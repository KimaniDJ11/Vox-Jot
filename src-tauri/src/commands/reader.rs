use quick_xml::escape::unescape;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use zip::ZipArchive;

const MAX_SECTION_CHARS: usize = 1_800;
const READER_DOCUMENTS_DIR: &str = "documents";
const READER_AUDIO_CACHE_DIR: &str = "audio-cache";
const READER_LIBRARY_FILE: &str = "library.json";
const READER_RUNTIME_VERSION: &str =
    "reader-runtime-v1|PyMuPDF==1.24.14|python-docx==1.1.2|ebooklib==0.18";
const READER_RUNTIME_PACKAGES: &[&str] =
    &["PyMuPDF==1.24.14", "python-docx==1.1.2", "ebooklib==0.18"];
// Optional precise word-alignment dependency, installed on demand and kept
// separate from the mandatory extraction packages so an install failure can
// never break document import (playback falls back to proportional timings).
// Pinned to an exact version for reproducible, auditable installs.
const READER_ALIGN_VERSION: &str = "reader-align-v2|faster-whisper==1.0.3";
const READER_ALIGN_PACKAGES: &[&str] = &["faster-whisper==1.0.3"];

// Resource limits for document import / page render. These bound memory, disk,
// and worker time so a huge or hostile document can't exhaust the host or stall
// a blocking worker. Extraction/render run in untrusted-input territory (the
// document is attacker-controllable), so every subprocess is time-boxed and its
// stdout is capped.
const MAX_READER_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_READER_TEXT_CHARS: usize = 5_000_000;
const MAX_READER_FALLBACK_XML_BYTES: u64 = 64 * 1024 * 1024;
const READER_EXTRACT_TIMEOUT: Duration = Duration::from_secs(180);
const READER_RENDER_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_READER_EXTRACT_STDOUT_BYTES: usize = 96 * 1024 * 1024;
const MAX_READER_RENDER_STDOUT_BYTES: usize = 48 * 1024 * 1024;
const READER_SUBPROCESS_STDERR_CAP: usize = 64 * 1024;
const NO_EXTRACTABLE_PDF_TEXT: &str =
    "This PDF opened, but Vox Jot could not find selectable text to read aloud.";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ReaderDocumentKind {
    Pdf,
    Docx,
    Epub,
    Markdown,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderDocumentSection {
    pub index: usize,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderDocumentBbox {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderDocumentBlock {
    pub index: usize,
    pub text: String,
    pub kind: String,
    pub bbox: Option<ReaderDocumentBbox>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderDocumentPage {
    pub index: usize,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub blocks: Vec<ReaderDocumentBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderDocument {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: ReaderDocumentKind,
    pub size_bytes: u64,
    pub source_modified_ms: Option<u64>,
    pub word_count: usize,
    pub page_count: usize,
    pub extraction_engine: String,
    pub thumbnail_data_url: Option<String>,
    pub text: String,
    pub pages: Vec<ReaderDocumentPage>,
    pub sections: Vec<ReaderDocumentSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderStoredDocument {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: ReaderDocumentKind,
    pub size_bytes: u64,
    pub source_modified_ms: Option<u64>,
    pub word_count: usize,
    pub page_count: usize,
    pub section_count: usize,
    pub extraction_engine: String,
    pub thumbnail_data_url: Option<String>,
    pub imported_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ReaderLibraryStore {
    #[serde(default)]
    documents: Vec<ReaderStoredDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReaderDocumentCacheEnvelope {
    source_path: String,
    source_size: u64,
    source_modified_ms: Option<u64>,
    cached_at_ms: u64,
    document: ReaderDocument,
}

#[tauri::command]
#[specta::specta]
pub async fn read_reader_document(
    app: AppHandle,
    source_path: String,
) -> Result<ReaderDocument, String> {
    tokio::task::spawn_blocking(move || {
        let extractor_path = resolve_reader_extractor(&app).ok();
        let python_path = ensure_reader_python(&app)
            .ok()
            .or_else(locate_reader_python);
        let reader_data_dir = crate::storage_paths::reader_data_dir(&app).ok();
        read_reader_document_blocking(
            &source_path,
            extractor_path.as_deref(),
            python_path.as_deref(),
            reader_data_dir.as_deref(),
        )
    })
    .await
    .map_err(|err| format!("Reader document task failed: {err}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn list_reader_documents(app: AppHandle) -> Result<Vec<ReaderStoredDocument>, String> {
    tokio::task::spawn_blocking(move || {
        let reader_data_dir = crate::storage_paths::reader_data_dir(&app)
            .map_err(|err| format!("Failed to resolve Reader library directory: {err}"))?;
        Ok(read_reader_library_store(&reader_data_dir)
            .unwrap_or_default()
            .documents)
    })
    .await
    .map_err(|err| format!("Reader library task failed: {err}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn remove_reader_document(app: AppHandle, id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let reader_data_dir = crate::storage_paths::reader_data_dir(&app)
            .map_err(|err| format!("Failed to resolve Reader library directory: {err}"))?;
        remove_reader_document_from_store(&reader_data_dir, &id)
    })
    .await
    .map_err(|err| format!("Reader remove task failed: {err}"))?
}

/// Max characters of document text sent to the AI for a transform. Keeps the
/// request within typical context windows and bounds cost for large books.
const READER_TRANSFORM_MAX_INPUT_CHARS: usize = 24_000;

fn reader_transform_prompts(task: &str) -> Result<(&'static str, &'static str), String> {
    Ok(match task {
        "summarize" => (
            "You are a precise summarizer. Produce a faithful, well-organized summary and return only the summary.",
            "Summarize the following document into a clear overview of the key points, using short paragraphs or bullet points.",
        ),
        "cleanup" => (
            "You tidy up extracted document text so it reads naturally aloud. Return only the cleaned text.",
            "Clean up the following extracted text: repair broken line breaks, hyphenation, and spacing, and drop stray page numbers or artifacts. Preserve all wording and meaning.",
        ),
        "notes" => (
            "You convert documents into structured study notes. Return only the notes.",
            "Turn the following document into structured notes with clear headings and concise bullet points.",
        ),
        "action_items" => (
            "You extract concrete action items from documents. Return only a bulleted list.",
            "Extract the concrete action items, tasks, or follow-ups from the following document as a bulleted list. If there are none, say there are no action items.",
        ),
        other => return Err(format!("Unknown Reader transform task: {other}")),
    })
}

/// Run an AI transform (summarize / clean up / notes / action items) over the
/// document text using the user's configured post-processing provider — the
/// same provider/model/key resolution as dictation post-processing, so it
/// reuses Ollama, Apple Intelligence, OpenAI, ModelScope, etc.
#[tauri::command]
#[specta::specta]
pub async fn reader_transform_text(
    app: AppHandle,
    text: String,
    task: String,
) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("There is no document text to transform.".to_string());
    }
    let (system_prompt, instruction) = reader_transform_prompts(&task)?;

    let mut input = trimmed.to_string();
    if input.chars().count() > READER_TRANSFORM_MAX_INPUT_CHARS {
        let truncated: String = input
            .chars()
            .take(READER_TRANSFORM_MAX_INPUT_CHARS)
            .collect();
        input = format!("{truncated}\n\n[Document truncated for length.]");
    }
    let user_prompt = format!("{instruction}\n\nDocument:\n{input}");

    let settings = crate::settings::get_settings(&app);
    let provider = settings.active_post_process_provider().cloned().ok_or_else(|| {
        "No AI provider is configured. Choose a provider and model under Settings → Models & AI."
            .to_string()
    })?;

    if settings.local_privacy_mode && !crate::settings::post_process_provider_is_local(&provider) {
        return Err(
            "Local privacy mode is on. Choose a local AI provider to transform documents."
                .to_string(),
        );
    }

    if provider.id == crate::settings::APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return tokio::task::spawn_blocking(move || {
                crate::apple_intelligence::process_text_with_system_prompt(
                    system_prompt,
                    &user_prompt,
                    0,
                )
            })
            .await
            .map_err(|err| format!("Reader transform task failed: {err}"))?;
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            let _ = system_prompt;
            return Err("Apple Intelligence is only available on Apple silicon Macs.".to_string());
        }
    }

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        return Err(format!(
            "No model is selected for {}. Pick a model under Settings → Models & AI.",
            provider.label
        ));
    }

    let api_key = crate::secret_store::get_post_process_api_key(&provider.id)
        .unwrap_or_default()
        .unwrap_or_default();

    let combined_prompt = format!("{system_prompt}\n\n{user_prompt}");
    crate::llm_client::send_chat_completion(&provider, api_key, &model, combined_prompt)
        .await
        .map_err(|err| format!("AI request failed: {err}"))?
        .ok_or_else(|| "The AI provider returned an empty response.".to_string())
}

fn read_reader_document_blocking(
    source_path: &str,
    extractor_path: Option<&Path>,
    python_path: Option<&Path>,
    reader_data_dir: Option<&Path>,
) -> Result<ReaderDocument, String> {
    let path = PathBuf::from(source_path);
    let id = reader_document_id(&path);
    if !path.is_file() {
        if let Some(reader_data_dir) = reader_data_dir {
            if let Some(document) = read_cached_reader_document_by_id(reader_data_dir, &id) {
                return Ok(document);
            }
        }
        return Err(format!("'{}' is not a readable file.", source_path));
    }

    let metadata = fs::metadata(&path)
        .map_err(|err| format!("Failed to inspect '{}': {err}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Document")
        .to_string();
    let kind = kind_from_path(&path)?;
    let source_modified_ms = metadata.modified().ok().and_then(system_time_millis);

    if let Some(reader_data_dir) = reader_data_dir {
        if let Some(document) =
            read_cached_reader_document(reader_data_dir, &id, metadata.len(), source_modified_ms)
        {
            // Don't serve a degraded cache (Rust fallback / placeholder — no
            // thumbnail, no layout) when the Python extractor is now available.
            // Re-extract so the preview + layout upgrade takes effect without the
            // user having to remove and re-add the document.
            let python_available = extractor_path.is_some() && python_path.is_some();
            let degraded = matches!(
                document.extraction_engine.as_str(),
                "rust-fallback" | "pdf-placeholder"
            );
            if !(degraded && python_available) {
                return Ok(document);
            }
        }
    }

    // Past the cache: any path below re-extracts, which reads the whole file.
    // Reject oversized documents before spending memory/CPU on extraction.
    if metadata.len() > MAX_READER_FILE_BYTES {
        return Err(format!(
            "This document is too large to open ({:.0} MB). The limit is {} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_READER_FILE_BYTES / (1024 * 1024)
        ));
    }

    if let (Some(extractor_path), Some(python_path)) = (extractor_path, python_path) {
        match extract_with_python(&path, extractor_path, python_path) {
            Ok(extracted) => {
                let document = build_reader_document_from_extraction(
                    id,
                    &path,
                    metadata.len(),
                    source_modified_ms,
                    name,
                    kind,
                    extracted,
                )?;
                if let Some(reader_data_dir) = reader_data_dir {
                    persist_reader_document(reader_data_dir, &document, metadata.len())?;
                }
                return Ok(document);
            }
            Err(err) if err.is_resource_limit() => return Err(err.to_string()),
            Err(_) => {}
        }
    }

    let raw_text = match kind {
        ReaderDocumentKind::Pdf => match pdf_extract::extract_text(&path) {
            Ok(text) => text,
            Err(_) => {
                let document = placeholder_pdf_document(
                    id,
                    &path,
                    metadata.len(),
                    source_modified_ms,
                    name,
                    "pdf-placeholder",
                );
                if let Some(reader_data_dir) = reader_data_dir {
                    persist_reader_document(reader_data_dir, &document, metadata.len())?;
                }
                return Ok(document);
            }
        },
        ReaderDocumentKind::Docx => extract_docx_text(&path)?,
        ReaderDocumentKind::Epub => extract_epub_text(&path)?,
        ReaderDocumentKind::Markdown | ReaderDocumentKind::Text => read_plain_text(&path)?,
    };
    let text = truncate_reader_text(normalize_document_text(&raw_text));
    if text.is_empty() {
        if matches!(kind, ReaderDocumentKind::Pdf) {
            let document = placeholder_pdf_document(
                id,
                &path,
                metadata.len(),
                source_modified_ms,
                name,
                "pdf-placeholder",
            );
            if let Some(reader_data_dir) = reader_data_dir {
                persist_reader_document(reader_data_dir, &document, metadata.len())?;
            }
            return Ok(document);
        }
        return Err("No readable text was found in this document.".to_string());
    }
    let sections = split_reader_sections(&text);
    let pages = fallback_pages_from_text(&text);

    let document = ReaderDocument {
        id,
        path: path.to_string_lossy().to_string(),
        name,
        kind,
        size_bytes: metadata.len(),
        source_modified_ms,
        word_count: count_words(&text),
        page_count: pages.len(),
        extraction_engine: "rust-fallback".to_string(),
        thumbnail_data_url: None,
        text,
        pages,
        sections,
    };
    if let Some(reader_data_dir) = reader_data_dir {
        persist_reader_document(reader_data_dir, &document, metadata.len())?;
    }
    Ok(document)
}

#[derive(Debug, Deserialize)]
struct PythonReaderDocument {
    #[serde(default)]
    meta: HashMap<String, Value>,
    thumbnail: Option<PythonReaderThumbnail>,
    #[serde(default)]
    text: String,
    #[serde(default)]
    pages: Vec<PythonReaderPage>,
}

#[derive(Debug, Deserialize)]
struct PythonReaderThumbnail {
    mime_type: String,
    base64: String,
}

#[derive(Debug, Deserialize)]
struct PythonReaderPage {
    index: usize,
    width: Option<f64>,
    height: Option<f64>,
    #[serde(default)]
    blocks: Vec<PythonReaderBlock>,
}

#[derive(Debug, Deserialize)]
struct PythonReaderBlock {
    index: usize,
    text: String,
    #[serde(default = "default_block_kind")]
    kind: String,
    bbox: Option<ReaderDocumentBbox>,
}

fn default_block_kind() -> String {
    "content".to_string()
}

fn resolve_reader_extractor(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("VOX_JOT_READER_EXTRACTOR") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "VOX_JOT_READER_EXTRACTOR does not point to a file: {}",
            path.display()
        ));
    }

    crate::portable::resolve_resource(app, "resources/python/reader_extract.py")
        .map_err(|err| format!("Failed to resolve Reader extractor: {err}"))
}

fn ensure_reader_python(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = reader_python_from_env("VOX_JOT_READER_PYTHON") {
        return Ok(path);
    }

    let runtime_dir = crate::storage_paths::reader_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve Reader runtime directory: {err}"))?;
    let venv_dir = runtime_dir.join(".venv");
    let python = venv_python_path(&venv_dir);
    let marker_path = runtime_dir.join("reader-runtime.version");

    if python.is_file()
        && fs::read_to_string(&marker_path)
            .map(|value| value.trim() == READER_RUNTIME_VERSION)
            .unwrap_or(false)
    {
        return Ok(python);
    }

    fs::create_dir_all(&runtime_dir).map_err(|err| {
        format!(
            "Failed to create Reader runtime directory '{}': {err}",
            runtime_dir.display()
        )
    })?;

    let bootstrap_python = locate_reader_python()
        .ok_or_else(|| "Could not locate Python to create the Reader runtime.".to_string())?;
    // Always (re)create with --clear. We only reach here when the version marker
    // is missing or stale, so any existing venv is partial or broken (e.g. one
    // created earlier from a relocatable uv-managed Python whose stdlib can't be
    // resolved). --clear wipes it so we recover instead of pip-installing into a
    // dead interpreter.
    let output = Command::new(&bootstrap_python)
        .arg("-m")
        .arg("venv")
        .arg("--clear")
        .arg(&venv_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| {
            format!(
                "Failed to create Reader runtime with '{}': {err}",
                bootstrap_python.display()
            )
        })?;
    if !output.status.success() {
        return Err(command_stderr_or_status(
            "Reader Python runtime creation failed",
            &output,
        ));
    }

    run_python_module(
        &python,
        "pip",
        &["install", "--disable-pip-version-check", "--upgrade", "pip"],
    )?;
    let mut install_args = vec!["install", "--disable-pip-version-check", "--no-input"];
    install_args.extend(READER_RUNTIME_PACKAGES.iter().copied());
    run_python_module(&python, "pip", &install_args)?;

    fs::write(&marker_path, format!("{READER_RUNTIME_VERSION}\n")).map_err(|err| {
        format!(
            "Failed to write Reader runtime marker '{}': {err}",
            marker_path.display()
        )
    })?;

    Ok(python)
}

/// Resolve a bundled Reader Python helper script (e.g. `reader_align.py`,
/// `reader_page.py`) by file name. A `VOX_JOT_<STEM>` env var (e.g.
/// `VOX_JOT_READER_ALIGN`) overrides the bundled path for dev/tests.
pub(crate) fn resolve_reader_script(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let env_key = format!("VOX_JOT_{}", stem.to_uppercase());
    if let Ok(custom) = std::env::var(&env_key) {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
    }
    crate::portable::resolve_resource(app, &format!("resources/python/{file_name}"))
        .map_err(|err| format!("Failed to resolve Reader script '{file_name}': {err}"))
}

/// Ensure the optional Whisper alignment dependency (faster-whisper) is present
/// in the Reader runtime. Best-effort and tracked by its own marker so it is
/// only installed once; separate from the mandatory extraction packages.
pub(crate) fn ensure_reader_alignment_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let python = ensure_reader_python(app)?;
    let runtime_dir = crate::storage_paths::reader_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve Reader runtime directory: {err}"))?;
    let marker_path = runtime_dir.join("reader-align.version");
    if fs::read_to_string(&marker_path)
        .map(|value| value.trim() == READER_ALIGN_VERSION)
        .unwrap_or(false)
    {
        return Ok(python);
    }
    let mut install_args = vec!["install", "--disable-pip-version-check", "--no-input"];
    install_args.extend(READER_ALIGN_PACKAGES.iter().copied());
    run_python_module(&python, "pip", &install_args)?;
    fs::write(&marker_path, format!("{READER_ALIGN_VERSION}\n")).map_err(|err| {
        format!(
            "Failed to write Reader alignment marker '{}': {err}",
            marker_path.display()
        )
    })?;
    Ok(python)
}

fn reader_python_from_env(variable: &str) -> Option<PathBuf> {
    let custom = std::env::var(variable).ok()?;
    let path = PathBuf::from(custom);
    path.is_file().then_some(path)
}

fn venv_python_path(venv_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

fn run_python_module(python: &Path, module: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(python)
        .arg("-m")
        .arg(module)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("Failed to run '{} -m {module}': {err}", python.display()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_stderr_or_status(
            &format!("Reader Python module '{module}' failed"),
            &output,
        ))
    }
}

fn command_stderr_or_status(label: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        format!("{label}: {}", output.status)
    } else {
        format!("{label}: {stderr}")
    }
}

fn locate_reader_python() -> Option<PathBuf> {
    for variable in ["VOX_JOT_READER_PYTHON", "OCR_RUNTIME_PYTHON"] {
        if let Some(path) = reader_python_from_env(variable) {
            return Some(path);
        }
    }

    // Prefer a Homebrew/framework Python 3.11. PATH can surface a uv-managed
    // standalone python3.11 first, and `python -m venv` against those produces a
    // broken venv: the stdlib path resolves to a build-time `/install` prefix, so
    // the venv interpreter can't import `encodings` and every pip install fails
    // (forcing the thumbnail-less Rust fallback). The Homebrew builds create
    // working venvs, matching the other Vox Jot Python sidecars.
    #[cfg(target_os = "macos")]
    for candidate in [
        "/opt/homebrew/bin/python3.11",
        "/opt/homebrew/opt/python@3.11/bin/python3.11",
        "/usr/local/bin/python3.11",
    ] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }

    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["python.exe", "python"]
    } else {
        &["python3.11", "python3", "python"]
    };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for candidate in candidates {
            let path = dir.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

#[derive(Debug)]
struct ReaderHelperError {
    message: String,
    resource_limit: bool,
}

impl ReaderHelperError {
    fn recoverable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            resource_limit: false,
        }
    }

    fn resource_limit(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            resource_limit: true,
        }
    }

    fn is_resource_limit(&self) -> bool {
        self.resource_limit
    }
}

