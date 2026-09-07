use crate::managers::history::{HistoryEntry, HistoryManager, MarkdownExportStatus};
use crate::settings::{get_settings, MarkdownExportContentSource};
use chrono::Utc;
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::AppHandle;

const BOOKMARK_FILE_NAME: &str = "markdown-export-bookmark";

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MarkdownExportSnapshot {
    export_dir: PathBuf,
    content_source: MarkdownExportContentSource,
    include_frontmatter: bool,
    filename: String,
    #[serde(default)]
    security_scoped_bookmark: Option<String>,
}

#[derive(Clone, Debug)]
struct MarkdownExportRecord {
    history_id: i64,
    timestamp: i64,
    title: String,
    transcription: String,
    post_processed: Option<String>,
    pasted: Option<String>,
    duration_ms: Option<i64>,
}

pub fn slugify(text: &str, max_chars: usize) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for character in text.chars() {
        if character.is_alphanumeric() {
            for lower in character.to_lowercase() {
                slug.push(lower);
            }
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
        if slug.chars().count() >= max_chars {
            break;
        }
    }

    let trimmed = slug.trim_end_matches('-');
    if trimmed.is_empty() {
        "dictation".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The history ID makes the name collision-free and stable across retries.
pub fn generate_markdown_filename(timestamp: i64, display_title: &str, history_id: i64) -> String {
    let date_time = chrono::DateTime::from_timestamp(timestamp, 0)
        .map(chrono::DateTime::<chrono::Local>::from)
        .unwrap_or_else(chrono::Local::now);
    let prefix = date_time.format("%Y-%m-%d-%H%M%S");
    format!(
        "{}-{}-history-{}.md",
        prefix,
        slugify(display_title, 40),
        history_id
    )
}

fn selected_content<'a>(
    source: MarkdownExportContentSource,
    transcription: &'a str,
    post_processed: Option<&'a str>,
    pasted: Option<&'a str>,
) -> &'a str {
    match source {
        MarkdownExportContentSource::Raw => transcription,
        MarkdownExportContentSource::Final => pasted.or(post_processed).unwrap_or(transcription),
    }
}

fn single_line_title(title: &str) -> String {
    title.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn format_markdown_content(
    title: &str,
    timestamp: i64,
    text: &str,
    duration_ms: Option<i64>,
    include_frontmatter: bool,
    history_id: i64,
) -> String {
    let title = single_line_title(title);
    let word_count = text.split_whitespace().count();
    let date_time = chrono::DateTime::from_timestamp(timestamp, 0)
        .map(chrono::DateTime::<chrono::Local>::from)
        .unwrap_or_else(chrono::Local::now);

    let mut output = String::new();
    if include_frontmatter {
        output.push_str("---\n");
        output.push_str("title: ");
        output.push_str(
            &serde_json::to_string(&title).unwrap_or_else(|_| "\"Vox Jot note\"".to_string()),
        );
        output.push('\n');
        output.push_str(&format!("date: {}\n", date_time.to_rfc3339()));
        if let Some(duration_ms) = duration_ms {
            output.push_str(&format!("duration_ms: {}\n", duration_ms.max(0)));
        }
        output.push_str(&format!("word_count: {word_count}\n"));
        output.push_str(&format!("vox_jot_id: {history_id}\n"));
        output.push_str("source: vox_jot\n");
        output.push_str("---\n\n");
    }

    output.push_str("# ");
    output.push_str(if title.is_empty() {
        "Vox Jot note"
    } else {
        &title
    });
    output.push_str("\n\n");
    output.push_str(text.trim());
    output.push('\n');
    output
}

pub fn write_atomic(dir: &Path, filename: &str, content: &str) -> std::io::Result<PathBuf> {
    if !dir.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "the Markdown export folder is unavailable",
        ));
    }

    if filename.is_empty()
        || Path::new(filename)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(filename)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "the Markdown export filename is invalid",
        ));
    }

    let target_path = dir.join(filename);
    let mut temporary = tempfile::Builder::new()
        .prefix(".vox-jot-export-")
        .tempfile_in(dir)?;
    temporary.write_all(content.as_bytes())?;
    temporary.as_file().sync_all()?;
    if let Err(error) = temporary.persist_noclobber(&target_path) {
        // A prior write may have succeeded immediately before the app stopped.
        // Treat only identical content as success; never replace user edits.
        let identical = error.error.kind() == std::io::ErrorKind::AlreadyExists
            && std::fs::symlink_metadata(&target_path)
                .is_ok_and(|metadata| metadata.is_file() && metadata.len() == content.len() as u64)
            && std::fs::read(&target_path).is_ok_and(|existing| existing == content.as_bytes());
        if !identical {
            return Err(error.error);
        }
    }
    Ok(target_path)
}

