use crate::correction_tracker::store::{CorrectionStore, StoredCorrection};
use plist::Value as PlistValue;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

const DICTIONARY_IMPORT_MAX_BYTES: u64 = 10 * 1024 * 1024;

fn emit_corrections_updated(app: &AppHandle) {
    if let Err(error) = app.emit("corrections-updated", ()) {
        log::debug!("Failed to emit corrections-updated: {}", error);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DictionaryImportSummary {
    pub imported: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct DictionaryImportEntry {
    original: String,
    corrected: String,
    exact_only: bool,
}

/// Get all stored corrections.
#[tauri::command]
#[specta::specta]
pub fn get_corrections(app: AppHandle) -> Result<Vec<StoredCorrection>, String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.list_all().map_err(|e| e.to_string())
}

/// Delete a correction by ID.
#[tauri::command]
#[specta::specta]
pub fn delete_correction(app: AppHandle, id: i64) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.delete_correction(id).map_err(|e| e.to_string())?;
    emit_corrections_updated(&app);
    Ok(())
}

/// Update the original and corrected text for a learned correction.
#[tauri::command]
#[specta::specta]
pub fn update_correction(
    app: AppHandle,
    id: i64,
    original: String,
    corrected: String,
) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store
        .update_correction(id, &original, &corrected)
        .map_err(|e| e.to_string())?;
    emit_corrections_updated(&app);
    Ok(())
}

/// Toggle the active state of a correction.
#[tauri::command]
#[specta::specta]
pub fn toggle_correction(app: AppHandle, id: i64, active: bool) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.set_active(id, active).map_err(|e| e.to_string())?;
    emit_corrections_updated(&app);
    Ok(())
}

/// Update the apps where a correction should be disabled.
#[tauri::command]
#[specta::specta]
pub fn set_correction_disabled_apps(
    app: AppHandle,
    id: i64,
    bundle_ids: Vec<String>,
) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store
        .set_disabled_bundle_ids(id, &bundle_ids)
        .map_err(|e| e.to_string())?;
    emit_corrections_updated(&app);
    Ok(())
}

/// Clear all stored corrections.
#[tauri::command]
#[specta::specta]
pub fn clear_all_corrections(app: AppHandle) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.clear_all().map_err(|e| e.to_string())?;
    emit_corrections_updated(&app);
    Ok(())
}

/// Export all corrections as a JSON string.
#[tauri::command]
#[specta::specta]
pub fn export_corrections(app: AppHandle) -> Result<String, String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.export_json().map_err(|e| e.to_string())
}

/// Manually add a new correction pair.
#[tauri::command]
#[specta::specta]
pub fn add_manual_correction(
    app: AppHandle,
    original: String,
    corrected: String,
    exact_only: bool,
) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    store
        .add_manual_correction(&original, &corrected, exact_only, now)
        .map_err(|e| e.to_string())?;
    emit_corrections_updated(&app);
    Ok(())
}

/// Add a dictionary correction learned from a transcript word edit, but only
/// when the edit looks like a genuine misrecognition fix. Returns whether an
/// entry was added (`false` means the edit was treated as an ordinary word
/// change and intentionally not stored).
#[tauri::command]
#[specta::specta]
pub fn add_transcript_word_correction(
    app: AppHandle,
    original: String,
    corrected: String,
) -> Result<bool, String> {
    let store = app.state::<Arc<CorrectionStore>>();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let added = store
        .add_correction_if_plausible(&original, &corrected, now)
        .map_err(|e| e.to_string())?;
    if added {
        emit_corrections_updated(&app);
    }
    Ok(added)
}

/// Import corrections from a JSON string.
#[tauri::command]
#[specta::specta]
pub fn import_corrections(app: AppHandle, json: String) -> Result<usize, String> {
    let store = app.state::<Arc<CorrectionStore>>();
    let imported = store.import_json(&json).map_err(|e| e.to_string())?;
    if imported > 0 {
        emit_corrections_updated(&app);
    }
    Ok(imported)
}