impl std::fmt::Display for ReaderHelperError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Read a child pipe into a buffer capped at `cap` bytes, but keep draining
/// past the cap so the child never blocks on a full pipe. Returns the captured
/// bytes and whether the stream was truncated (exceeded the cap).
fn read_stream_capped<R: Read + Send + 'static>(
    mut reader: R,
    cap: usize,
) -> thread::JoinHandle<(Vec<u8>, bool)> {
    thread::spawn(move || {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        let mut truncated = false;
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    if buf.len() < cap {
                        let take = n.min(cap - buf.len());
                        buf.extend_from_slice(&chunk[..take]);
                        if take < n {
                            truncated = true;
                        }
                    } else {
                        truncated = true;
                    }
                }
                Err(_) => break,
            }
        }
        (buf, truncated)
    })
}

/// Run a Reader helper subprocess (extractor / page renderer) over untrusted
/// document input with a hard time limit and a stdout byte cap. On timeout the
/// child is killed; on oversized output an error is returned. stdout/stderr are
/// drained on threads so a chatty child can't deadlock on a full pipe.
fn run_reader_subprocess_capped(
    mut command: Command,
    timeout: Duration,
    max_stdout_bytes: usize,
) -> Result<Vec<u8>, ReaderHelperError> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            ReaderHelperError::recoverable(format!("Failed to start Reader helper: {err}"))
        })?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ReaderHelperError::recoverable(
            "Failed to capture Reader helper output.",
        ));
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ReaderHelperError::recoverable(
            "Failed to capture Reader helper errors.",
        ));
    };
    let stdout_handle = read_stream_capped(stdout, max_stdout_bytes);
    let stderr_handle = read_stream_capped(stderr, READER_SUBPROCESS_STDERR_CAP);

    let start = Instant::now();
    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                thread::sleep(Duration::from_millis(40));
            }
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ReaderHelperError::recoverable(format!(
                    "Failed to wait for Reader helper: {err}"
                )));
            }
        }
    };

    let (stdout_bytes, stdout_truncated) =
        stdout_handle.join().unwrap_or_else(|_| (Vec::new(), false));
    let (stderr_bytes, _) = stderr_handle.join().unwrap_or_else(|_| (Vec::new(), false));
    let stderr_str = String::from_utf8_lossy(&stderr_bytes).trim().to_string();

    let Some(status) = exit_status else {
        return Err(ReaderHelperError::resource_limit(
            "This document took too long to process and was stopped.",
        ));
    };
    if stdout_truncated {
        return Err(ReaderHelperError::resource_limit(
            "This document produced too much data to open safely.",
        ));
    }
    if !status.success() {
        return Err(ReaderHelperError::recoverable(if stderr_str.is_empty() {
            format!("Reader helper exited with status {status}")
        } else {
            stderr_str
        }));
    }
    Ok(stdout_bytes)
}