fn bookmark_file(app: &AppHandle) -> Result<PathBuf, String> {
    crate::portable::app_data_dir(app)
        .map(|directory| directory.join(BOOKMARK_FILE_NAME))
        .map_err(|error| format!("Could not access Vox Jot's private app data: {error}"))
}

fn store_bookmark(app: &AppHandle, bookmark: Option<&str>) -> Result<(), String> {
    let path = bookmark_file(app)?;
    match bookmark {
        Some(bookmark) => {
            let parent = path
                .parent()
                .ok_or_else(|| "Invalid private bookmark path".to_string())?;
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not prepare bookmark storage: {error}"))?;
            let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|error| format!("Could not save folder authorization: {error}"))?;
            file.write_all(bookmark.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|error| {
                    let _ = std::fs::remove_file(&temporary);
                    format!("Could not save folder authorization: {error}")
                })?;
            drop(file);
            std::fs::rename(&temporary, &path).map_err(|error| {
                let _ = std::fs::remove_file(&temporary);
                format!("Could not finish saving folder authorization: {error}")
            })
        }
        None => match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Could not clear folder authorization: {error}")),
        },
    }
}

#[cfg(vox_jot_app_store)]
fn load_bookmark(app: &AppHandle) -> Result<Option<String>, String> {
    let path = bookmark_file(app)?;
    match std::fs::read_to_string(path) {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read folder authorization: {error}")),
    }
}

pub fn configure_export_directory(
    app: &AppHandle,
    path: Option<String>,
) -> Result<Option<PathBuf>, String> {
    let Some(path) = path else {
        store_bookmark(app, None)?;
        return Ok(None);
    };
    let directory = PathBuf::from(path);
    if !directory.is_absolute() {
        return Err("Choose an absolute folder path for Markdown export.".to_string());
    }
    if !directory.is_dir() {
        return Err("The selected Markdown export folder is unavailable.".to_string());
    }

    #[cfg(all(vox_jot_app_store, target_os = "macos", target_arch = "aarch64"))]
    {
        let bookmark = macos_security_scope::create_bookmark(&directory)?;
        store_bookmark(app, Some(&bookmark))?;
    }

    #[cfg(all(vox_jot_app_store, target_os = "macos", not(target_arch = "aarch64")))]
    {
        return Err(
            "Persistent Markdown folder authorization is unavailable in this build.".to_string(),
        );
    }

    #[cfg(not(vox_jot_app_store))]
    store_bookmark(app, None)?;

    Ok(Some(directory))
}

fn snapshot_from_settings(
    app: &AppHandle,
    history_id: i64,
    timestamp: i64,
    title: &str,
) -> Result<Option<(MarkdownExportSnapshot, usize, bool, bool)>, String> {
    let settings = get_settings(app);
    if !settings.markdown_export_enabled {
        return Ok(None);
    }
    let export_dir = settings.markdown_export_dir.ok_or_else(|| {
        "Markdown export is enabled, but its destination folder is not configured.".to_string()
    })?;

    #[cfg(vox_jot_app_store)]
    let security_scoped_bookmark = load_bookmark(app)?;
    #[cfg(not(vox_jot_app_store))]
    let security_scoped_bookmark = None;

    Ok(Some((
        MarkdownExportSnapshot {
            export_dir,
            content_source: settings.markdown_export_content_source,
            include_frontmatter: settings.markdown_export_frontmatter,
            filename: generate_markdown_filename(timestamp, title, history_id),
            security_scoped_bookmark,
        },
        settings.markdown_export_min_words,
        settings.markdown_export_include_rewrite_selection,
        settings.markdown_export_include_failed_paste,
    )))
}