/// Import a dictionary file selected by the frontend file picker.
///
/// Supported formats include Vox Jot JSON exports, JSON dictionary arrays or
/// maps, macOS text replacement plists, CSV/TSV/TAB two-column files, Hunspell
/// `.dic` word lists, and plain text word lists.
#[tauri::command]
#[specta::specta]
pub fn import_dictionary_file(
    app: AppHandle,
    path: String,
) -> Result<DictionaryImportSummary, String> {
    let path_ref = Path::new(&path);
    let metadata = std::fs::metadata(path_ref)
        .map_err(|e| format!("Failed to inspect dictionary file: {e}"))?;
    if !metadata.is_file() {
        return Err("Choose a dictionary file, not a folder.".to_string());
    }
    if metadata.len() > DICTIONARY_IMPORT_MAX_BYTES {
        return Err("That dictionary file is too large to import.".to_string());
    }

    let bytes =
        std::fs::read(path_ref).map_err(|e| format!("Failed to read dictionary file: {e}"))?;
    let parsed = parse_dictionary_import_entries(path_ref, &bytes)?;
    if parsed.is_empty() {
        return Err("No dictionary entries were found in that file.".to_string());
    }

    let mut seen = HashSet::new();
    let entries: Vec<_> = parsed
        .into_iter()
        .filter(|entry| {
            seen.insert((
                entry.original.to_lowercase(),
                entry.corrected.to_lowercase(),
                entry.exact_only,
            ))
        })
        .collect();

    let store = app.state::<Arc<CorrectionStore>>();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let mut imported = 0;
    let mut skipped = 0;
    for entry in &entries {
        match store.add_imported_correction(
            &entry.original,
            &entry.corrected,
            entry.exact_only,
            now,
        ) {
            Ok(()) => imported += 1,
            Err(e) => {
                log::warn!(
                    "Skipped imported dictionary entry '{}' → '{}': {}",
                    entry.original,
                    entry.corrected,
                    e
                );
                skipped += 1;
            }
        }
    }

    if imported > 0 {
        emit_corrections_updated(&app);
    }

    Ok(DictionaryImportSummary { imported, skipped })
}

fn parse_dictionary_import_entries(
    path: &Path,
    bytes: &[u8],
) -> Result<Vec<DictionaryImportEntry>, String> {
    if looks_like_plist(path, bytes) {
        let value = PlistValue::from_reader(Cursor::new(bytes))
            .map_err(|e| format!("Failed to parse plist dictionary: {e}"))?;
        return Ok(parse_plist_value(&value));
    }

    if let Ok(json) = serde_json::from_slice::<JsonValue>(bytes) {
        let entries = parse_json_value(&json);
        if !entries.is_empty() {
            return Ok(entries);
        }
    }

    let text = decode_import_text(bytes)?;
    Ok(parse_delimited_or_word_list(path, &text))
}

fn looks_like_plist(path: &Path, bytes: &[u8]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("plist"))
        || bytes.starts_with(b"bplist")
        || bytes
            .iter()
            .copied()
            .find(|byte| !byte.is_ascii_whitespace())
            .is_some_and(|byte| byte == b'<')
            && String::from_utf8_lossy(&bytes[..bytes.len().min(256)]).contains("<plist")
}

fn decode_import_text(bytes: &[u8]) -> Result<String, String> {
    std::str::from_utf8(bytes)
        .map(|text| text.trim_start_matches('\u{feff}').to_string())
        .map_err(|_| "Dictionary file must be UTF-8 text, JSON, or a plist.".to_string())
}

fn parse_plist_value(value: &PlistValue) -> Vec<DictionaryImportEntry> {
    match value {
        PlistValue::Array(items) => items.iter().filter_map(parse_plist_entry).collect(),
        PlistValue::Dictionary(dict) => {
            if let Some(entry) = parse_plist_entry(value) {
                return vec![entry];
            }

            let mut entries = Vec::new();
            for key in [
                "NSUserDictionaryReplacementItems",
                "NSUserReplacementItems",
                "replacements",
                "entries",
                "dictionary",
                "items",
            ] {
                if let Some(value) = dict.get(key) {
                    entries.extend(parse_plist_value(value));
                }
            }
            entries
        }
        _ => Vec::new(),
    }
}

fn parse_plist_entry(value: &PlistValue) -> Option<DictionaryImportEntry> {
    let PlistValue::Dictionary(dict) = value else {
        return None;
    };
    let mut map = HashMap::new();
    for (key, value) in dict {
        if let Some(text) = plist_string(value) {
            map.insert(normalize_header(key), text);
        }
    }
    entry_from_field_map(&map)
}

fn plist_string(value: &PlistValue) -> Option<String> {
    match value {
        PlistValue::String(text) => Some(text.clone()),
        PlistValue::Integer(value) => Some(value.to_string()),
        PlistValue::Real(value) => Some(value.to_string()),
        PlistValue::Boolean(value) => Some(value.to_string()),
        _ => None,
    }
}

fn parse_json_value(value: &JsonValue) -> Vec<DictionaryImportEntry> {
    match value {
        JsonValue::Array(items) => items.iter().filter_map(parse_json_entry).collect(),
        JsonValue::Object(object) => {
            if let Some(entry) = parse_json_entry(value) {
                return vec![entry];
            }

            let mut entries = Vec::new();
            for key in [
                "corrections",
                "dictionary",
                "entries",
                "replacements",
                "items",
                "personal_dictionary",
            ] {
                if let Some(value) = object.get(key) {
                    entries.extend(parse_json_value(value));
                }
            }

            if entries.is_empty() {
                for (key, value) in object {
                    if let Some(corrected) = value.as_str() {
                        if let Some(entry) = make_entry(key, corrected, false) {
                            entries.push(entry);
                        }
                    }
                }
            }
            entries
        }
        _ => Vec::new(),
    }
}