fn extract_with_python(
    path: &Path,
    extractor_path: &Path,
    python: &Path,
) -> Result<PythonReaderDocument, ReaderHelperError> {
    let mut command = Command::new(python);
    command
        .arg(extractor_path)
        .arg("--path")
        .arg(path)
        .env("PYTHONUNBUFFERED", "1");
    let stdout = run_reader_subprocess_capped(
        command,
        READER_EXTRACT_TIMEOUT,
        MAX_READER_EXTRACT_STDOUT_BYTES,
    )?;
    serde_json::from_slice(&stdout).map_err(|err| {
        ReaderHelperError::recoverable(format!("Reader extractor returned invalid JSON: {err}"))
    })
}

fn build_reader_document_from_extraction(
    id: String,
    path: &Path,
    size_bytes: u64,
    source_modified_ms: Option<u64>,
    name: String,
    kind: ReaderDocumentKind,
    extracted: PythonReaderDocument,
) -> Result<ReaderDocument, String> {
    let text = normalize_document_text(&extracted.text);
    if text.is_empty() {
        if matches!(kind, ReaderDocumentKind::Pdf) {
            return Ok(placeholder_pdf_document(
                id,
                path,
                size_bytes,
                source_modified_ms,
                name,
                extracted
                    .meta
                    .get("engine")
                    .and_then(Value::as_str)
                    .unwrap_or("pymupdf-empty"),
            )
            .with_thumbnail(extracted.thumbnail));
        }
        return Err("No readable text was found in this document.".to_string());
    }
    let mut pages = extracted
        .pages
        .into_iter()
        .map(|page| ReaderDocumentPage {
            index: page.index,
            width: page.width,
            height: page.height,
            blocks: page
                .blocks
                .into_iter()
                .filter_map(|block| {
                    let block_text = normalize_document_text(&block.text);
                    if block_text.is_empty() {
                        return None;
                    }
                    Some(ReaderDocumentBlock {
                        index: block.index,
                        text: block_text,
                        kind: block.kind,
                        bbox: block.bbox,
                    })
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    if pages.is_empty() {
        pages = fallback_pages_from_text(&text);
    }
    let page_count = pages.len();
    let extraction_engine = extracted
        .meta
        .get("engine")
        .and_then(Value::as_str)
        .unwrap_or("python")
        .to_string();
    let thumbnail_data_url = thumbnail_data_url(extracted.thumbnail);
    let sections = split_reader_sections(&text);

    Ok(ReaderDocument {
        id,
        path: path.to_string_lossy().to_string(),
        name,
        kind,
        size_bytes,
        source_modified_ms,
        word_count: count_words(&text),
        page_count,
        extraction_engine,
        thumbnail_data_url,
        text,
        pages,
        sections,
    })
}

fn placeholder_pdf_document(
    id: String,
    path: &Path,
    size_bytes: u64,
    source_modified_ms: Option<u64>,
    name: String,
    extraction_engine: &str,
) -> ReaderDocument {
    let text = NO_EXTRACTABLE_PDF_TEXT.to_string();
    let sections = split_reader_sections(&text);
    let pages = fallback_pages_from_text(&text);
    ReaderDocument {
        id,
        path: path.to_string_lossy().to_string(),
        name,
        kind: ReaderDocumentKind::Pdf,
        size_bytes,
        source_modified_ms,
        word_count: count_words(&text),
        page_count: pages.len(),
        extraction_engine: extraction_engine.to_string(),
        thumbnail_data_url: None,
        text,
        pages,
        sections,
    }
}

trait ReaderDocumentThumbnailExt {
    fn with_thumbnail(self, thumbnail: Option<PythonReaderThumbnail>) -> Self;
}

impl ReaderDocumentThumbnailExt for ReaderDocument {
    fn with_thumbnail(mut self, thumbnail: Option<PythonReaderThumbnail>) -> Self {
        self.thumbnail_data_url = thumbnail_data_url(thumbnail);
        self
    }
}

fn thumbnail_data_url(thumbnail: Option<PythonReaderThumbnail>) -> Option<String> {
    thumbnail.and_then(|thumbnail| {
        if thumbnail.mime_type.trim().is_empty() || thumbnail.base64.trim().is_empty() {
            None
        } else {
            Some(format!(
                "data:{};base64,{}",
                thumbnail.mime_type.trim(),
                thumbnail.base64.trim()
            ))
        }
    })
}

fn read_cached_reader_document(
    reader_data_dir: &Path,
    id: &str,
    source_size: u64,
    source_modified_ms: Option<u64>,
) -> Option<ReaderDocument> {
    let envelope = read_cached_reader_envelope(reader_data_dir, id)?;
    if envelope.source_size == source_size && envelope.source_modified_ms == source_modified_ms {
        Some(envelope.document)
    } else {
        None
    }
}

fn read_cached_reader_document_by_id(reader_data_dir: &Path, id: &str) -> Option<ReaderDocument> {
    read_cached_reader_envelope(reader_data_dir, id).map(|envelope| envelope.document)
}

fn read_cached_reader_envelope(
    reader_data_dir: &Path,
    id: &str,
) -> Option<ReaderDocumentCacheEnvelope> {
    let cache_path = reader_cache_path(reader_data_dir, id);
    let bytes = fs::read(cache_path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn persist_reader_document(
    reader_data_dir: &Path,
    document: &ReaderDocument,
    source_size: u64,
) -> Result<(), String> {
    fs::create_dir_all(reader_data_dir.join(READER_DOCUMENTS_DIR)).map_err(|err| {
        format!(
            "Failed to create Reader document cache '{}': {err}",
            reader_data_dir.join(READER_DOCUMENTS_DIR).display()
        )
    })?;

    let cached_at_ms = current_time_millis();
    let envelope = ReaderDocumentCacheEnvelope {
        source_path: document.path.clone(),
        source_size,
        source_modified_ms: document.source_modified_ms,
        cached_at_ms,
        document: document.clone(),
    };
    let cache_bytes = serde_json::to_vec_pretty(&envelope)
        .map_err(|err| format!("Failed to encode Reader document cache: {err}"))?;
    fs::write(
        reader_cache_path(reader_data_dir, &document.id),
        cache_bytes,
    )
    .map_err(|err| format!("Failed to write Reader document cache: {err}"))?;

    let mut store = read_reader_library_store(reader_data_dir).unwrap_or_default();
    let imported_at_ms = store
        .documents
        .iter()
        .find(|item| item.id == document.id)
        .map(|item| item.imported_at_ms)
        .unwrap_or(cached_at_ms);
    store.documents.retain(|item| item.id != document.id);
    store.documents.insert(
        0,
        ReaderStoredDocument {
            id: document.id.clone(),
            path: document.path.clone(),
            name: document.name.clone(),
            kind: document.kind.clone(),
            size_bytes: document.size_bytes,
            source_modified_ms: document.source_modified_ms,
            word_count: document.word_count,
            page_count: document.page_count,
            section_count: document.sections.len(),
            extraction_engine: document.extraction_engine.clone(),
            thumbnail_data_url: document.thumbnail_data_url.clone(),
            imported_at_ms,
            updated_at_ms: cached_at_ms,
        },
    );
    store
        .documents
        .sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    store.documents.truncate(200);
    write_reader_library_store(reader_data_dir, &store)
}

fn read_reader_library_store(reader_data_dir: &Path) -> Result<ReaderLibraryStore, String> {
    let path = reader_data_dir.join(READER_LIBRARY_FILE);
    if !path.is_file() {
        return Ok(ReaderLibraryStore::default());
    }
    let bytes = fs::read(&path)
        .map_err(|err| format!("Failed to read Reader library '{}': {err}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|err| {
        format!(
            "Failed to decode Reader library '{}': {err}",
            path.display()
        )
    })
}

fn write_reader_library_store(
    reader_data_dir: &Path,
    store: &ReaderLibraryStore,
) -> Result<(), String> {
    fs::create_dir_all(reader_data_dir).map_err(|err| {
        format!(
            "Failed to create Reader library directory '{}': {err}",
            reader_data_dir.display()
        )
    })?;
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|err| format!("Failed to encode Reader library: {err}"))?;
    fs::write(reader_data_dir.join(READER_LIBRARY_FILE), bytes)
        .map_err(|err| format!("Failed to write Reader library: {err}"))
}

fn remove_reader_document_from_store(reader_data_dir: &Path, id: &str) -> Result<(), String> {
    if !is_valid_reader_id(id) {
        return Err("Invalid Reader document id.".to_string());
    }
    let mut store = read_reader_library_store(reader_data_dir).unwrap_or_default();
    store.documents.retain(|item| item.id != id);
    write_reader_library_store(reader_data_dir, &store)?;
    let cache_path = reader_cache_path(reader_data_dir, id);
    if cache_path.is_file() {
        fs::remove_file(&cache_path).map_err(|err| {
            format!(
                "Failed to remove Reader document cache '{}': {err}",
                cache_path.display()
            )
        })?;
    }
    let audio_cache_path = reader_audio_cache_path(reader_data_dir, id);
    if audio_cache_path.is_dir() {
        fs::remove_dir_all(&audio_cache_path).map_err(|err| {
            format!(
                "Failed to remove Reader audio cache '{}': {err}",
                audio_cache_path.display()
            )
        })?;
    }
    Ok(())
}

fn reader_cache_path(reader_data_dir: &Path, id: &str) -> PathBuf {
    reader_data_dir
        .join(READER_DOCUMENTS_DIR)
        .join(format!("{id}.json"))
}

fn reader_audio_cache_path(reader_data_dir: &Path, id: &str) -> PathBuf {
    reader_data_dir.join(READER_AUDIO_CACHE_DIR).join(id)
}

fn reader_document_id(path: &Path) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn is_valid_reader_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn current_time_millis() -> u64 {
    system_time_millis(SystemTime::now()).unwrap_or(0)
}

fn system_time_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| duration.as_millis().try_into().ok())
}

fn kind_from_path(path: &Path) -> Result<ReaderDocumentKind, String> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("pdf") => Ok(ReaderDocumentKind::Pdf),
        Some("docx") => Ok(ReaderDocumentKind::Docx),
        Some("epub") => Ok(ReaderDocumentKind::Epub),
        Some("md") | Some("markdown") => Ok(ReaderDocumentKind::Markdown),
        Some("txt") | Some("text") => Ok(ReaderDocumentKind::Text),
        Some(ext) => Err(format!(
            "Unsupported Reader file type '.{ext}'. Use PDF, DOCX, EPUB, TXT, or MD."
        )),
        None => Err("Unsupported Reader file without an extension.".to_string()),
    }
}

fn read_plain_text(path: &Path) -> Result<String, String> {
    let file =
        File::open(path).map_err(|err| format!("Failed to read '{}': {err}", path.display()))?;
    let mut reader = file.take(MAX_READER_TEXT_CHARS as u64 + 1);
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|err| format!("Failed to read '{}': {err}", path.display()))?;
    Ok(String::from_utf8(bytes)
        .unwrap_or_else(|err| String::from_utf8_lossy(err.as_bytes()).to_string()))
}