#[allow(clippy::too_many_arguments)]
pub fn maybe_export_markdown(
    app: &AppHandle,
    history_manager: HistoryManager,
    history_id: i64,
    timestamp: i64,
    transcription: &str,
    post_processed: Option<&str>,
    pasted: Option<&str>,
    duration_ms: Option<i64>,
    display_title: &str,
    is_rewrite_selection: bool,
) {
    let snapshot_result = snapshot_from_settings(app, history_id, timestamp, display_title);
    let Some((snapshot, minimum_words, include_rewrites, include_failed_paste)) =
        (match snapshot_result {
            Ok(value) => value,
            Err(message) => {
                let _ = history_manager.set_markdown_export_state(
                    history_id,
                    MarkdownExportStatus::Failed,
                    None,
                    Some(&message),
                    None,
                    None,
                );
                return;
            }
        })
    else {
        return;
    };

    let snapshot_json = match serde_json::to_string(&snapshot) {
        Ok(value) => value,
        Err(error) => {
            let message = format!("Could not prepare Markdown export settings: {error}");
            let _ = history_manager.set_markdown_export_state(
                history_id,
                MarkdownExportStatus::Failed,
                None,
                Some(&message),
                None,
                None,
            );
            return;
        }
    };

    let text = selected_content(
        snapshot.content_source,
        transcription,
        post_processed,
        pasted,
    );
    let skip_reason = if text.trim().is_empty() {
        Some("Skipped because the selected export text was empty.")
    } else if text.split_whitespace().count() < minimum_words {
        Some("Skipped because the dictation was below the minimum word count.")
    } else if is_rewrite_selection && !include_rewrites {
        Some("Skipped because selection rewrites are excluded by the export settings.")
    } else if pasted.is_none() && !include_failed_paste {
        Some("Skipped because the text was not delivered to another app.")
    } else {
        None
    };

    if let Some(reason) = skip_reason {
        if let Err(error) = history_manager.set_markdown_export_state(
            history_id,
            MarkdownExportStatus::Skipped,
            None,
            Some(reason),
            None,
            Some(&snapshot_json),
        ) {
            error!("Failed to save Markdown export skip state: {error}");
        }
        return;
    }

    let record = MarkdownExportRecord {
        history_id,
        timestamp,
        title: display_title.to_string(),
        transcription: transcription.to_string(),
        post_processed: post_processed.map(ToOwned::to_owned),
        pasted: pasted.map(ToOwned::to_owned),
        duration_ms,
    };
    queue_export(history_manager, snapshot, record, Some(snapshot_json));
}

fn queue_export(
    history_manager: HistoryManager,
    snapshot: MarkdownExportSnapshot,
    record: MarkdownExportRecord,
    snapshot_json: Option<String>,
) {
    let expected_path = snapshot.export_dir.join(&snapshot.filename);
    if let Err(error) = history_manager.set_markdown_export_state(
        record.history_id,
        MarkdownExportStatus::Pending,
        Some(&expected_path),
        None,
        None,
        snapshot_json.as_deref(),
    ) {
        error!("Failed to mark Markdown export pending: {error}");
        return;
    }

    spawn_export(history_manager, snapshot, record, expected_path);
}

