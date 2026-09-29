//! TTS asset transfers. Catalog selection and engine preparation stay in TtsManager.
use super::{runtime::extract_archive, TtsManager};
use futures_util::StreamExt;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tauri::Emitter;
use uuid::Uuid;

mod snapshot;
use snapshot::{SnapshotRequest, SnapshotSource};

/// Packs keep their archive-compatible inner directory; MLX uses the destination itself.
#[derive(Clone, Copy, Debug)]
pub(super) enum SnapshotLayout {
    RepositorySubdirectory,
    ExactDirectory,
}

fn hf_get(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    let request = client.get(url);
    if let Some(token) = crate::speech_analysis::hugging_face_token_for_runtime() {
        request.bearer_auth(token)
    } else {
        request
    }
}

fn hf_access_error(repo_id: &str) -> String {
    format!(
        "{repo_id} requires Hugging Face access. Open https://huggingface.co/{repo_id}, accept the model terms, save a Hugging Face read token in Vox Jot, then download again."
    )
}

impl TtsManager {
    pub(super) async fn download_hf_file_set_into_dir(
        &self,
        repo_id: &str,
        files: &[(&str, &str)],
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        use tokio::fs as tokio_fs;
        use tokio::io::AsyncWriteExt;

        if files.is_empty() {
            return Err(format!("No files configured for {label}."));
        }

        let parent = install_dir
            .parent()
            .ok_or_else(|| format!("Invalid install directory '{}'.", install_dir.display()))?;
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
        let staging_dir = parent.join(format!(
            ".staging-{}-{}",
            install_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("tts-model"),
            Uuid::new_v4()
        ));
        tokio_fs::create_dir_all(&staging_dir)
            .await
            .map_err(|err| format!("Failed to create staging dir for {label}: {err}"))?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(900))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        for (source, destination) in files {
            let encoded = source
                .split('/')
                .map(|segment| segment.replace(' ', "%20"))
                .collect::<Vec<_>>()
                .join("/");
            let url = format!("https://huggingface.co/{repo_id}/resolve/main/{encoded}");
            let target = staging_dir.join(destination);
            if let Some(parent) = target.parent() {
                tokio_fs::create_dir_all(parent)
                    .await
                    .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
            }

            let response = hf_get(&client, &url)
                .send()
                .await
                .map_err(|err| format!("Failed to fetch {source} for {label}: {err}"))?;
            if !response.status().is_success() {
                let _ = tokio_fs::remove_dir_all(&staging_dir).await;
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                    return Err(hf_access_error(repo_id));
                }
                return Err(format!(
                    "Failed to download {source} for {label}: HTTP {}",
                    response.status()
                ));
            }

