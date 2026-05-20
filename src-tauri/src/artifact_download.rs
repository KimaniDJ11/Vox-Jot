use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::path::{Component, Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs as tokio_fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const DOWNLOAD_CANCELLED_MESSAGE: &str = "Download cancelled.";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ArtifactProgress {
    pub domain: String,
    pub artifact_id: String,
    pub phase: String,
    pub file: Option<String>,
    pub file_index: Option<usize>,
    pub file_count: Option<usize>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub error: Option<String>,
}

pub type ProgressCallback = Arc<dyn Fn(ArtifactProgress) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct HfRepoFile {
    pub path: String,
    pub size: Option<u64>,
}

#[derive(Clone)]
pub struct HfRepoDownloadOptions {
    pub domain: String,
    pub artifact_id: String,
    pub repo_id: String,
    pub staging_dir: PathBuf,
    pub final_dir: PathBuf,
    pub token: Option<String>,
    pub gated: bool,
    pub resume_existing_staging: bool,
    pub cancel_flag: Option<Arc<AtomicBool>>,
    pub progress: Option<ProgressCallback>,
}

#[derive(Debug, Clone)]
pub struct HfRepoDownloadReport {
    pub final_dir: PathBuf,
    pub file_count: usize,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Clone)]
pub struct FileDownloadOptions {
    pub domain: String,
    pub artifact_id: String,
    pub url: String,
    pub partial_path: PathBuf,
    pub final_path: PathBuf,
    pub expected_sha256: Option<String>,
    pub expected_size: Option<u64>,
    pub cancel_flag: Option<Arc<AtomicBool>>,
    pub progress: Option<ProgressCallback>,
}

#[derive(Debug, Clone)]
pub struct FileDownloadReport {
    pub final_path: PathBuf,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct HfModelInfo {
    #[serde(default)]
    siblings: Vec<HfSibling>,
}

pub fn default_hf_file_filter(path: &str) -> bool {
    !path.starts_with('.')
        && !path.contains("/.cache/")
        && !path.starts_with(".cache/")
        && !path.contains("/.git/")
        && !path.starts_with(".git/")
}

pub fn encode_hf_path(rel_path: &str) -> String {
    rel_path
        .split('/')
        .map(|seg| seg.replace(' ', "%20"))
        .collect::<Vec<_>>()
        .join("/")
}

pub fn emit_artifact_progress(app: &AppHandle, progress: ArtifactProgress) {
    let _ = app.emit("artifact-download-progress", progress);
}

pub fn progress(
    domain: &str,
    artifact_id: &str,
    phase: &str,
    file: Option<&str>,
    file_index: Option<usize>,
    file_count: Option<usize>,
    downloaded_bytes: u64,
    total_bytes: u64,
    error: Option<&str>,
) -> ArtifactProgress {
    let percentage = if total_bytes > 0 {
        ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    ArtifactProgress {
        domain: domain.to_string(),
        artifact_id: artifact_id.to_string(),
        phase: phase.to_string(),
        file: file.map(str::to_string),
        file_index,
        file_count,
        downloaded_bytes,
        total_bytes,
        percentage,
        error: error.map(str::to_string),
    }
}

fn emit(options: &HfRepoDownloadOptions, progress: ArtifactProgress) {
    if let Some(callback) = &options.progress {
        callback(progress);
    }
}

fn emit_file(options: &FileDownloadOptions, progress: ArtifactProgress) {
    if let Some(callback) = &options.progress {
        callback(progress);
    }
}

fn ensure_not_cancelled(cancel_flag: Option<&Arc<AtomicBool>>) -> Result<(), String> {
    if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err(DOWNLOAD_CANCELLED_MESSAGE.to_string());
    }
    Ok(())
}

pub fn is_cancelled_error(error: &str) -> bool {
    error == DOWNLOAD_CANCELLED_MESSAGE
}

fn hf_request<'a>(
    client: &'a reqwest::Client,
    url: &'a str,
    token: Option<&'a str>,
) -> reqwest::RequestBuilder {
    let request = client.get(url);
    if let Some(token) = token.filter(|token| !token.trim().is_empty()) {
        request.bearer_auth(token)
    } else {
        request
    }
}

