use anyhow::Result;
use chrono::{DateTime, Local, Utc};
use log::{debug, error, info};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

use crate::audio_toolkit::save_wav_file;
use crate::screen_context::ContextCaptureStatus;
use crate::tts::TtsHistoryContext;

/// Database migrations for transcription history.
/// Each migration is applied in order. The library tracks which migrations
/// have been applied using SQLite's user_version pragma.
///
/// Note: For users upgrading from tauri-plugin-sql, migrate_from_tauri_plugin_sql()
/// converts the old _sqlx_migrations table tracking to the user_version pragma,
/// ensuring migrations don't re-run on existing databases.
static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS transcription_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            saved BOOLEAN NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            transcription_text TEXT NOT NULL
        );",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_processed_text TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_prompt TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN dictionary_hits TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN pasted_text TEXT;"),
    // Field snapshot captured ~30s after paste
    M::up("ALTER TABLE transcription_history ADD COLUMN field_snapshot_text TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN field_snapshot_at INTEGER;"),
    M::up(
        "ALTER TABLE transcription_history ADD COLUMN field_snapshot_status TEXT NOT NULL DEFAULT 'not_requested';",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN field_snapshot_error TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN source_language_detected TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN translation_target_language TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN translated_text TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN translation_route TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN translation_provider_id TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN translation_model_id TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN translation_origin TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN translation_destination TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN tts_requested BOOLEAN;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN tts_engine TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN tts_voice_id TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN tts_locale TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN tts_trigger TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN tts_status TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN screen_context_metadata TEXT;"),
];

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum FieldSnapshotStatus {
    #[default]
    NotRequested,
    Pending,
    Captured,
    Skipped,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryEntry {
    pub id: i64,
    pub file_name: String,
    pub timestamp: i64,
    pub saved: bool,
    pub title: String,
    pub transcription_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
    pub dictionary_hits: Vec<String>,
    pub pasted_text: Option<String>,
    pub field_snapshot_text: Option<String>,
    pub field_snapshot_at: Option<i64>,
    pub field_snapshot_status: FieldSnapshotStatus,
    pub field_snapshot_error: Option<String>,
    pub source_language_detected: Option<String>,
    pub translation_target_language: Option<String>,
    pub translated_text: Option<String>,
    pub translation_route: Option<String>,
    pub translation_provider_id: Option<String>,
    pub translation_model_id: Option<String>,
    pub translation_origin: Option<String>,
    pub translation_destination: Option<String>,
    pub tts_requested: Option<bool>,
    pub tts_engine: Option<String>,
    pub tts_voice_id: Option<String>,
    pub tts_locale: Option<String>,
    pub tts_trigger: Option<String>,
    pub tts_status: Option<String>,
    pub screen_context_metadata: Option<ScreenContextHistoryMetadata>,
}

#[derive(Clone, Debug, Default)]
pub struct TranslationHistoryContext {
    pub source_language_detected: Option<String>,
    pub translation_target_language: Option<String>,
    pub translated_text: Option<String>,
    pub translation_route: Option<String>,
    pub translation_provider_id: Option<String>,
    pub translation_model_id: Option<String>,
    pub translation_origin: Option<String>,
    pub translation_destination: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
pub struct ScreenContextHistoryMetadata {
    pub source: Option<String>,
    pub capture_status: ContextCaptureStatus,
    pub cache_age_ms: Option<u64>,
    pub summary: Option<String>,
    pub sent_externally: bool,
    pub changed_output: bool,
}

/// Parse a database row into a HistoryEntry, deserializing the dictionary_hits JSON column.
fn row_to_history_entry(row: &rusqlite::Row) -> HistoryEntry {
    let hits_json: Option<String> = row.get("dictionary_hits").unwrap_or(None);
    let dictionary_hits = hits_json
        .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
        .unwrap_or_default();
    let field_snapshot_text: Option<String> = row.get("field_snapshot_text").unwrap_or(None);
    let field_snapshot_at: Option<i64> = row.get("field_snapshot_at").unwrap_or(None);
    let field_snapshot_error: Option<String> = row.get("field_snapshot_error").unwrap_or(None);
    let field_snapshot_status_raw: Option<String> =
        row.get("field_snapshot_status").unwrap_or(None);
    let field_snapshot_status = match field_snapshot_status_raw.as_deref() {
        Some("pending") => FieldSnapshotStatus::Pending,
        Some("captured") => FieldSnapshotStatus::Captured,
        Some("skipped") => FieldSnapshotStatus::Skipped,
        Some("failed") => FieldSnapshotStatus::Failed,
        Some("not_requested") => FieldSnapshotStatus::NotRequested,
        _ if field_snapshot_error.is_some() => FieldSnapshotStatus::Failed,
        _ if field_snapshot_text.is_some() || field_snapshot_at.is_some() => {
            FieldSnapshotStatus::Captured
        }
        _ => FieldSnapshotStatus::NotRequested,
    };
    let screen_context_metadata = row
        .get::<_, Option<String>>("screen_context_metadata")
        .unwrap_or(None)
        .and_then(|json| serde_json::from_str::<ScreenContextHistoryMetadata>(&json).ok());

    HistoryEntry {
        id: row.get("id").unwrap_or_default(),
        file_name: row.get("file_name").unwrap_or_default(),
        timestamp: row.get("timestamp").unwrap_or_default(),
        saved: row.get("saved").unwrap_or_default(),
        title: row.get("title").unwrap_or_default(),
        transcription_text: row.get("transcription_text").unwrap_or_default(),
        post_processed_text: row.get("post_processed_text").unwrap_or(None),
        post_process_prompt: row.get("post_process_prompt").unwrap_or(None),
        dictionary_hits,
        pasted_text: row.get("pasted_text").unwrap_or(None),
        field_snapshot_text,
        field_snapshot_at,
        field_snapshot_status,
        field_snapshot_error,
        source_language_detected: row.get("source_language_detected").unwrap_or(None),
        translation_target_language: row.get("translation_target_language").unwrap_or(None),
        translated_text: row.get("translated_text").unwrap_or(None),
        translation_route: row.get("translation_route").unwrap_or(None),
        translation_provider_id: row.get("translation_provider_id").unwrap_or(None),
        translation_model_id: row.get("translation_model_id").unwrap_or(None),
        translation_origin: row.get("translation_origin").unwrap_or(None),
        translation_destination: row.get("translation_destination").unwrap_or(None),
        tts_requested: row.get("tts_requested").unwrap_or(None),
        tts_engine: row.get("tts_engine").unwrap_or(None),
        tts_voice_id: row.get("tts_voice_id").unwrap_or(None),
        tts_locale: row.get("tts_locale").unwrap_or(None),
        tts_trigger: row.get("tts_trigger").unwrap_or(None),
        tts_status: row.get("tts_status").unwrap_or(None),
        screen_context_metadata,
    }
}

pub struct HistoryManager {
    app_handle: AppHandle,
    recordings_dir: PathBuf,
    db_path: PathBuf,
}

impl HistoryManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create recordings directory in app data dir
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        let recordings_dir = app_data_dir.join("recordings");
        let db_path = app_data_dir.join("history.db");

        // Ensure recordings directory exists
        if !recordings_dir.exists() {
            fs::create_dir_all(&recordings_dir)?;
            debug!("Created recordings directory: {:?}", recordings_dir);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            recordings_dir,
            db_path,
        };

        // Initialize database and run migrations synchronously
        manager.init_database()?;

        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing database at {:?}", self.db_path);

        let mut conn = Connection::open(&self.db_path)?;

        // Handle migration from tauri-plugin-sql to rusqlite_migration
        // tauri-plugin-sql used _sqlx_migrations table, rusqlite_migration uses user_version pragma
        self.migrate_from_tauri_plugin_sql(&conn)?;

        // Create migrations object and run to latest version
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        // Validate migrations in debug builds
        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid migrations");

        // Get current version before migration
        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!("Database version before migration: {}", version_before);

        // Apply any pending migrations
        migrations.to_latest(&mut conn)?;

        // Get version after migration
        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version_after > version_before {
            info!(
                "Database migrated from version {} to {}",
                version_before, version_after
            );
        } else {
            debug!("Database already at latest version {}", version_after);
        }

        self.ensure_history_columns(&conn)?;

        Ok(())
    }

    fn ensure_history_columns(&self, conn: &Connection) -> Result<()> {
        let mut stmt = conn.prepare("PRAGMA table_info(transcription_history)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;

        let mut existing_columns = std::collections::HashSet::new();
        for row in rows {
            existing_columns.insert(row?);
        }

        let required_columns = [
            ("post_processed_text", "ALTER TABLE transcription_history ADD COLUMN post_processed_text TEXT"),
            ("post_process_prompt", "ALTER TABLE transcription_history ADD COLUMN post_process_prompt TEXT"),
            ("dictionary_hits", "ALTER TABLE transcription_history ADD COLUMN dictionary_hits TEXT"),
            ("pasted_text", "ALTER TABLE transcription_history ADD COLUMN pasted_text TEXT"),
            ("field_snapshot_text", "ALTER TABLE transcription_history ADD COLUMN field_snapshot_text TEXT"),
            ("field_snapshot_at", "ALTER TABLE transcription_history ADD COLUMN field_snapshot_at INTEGER"),
            (
                "field_snapshot_status",
                "ALTER TABLE transcription_history ADD COLUMN field_snapshot_status TEXT NOT NULL DEFAULT 'not_requested'",
            ),
            ("field_snapshot_error", "ALTER TABLE transcription_history ADD COLUMN field_snapshot_error TEXT"),
            ("screen_context_metadata", "ALTER TABLE transcription_history ADD COLUMN screen_context_metadata TEXT"),
            ("source_language_detected", "ALTER TABLE transcription_history ADD COLUMN source_language_detected TEXT"),
            ("translation_target_language", "ALTER TABLE transcription_history ADD COLUMN translation_target_language TEXT"),
            ("translated_text", "ALTER TABLE transcription_history ADD COLUMN translated_text TEXT"),
            ("translation_route", "ALTER TABLE transcription_history ADD COLUMN translation_route TEXT"),
            ("translation_provider_id", "ALTER TABLE transcription_history ADD COLUMN translation_provider_id TEXT"),
            ("translation_model_id", "ALTER TABLE transcription_history ADD COLUMN translation_model_id TEXT"),
            ("translation_origin", "ALTER TABLE transcription_history ADD COLUMN translation_origin TEXT"),
            ("translation_destination", "ALTER TABLE transcription_history ADD COLUMN translation_destination TEXT"),
            ("tts_requested", "ALTER TABLE transcription_history ADD COLUMN tts_requested BOOLEAN"),
            ("tts_engine", "ALTER TABLE transcription_history ADD COLUMN tts_engine TEXT"),
            ("tts_voice_id", "ALTER TABLE transcription_history ADD COLUMN tts_voice_id TEXT"),
            ("tts_locale", "ALTER TABLE transcription_history ADD COLUMN tts_locale TEXT"),
            ("tts_trigger", "ALTER TABLE transcription_history ADD COLUMN tts_trigger TEXT"),
            ("tts_status", "ALTER TABLE transcription_history ADD COLUMN tts_status TEXT"),
        ];

        for (column_name, sql) in required_columns {
            if existing_columns.contains(column_name) {
                continue;
            }

            info!(
                "History schema drift detected; adding missing column '{}'",
                column_name
            );
            conn.execute(sql, [])?;
        }

        Ok(())
    }

    /// Migrate from tauri-plugin-sql's migration tracking to rusqlite_migration's.
    /// tauri-plugin-sql used a _sqlx_migrations table, while rusqlite_migration uses
    /// SQLite's user_version pragma. This function checks if the old system was in use
    /// and sets the user_version accordingly so migrations don't re-run.
    fn migrate_from_tauri_plugin_sql(&self, conn: &Connection) -> Result<()> {
        // Check if the old _sqlx_migrations table exists
        let has_sqlx_migrations: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !has_sqlx_migrations {
            return Ok(());
        }

        // Check current user_version
        let current_version: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if current_version > 0 {
            // Already migrated to rusqlite_migration system
            return Ok(());
        }

        // Get the highest version from the old migrations table
        let old_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if old_version > 0 {
            info!(
                "Migrating from tauri-plugin-sql (version {}) to rusqlite_migration",
                old_version
            );

            // Set user_version to match the old migration state
            conn.pragma_update(None, "user_version", old_version)?;

            // Optionally drop the old migrations table (keeping it doesn't hurt)
            // conn.execute("DROP TABLE IF EXISTS _sqlx_migrations", [])?;

            info!(
                "Migration tracking converted: user_version set to {}",
                old_version
            );
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Save a transcription to history (both database and WAV file).
    /// Returns the database row ID of the new entry.
    pub async fn save_transcription(
        &self,
        audio_samples: Vec<f32>,
        transcription_text: String,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
        dictionary_hits: Vec<String>,
        pasted_text: Option<String>,
        translation_context: TranslationHistoryContext,
        tts_context: TtsHistoryContext,
        screen_context_metadata: Option<ScreenContextHistoryMetadata>,
    ) -> Result<i64> {
        let timestamp = Utc::now().timestamp();
        let file_name = format!("handy-{}.wav", timestamp);
        let title = self.format_timestamp_title(timestamp);

        // Save WAV file
        let file_path = self.recordings_dir.join(&file_name);
        save_wav_file(file_path, &audio_samples).await?;

        // Save to database
        let id = self.save_to_database(
            file_name,
            timestamp,
            title,
            transcription_text,
            post_processed_text,
            post_process_prompt,
            dictionary_hits,
            pasted_text,
            translation_context,
            tts_context,
            screen_context_metadata,
        )?;

        // Clean up old entries
        self.cleanup_old_entries()?;

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(id)
    }

    fn save_to_database(
        &self,
        file_name: String,
        timestamp: i64,
        title: String,
        transcription_text: String,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
        dictionary_hits: Vec<String>,
        pasted_text: Option<String>,
        translation_context: TranslationHistoryContext,
        tts_context: TtsHistoryContext,
        screen_context_metadata: Option<ScreenContextHistoryMetadata>,
    ) -> Result<i64> {
        let conn = self.get_connection()?;
        let dictionary_hits_json = if dictionary_hits.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&dictionary_hits).unwrap_or_default())
        };
        let screen_context_metadata_json = screen_context_metadata
            .as_ref()
            .map(|metadata| serde_json::to_string(metadata).unwrap_or_default());
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                dictionary_hits,
                pasted_text,
                source_language_detected,
                translation_target_language,
                translated_text,
                translation_route,
                translation_provider_id,
                translation_model_id,
                translation_origin,
                translation_destination,
                tts_requested,
                tts_engine,
                tts_voice_id,
                tts_locale,
                tts_trigger,
                tts_status,
                screen_context_metadata
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
            params![
                file_name,
                timestamp,
                false,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                dictionary_hits_json,
                pasted_text,
                translation_context.source_language_detected,
                translation_context.translation_target_language,
                translation_context.translated_text,
                translation_context.translation_route,
                translation_context.translation_provider_id,
                translation_context.translation_model_id,
                translation_context.translation_origin,
                translation_context.translation_destination,
                tts_context.tts_requested,
                tts_context.tts_engine,
                tts_context.tts_voice_id,
                tts_context.tts_locale,
                tts_context.tts_trigger,
                tts_context.tts_status,
                screen_context_metadata_json
            ],
        )?;

        let id = conn.last_insert_rowid();
        debug!("Saved transcription to database with id {}", id);
        Ok(id)
    }

    /// Write the field snapshot back to a history entry by ID.
    /// Called ~30s after paste once the field monitor has read the text.
    pub fn update_field_snapshot(&self, id: i64, snapshot_text: String) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE transcription_history SET field_snapshot_text = ?1, field_snapshot_at = ?2, field_snapshot_status = ?3, field_snapshot_error = NULL WHERE id = ?4",
            params![snapshot_text, now, "captured", id],
        )?;
        debug!("Updated field snapshot for history entry {}", id);

        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!(
                "Failed to emit history-updated after snapshot update: {}",
                e
            );
        }

        Ok(())
    }

    pub fn mark_field_snapshot_pending(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE transcription_history SET field_snapshot_status = ?1, field_snapshot_error = NULL WHERE id = ?2",
            params!["pending", id],
        )?;
        debug!("Marked field snapshot pending for history entry {}", id);

        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!(
                "Failed to emit history-updated after snapshot pending: {}",
                e
            );
        }

        Ok(())
    }

    pub fn update_field_snapshot_failure(&self, id: i64, error_message: String) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE transcription_history SET field_snapshot_at = ?1, field_snapshot_status = ?2, field_snapshot_error = ?3 WHERE id = ?4",
            params![now, "failed", error_message, id],
        )?;
        debug!("Updated field snapshot failure for history entry {}", id);

        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!(
                "Failed to emit history-updated after snapshot failure: {}",
                e
            );
        }

        Ok(())
    }

    pub fn update_field_snapshot_skipped(
        &self,
        id: i64,
        snapshot_text: Option<String>,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE transcription_history SET field_snapshot_text = ?1, field_snapshot_at = ?2, field_snapshot_status = ?3, field_snapshot_error = NULL WHERE id = ?4",
            params![snapshot_text, now, "skipped", id],
        )?;
        debug!("Updated field snapshot skipped for history entry {}", id);

        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!(
                "Failed to emit history-updated after snapshot skipped: {}",
                e
            );
        }

        Ok(())
    }

    pub fn update_tts_status(&self, id: i64, status: &str) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE transcription_history SET tts_status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!(
                "Failed to emit history-updated after TTS status update: {}",
                e
            );
        }
        Ok(())
    }

    pub fn cleanup_old_entries(&self) -> Result<()> {
        let retention_period = crate::settings::get_recording_retention_period(&self.app_handle);

        match retention_period {
            crate::settings::RecordingRetentionPeriod::Never => {
                // Don't delete anything
                Ok(())
            }
            crate::settings::RecordingRetentionPeriod::PreserveLimit => {
                // Use the old count-based logic with history_limit
                let limit = crate::settings::get_history_limit(&self.app_handle);
                self.cleanup_by_count(limit)
            }
            _ => {
                // Use time-based logic
                self.cleanup_by_time(retention_period)
            }
        }
    }

    fn delete_entries_and_files(&self, entries: &[(i64, String)]) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }

        let conn = self.get_connection()?;
        let mut deleted_count = 0;

        for (id, file_name) in entries {
            // Delete database entry
            conn.execute(
                "DELETE FROM transcription_history WHERE id = ?1",
                params![id],
            )?;

            // Delete WAV file
            let file_path = self.recordings_dir.join(file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete WAV file {}: {}", file_name, e);
                } else {
                    debug!("Deleted old WAV file: {}", file_name);
                    deleted_count += 1;
                }
            }
        }

        Ok(deleted_count)
    }

    fn cleanup_by_count(&self, limit: usize) -> Result<()> {
        let conn = self.get_connection()?;

        // Get all entries that are not saved, ordered by timestamp desc
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 ORDER BY timestamp DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        if entries.len() > limit {
            let entries_to_delete = &entries[limit..];
            let deleted_count = self.delete_entries_and_files(entries_to_delete)?;

            if deleted_count > 0 {
                debug!("Cleaned up {} old history entries by count", deleted_count);
            }
        }

        Ok(())
    }

    fn cleanup_by_time(
        &self,
        retention_period: crate::settings::RecordingRetentionPeriod,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        // Calculate cutoff timestamp (current time minus retention period)
        let now = Utc::now().timestamp();
        let cutoff_timestamp = match retention_period {
            crate::settings::RecordingRetentionPeriod::Days3 => now - (3 * 24 * 60 * 60), // 3 days in seconds
            crate::settings::RecordingRetentionPeriod::Weeks2 => now - (2 * 7 * 24 * 60 * 60), // 2 weeks in seconds
            crate::settings::RecordingRetentionPeriod::Months3 => now - (3 * 30 * 24 * 60 * 60), // 3 months in seconds (approximate)
            crate::settings::RecordingRetentionPeriod::Never
            | crate::settings::RecordingRetentionPeriod::PreserveLimit => {
                debug!(
                    "Skipping time-based cleanup for retention period {:?}",
                    retention_period
                );
                return Ok(());
            }
        };

        // Get all unsaved entries older than the cutoff timestamp
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 AND timestamp < ?1",
        )?;

        let rows = stmt.query_map(params![cutoff_timestamp], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries_to_delete: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries_to_delete.push(row?);
        }

        let deleted_count = self.delete_entries_and_files(&entries_to_delete)?;

        if deleted_count > 0 {
            debug!(
                "Cleaned up {} old history entries based on retention period",
                deleted_count
            );
        }

        Ok(())
    }

    pub async fn get_history_entries(&self) -> Result<Vec<HistoryEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, dictionary_hits, pasted_text, field_snapshot_text, field_snapshot_at, field_snapshot_status, field_snapshot_error, source_language_detected, translation_target_language, translated_text, translation_route, translation_provider_id, translation_model_id, translation_origin, translation_destination, tts_requested, tts_engine, tts_voice_id, tts_locale, tts_trigger, tts_status, screen_context_metadata FROM transcription_history ORDER BY timestamp DESC"
        )?;

        let rows = stmt.query_map([], |row| Ok(row_to_history_entry(row)))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        Ok(entries)
    }

    pub fn get_latest_entry(&self) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        Self::get_latest_entry_with_conn(&conn)
    }

    fn get_latest_entry_with_conn(conn: &Connection) -> Result<Option<HistoryEntry>> {
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, dictionary_hits, pasted_text, field_snapshot_text, field_snapshot_at, field_snapshot_status, field_snapshot_error, source_language_detected, translation_target_language, translated_text, translation_route, translation_provider_id, translation_model_id, translation_origin, translation_destination, tts_requested, tts_engine, tts_voice_id, tts_locale, tts_trigger, tts_status, screen_context_metadata
             FROM transcription_history
             ORDER BY timestamp DESC
             LIMIT 1",
        )?;

        let entry = stmt
            .query_row([], |row| Ok(row_to_history_entry(row)))
            .optional()?;

        Ok(entry)
    }

    pub async fn toggle_saved_status(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Get current saved status
        let current_saved: bool = conn.query_row(
            "SELECT saved FROM transcription_history WHERE id = ?1",
            params![id],
            |row| row.get("saved"),
        )?;

        let new_saved = !current_saved;

        conn.execute(
            "UPDATE transcription_history SET saved = ?1 WHERE id = ?2",
            params![new_saved, id],
        )?;

        debug!("Toggled saved status for entry {}: {}", id, new_saved);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    pub fn get_audio_file_path(&self, file_name: &str) -> PathBuf {
        self.recordings_dir.join(file_name)
    }

    pub async fn get_entry_by_id(&self, id: i64) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, dictionary_hits, pasted_text, field_snapshot_text, field_snapshot_at, field_snapshot_status, field_snapshot_error, source_language_detected, translation_target_language, translated_text, translation_route, translation_provider_id, translation_model_id, translation_origin, translation_destination, tts_requested, tts_engine, tts_voice_id, tts_locale, tts_trigger, tts_status, screen_context_metadata
             FROM transcription_history WHERE id = ?1",
        )?;

        let entry = stmt
            .query_row([id], |row| Ok(row_to_history_entry(row)))
            .optional()?;

        Ok(entry)
    }

    pub async fn delete_entry(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Get the entry to find the file name
        if let Some(entry) = self.get_entry_by_id(id).await? {
            // Delete the audio file first
            let file_path = self.get_audio_file_path(&entry.file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete audio file {}: {}", entry.file_name, e);
                    // Continue with database deletion even if file deletion fails
                }
            }
        }

        // Delete from database
        conn.execute(
            "DELETE FROM transcription_history WHERE id = ?1",
            params![id],
        )?;

        debug!("Deleted history entry with id: {}", id);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    fn format_timestamp_title(&self, timestamp: i64) -> String {
        if let Some(utc_datetime) = DateTime::from_timestamp(timestamp, 0) {
            // Convert UTC to local timezone
            let local_datetime = utc_datetime.with_timezone(&Local);
            local_datetime.format("%B %e, %Y - %l:%M%p").to_string()
        } else {
            format!("Recording {}", timestamp)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE transcription_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                saved BOOLEAN NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                transcription_text TEXT NOT NULL,
                post_processed_text TEXT,
                post_process_prompt TEXT,
                dictionary_hits TEXT,
                pasted_text TEXT,
                field_snapshot_text TEXT,
                field_snapshot_at INTEGER,
                field_snapshot_status TEXT NOT NULL DEFAULT 'not_requested',
                field_snapshot_error TEXT,
                source_language_detected TEXT,
                translation_target_language TEXT,
                translated_text TEXT,
                translation_route TEXT,
                translation_provider_id TEXT,
                translation_model_id TEXT,
                translation_origin TEXT,
                translation_destination TEXT,
                tts_requested BOOLEAN,
                tts_engine TEXT,
                tts_voice_id TEXT,
                tts_locale TEXT,
                tts_trigger TEXT,
                tts_status TEXT,
                screen_context_metadata TEXT
            );",
        )
        .expect("create transcription_history table");
        conn
    }

    fn insert_entry(conn: &Connection, timestamp: i64, text: &str, post_processed: Option<&str>) {
        conn.execute(
            "INSERT INTO transcription_history (file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, dictionary_hits, pasted_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                format!("handy-{}.wav", timestamp),
                timestamp,
                false,
                format!("Recording {}", timestamp),
                text,
                post_processed,
                Option::<String>::None,
                Option::<String>::None,
                post_processed.map(|value| value.to_string())
            ],
        )
        .expect("insert history entry");
    }

    #[test]
    fn get_latest_entry_returns_none_when_empty() {
        let conn = setup_conn();
        let entry = HistoryManager::get_latest_entry_with_conn(&conn).expect("fetch latest entry");
        assert!(entry.is_none());
    }

    #[test]
    fn get_latest_entry_returns_newest_entry() {
        let conn = setup_conn();
        insert_entry(&conn, 100, "first", None);
        insert_entry(&conn, 200, "second", Some("processed"));

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch latest entry")
            .expect("entry exists");

        assert_eq!(entry.timestamp, 200);
        assert_eq!(entry.transcription_text, "second");
        assert_eq!(entry.post_processed_text.as_deref(), Some("processed"));
        assert_eq!(entry.pasted_text.as_deref(), Some("processed"));
        assert!(entry.field_snapshot_text.is_none());
        assert_eq!(
            entry.field_snapshot_status,
            FieldSnapshotStatus::NotRequested
        );
    }

    #[test]
    fn row_mapping_includes_tts_columns() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO transcription_history (
                file_name, timestamp, saved, title, transcription_text, post_processed_text,
                post_process_prompt, dictionary_hits, pasted_text,
                tts_requested, tts_engine, tts_voice_id, tts_locale, tts_trigger, tts_status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                "tts.wav",
                300,
                false,
                "TTS Recording",
                "hello",
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                Some("hello".to_string()),
                Some(true),
                Some("system".to_string()),
                Some("Samantha".to_string()),
                Some("en-US".to_string()),
                Some("auto_readback_dictation".to_string()),
                Some("pending".to_string())
            ],
        )
        .expect("insert history entry with tts metadata");

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch latest entry")
            .expect("entry exists");

        assert_eq!(entry.tts_requested, Some(true));
        assert_eq!(entry.tts_engine.as_deref(), Some("system"));
        assert_eq!(entry.tts_voice_id.as_deref(), Some("Samantha"));
        assert_eq!(entry.tts_locale.as_deref(), Some("en-US"));
        assert_eq!(
            entry.tts_trigger.as_deref(),
            Some("auto_readback_dictation")
        );
        assert_eq!(entry.tts_status.as_deref(), Some("pending"));
    }
}