fn extract_docx_text(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|err| format!("Failed to open DOCX: {err}"))?;
    let mut archive = ZipArchive::new(file).map_err(|err| format!("Failed to read DOCX: {err}"))?;
    let mut xml = String::new();
    let mut body = archive
        .by_name("word/document.xml")
        .map_err(|err| format!("DOCX is missing word/document.xml: {err}"))?;
    if body.size() > MAX_READER_FALLBACK_XML_BYTES {
        return Err(format!(
            "DOCX body is too large to read safely; the limit is {} MB.",
            MAX_READER_FALLBACK_XML_BYTES / (1024 * 1024)
        ));
    }
    body.read_to_string(&mut xml)
        .map_err(|err| format!("Failed to read DOCX body: {err}"))?;
    xml_text(&xml, XmlFlavor::Docx).map(truncate_reader_text)
}

fn extract_epub_text(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|err| format!("Failed to open EPUB: {err}"))?;
    let mut archive = ZipArchive::new(file).map_err(|err| format!("Failed to read EPUB: {err}"))?;
    let mut entries = Vec::new();

    for index in 0..archive.len() {
        let Ok(file) = archive.by_index(index) else {
            continue;
        };
        let name = file.name().to_string();
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm") {
            entries.push(name);
        }
    }

    entries.sort();
    let mut out = String::new();
    let mut total_xml_bytes = 0u64;
    for name in entries {
        let mut entry = archive
            .by_name(&name)
            .map_err(|err| format!("Failed to read EPUB entry '{}': {err}", name))?;
        let entry_size = entry.size();
        if total_xml_bytes.saturating_add(entry_size) > MAX_READER_FALLBACK_XML_BYTES {
            break;
        }
        total_xml_bytes += entry_size;
        let mut xml = String::new();
        entry
            .read_to_string(&mut xml)
            .map_err(|err| format!("Failed to decode EPUB entry '{}': {err}", name))?;
        let text = xml_text(&xml, XmlFlavor::Html)?;
        if !text.trim().is_empty() {
            push_paragraph_break(&mut out);
            out.push_str(text.trim());
            out = truncate_reader_text(out);
            if reader_text_at_limit(&out) {
                break;
            }
        }
    }

    Ok(out)
}