fn hf_head_request<'a>(
    client: &'a reqwest::Client,
    url: &'a str,
    token: Option<&'a str>,
) -> reqwest::RequestBuilder {
    let request = client.head(url);
    if let Some(token) = token.filter(|token| !token.trim().is_empty()) {
        request.bearer_auth(token)
    } else {
        request
    }
}

pub async fn fetch_hf_repo_files<F>(
    client: &reqwest::Client,
    repo_id: &str,
    token: Option<&str>,
    gated: bool,
    filter: F,
) -> Result<Vec<HfRepoFile>, String>
where
    F: Fn(&str) -> bool,
{
    if gated && token.is_none() {
        return Err(format!(
            "{repo_id} requires Hugging Face access. Accept the model terms and save a read token before downloading."
        ));
    }

    let url = format!("https://huggingface.co/api/models/{repo_id}");
    let resp = hf_request(client, &url, token)
        .send()
        .await
        .map_err(|err| format!("Failed to query {repo_id}: {err}"))?;

    if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        let token_hint = if gated {
            " Accept the model terms on Hugging Face, then save a read token in Vox Jot."
        } else {
            " Save a Hugging Face read token if this repo requires authentication."
        };
        return Err(format!(
            "{repo_id} cannot be accessed from Hugging Face.{token_hint}"
        ));
    }
    if resp.status().as_u16() == 404 {
        return Err(format!("{repo_id} was not found on Hugging Face."));
    }
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to fetch repo info for {repo_id}: HTTP {}",
            resp.status()
        ));
    }

    let info: HfModelInfo = resp
        .json()
        .await
        .map_err(|err| format!("Failed to decode repo info for {repo_id}: {err}"))?;
    let files = info
        .siblings
        .into_iter()
        .filter(|sibling| filter(&sibling.rfilename))
        .map(|sibling| HfRepoFile {
            path: sibling.rfilename,
            size: sibling.size,
        })
        .collect::<Vec<_>>();

    if files.is_empty() {
        return Err(format!("No downloadable files in {repo_id}."));
    }

    Ok(files)
}

pub async fn resolve_remote_file_size(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> Option<u64> {
    if let Ok(no_redir) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        if let Ok(resp) = hf_head_request(&no_redir, url, token).send().await {
            if let Some(linked) = resp
                .headers()
                .get("x-linked-size")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
            {
                return Some(linked);
            }
        }
    }

    hf_head_request(client, url, token)
        .send()
        .await
        .ok()
        .and_then(|resp| resp.content_length())
}

async fn local_file_len(path: &Path) -> Result<Option<u64>, String> {
    match tokio_fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() => Ok(Some(metadata.len())),
        Ok(_) => Ok(None),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Failed to inspect {}: {err}", path.display())),
    }
}

fn safe_join(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel_path);
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            _ => return Err(format!("Unsafe artifact path: {rel_path}")),
        }
    }
    if safe.as_os_str().is_empty() {
        return Err("Artifact path is empty.".to_string());
    }
    Ok(root.join(safe))
}