fn parse_json_entry(value: &JsonValue) -> Option<DictionaryImportEntry> {
    let JsonValue::Object(object) = value else {
        if let Some(word) = value.as_str() {
            return make_entry(word, word, false);
        }
        return None;
    };

    let mut map = HashMap::new();
    for (key, value) in object {
        if let Some(text) = json_scalar_string(value) {
            map.insert(normalize_header(key), text);
        }
    }
    entry_from_field_map(&map)
}

fn json_scalar_string(value: &JsonValue) -> Option<String> {
    match value {
        JsonValue::String(text) => Some(text.clone()),
        JsonValue::Number(value) => Some(value.to_string()),
        JsonValue::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn entry_from_field_map(map: &HashMap<String, String>) -> Option<DictionaryImportEntry> {
    let original = first_field(
        map,
        &[
            "original",
            "spoken",
            "shortcut",
            "replace",
            "from",
            "trigger",
            "input",
            "source",
            "sourceterm",
            "term",
        ],
    );
    let corrected = first_field(
        map,
        &[
            "corrected",
            "written",
            "phrase",
            "with",
            "to",
            "replacement",
            "output",
            "word",
            "target",
            "targetterm",
            "translation",
        ],
    );

    match (original, corrected) {
        (Some(original), Some(corrected)) => make_entry(original, corrected, false),
        (None, Some(word)) => make_entry(word, word, false),
        _ => None,
    }
}

fn first_field<'a>(map: &'a HashMap<String, String>, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| map.get(*key).map(String::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn parse_delimited_or_word_list(path: &Path, text: &str) -> Vec<DictionaryImportEntry> {
    let is_hunspell = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("dic"));
    let mut entries = Vec::new();
    let mut headers: Option<Vec<String>> = None;
    let mut first_content_line = true;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }

        if first_content_line && is_hunspell && line.chars().all(|ch| ch.is_ascii_digit()) {
            first_content_line = false;
            continue;
        }
        first_content_line = false;

        if let Some((original, corrected)) = split_arrow_pair(line) {
            if let Some(entry) = make_entry(&original, &corrected, false) {
                entries.push(entry);
            }
            continue;
        }

        let delimiter = best_delimiter(line);
        let columns = delimiter
            .map(|delimiter| parse_delimited_line(line, delimiter))
            .unwrap_or_else(|| vec![line.to_string()]);

        if columns.len() >= 2 {
            if headers.is_none() && looks_like_header(&columns) {
                headers = Some(
                    columns
                        .iter()
                        .map(|column| normalize_header(column))
                        .collect(),
                );
                continue;
            }

            let pair = headers
                .as_ref()
                .and_then(|headers| pair_from_headers(headers, &columns))
                .or_else(|| Some((columns[0].as_str(), columns[1].as_str())));

            if let Some((original, corrected)) = pair {
                if let Some(entry) = make_entry(original, corrected, false) {
                    entries.push(entry);
                }
            }
        } else if let Some(word) = normalize_word_list_item(line, is_hunspell) {
            if let Some(entry) = make_entry(&word, &word, false) {
                entries.push(entry);
            }
        }
    }

    entries
}

fn best_delimiter(line: &str) -> Option<char> {
    let candidates = ['\t', ',', ';'];
    candidates
        .iter()
        .copied()
        .max_by_key(|delimiter| line.matches(*delimiter).count())
        .filter(|delimiter| line.matches(*delimiter).count() > 0)
}

fn parse_delimited_line(line: &str, delimiter: char) -> Vec<String> {
    let mut columns = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if ch == '"' {
            if in_quotes && chars.peek() == Some(&'"') {
                current.push('"');
                chars.next();
            } else {
                in_quotes = !in_quotes;
            }
        } else if ch == delimiter && !in_quotes {
            columns.push(current.trim().trim_matches('"').to_string());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    columns.push(current.trim().trim_matches('"').to_string());
    columns
}

fn looks_like_header(columns: &[String]) -> bool {
    columns.iter().any(|column| {
        matches!(
            normalize_header(column).as_str(),
            "original"
                | "spoken"
                | "shortcut"
                | "replace"
                | "from"
                | "source"
                | "sourceterm"
                | "term"
                | "corrected"
                | "written"
                | "phrase"
                | "target"
                | "targetterm"
                | "translation"
                | "with"
        )
    })
}

fn pair_from_headers<'a>(headers: &[String], columns: &'a [String]) -> Option<(&'a str, &'a str)> {
    let original_index = headers.iter().position(|header| {
        matches!(
            header.as_str(),
            "original"
                | "spoken"
                | "shortcut"
                | "replace"
                | "from"
                | "trigger"
                | "input"
                | "source"
                | "sourceterm"
                | "term"
        )
    });
    let corrected_index = headers.iter().position(|header| {
        matches!(
            header.as_str(),
            "corrected"
                | "written"
                | "phrase"
                | "with"
                | "to"
                | "replacement"
                | "output"
                | "word"
                | "target"
                | "targetterm"
                | "translation"
        )
    });

    match (original_index, corrected_index) {
        (Some(original), Some(corrected)) => Some((
            columns.get(original)?.as_str(),
            columns.get(corrected)?.as_str(),
        )),
        (None, Some(corrected)) => {
            let word = columns.get(corrected)?.as_str();
            Some((word, word))
        }
        _ => None,
    }
}