fn reader_text_at_limit(text: &str) -> bool {
    text.chars().count() >= MAX_READER_TEXT_CHARS
}

fn truncate_reader_text(text: String) -> String {
    if !reader_text_at_limit(&text) {
        return text;
    }
    text.chars().take(MAX_READER_TEXT_CHARS).collect()
}

#[derive(Debug, Clone, Copy)]
enum XmlFlavor {
    Docx,
    Html,
}

fn xml_text(xml: &str, flavor: XmlFlavor) -> Result<String, String> {
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut text = String::new();
    let mut skip_depth = 0usize;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(Event::Start(event)) => {
                let tag = local_name(event.local_name().as_ref());
                if should_skip_tag(&tag) {
                    skip_depth += 1;
                } else if skip_depth == 0 && should_break_before(&tag, flavor) {
                    push_paragraph_break(&mut text);
                }
            }
            Ok(Event::End(event)) => {
                let tag = local_name(event.local_name().as_ref());
                if skip_depth > 0 && should_skip_tag(&tag) {
                    skip_depth -= 1;
                } else if skip_depth == 0 && should_break_after(&tag, flavor) {
                    push_paragraph_break(&mut text);
                }
            }
            Ok(Event::Empty(event)) => {
                if skip_depth == 0 {
                    let tag = local_name(event.local_name().as_ref());
                    if should_break_after(&tag, flavor) {
                        push_paragraph_break(&mut text);
                    }
                }
            }
            Ok(Event::Text(event)) => {
                if skip_depth == 0 {
                    let decoded = event
                        .decode()
                        .map_err(|err| format!("Failed to decode document XML text: {err}"))?;
                    let unescaped = unescape(&decoded)
                        .map_err(|err| format!("Failed to decode document XML entities: {err}"))?;
                    push_text(&mut text, unescaped.as_ref());
                }
            }
            Ok(Event::CData(event)) => {
                if skip_depth == 0 {
                    let decoded = event
                        .decode()
                        .map_err(|err| format!("Failed to decode document XML CDATA: {err}"))?;
                    push_text(&mut text, decoded.as_ref());
                }
            }
            Err(err) => return Err(format!("Failed to parse document XML: {err}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(text)
}

fn local_name(raw: &[u8]) -> String {
    let full = String::from_utf8_lossy(raw);
    full.rsplit(':')
        .next()
        .unwrap_or_else(|| full.as_ref())
        .to_ascii_lowercase()
}

fn should_skip_tag(tag: &str) -> bool {
    matches!(
        tag,
        "script" | "style" | "svg" | "math" | "head" | "metadata" | "meta"
    )
}

fn should_break_before(tag: &str, flavor: XmlFlavor) -> bool {
    match flavor {
        XmlFlavor::Docx => matches!(tag, "p" | "tr" | "tbl"),
        XmlFlavor::Html => matches!(
            tag,
            "p" | "section"
                | "article"
                | "chapter"
                | "div"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "li"
                | "tr"
                | "blockquote"
        ),
    }
}

fn should_break_after(tag: &str, flavor: XmlFlavor) -> bool {
    match flavor {
        XmlFlavor::Docx => matches!(tag, "p" | "br" | "tr" | "tbl"),
        XmlFlavor::Html => matches!(
            tag,
            "p" | "section"
                | "article"
                | "chapter"
                | "div"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "li"
                | "br"
                | "tr"
                | "blockquote"
        ),
    }
}

fn push_text(out: &mut String, value: &str) {
    let trimmed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return;
    }
    if !out.is_empty() && !out.ends_with([' ', '\n']) {
        out.push(' ');
    }
    out.push_str(&trimmed);
}

fn push_paragraph_break(out: &mut String) {
    let trimmed_len = out.trim_end().len();
    out.truncate(trimmed_len);
    if !out.is_empty() && !out.ends_with("\n\n") {
        out.push_str("\n\n");
    }
}

fn normalize_document_text(text: &str) -> String {
    let mut out = String::new();
    let mut blank_pending = false;

    for raw_line in text.lines() {
        let line = raw_line.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            blank_pending = true;
            continue;
        }
        if !out.is_empty() {
            if blank_pending {
                out.push_str("\n\n");
            } else {
                out.push('\n');
            }
        }
        out.push_str(&line);
        blank_pending = false;
    }

    out.trim().to_string()
}

