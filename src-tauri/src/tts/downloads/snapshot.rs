use super::{hf_access_error, SnapshotLayout};
use crate::artifact_download::{ensure_download_not_cancelled, safe_join};
use futures_util::StreamExt;
use log::info;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    sync::{atomic::AtomicBool, Arc},
};
use tokio::{fs as tokio_fs, io::AsyncWriteExt};

pub(super) struct SnapshotRequest<'a> {
    pub repo_id: &'a str,
    pub install_dir: &'a Path,
    pub label: &'a str,
    pub layout: SnapshotLayout,
    pub cancel_flag: Option<&'a Arc<AtomicBool>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum Stage {
    Preparing,
    Downloading,
    Complete,
}

/// Keep the existing webview event contract, including null unknown totals.
#[derive(Clone, Debug, Serialize)]
pub(super) struct SnapshotProgress {
    repo_id: String,
    stage: Stage,
    file: Option<String>,
    file_index: Option<usize>,
    file_count: Option<usize>,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct Sibling {
    rfilename: String,
    size: Option<u64>,
}

#[derive(Deserialize)]
struct ModelInfo {
    siblings: Vec<Sibling>,
}

/// Transport configuration is independent of Tauri, so the real download path is testable.
pub(super) struct SnapshotSource {
    client: reqwest::Client,
    origin: String,
    token: Option<String>,
}

impl SnapshotSource {
    pub(super) fn hugging_face(token: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            origin: "https://huggingface.co".to_string(),
            token,
        }
    }

    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        let request = self.client.get(format!("{}{path}", self.origin));
        match self.token.as_deref() {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    pub(super) async fn download(
        &self,
        request: SnapshotRequest<'_>,
        emit: impl Fn(SnapshotProgress),
    ) -> Result<(), String> {
        let SnapshotRequest {
            repo_id,
            install_dir,
            label,
            layout,
            cancel_flag,
        } = request;
        ensure_download_not_cancelled(cancel_flag)?;
        let mut progress = SnapshotProgress {
            repo_id: repo_id.to_string(),
            stage: Stage::Preparing,
            file: None,
            file_index: None,
            file_count: None,
            downloaded_bytes: None,
            total_bytes: None,
            error: None,
        };
        emit(progress.clone());

        let api_path = format!("/api/models/{repo_id}");
        info!("HF snapshot: listing files from {}{api_path}", self.origin);
        let response = self
            .get(&api_path)
            .send()
            .await
            .map_err(|e| format!("Failed to query HuggingFace API for {label}: {e}"))?;
        check_response(
            &response,
            repo_id,
            &format!("Failed to query HuggingFace API for {label}"),
        )?;
        let model: ModelInfo = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse HuggingFace API response for {label}: {e}"))?;
        let file_count = model.siblings.len();
        progress.stage = Stage::Downloading;
        progress.file_index = Some(0);
        progress.file_count = Some(file_count);
        progress.downloaded_bytes = Some(0);
        progress.total_bytes = model.siblings.iter().try_fold(0_u64, |sum, file| {
            file.size.map(|size| sum.saturating_add(size))
        });
        emit(progress.clone());

        let destination = match layout {
            SnapshotLayout::RepositorySubdirectory => {
                safe_join(install_dir, repo_id.rsplit('/').next().unwrap_or(repo_id))?
            }
            SnapshotLayout::ExactDirectory => install_dir.to_path_buf(),
        };
        // Resolve every remote path before touching the installation directory.
        let paths = model
            .siblings
            .iter()
            .map(|file| safe_join(&destination, &file.rfilename))
            .collect::<Result<Vec<_>, _>>()?;
        ensure_download_not_cancelled(cancel_flag)?;
        if install_dir.exists() {
            fs::remove_dir_all(install_dir)
                .map_err(|e| format!("Failed to clear install dir for {label}: {e}"))?;
        }
        fs::create_dir_all(&destination)
            .map_err(|e| format!("Failed to create install dir for {label}: {e}"))?;

        let mut downloaded_bytes = 0_u64;
        for (index, (sibling, path)) in model.siblings.iter().zip(paths).enumerate() {
            ensure_download_not_cancelled(cancel_flag)?;
            let filename = &sibling.rfilename;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory for {filename}: {e}"))?;
            }
            info!("HF snapshot: downloading {filename}");
            progress.file = Some(filename.clone());
            progress.file_index = Some(index);
            emit(progress.clone());

            let response = self
                .get(&format!("/{repo_id}/resolve/main/{filename}"))
                .send()
                .await
                .map_err(|e| format!("Failed to download {filename}: {e}"))?;
            check_response(
                &response,
                repo_id,
                &format!("Failed to download {filename}"),
            )?;
            let mut file = tokio_fs::File::create(&path)
                .await
                .map_err(|e| format!("Failed to write {filename}: {e}"))?;
            let mut stream = response.bytes_stream();
            let mut last_emit_bytes = downloaded_bytes;
            while let Some(chunk) = stream.next().await {
                ensure_download_not_cancelled(cancel_flag)?;
                let chunk = chunk.map_err(|e| format!("Failed to read {filename}: {e}"))?;
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("Failed to write {filename}: {e}"))?;
                downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
                progress.downloaded_bytes = Some(downloaded_bytes);
                if downloaded_bytes.saturating_sub(last_emit_bytes) >= 1_048_576 {
                    emit(progress.clone());
                    last_emit_bytes = downloaded_bytes;
                }
            }
            file.flush()
                .await
                .map_err(|e| format!("Failed to finalize {filename}: {e}"))?;
            progress.file_index = Some(index + 1);
            emit(progress.clone());
        }

        info!("HF snapshot: completed {label} ({file_count} files)");
        progress.stage = Stage::Complete;
        progress.file = None;
        emit(progress);
        Ok(())
    }
}

fn check_response(
    response: &reqwest::Response,
    repo_id: &str,
    context: &str,
) -> Result<(), String> {
    match response.status().as_u16() {
        401 | 403 => Err(hf_access_error(repo_id)),
        _ if response.status().is_success() => Ok(()),
        _ => Err(format!("{context}: HTTP {}", response.status())),
    }
}

#[cfg(test)]
mod tests;