            let mut output = tokio_fs::File::create(&target)
                .await
                .map_err(|err| format!("Failed to create {}: {err}", target.display()))?;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|err| format!("Download stream failed for {source}: {err}"))?;
                output
                    .write_all(&chunk)
                    .await
                    .map_err(|err| format!("Failed to write {source}: {err}"))?;
            }
            output
                .flush()
                .await
                .map_err(|err| format!("Failed to flush {source}: {err}"))?;
        }

        if install_dir.exists() {
            tokio_fs::remove_dir_all(install_dir)
                .await
                .map_err(|err| format!("Failed to clear existing {label}: {err}"))?;
        }
        tokio_fs::rename(&staging_dir, install_dir)
            .await
            .map_err(|err| {
                format!(
                    "Failed to install {label} ({} -> {}): {err}",
                    staging_dir.display(),
                    install_dir.display()
                )
            })?;
        Ok(())
    }

    pub(super) async fn download_and_extract_archive(
        &self,
        candidate_urls: &[String],
        install_dir: &Path,
        label: &str,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> Result<(), String> {
        let download_dir = crate::storage_paths::tts_downloads_dir(&self.app_handle)
            .map_err(|err| format!("TTS dir error: {err}"))?;
        fs::create_dir_all(&download_dir)
            .map_err(|err| format!("Failed to create TTS download dir: {err}"))?;

        let mut last_error = None;
        for url in candidate_urls {
            crate::artifact_download::ensure_download_not_cancelled(cancel_flag.as_ref())?;
            match self
                .download_archive(url, &download_dir, label, cancel_flag.clone())
                .await
            {
                Ok(archive_path) => {
                    let extract_result = extract_archive(&archive_path, install_dir);
                    let _ = fs::remove_file(&archive_path);
                    return extract_result;
                }
                Err(err) => last_error = Some(err),
            }
        }

        Err(last_error.unwrap_or_else(|| format!("Failed to download {label}.")))
    }

    async fn download_archive(
        &self,
        url: &str,
        download_dir: &Path,
        label: &str,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> Result<PathBuf, String> {
        let file_name = url
            .split('/')
            .next_back()
            .filter(|name| !name.is_empty())
            .unwrap_or("tts-asset.tar.gz");
        let archive_path = download_dir.join(file_name);
        let partial_path = download_dir.join(format!("{file_name}.partial"));
        if archive_path.exists() {
            fs::remove_file(&archive_path)
                .map_err(|err| format!("Failed to clear previous {label} archive: {err}"))?;
        }

        let progress_app = self.app_handle.clone();
        let artifact_id = label.to_string();
        let progress = std::sync::Arc::new(move |progress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress);
        });

        crate::artifact_download::download_file(crate::artifact_download::FileDownloadOptions {
            domain: "tts".to_string(),
            artifact_id,
            url: url.to_string(),
            partial_path,
            final_path: archive_path.clone(),
            expected_sha256: None,
            expected_size: None,
            bearer_token: None,
            cancel_flag,
            progress: Some(progress),
        })
        .await
        .map(|report| report.final_path)
    }

    pub(super) async fn download_hf_files_into_existing_dir(
        &self,
        repo_id: &str,
        files: &[(&str, &str)],
        install_dir: &Path,
        label: &str,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> Result<(), String> {
        use tokio::fs as tokio_fs;
        use tokio::io::AsyncWriteExt;

        fs::create_dir_all(install_dir)
            .map_err(|err| format!("Failed to create install dir for {label}: {err}"))?;

        let client = reqwest::Client::new();
        for (idx, (source, destination)) in files.iter().enumerate() {
            crate::artifact_download::ensure_download_not_cancelled(cancel_flag.as_ref())?;
            let file_url = format!("https://huggingface.co/{repo_id}/resolve/main/{source}");
            let target = install_dir.join(destination);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    format!("Failed to create directory for {}: {err}", target.display())
                })?;
            }

            self.emit_tts_hf_download_progress(
                repo_id,
                "downloading",
                Some(source),
                Some(idx),
                Some(files.len()),
                None,
                None,
                None,
            );

            let response = hf_get(&client, &file_url)
                .send()
                .await
                .map_err(|err| format!("Failed to fetch {source} for {label}: {err}"))?;
            if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                return Err(hf_access_error(repo_id));
            }
            if !response.status().is_success() {
                return Err(format!(
                    "Failed to download {source} for {label}: HTTP {}",
                    response.status()
                ));
            }

            let mut output = tokio_fs::File::create(&target)
                .await
                .map_err(|err| format!("Failed to create {}: {err}", target.display()))?;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                crate::artifact_download::ensure_download_not_cancelled(cancel_flag.as_ref())?;
                let chunk =
                    chunk.map_err(|err| format!("Download stream failed for {source}: {err}"))?;
                output
                    .write_all(&chunk)
                    .await
                    .map_err(|err| format!("Failed to write {source}: {err}"))?;
            }
            output
                .flush()
                .await
                .map_err(|err| format!("Failed to flush {source}: {err}"))?;
        }

        self.emit_tts_hf_download_progress(
            repo_id,
            "complete",
            None,
            Some(files.len()),
            Some(files.len()),
            None,
            None,
            None,
        );
        Ok(())
    }

    fn emit_tts_hf_download_progress(
        &self,
        repo_id: &str,
        stage: &str,
        file: Option<&str>,
        file_index: Option<usize>,
        file_count: Option<usize>,
        downloaded_bytes: Option<u64>,
        total_bytes: Option<u64>,
        error: Option<&str>,
    ) {
        let payload = serde_json::json!({
            "repo_id": repo_id,
            "stage": stage,
            "file": file,
            "file_index": file_index,
            "file_count": file_count,
            "downloaded_bytes": downloaded_bytes,
            "total_bytes": total_bytes,
            "error": error,
        });
        let _ = self.app_handle.emit("tts-hf-download-progress", payload);
    }

    pub(super) async fn download_hf_snapshot(
        &self,
        repo_id: &str,
        install_dir: &Path,
        label: &str,
        layout: SnapshotLayout,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> Result<(), String> {
        let source =
            SnapshotSource::hugging_face(crate::speech_analysis::hugging_face_token_for_runtime());
        source
            .download(
                SnapshotRequest {
                    repo_id,
                    install_dir,
                    label,
                    layout,
                    cancel_flag: cancel_flag.as_ref(),
                },
                |progress| {
                    let _ = self.app_handle.emit("tts-hf-download-progress", progress);
                },
            )
            .await
    }
}