fn spawn_export(
    history_manager: HistoryManager,
    snapshot: MarkdownExportSnapshot,
    record: MarkdownExportRecord,
    expected_path: PathBuf,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let text = selected_content(
            snapshot.content_source,
            &record.transcription,
            record.post_processed.as_deref(),
            record.pasted.as_deref(),
        );
        let content = format_markdown_content(
            &record.title,
            record.timestamp,
            text,
            record.duration_ms,
            snapshot.include_frontmatter,
            record.history_id,
        );
        let result = write_with_snapshot(&snapshot, &content);
        match result {
            Ok(path) => {
                if let Err(error) = history_manager.set_markdown_export_state(
                    record.history_id,
                    MarkdownExportStatus::Complete,
                    Some(&path),
                    None,
                    Some(Utc::now().timestamp()),
                    None,
                ) {
                    error!(
                        "Markdown exported, but its history state could not be updated: {error}"
                    );
                } else {
                    info!(
                        "Auto-exported Markdown for history entry {}",
                        record.history_id
                    );
                }
            }
            Err(message) => {
                error!(
                    "Markdown export failed for history entry {}: {}",
                    record.history_id, message
                );
                let _ = history_manager.set_markdown_export_state(
                    record.history_id,
                    MarkdownExportStatus::Failed,
                    Some(&expected_path),
                    Some(&message),
                    None,
                    None,
                );
            }
        }
    });
}

fn write_with_snapshot(
    snapshot: &MarkdownExportSnapshot,
    content: &str,
) -> Result<PathBuf, String> {
    #[cfg(all(vox_jot_app_store, target_os = "macos", target_arch = "aarch64"))]
    {
        let bookmark = snapshot
            .security_scoped_bookmark
            .as_deref()
            .ok_or_else(|| {
                "Folder authorization is missing. Choose the export folder again.".to_string()
            })?;
        return macos_security_scope::write_file(bookmark, &snapshot.filename, content);
    }

    #[cfg(all(vox_jot_app_store, target_os = "macos", not(target_arch = "aarch64")))]
    {
        Err("Persistent Markdown folder authorization is unavailable in this build.".to_string())
    }

    #[cfg(not(vox_jot_app_store))]
    write_atomic(&snapshot.export_dir, &snapshot.filename, content)
        .map_err(|error| format!("Could not write Markdown file: {error}"))
}

pub fn retry_markdown_export(
    app: &AppHandle,
    history_manager: Arc<HistoryManager>,
    entry: HistoryEntry,
) -> Result<(), String> {
    if entry.markdown_export_status != MarkdownExportStatus::Failed {
        return Err("Only failed Markdown exports can be retried.".to_string());
    }
    let snapshot_json = history_manager
        .markdown_export_settings_snapshot(entry.id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "This entry has no saved export settings. Create a new dictation after configuring Markdown export."
                .to_string()
        })?;
    let mut snapshot: MarkdownExportSnapshot = serde_json::from_str(&snapshot_json)
        .map_err(|error| format!("Could not read saved export settings: {error}"))?;
    refresh_folder_authorization(app, &mut snapshot)?;
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|error| format!("Could not preserve refreshed export settings: {error}"))?;
    let record = MarkdownExportRecord {
        history_id: entry.id,
        timestamp: entry.timestamp,
        title: entry.display_title,
        transcription: entry.transcription_text,
        post_processed: entry.post_processed_text,
        pasted: entry.pasted_text,
        duration_ms: entry.duration_ms,
    };
    let expected_path = snapshot.export_dir.join(&snapshot.filename);
    let claimed = history_manager
        .claim_markdown_export_retry(entry.id, &expected_path, &snapshot_json)
        .map_err(|error| error.to_string())?;
    if !claimed {
        return Err(
            "This Markdown export is already pending, completed, or no longer retryable."
                .to_string(),
        );
    }
    spawn_export(
        history_manager.as_ref().clone(),
        snapshot,
        record,
        expected_path,
    );
    debug!(
        "Queued Markdown export retry for history entry {}",
        entry.id
    );
    Ok(())
}

