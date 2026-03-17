use anyhow::Result;
use log::{debug, error, info};
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

use crate::post_processing::DictionaryEntry;

use super::diff::CorrectionPair;

/// Database migrations for the corrections store.
static MIGRATIONS: &[M] = &[M::up(
    "CREATE TABLE IF NOT EXISTS auto_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original TEXT NOT NULL,
        corrected TEXT NOT NULL,
        frequency INTEGER NOT NULL DEFAULT 1,
        confidence REAL NOT NULL DEFAULT 0.5,
        source_app TEXT,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        user_approved BOOLEAN NOT NULL DEFAULT 0,
        UNIQUE(original, corrected) ON CONFLICT REPLACE
    );",
)];

/// A stored correction entry, as returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoredCorrection {
    pub id: i64,
    pub original: String,
    pub corrected: String,
    pub frequency: u32,
    pub confidence: f64,
    pub source_app: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
    pub is_active: bool,
    pub user_approved: bool,
}

/// Persistent SQLite store for auto-learned corrections.
pub struct CorrectionStore {
    db_path: PathBuf,
}

impl CorrectionStore {
    /// Create a new CorrectionStore, initializing the database if needed.
    pub fn new(app_data_dir: &std::path::Path) -> Result<Self> {
        let db_path = app_data_dir.join("corrections.db");

        let store = Self { db_path };
        store.init_database()?;

        Ok(store)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing corrections database at {:?}", self.db_path);

        let mut conn = Connection::open(&self.db_path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        #[cfg(debug_assertions)]
        migrations
            .validate()
            .expect("Invalid corrections migrations");

        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!(
            "Corrections database version before migration: {}",
            version_before
        );

        migrations.to_latest(&mut conn)?;

        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version_after > version_before {
            info!(
                "Corrections database migrated from version {} to {}",
                version_before, version_after
            );
        } else {
            debug!(
                "Corrections database already at latest version {}",
                version_after
            );
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Add or update a correction pair. Uses UPSERT to increment frequency
    /// and update confidence/timestamps if the pair already exists.
    pub fn add_correction(&self, pair: &CorrectionPair) -> Result<()> {
        let conn = self.get_connection()?;

        // Check if correction already exists
        let existing: Option<(i64, u32, f64, i64)> = conn
            .query_row(
                "SELECT id, frequency, confidence, first_seen FROM auto_corrections WHERE original = ?1 AND corrected = ?2",
                params![pair.original, pair.corrected],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .ok();

        if let Some((id, freq, existing_conf, first_seen)) = existing {
            let new_freq = freq + 1;
            // Rolling average for confidence
            let new_conf = (existing_conf * freq as f64 + pair.confidence) / (new_freq as f64);
            conn.execute(
                "UPDATE auto_corrections SET frequency = ?1, confidence = ?2, last_seen = ?3, source_app = COALESCE(?4, source_app) WHERE id = ?5",
                params![new_freq, new_conf, pair.last_seen, pair.source_app, id],
            )?;
            debug!(
                "Updated correction '{}' → '{}' (freq: {}, conf: {:.2})",
                pair.original, pair.corrected, new_freq, new_conf
            );
        } else {
            conn.execute(
                "INSERT INTO auto_corrections (original, corrected, frequency, confidence, source_app, first_seen, last_seen, is_active, user_approved)
                 VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, 1, 0)",
                params![
                    pair.original,
                    pair.corrected,
                    pair.confidence,
                    pair.source_app,
                    pair.first_seen,
                    pair.last_seen,
                ],
            )?;
            debug!(
                "Added new correction '{}' → '{}' (conf: {:.2})",
                pair.original, pair.corrected, pair.confidence
            );
        }

        Ok(())
    }

    /// Get active corrections as DictionaryEntry values for merging with the personal dictionary.
    pub fn get_active_corrections(
        &self,
        min_frequency: u32,
        min_confidence: f64,
    ) -> Result<Vec<DictionaryEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT original, corrected, frequency, confidence FROM auto_corrections
             WHERE is_active = 1 AND frequency >= ?1 AND confidence >= ?2
             ORDER BY frequency DESC, confidence DESC",
        )?;

        let rows = stmt.query_map(params![min_frequency, min_confidence], |row| {
            let original: String = row.get("original")?;
            let corrected: String = row.get("corrected")?;
            let frequency: u32 = row.get("frequency")?;
            let confidence: f64 = row.get("confidence")?;
            Ok((original, corrected, frequency, confidence))
        })?;

        let mut entries = Vec::new();
        for row in rows {
            let (original, corrected, frequency, confidence) = row?;
            entries.push(DictionaryEntry {
                spoken: original,
                written: corrected,
                priority: compute_priority(frequency, confidence),
                case_sensitive: false,
                exact_only: false,
            });
        }

        Ok(entries)
    }

    /// List all corrections (active and inactive).
    pub fn list_all(&self) -> Result<Vec<StoredCorrection>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, original, corrected, frequency, confidence, source_app, first_seen, last_seen, is_active, user_approved
             FROM auto_corrections
             ORDER BY last_seen DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(StoredCorrection {
                id: row.get("id")?,
                original: row.get("original")?,
                corrected: row.get("corrected")?,
                frequency: row.get("frequency")?,
                confidence: row.get("confidence")?,
                source_app: row.get("source_app")?,
                first_seen: row.get("first_seen")?,
                last_seen: row.get("last_seen")?,
                is_active: row.get("is_active")?,
                user_approved: row.get("user_approved")?,
            })
        })?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        Ok(entries)
    }

    /// Delete a correction by ID.
    pub fn delete_correction(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM auto_corrections WHERE id = ?1", params![id])?;
        debug!("Deleted correction with id: {}", id);
        Ok(())
    }

    /// Toggle the is_active flag for a correction.
    pub fn set_active(&self, id: i64, active: bool) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE auto_corrections SET is_active = ?1 WHERE id = ?2",
            params![active, id],
        )?;
        debug!("Set correction {} active={}", id, active);
        Ok(())
    }

    /// Clear all corrections.
    pub fn clear_all(&self) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM auto_corrections", [])?;
        info!("Cleared all auto-corrections");
        Ok(())
    }

    /// Export all corrections as JSON.
    pub fn export_json(&self) -> Result<String> {
        let corrections = self.list_all()?;
        let json = serde_json::to_string_pretty(&corrections)
            .map_err(|e| anyhow::anyhow!("Failed to serialize corrections: {}", e))?;
        Ok(json)
    }

    /// Import corrections from JSON, merging with existing data.
    pub fn import_json(&self, json: &str) -> Result<usize> {
        let corrections: Vec<StoredCorrection> = serde_json::from_str(json)
            .map_err(|e| anyhow::anyhow!("Failed to parse corrections JSON: {}", e))?;

        let conn = self.get_connection()?;
        let mut imported = 0;

        for correction in &corrections {
            conn.execute(
                "INSERT INTO auto_corrections (original, corrected, frequency, confidence, source_app, first_seen, last_seen, is_active, user_approved)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(original, corrected) DO UPDATE SET
                    frequency = MAX(auto_corrections.frequency, excluded.frequency),
                    confidence = MAX(auto_corrections.confidence, excluded.confidence),
                    last_seen = MAX(auto_corrections.last_seen, excluded.last_seen)",
                params![
                    correction.original,
                    correction.corrected,
                    correction.frequency,
                    correction.confidence,
                    correction.source_app,
                    correction.first_seen,
                    correction.last_seen,
                    correction.is_active,
                    correction.user_approved,
                ],
            )?;
            imported += 1;
        }

        info!("Imported {} corrections", imported);
        Ok(imported)
    }
}