fn normalize_header(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .to_lowercase()
        .replace([' ', '-', '_'], "")
}

fn split_arrow_pair(line: &str) -> Option<(String, String)> {
    for delimiter in ["=>", "->", "→", "="] {
        if let Some((left, right)) = line.split_once(delimiter) {
            return Some((left.trim().to_string(), right.trim().to_string()));
        }
    }
    None
}

fn normalize_word_list_item(line: &str, strip_hunspell_flags: bool) -> Option<String> {
    let mut word = line.trim().trim_matches('"').to_string();
    if strip_hunspell_flags {
        if let Some(index) = first_unescaped_slash(&word) {
            if index > 0 {
                word.truncate(index);
            }
        }
        word = word.replace("\\/", "/");
    }
    if word.is_empty() || word.chars().all(|ch| !ch.is_alphanumeric()) {
        None
    } else {
        Some(word)
    }
}

fn first_unescaped_slash(value: &str) -> Option<usize> {
    let mut escaped = false;
    for (index, ch) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '/' {
            return Some(index);
        }
    }
    None
}

fn make_entry(
    original: impl AsRef<str>,
    corrected: impl AsRef<str>,
    exact_only: bool,
) -> Option<DictionaryImportEntry> {
    let original = clean_import_value(original.as_ref());
    let corrected = clean_import_value(corrected.as_ref());
    if original.is_empty() || corrected.is_empty() {
        return None;
    }
    Some(DictionaryImportEntry {
        original,
        corrected,
        exact_only,
    })
}

fn clean_import_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

#[cfg(test)]
mod import_tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parses_vox_jot_json_export() {
        let json = br#"[{"original":"swift ui","corrected":"SwiftUI"},{"spoken":"tauri","written":"Tauri"}]"#;
        let entries = parse_dictionary_import_entries(Path::new("dictionary.json"), json).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].original, "swift ui");
        assert_eq!(entries[0].corrected, "SwiftUI");
        assert_eq!(entries[1].original, "tauri");
        assert_eq!(entries[1].corrected, "Tauri");
    }

    #[test]
    fn parses_csv_with_headers_and_quotes() {
        let csv = b"spoken,written\n\"swift ui\",\"SwiftUI\"\nrecieve,receive\n";
        let entries = parse_dictionary_import_entries(Path::new("dictionary.csv"), csv).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].original, "swift ui");
        assert_eq!(entries[0].corrected, "SwiftUI");
        assert_eq!(entries[1].original, "recieve");
        assert_eq!(entries[1].corrected, "receive");
    }

    #[test]
    fn parses_glossary_csv_source_target_headers() {
        let csv = b"source term,target term\nvox jot,Vox Jot\n";
        let entries = parse_dictionary_import_entries(Path::new("glossary.csv"), csv).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].original, "vox jot");
        assert_eq!(entries[0].corrected, "Vox Jot");
    }

    #[test]
    fn parses_macos_text_replacement_plist() {
        let plist = br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><array><dict><key>shortcut</key><string>vj</string><key>phrase</key><string>Vox Jot</string></dict></array></plist>"#;
        let entries =
            parse_dictionary_import_entries(Path::new("Text Substitutions.plist"), plist).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].original, "vj");
        assert_eq!(entries[0].corrected, "Vox Jot");
    }

    #[test]
    fn parses_hunspell_dic_word_list() {
        let dic = b"3\nSwiftUI\nTauri/SM\nAC\\/DC\n";
        let entries = parse_dictionary_import_entries(Path::new("custom.dic"), dic).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].original, "SwiftUI");
        assert_eq!(entries[0].corrected, "SwiftUI");
        assert_eq!(entries[1].original, "Tauri");
        assert_eq!(entries[1].corrected, "Tauri");
        assert_eq!(entries[2].original, "AC/DC");
    }
}