fn split_reader_sections(text: &str) -> Vec<ReaderDocumentSection> {
    let mut sections = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n") {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        let next_len = current.len() + paragraph.len() + if current.is_empty() { 0 } else { 2 };
        if !current.is_empty() && next_len > MAX_SECTION_CHARS {
            push_section(&mut sections, &current);
            current.clear();
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(paragraph);
    }

    if !current.trim().is_empty() {
        push_section(&mut sections, &current);
    }

    sections
}

fn fallback_pages_from_text(text: &str) -> Vec<ReaderDocumentPage> {
    let blocks = text
        .split("\n\n")
        .filter_map(|paragraph| {
            let text = paragraph.trim();
            if text.is_empty() {
                return None;
            }
            Some(text.to_string())
        })
        .enumerate()
        .map(|(index, text)| ReaderDocumentBlock {
            index,
            text,
            kind: "content".to_string(),
            bbox: None,
        })
        .collect::<Vec<_>>();

    if blocks.is_empty() {
        Vec::new()
    } else {
        vec![ReaderDocumentPage {
            index: 0,
            width: None,
            height: None,
            blocks,
        }]
    }
}

fn push_section(sections: &mut Vec<ReaderDocumentSection>, text: &str) {
    let index = sections.len();
    let title = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.chars().count() > 72 {
                format!("{}...", trimmed.chars().take(69).collect::<String>())
            } else {
                trimmed.to_string()
            }
        })
        .unwrap_or_else(|| format!("Section {}", index + 1));

    sections.push(ReaderDocumentSection {
        index,
        title,
        text: text.trim().to_string(),
    });
}