/// Map frequency × confidence to a 0-255 priority scale.
/// Auto-corrections get lower priority than manual entries (which typically use 0-100).
/// We cap at 200 to leave headroom for manual entries.
fn compute_priority(frequency: u32, confidence: f64) -> u8 {
    let freq_factor = (frequency as f64).min(50.0) / 50.0; // Saturates at 50 occurrences
    let raw = freq_factor * confidence * 200.0;
    (raw as u8).min(200)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_store() -> (CorrectionStore, TempDir) {
        let dir = TempDir::new().unwrap();
        let store = CorrectionStore::new(dir.path()).unwrap();
        (store, dir)
    }

    #[test]
    fn test_add_and_list() {
        let (store, _dir) = setup_store();
        let pair = CorrectionPair {
            original: "teh".to_string(),
            corrected: "the".to_string(),
            confidence: 0.9,
            source_app: Some("com.apple.TextEdit".to_string()),
            first_seen: 1000,
            last_seen: 1000,
        };

        store.add_correction(&pair).unwrap();
        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].original, "teh");
        assert_eq!(all[0].corrected, "the");
        assert_eq!(all[0].frequency, 1);
    }

    #[test]
    fn test_upsert_increments_frequency() {
        let (store, _dir) = setup_store();
        let pair = CorrectionPair {
            original: "recieve".to_string(),
            corrected: "receive".to_string(),
            confidence: 0.85,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        };

        store.add_correction(&pair).unwrap();
        store.add_correction(&pair).unwrap();
        store.add_correction(&pair).unwrap();

        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].frequency, 3);
    }

    #[test]
    fn test_get_active_corrections_respects_thresholds() {
        let (store, _dir) = setup_store();

        // Add a correction with frequency 1
        let pair1 = CorrectionPair {
            original: "foo".to_string(),
            corrected: "bar".to_string(),
            confidence: 0.9,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        };
        store.add_correction(&pair1).unwrap();

        // Frequency 1, min_frequency 2 — should not be returned
        let entries = store.get_active_corrections(2, 0.5).unwrap();
        assert!(entries.is_empty());

        // Add again to reach frequency 2
        store.add_correction(&pair1).unwrap();
        let entries = store.get_active_corrections(2, 0.5).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].spoken, "foo");
        assert_eq!(entries[0].written, "bar");
    }

    #[test]
    fn test_delete_correction() {
        let (store, _dir) = setup_store();
        let pair = CorrectionPair {
            original: "teh".to_string(),
            corrected: "the".to_string(),
            confidence: 0.9,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        };
        store.add_correction(&pair).unwrap();

        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);

        store.delete_correction(all[0].id).unwrap();
        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[test]
    fn test_toggle_active() {
        let (store, _dir) = setup_store();
        let pair = CorrectionPair {
            original: "teh".to_string(),
            corrected: "the".to_string(),
            confidence: 0.9,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        };
        store.add_correction(&pair).unwrap();

        let all = store.list_all().unwrap();
        assert!(all[0].is_active);

        store.set_active(all[0].id, false).unwrap();
        let all = store.list_all().unwrap();
        assert!(!all[0].is_active);

        // Should not appear in active corrections
        let active = store.get_active_corrections(1, 0.0).unwrap();
        assert!(active.is_empty());
    }

    #[test]
    fn test_clear_all() {
        let (store, _dir) = setup_store();
        for i in 0..5 {
            let pair = CorrectionPair {
                original: format!("word{}", i),
                corrected: format!("fixed{}", i),
                confidence: 0.9,
                source_app: None,
                first_seen: 1000,
                last_seen: 1000,
            };
            store.add_correction(&pair).unwrap();
        }

        assert_eq!(store.list_all().unwrap().len(), 5);
        store.clear_all().unwrap();
        assert!(store.list_all().unwrap().is_empty());
    }

    #[test]
    fn test_export_import_json() {
        let (store, _dir) = setup_store();
        let pair = CorrectionPair {
            original: "teh".to_string(),
            corrected: "the".to_string(),
            confidence: 0.9,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        };
        store.add_correction(&pair).unwrap();

        let json = store.export_json().unwrap();
        assert!(json.contains("teh"));

        // Import into a fresh store
        let (store2, _dir2) = setup_store();
        let count = store2.import_json(&json).unwrap();
        assert_eq!(count, 1);
        assert_eq!(store2.list_all().unwrap().len(), 1);
    }

    #[test]
    fn test_compute_priority() {
        // Low frequency, low confidence
        assert_eq!(compute_priority(1, 0.5), 2);
        // High frequency, high confidence
        assert_eq!(compute_priority(50, 1.0), 200);
        // Medium
        assert_eq!(compute_priority(25, 0.8), 80);
    }
}