fn refresh_folder_authorization(
    app: &AppHandle,
    snapshot: &mut MarkdownExportSnapshot,
) -> Result<(), String> {
    #[cfg(vox_jot_app_store)]
    {
        let settings = get_settings(app);
        if settings.markdown_export_dir.as_ref() == Some(&snapshot.export_dir) {
            if let Some(bookmark) = load_bookmark(app)? {
                snapshot.security_scoped_bookmark = Some(bookmark);
            }
        }
    }
    #[cfg(not(vox_jot_app_store))]
    let _ = (app, snapshot);
    Ok(())
}

pub fn reveal_markdown_export(
    app: &AppHandle,
    history_manager: &HistoryManager,
    entry: &HistoryEntry,
) -> Result<(), String> {
    if entry.markdown_export_status != MarkdownExportStatus::Complete {
        return Err("This history entry does not have a completed Markdown export.".to_string());
    }
    #[cfg(all(vox_jot_app_store, target_os = "macos", target_arch = "aarch64"))]
    {
        let snapshot_json = history_manager
            .markdown_export_settings_snapshot(entry.id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "The export folder authorization is missing.".to_string())?;
        let mut snapshot: MarkdownExportSnapshot = serde_json::from_str(&snapshot_json)
            .map_err(|error| format!("Could not read export folder authorization: {error}"))?;
        refresh_folder_authorization(app, &mut snapshot)?;
        let bookmark = snapshot
            .security_scoped_bookmark
            .as_deref()
            .ok_or_else(|| {
                "Folder authorization is missing. Choose the export folder again.".to_string()
            })?;
        return macos_security_scope::reveal_file(bookmark, &snapshot.filename);
    }

    #[cfg(not(all(vox_jot_app_store, target_os = "macos", target_arch = "aarch64")))]
    {
        use tauri_plugin_opener::OpenerExt;
        let _ = history_manager;
        let path = entry
            .markdown_export_path
            .as_deref()
            .map(PathBuf::from)
            .ok_or_else(|| "The completed export has no saved file path.".to_string())?;
        if !path.is_file() {
            return Err("The exported Markdown file could not be found.".to_string());
        }
        app.opener()
            .reveal_item_in_dir(&path)
            .map_err(|error| format!("Could not reveal Markdown export: {error}"))
    }
}