fn count_words(text: &str) -> usize {
    text.split_whitespace()
        .filter(|word| !word.trim().is_empty())
        .count()
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderRenderedWord {
    pub text: String,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderRenderedPage {
    pub index: usize,
    /// Page width/height in PDF points; word bboxes are in the same space, so
    /// the frontend overlays words as percentages independent of render scale.
    pub width: f64,
    pub height: f64,
    pub scale: f32,
    pub image_data_url: String,
    pub words: Vec<ReaderRenderedWord>,
}

#[derive(Deserialize)]
struct PythonRenderedImage {
    mime_type: String,
    base64: String,
}

#[derive(Deserialize)]
struct PythonRenderedPage {
    index: usize,
    width: f64,
    height: f64,
    scale: f32,
    image: PythonRenderedImage,
    words: Vec<ReaderRenderedWord>,
}

/// Render a single PDF page to a PNG (data URL) with per-word bounding boxes for
/// the reader's page view (geometry-based highlighting). Reads the original file
/// recorded in the cached document envelope.
#[tauri::command]
#[specta::specta]
pub async fn render_reader_page(
    app: AppHandle,
    document_id: String,
    page_index: u32,
    scale: Option<f32>,
) -> Result<ReaderRenderedPage, String> {
    tokio::task::spawn_blocking(move || {
        if !is_valid_reader_id(&document_id) {
            return Err("Invalid Reader document id.".to_string());
        }
        let reader_data_dir = crate::storage_paths::reader_data_dir(&app)
            .map_err(|err| format!("Failed to resolve Reader library directory: {err}"))?;
        let envelope = read_cached_reader_envelope(&reader_data_dir, &document_id)
            .ok_or_else(|| "This document is no longer in the Reader library.".to_string())?;
        if !matches!(envelope.document.kind, ReaderDocumentKind::Pdf) {
            return Err("Page view is only available for PDF documents.".to_string());
        }
        let source_path = PathBuf::from(&envelope.source_path);
        if !source_path.is_file() {
            return Err(
                "The original file is no longer available, so its pages can't be rendered."
                    .to_string(),
            );
        }
        let python = ensure_reader_python(&app)?;
        let script = resolve_reader_script(&app, "reader_page.py")?;
        let mut page = render_reader_page_blocking(
            &python,
            &script,
            &source_path,
            page_index,
            scale.unwrap_or(2.0),
        )?;
        if page.words.is_empty() {
            page.words = words_from_cached_layout_page(
                &envelope.document,
                page_index as usize,
                page.width,
                page.height,
            );
        }
        Ok(page)
    })
    .await
    .map_err(|err| format!("Reader page render task failed: {err}"))?
}

fn render_reader_page_blocking(
    python: &Path,
    script: &Path,
    pdf_path: &Path,
    page_index: u32,
    scale: f32,
) -> Result<ReaderRenderedPage, String> {
    let mut command = Command::new(python);
    command
        .arg(script)
        .arg("--path")
        .arg(pdf_path)
        .arg("--page")
        .arg(page_index.to_string())
        .arg("--scale")
        .arg(format!("{scale}"))
        .env("PYTHONUNBUFFERED", "1");
    let stdout = run_reader_subprocess_capped(
        command,
        READER_RENDER_TIMEOUT,
        MAX_READER_RENDER_STDOUT_BYTES,
    )
    .map_err(|err| err.to_string())?;
    let parsed: PythonRenderedPage = serde_json::from_slice(&stdout)
        .map_err(|err| format!("Reader page renderer returned invalid JSON: {err}"))?;
    Ok(ReaderRenderedPage {
        index: parsed.index,
        width: parsed.width,
        height: parsed.height,
        scale: parsed.scale,
        image_data_url: format!(
            "data:{};base64,{}",
            parsed.image.mime_type, parsed.image.base64
        ),
        words: parsed.words,
    })
}

fn words_from_cached_layout_page(
    document: &ReaderDocument,
    page_index: usize,
    rendered_width: f64,
    rendered_height: f64,
) -> Vec<ReaderRenderedWord> {
    let Some(page) = document.pages.iter().find(|page| page.index == page_index) else {
        return Vec::new();
    };
    let x_scale = page
        .width
        .filter(|width| *width > 0.0)
        .map(|width| rendered_width / width)
        .unwrap_or(1.0);
    let y_scale = page
        .height
        .filter(|height| *height > 0.0)
        .map(|height| rendered_height / height)
        .unwrap_or(1.0);

    let mut words = Vec::new();
    for block in &page.blocks {
        let Some(bbox) = block.bbox.as_ref() else {
            continue;
        };
        let lines: Vec<&str> = block
            .text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect();
        if lines.is_empty() || bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0 {
            continue;
        }
        let line_height = (bbox.y1 - bbox.y0) / lines.len() as f64;
        for (line_index, line) in lines.iter().enumerate() {
            let line_words: Vec<&str> = line.split_whitespace().collect();
            if line_words.is_empty() {
                continue;
            }
            let total_units: usize = line_words
                .iter()
                .map(|word| word.chars().count().max(1))
                .sum::<usize>()
                + line_words.len().saturating_sub(1);
            let unit_width = (bbox.x1 - bbox.x0) / total_units.max(1) as f64;
            let mut x = bbox.x0;
            let y0 = bbox.y0 + line_height * line_index as f64;
            let y1 = if line_index + 1 == lines.len() {
                bbox.y1
            } else {
                y0 + line_height
            };
            let y_padding = ((y1 - y0) * 0.12).max(0.0);
            for (word_index, word) in line_words.iter().enumerate() {
                let width = unit_width * word.chars().count().max(1) as f64;
                let x0 = x;
                let x1 = (x + width).min(bbox.x1);
                if x1 > x0 {
                    words.push(ReaderRenderedWord {
                        text: (*word).to_string(),
                        x0: clamp_page_coord(x0 * x_scale, rendered_width),
                        y0: clamp_page_coord((y0 + y_padding) * y_scale, rendered_height),
                        x1: clamp_page_coord(x1 * x_scale, rendered_width),
                        y1: clamp_page_coord((y1 - y_padding) * y_scale, rendered_height),
                    });
                }
                x = x1;
                if word_index + 1 < line_words.len() {
                    x = (x + unit_width).min(bbox.x1);
                }
            }
        }
    }
    words
}

fn clamp_page_coord(value: f64, max: f64) -> f64 {
    if max.is_finite() && max > 0.0 {
        value.clamp(0.0, max)
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    #[test]
    fn split_reader_sections_preserves_paragraph_groups() {
        let text = "Intro paragraph.\n\nSecond paragraph with more words.";
        let sections = split_reader_sections(text);

        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].index, 0);
        assert!(sections[0].text.contains("Intro paragraph."));
        assert!(sections[0].text.contains("Second paragraph"));
    }

    #[test]
    fn cached_layout_blocks_provide_page_word_fallback() {
        let document = ReaderDocument {
            id: "doc".to_string(),
            path: "/tmp/doc.pdf".to_string(),
            name: "doc.pdf".to_string(),
            kind: ReaderDocumentKind::Pdf,
            size_bytes: 1,
            source_modified_ms: None,
            word_count: 4,
            page_count: 1,
            extraction_engine: "pymupdf-ocr".to_string(),
            thumbnail_data_url: None,
            text: "Hello world\nSecond line".to_string(),
            pages: vec![ReaderDocumentPage {
                index: 0,
                width: Some(100.0),
                height: Some(200.0),
                blocks: vec![ReaderDocumentBlock {
                    index: 0,
                    text: "Hello world\nSecond line".to_string(),
                    kind: "content".to_string(),
                    bbox: Some(ReaderDocumentBbox {
                        x0: 10.0,
                        y0: 20.0,
                        x1: 90.0,
                        y1: 60.0,
                    }),
                }],
            }],
            sections: Vec::new(),
        };

        let words = words_from_cached_layout_page(&document, 0, 200.0, 400.0);
        let texts: Vec<&str> = words.iter().map(|word| word.text.as_str()).collect();

        assert_eq!(texts, vec!["Hello", "world", "Second", "line"]);
        assert!(words[0].x0 < words[1].x0);
        assert!(words[2].y0 > words[0].y0);
        assert!(words.iter().all(|word| word.x0 >= 0.0 && word.x1 <= 200.0));
    }

    #[test]
    fn docx_text_extraction_reads_document_xml() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sample.docx");
        let file = File::create(&path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(
            br#"<w:document><w:body><w:p><w:r><w:t>Hello reader</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>"#,
        )
        .unwrap();
        zip.finish().unwrap();

        let text = normalize_document_text(&extract_docx_text(&path).unwrap());
        assert!(text.contains("Hello reader"));
        assert!(text.contains("Second line"));
    }

    #[test]
    fn epub_text_extraction_reads_html_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sample.epub");
        let file = File::create(&path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("OPS/chapter.xhtml", options).unwrap();
        zip.write_all(
            br#"<html><head><title>Skip</title></head><body><h1>Chapter One</h1><p>Local voices read this.</p></body></html>"#,
        )
        .unwrap();
        zip.finish().unwrap();

        let text = normalize_document_text(&extract_epub_text(&path).unwrap());
        assert!(text.contains("Chapter One"));
        assert!(text.contains("Local voices read this."));
        assert!(!text.contains("Skip"));
    }

    #[test]
    fn txt_reader_document_builds_metadata_and_sections() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        fs::write(&path, "First note.\n\nSecond note.").unwrap();

        let document =
            read_reader_document_blocking(path.to_str().unwrap(), None, None, None).unwrap();

        assert_eq!(document.name, "notes.txt");
        assert!(matches!(document.kind, ReaderDocumentKind::Text));
        assert_eq!(document.word_count, 4);
        assert_eq!(document.sections.len(), 1);
        assert_eq!(document.page_count, 1);
        assert_eq!(document.extraction_engine, "rust-fallback");
        assert_eq!(document.pages[0].blocks.len(), 2);
    }

    #[test]
    fn python_reader_extractor_output_builds_layout_pages() {
        let Some(_) = locate_reader_python() else {
            return;
        };
        let dir = tempdir().unwrap();
        let document_path = dir.path().join("notes.txt");
        fs::write(&document_path, "unused").unwrap();
        let extractor_path = dir.path().join("reader_extract.py");
        fs::write(
            &extractor_path,
            r#"
import json
print(json.dumps({
  "meta": {"engine": "test-python"},
  "text": "Hello from python.",
  "pages": [{
    "index": 0,
    "width": 100.0,
    "height": 200.0,
    "blocks": [{
      "index": 0,
      "text": "Hello from python.",
      "kind": "content",
      "bbox": {"x0": 1.0, "y0": 2.0, "x1": 3.0, "y1": 4.0}
    }]
  }]
}))
"#,
        )
        .unwrap();

        let document = read_reader_document_blocking(
            document_path.to_str().unwrap(),
            Some(extractor_path.as_path()),
            locate_reader_python().as_deref(),
            None,
        )
        .unwrap();

        assert_eq!(document.extraction_engine, "test-python");
        assert_eq!(document.page_count, 1);
        assert_eq!(document.pages[0].blocks[0].kind, "content");
        assert_eq!(document.pages[0].blocks[0].bbox.as_ref().unwrap().x0, 1.0);
    }

    #[test]
    fn python_reader_extractor_failure_falls_back_to_rust_text() {
        let Some(_) = locate_reader_python() else {
            return;
        };
        let dir = tempdir().unwrap();
        let document_path = dir.path().join("notes.txt");
        fs::write(&document_path, "Fallback text.").unwrap();
        let extractor_path = dir.path().join("reader_extract.py");
        fs::write(
            &extractor_path,
            r#"
import sys
print("missing dependency", file=sys.stderr)
raise SystemExit(2)
"#,
        )
        .unwrap();

        let document = read_reader_document_blocking(
            document_path.to_str().unwrap(),
            Some(extractor_path.as_path()),
            locate_reader_python().as_deref(),
            None,
        )
        .unwrap();

        assert_eq!(document.text, "Fallback text.");
        assert_eq!(document.extraction_engine, "rust-fallback");
        assert_eq!(document.page_count, 1);
    }

    #[test]
    fn reader_helper_timeout_is_fatal_resource_limit() {
        let Some(python) = locate_reader_python() else {
            return;
        };
        let dir = tempdir().unwrap();
        let script = dir.path().join("slow.py");
        fs::write(&script, "import time\ntime.sleep(1)\nprint('{}')\n").unwrap();
        let mut command = Command::new(python);
        command.arg(&script);

        let err =
            run_reader_subprocess_capped(command, Duration::from_millis(30), 1024).unwrap_err();

        assert!(err.is_resource_limit());
        assert!(err.to_string().contains("too long"));
    }

    #[test]
    fn reader_helper_stdout_cap_is_fatal_resource_limit() {
        let Some(python) = locate_reader_python() else {
            return;
        };
        let dir = tempdir().unwrap();
        let script = dir.path().join("large.py");
        fs::write(&script, "print('x' * 2048)\n").unwrap();
        let mut command = Command::new(python);
        command.arg(&script);

        let err = run_reader_subprocess_capped(command, Duration::from_secs(5), 64).unwrap_err();

        assert!(err.is_resource_limit());
        assert!(err.to_string().contains("too much data"));
    }

    #[test]
    fn oversized_reader_file_is_rejected_before_extraction() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("huge.txt");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_READER_FILE_BYTES + 1).unwrap();

        let err = read_reader_document_blocking(path.to_str().unwrap(), None, None, None)
            .expect_err("oversized file should be rejected");

        assert!(err.contains("too large"));
    }

    #[test]
    fn pdf_without_selectable_text_still_opens_as_reader_document() {
        let dir = tempdir().unwrap();
        let document_path = dir.path().join("scanned.pdf");
        fs::write(&document_path, b"%PDF-1.4\n").unwrap();

        let mut meta = HashMap::new();
        meta.insert("engine".to_string(), Value::String("pymupdf".to_string()));
        let document = build_reader_document_from_extraction(
            "pdf-empty".to_string(),
            &document_path,
            42,
            None,
            "scanned.pdf".to_string(),
            ReaderDocumentKind::Pdf,
            PythonReaderDocument {
                meta,
                thumbnail: Some(PythonReaderThumbnail {
                    mime_type: "image/png".to_string(),
                    base64: "abc123".to_string(),
                }),
                text: String::new(),
                pages: vec![PythonReaderPage {
                    index: 0,
                    width: Some(612.0),
                    height: Some(792.0),
                    blocks: Vec::new(),
                }],
            },
        )
        .unwrap();

        assert_eq!(document.name, "scanned.pdf");
        assert_eq!(document.extraction_engine, "pymupdf");
        assert!(document.text.contains("could not find selectable text"));
        assert_eq!(
            document.thumbnail_data_url.as_deref(),
            Some("data:image/png;base64,abc123")
        );
    }

    #[test]
    fn reader_cache_persists_document_and_library_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        fs::write(&path, "Cached reader text.").unwrap();
        let reader_data_dir = dir.path().join("reader-data");

        let document = read_reader_document_blocking(
            path.to_str().unwrap(),
            None,
            None,
            Some(reader_data_dir.as_path()),
        )
        .unwrap();

        let cached = read_cached_reader_document(
            &reader_data_dir,
            &document.id,
            document.size_bytes,
            document.source_modified_ms,
        )
        .unwrap();
        assert_eq!(cached.text, "Cached reader text.");

        let library = read_reader_library_store(&reader_data_dir).unwrap();
        assert_eq!(library.documents.len(), 1);
        assert_eq!(library.documents[0].id, document.id);

        remove_reader_document_from_store(&reader_data_dir, &document.id).unwrap();
        let library = read_reader_library_store(&reader_data_dir).unwrap();
        assert!(library.documents.is_empty());
        assert!(!reader_cache_path(&reader_data_dir, &document.id).exists());
    }

    #[test]
    fn reader_cache_opens_when_original_file_is_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("portable.md");
        fs::write(&path, "Cached after import.").unwrap();
        let reader_data_dir = dir.path().join("reader-data");

        let document = read_reader_document_blocking(
            path.to_str().unwrap(),
            None,
            None,
            Some(reader_data_dir.as_path()),
        )
        .unwrap();
        fs::remove_file(&path).unwrap();

        let cached = read_reader_document_blocking(
            path.to_str().unwrap(),
            None,
            None,
            Some(reader_data_dir.as_path()),
        )
        .unwrap();

        assert_eq!(cached.id, document.id);
        assert_eq!(cached.text, "Cached after import.");
    }
}