pub async fn download_hf_repo(
    options: HfRepoDownloadOptions,
) -> Result<HfRepoDownloadReport, String> {
    if !options.repo_id.contains('/') {
        return Err(format!(
            "Invalid Hugging Face repo id '{}'.",
            options.repo_id
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1800))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let token = options.token.as_deref();

    emit(
        &options,
        progress(
            &options.domain,
            &options.artifact_id,
            "preparing",
            None,
            None,
            None,
            0,
            0,
            None,
        ),
    );

    let mut files = fetch_hf_repo_files(
        &client,
        &options.repo_id,
        token,
        options.gated,
        default_hf_file_filter,
    )
    .await?;
    files.sort_by(|a, b| a.path.cmp(&b.path));

    let mut total_bytes = 0u64;
    for file in &mut files {
        ensure_not_cancelled(options.cancel_flag.as_ref())?;
        if file.size.is_none() {
            let url = format!(
                "https://huggingface.co/{}/resolve/main/{}",
                options.repo_id,
                encode_hf_path(&file.path)
            );
            file.size = resolve_remote_file_size(&client, &url, token).await;
        }
        if let Some(size) = file.size {
            total_bytes = total_bytes.saturating_add(size);
        }
    }

    let had_staging = options.staging_dir.exists();
    if had_staging && !options.resume_existing_staging {
        tokio_fs::remove_dir_all(&options.staging_dir)
            .await
            .map_err(|err| format!("Failed to clear staging dir: {err}"))?;
    } else if had_staging && !options.staging_dir.is_dir() {
        tokio_fs::remove_file(&options.staging_dir)
            .await
            .map_err(|err| format!("Failed to clear invalid staging file: {err}"))?;
    }
    tokio_fs::create_dir_all(&options.staging_dir)
        .await
        .map_err(|err| format!("Failed to create staging dir: {err}"))?;

    let file_count = files.len();
    let mut downloaded_bytes = 0u64;
    let initial_phase = if had_staging && options.resume_existing_staging {
        "recovering"
    } else {
        "downloading"
    };
    emit(
        &options,
        progress(
            &options.domain,
            &options.artifact_id,
            initial_phase,
            None,
            Some(0),
            Some(file_count),
            0,
            total_bytes,
            None,
        ),
    );

    for (index, file) in files.iter().enumerate() {
        ensure_not_cancelled(options.cancel_flag.as_ref())?;
        let target = safe_join(&options.staging_dir, &file.path)?;
        if let Some(parent) = target.parent() {
            tokio_fs::create_dir_all(parent)
                .await
                .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
        }

        let existing_len = local_file_len(&target).await?.unwrap_or(0);
        if let Some(expected) = file.size {
            if existing_len == expected {
                downloaded_bytes = downloaded_bytes.saturating_add(existing_len);
                emit(
                    &options,
                    progress(
                        &options.domain,
                        &options.artifact_id,
                        initial_phase,
                        Some(&file.path),
                        Some(index + 1),
                        Some(file_count),
                        downloaded_bytes,
                        total_bytes,
                        None,
                    ),
                );
                continue;
            }
        }

        let mut resume_from = match file.size {
            Some(expected) if existing_len > 0 && existing_len < expected => existing_len,
            _ => 0,
        };
        downloaded_bytes = downloaded_bytes.saturating_add(resume_from);

        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}",
            options.repo_id,
            encode_hf_path(&file.path)
        );
        let mut request = hf_request(&client, &url, token);
        if resume_from > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
        }

        emit(
            &options,
            progress(
                &options.domain,
                &options.artifact_id,
                "downloading",
                Some(&file.path),
                Some(index + 1),
                Some(file_count),
                downloaded_bytes,
                total_bytes,
                None,
            ),
        );

        let response = request
            .send()
            .await
            .map_err(|err| format!("Failed to fetch {}: {err}", file.path))?;
        let status = response.status();
        let is_resuming = resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
        if !status.is_success() {
            return Err(format!("Failed to download {}: HTTP {status}", file.path));
        }
        if resume_from > 0 && !is_resuming {
            downloaded_bytes = downloaded_bytes.saturating_sub(resume_from);
            resume_from = 0;
        }

        let mut open_options = tokio_fs::OpenOptions::new();
        open_options.create(true).write(true);
        if is_resuming {
            open_options.append(true);
        } else {
            open_options.truncate(true);
        }
        let mut output = open_options
            .open(&target)
            .await
            .map_err(|err| format!("Failed to open {}: {err}", target.display()))?;

        let mut stream = response.bytes_stream();
        let mut last_emit = Instant::now();
        let throttle = Duration::from_millis(200);
        while let Some(chunk) = stream.next().await {
            ensure_not_cancelled(options.cancel_flag.as_ref())?;
            let chunk = chunk.map_err(|err| format!("Stream failed for {}: {err}", file.path))?;
            output
                .write_all(&chunk)
                .await
                .map_err(|err| format!("Failed to write {}: {err}", file.path))?;
            downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);

            if last_emit.elapsed() >= throttle {
                emit(
                    &options,
                    progress(
                        &options.domain,
                        &options.artifact_id,
                        "downloading",
                        Some(&file.path),
                        Some(index + 1),
                        Some(file_count),
                        downloaded_bytes,
                        total_bytes,
                        None,
                    ),
                );
                last_emit = Instant::now();
            }
        }
        output
            .flush()
            .await
            .map_err(|err| format!("Failed to flush {}: {err}", file.path))?;

        if let Some(expected) = file.size {
            let actual = local_file_len(&target).await?.unwrap_or(0);
            if actual != expected {
                return Err(format!(
                    "Downloaded {} but expected {expected} bytes and found {actual} bytes.",
                    file.path
                ));
            }
        }

        if resume_from == 0 && file.size.is_none() {
            downloaded_bytes = downloaded_bytes.max(local_file_len(&target).await?.unwrap_or(0));
        }
        emit(
            &options,
            progress(
                &options.domain,
                &options.artifact_id,
                "downloading",
                Some(&file.path),
                Some(index + 1),
                Some(file_count),
                downloaded_bytes,
                total_bytes,
                None,
            ),
        );
    }

    ensure_not_cancelled(options.cancel_flag.as_ref())?;
    emit(
        &options,
        progress(
            &options.domain,
            &options.artifact_id,
            "installing",
            None,
            Some(file_count),
            Some(file_count),
            downloaded_bytes,
            total_bytes,
            None,
        ),
    );

    if let Some(parent) = options.final_dir.parent() {
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    }
    if options.final_dir.exists() {
        tokio_fs::remove_dir_all(&options.final_dir)
            .await
            .map_err(|err| format!("Failed to clear existing install: {err}"))?;
    }
    tokio_fs::rename(&options.staging_dir, &options.final_dir)
        .await
        .map_err(|err| {
            format!(
                "Failed to move staging into place ({} -> {}): {err}",
                options.staging_dir.display(),
                options.final_dir.display()
            )
        })?;

    emit(
        &options,
        progress(
            &options.domain,
            &options.artifact_id,
            "complete",
            None,
            Some(file_count),
            Some(file_count),
            downloaded_bytes,
            total_bytes,
            None,
        ),
    );

    Ok(HfRepoDownloadReport {
        final_dir: options.final_dir,
        file_count,
        downloaded_bytes,
        total_bytes,
    })
}