#[cfg(all(vox_jot_app_store, target_os = "macos", target_arch = "aarch64"))]
mod macos_security_scope {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};
    use std::path::{Path, PathBuf};

    #[repr(C)]
    struct AuthorizedFileResponse {
        value: *mut c_char,
        success: c_int,
        error_message: *mut c_char,
    }

    unsafe extern "C" {
        fn create_security_scoped_bookmark_apple(
            directory_path: *const c_char,
        ) -> *mut AuthorizedFileResponse;
        fn write_security_scoped_file_apple(
            bookmark_base64: *const c_char,
            filename: *const c_char,
            content: *const c_char,
        ) -> *mut AuthorizedFileResponse;
        fn reveal_security_scoped_file_apple(
            bookmark_base64: *const c_char,
            filename: *const c_char,
        ) -> *mut AuthorizedFileResponse;
        fn free_authorized_file_response(response: *mut AuthorizedFileResponse);
    }

    struct ResponseGuard(*mut AuthorizedFileResponse);

    impl Drop for ResponseGuard {
        fn drop(&mut self) {
            unsafe { free_authorized_file_response(self.0) };
        }
    }

    fn response_value(pointer: *mut AuthorizedFileResponse) -> Result<String, String> {
        if pointer.is_null() {
            return Err("The macOS folder authorization bridge returned no response.".to_string());
        }
        let _guard = ResponseGuard(pointer);
        let response = unsafe { &*pointer };
        if response.success == 0 {
            let message = if response.error_message.is_null() {
                "macOS denied access to the selected folder.".to_string()
            } else {
                unsafe { CStr::from_ptr(response.error_message) }
                    .to_string_lossy()
                    .into_owned()
            };
            return Err(message);
        }
        if response.value.is_null() {
            return Ok(String::new());
        }
        Ok(unsafe { CStr::from_ptr(response.value) }
            .to_string_lossy()
            .into_owned())
    }

    fn c_string(value: &str, label: &str) -> Result<CString, String> {
        CString::new(value).map_err(|_| format!("{label} contains an unsupported null character."))
    }

    pub fn create_bookmark(directory: &Path) -> Result<String, String> {
        let path = c_string(&directory.to_string_lossy(), "The folder path")?;
        response_value(unsafe { create_security_scoped_bookmark_apple(path.as_ptr()) })
    }

    pub fn write_file(bookmark: &str, filename: &str, content: &str) -> Result<PathBuf, String> {
        let bookmark = c_string(bookmark, "Folder authorization")?;
        let filename = c_string(filename, "The export filename")?;
        let content = c_string(content, "The Markdown content")?;
        response_value(unsafe {
            write_security_scoped_file_apple(bookmark.as_ptr(), filename.as_ptr(), content.as_ptr())
        })
        .map(PathBuf::from)
    }

    pub fn reveal_file(bookmark: &str, filename: &str) -> Result<(), String> {
        let bookmark = c_string(bookmark, "Folder authorization")?;
        let filename = c_string(filename, "The export filename")?;
        response_value(unsafe {
            reveal_security_scoped_file_apple(bookmark.as_ptr(), filename.as_ptr())
        })
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_is_safe_and_bounded() {
        assert_eq!(
            slugify("Sprint Planning Meeting #4!", 40),
            "sprint-planning-meeting-4"
        );
        assert_eq!(slugify("   ", 40), "dictation");
        assert!(
            slugify("a very long title with many words", 12)
                .chars()
                .count()
                <= 12
        );
    }

    #[test]
    fn filename_is_stable_and_contains_history_id() {
        let filename = generate_markdown_filename(1_700_000_000, "Weekly Standup", 42);
        assert!(filename.ends_with("-weekly-standup-history-42.md"));
        assert_eq!(
            filename,
            generate_markdown_filename(1_700_000_000, "Weekly Standup", 42)
        );
    }

    #[test]
    fn final_export_uses_the_actual_delivered_text() {
        assert_eq!(
            selected_content(
                MarkdownExportContentSource::Final,
                "raw",
                Some("refined"),
                Some("delivered")
            ),
            "delivered"
        );
        assert_eq!(
            selected_content(
                MarkdownExportContentSource::Raw,
                "raw",
                Some("refined"),
                Some("delivered")
            ),
            "raw"
        );
        assert_eq!(
            selected_content(
                MarkdownExportContentSource::Final,
                "raw",
                Some("refined"),
                None
            ),
            "refined"
        );
    }

    #[test]
    fn content_uses_valid_yaml_quoting_and_one_body() {
        let content = format_markdown_content(
            "Project: Review\nToday",
            1_700_000_000,
            "Refined dictation with more words.",
            Some(4_500),
            true,
            42,
        );
        assert!(content.starts_with("---\n"));
        assert!(content.contains("title: \"Project: Review Today\"\n"));
        assert!(content.contains("duration_ms: 4500\n"));
        assert!(content.contains("vox_jot_id: 42\n"));
        assert!(
            content.ends_with("# Project: Review Today\n\nRefined dictation with more words.\n")
        );
    }

    #[test]
    fn atomic_write_does_not_leave_temp_file() {
        let directory =
            std::env::temp_dir().join(format!("vox_jot_markdown_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = write_atomic(&directory, "note.md", "# Note\n").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "# Note\n");
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn retry_is_idempotent_and_never_overwrites_different_content() {
        let directory = tempfile::tempdir().unwrap();
        let path = write_atomic(directory.path(), "note.md", "original").unwrap();
        assert_eq!(
            write_atomic(directory.path(), "note.md", "original").unwrap(),
            path
        );
        assert!(write_atomic(directory.path(), "note.md", "replacement").is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "original");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn export_rejects_path_traversal() {
        let directory = tempfile::tempdir().unwrap();
        assert!(write_atomic(directory.path(), "../escape.md", "data").is_err());
    }
}