pub async fn download_file(options: FileDownloadOptions) -> Result<FileDownloadReport, String> {
    let client = reqwest::Client::new();
    if let Some(parent) = options.partial_path.parent() {
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    }

    let mut resume_from = local_file_len(&options.partial_path).await?.unwrap_or(0);
    emit_file(
        &options,
        progress(
            &options.domain,
            &options.artifact_id,
            "downloading",
            None,
            None,
            None,
            resume_from,
            options.expected_size.unwrap_or(0),
            None,
        ),
    );

    let mut response = crate::github_release::get_with_optional_github_auth(
        &client,
        &options.url,
        Some(resume_from),
    )
    .await
    .map_err(|err| format!("Failed to download {}: {err}", options.url))?;
    let status = response.status();
    if resume_from > 0 && status == reqwest::StatusCode::OK {
        let _ = tokio_fs::remove_file(&options.partial_path).await;
        resume_from = 0;
        response =
            crate::github_release::get_with_optional_github_auth(&client, &options.url, None)
                .await
                .map_err(|err| format!("Failed to restart {}: {err}", options.url))?;
    }
    let status = response.status();
    let is_resuming = resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if !status.is_success() {
        return Err(format!(
            "Failed to download {}: HTTP {}",
            options.artifact_id, status
        ));
    }
    if resume_from > 0 && !is_resuming {
        let _ = tokio_fs::remove_file(&options.partial_path).await;
        resume_from = 0;
    }

    let response_total = if resume_from > 0 {
        resume_from.saturating_add(response.content_length().unwrap_or(0))
    } else {
        response
            .content_length()
            .or(options.expected_size)
            .unwrap_or(0)
    };
    let mut open_options = tokio_fs::OpenOptions::new();
    open_options.create(true).write(true);
    if is_resuming {
        open_options.append(true);
    } else {
        open_options.truncate(true);
    }
    let mut output = open_options
        .open(&options.partial_path)
        .await
        .map_err(|err| format!("Failed to open {}: {err}", options.partial_path.display()))?;

    let mut downloaded = resume_from;
    let mut stream = response.bytes_stream();
    let throttle = Duration::from_millis(200);
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        ensure_not_cancelled(options.cancel_flag.as_ref())?;
        let chunk = chunk.map_err(|err| format!("Download stream failed: {err}"))?;
        output
            .write_all(&chunk)
            .await
            .map_err(|err| format!("Failed to write {}: {err}", options.partial_path.display()))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if last_emit.elapsed() >= throttle {
            emit_file(
                &options,
                progress(
                    &options.domain,
                    &options.artifact_id,
                    "downloading",
                    None,
                    None,
                    None,
                    downloaded,
                    response_total,
                    None,
                ),
            );
            last_emit = Instant::now();
        }
    }
    output
        .flush()
        .await
        .map_err(|err| format!("Failed to flush {}: {err}", options.partial_path.display()))?;

    if response_total > 0 && downloaded != response_total {
        let _ = tokio_fs::remove_file(&options.partial_path).await;
        return Err(format!(
            "Download incomplete for {}: got {downloaded} bytes, expected {response_total}.",
            options.artifact_id
        ));
    }

    if let Some(expected_sha256) = options.expected_sha256.as_deref() {
        let actual = sha256_file(&options.partial_path).await?;
        if !actual.eq_ignore_ascii_case(expected_sha256.trim()) {
            let _ = tokio_fs::remove_file(&options.partial_path).await;
            return Err(format!(
                "SHA-256 mismatch for {}: expected {}, got {}.",
                options.artifact_id, expected_sha256, actual
            ));
        }
    }

    if let Some(parent) = options.final_path.parent() {
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    }
    tokio_fs::rename(&options.partial_path, &options.final_path)
        .await
        .map_err(|err| {
            format!(
                "Failed to finalize download ({} -> {}): {err}",
                options.partial_path.display(),
                options.final_path.display()
            )
        })?;

    emit_file(
        &options,
        progress(
            &options.domain,
            &options.artifact_id,
            "complete",
            None,
            None,
            None,
            downloaded,
            response_total,
            None,
        ),
    );

    Ok(FileDownloadReport {
        final_path: options.final_path,
        downloaded_bytes: downloaded,
        total_bytes: response_total,
    })
}

async fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = tokio_fs::File::open(path)
        .await
        .map_err(|err| format!("Failed to open {} for checksum: {err}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let bytes_read = file
            .read(&mut buffer)
            .await
            .map_err(|err| format!("Failed to read {} for checksum: {err}", path.display()))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::{default_hf_file_filter, encode_hf_path, safe_join};
    use std::path::Path;

    #[test]
    fn hf_path_encoding_preserves_segments() {
        assert_eq!(
            encode_hf_path("a dir/model file.bin"),
            "a%20dir/model%20file.bin"
        );
    }

    #[test]
    fn default_filter_excludes_hidden_and_cache_entries() {
        assert!(!default_hf_file_filter(".gitattributes"));
        assert!(!default_hf_file_filter("foo/.cache/blob"));
        assert!(!default_hf_file_filter(".git/config"));
        assert!(default_hf_file_filter("model.safetensors"));
    }

    #[test]
    fn safe_join_rejects_traversal() {
        assert!(safe_join(Path::new("/tmp/root"), "../outside").is_err());
        assert!(safe_join(Path::new("/tmp/root"), "/absolute").is_err());
        assert_eq!(
            safe_join(Path::new("/tmp/root"), "nested/model.bin").unwrap(),
            Path::new("/tmp/root").join("nested/model.bin")
        );
    }
}
