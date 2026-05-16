use anyhow::Result;
use log::{debug, info, warn};
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

use crate::post_processing::DictionaryEntry;

use super::diff::{auto_correction_score, CorrectionPair};

/// Database migrations for the corrections store.
static MIGRATIONS: &[M] = &[
    M::up(
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
    ),
    M::up("ALTER TABLE auto_corrections ADD COLUMN exact_only BOOLEAN NOT NULL DEFAULT 0;"),
];

/// A stored correction entry, as returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoredCorrection {
    pub id: i64,
    pub original: String,
    pub corrected: String,
    pub frequency: u32,
    pub confidence: f64,
    #[serde(default)]
    pub exact_only: bool,
    pub source_app: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
    pub is_active: bool,
    pub user_approved: bool,
    #[serde(default)]
    pub auto_apply: CorrectionAutoApply,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum CorrectionAutoApplyStatus {
    #[default]
    Candidate,
    Manual,
    Active,
    LowConfidence,
    Blocked,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
pub struct CorrectionAutoApply {
    pub status: CorrectionAutoApplyStatus,
    pub eligible: bool,
    pub effective_confidence: f64,
    pub min_frequency: u32,
    pub min_confidence: f64,
    pub confirmations_remaining: u32,
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
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn add_correction(&self, pair: &CorrectionPair) -> Result<()> {
        let conn = self.get_connection()?;

        // Check if correction already exists
        let existing: Option<(i64, u32, f64, i64, bool)> = conn
            .query_row(
                "SELECT id, frequency, confidence, first_seen, user_approved FROM auto_corrections WHERE original = ?1 AND corrected = ?2",
                params![pair.original, pair.corrected],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .ok();

        if let Some((id, freq, existing_conf, _first_seen, user_approved)) = existing {
            let new_freq = freq + 1;
            // Rolling average for confidence
            let new_conf = if user_approved {
                1.0
            } else {
                (existing_conf * freq as f64 + pair.confidence) / (new_freq as f64)
            };
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
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn get_active_corrections(
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

    /// Get corrections that should be applied during dictionary normalization.
    /// User-approved entries are always included, while auto-learned entries
    /// still respect the configured thresholds.
    pub fn get_dictionary_entries(
        &self,
        include_auto_learned: bool,
        min_frequency: u32,
        min_confidence: f64,
    ) -> Result<Vec<DictionaryEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT original, corrected, frequency, confidence, exact_only, user_approved
             FROM auto_corrections
             WHERE is_active = 1
             ORDER BY user_approved DESC, frequency DESC, confidence DESC, last_seen DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>("original")?,
                row.get::<_, String>("corrected")?,
                row.get::<_, u32>("frequency")?,
                row.get::<_, f64>("confidence")?,
                row.get::<_, bool>("exact_only")?,
                row.get::<_, bool>("user_approved")?,
            ))
        })?;

        let mut entries = Vec::new();
        for row in rows {
            let (original, corrected, frequency, confidence, exact_only, user_approved) = row?;

            let auto_score = if user_approved {
                None
            } else {
                auto_correction_score(&original, &corrected)
            };

            let effective_confidence = if user_approved {
                confidence
            } else {
                auto_score.map_or(confidence, |score| confidence.max(score))
            };

            let should_include = if user_approved {
                true
            } else if include_auto_learned {
                frequency >= min_frequency
                    && effective_confidence >= min_confidence
                    && auto_score.is_some()
            } else {
                false
            };

            if !should_include {
                continue;
            }

            let priority = if user_approved {
                u8::MAX
            } else {
                compute_priority(frequency, effective_confidence)
            };

            entries.push(DictionaryEntry {
                spoken: original,
                written: corrected,
                priority,
                case_sensitive: false,
                exact_only,
            });
        }

        Ok(entries)
    }

    /// List all corrections (active and inactive).
    pub fn list_all(&self) -> Result<Vec<StoredCorrection>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, original, corrected, frequency, confidence, exact_only, source_app, first_seen, last_seen, is_active, user_approved
             FROM auto_corrections
             ORDER BY last_seen DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let original: String = row.get("original")?;
            let corrected: String = row.get("corrected")?;
            let frequency: u32 = row.get("frequency")?;
            let confidence: f64 = row.get("confidence")?;
            let is_active: bool = row.get("is_active")?;
            let user_approved: bool = row.get("user_approved")?;

            Ok(StoredCorrection {
                id: row.get("id")?,
                auto_apply: evaluate_auto_apply(
                    &original,
                    &corrected,
                    frequency,
                    confidence,
                    is_active,
                    user_approved,
                ),
                original,
                corrected,
                frequency,
                confidence,
                exact_only: row.get("exact_only")?,
                source_app: row.get("source_app")?,
                first_seen: row.get("first_seen")?,
                last_seen: row.get("last_seen")?,
                is_active,
                user_approved,
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

    /// Update the original and corrected text for a learned correction.
    pub fn update_correction(&self, id: i64, original: &str, corrected: &str) -> Result<()> {
        let normalized_original = original.trim();
        let normalized_corrected = corrected.trim();

        if normalized_original.is_empty() || normalized_corrected.is_empty() {
            anyhow::bail!("Original and corrected text must not be empty");
        }

        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE auto_corrections SET original = ?1, corrected = ?2 WHERE id = ?3",
            params![normalized_original, normalized_corrected, id],
        )?;
        debug!(
            "Updated correction {} to '{}' → '{}'",
            id, normalized_original, normalized_corrected
        );
        Ok(())
    }

    /// Add or update a user-approved correction.
    pub fn add_manual_correction(
        &self,
        original: &str,
        corrected: &str,
        exact_only: bool,
        timestamp: i64,
    ) -> Result<()> {
        let normalized_original = original.trim();
        let normalized_corrected = corrected.trim();

        if normalized_original.is_empty() || normalized_corrected.is_empty() {
            anyhow::bail!("Original and corrected text must not be empty");
        }

        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO auto_corrections (
                original,
                corrected,
                frequency,
                confidence,
                exact_only,
                source_app,
                first_seen,
                last_seen,
                is_active,
                user_approved
             )
             VALUES (?1, ?2, 0, 1.0, ?3, ?4, ?5, ?5, 1, 1)
             ON CONFLICT(original, corrected) DO UPDATE SET
                confidence = 1.0,
                exact_only = excluded.exact_only,
                source_app = excluded.source_app,
                last_seen = MAX(auto_corrections.last_seen, excluded.last_seen),
                is_active = 1,
                user_approved = 1",
            params![
                normalized_original,
                normalized_corrected,
                exact_only,
                "manual",
                timestamp,
            ],
        )?;

        debug!(
            "Added or approved manual correction '{}' → '{}' (exact_only: {})",
            normalized_original, normalized_corrected, exact_only
        );
        Ok(())
    }

    /// Add or update a correction directly observed from the user editing the
    /// pasted text in another app. Unlike passive auto-learning, a plausible
    /// observed edit is treated as user-approved because the user explicitly
    /// made the replacement in the destination field. We still preserve the
    /// heuristic confidence so the UI can explain why it was accepted.
    pub fn add_observed_user_correction(&self, pair: &CorrectionPair) -> Result<Option<f64>> {
        let normalized_original = pair.original.trim();
        let normalized_corrected = pair.corrected.trim();

        if normalized_original.is_empty()
            || normalized_corrected.is_empty()
            || normalized_original == normalized_corrected
        {
            return Ok(None);
        }

        let Some(score) = auto_correction_score(normalized_original, normalized_corrected) else {
            return Ok(None);
        };
        let confidence = pair.confidence.max(score);

        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO auto_corrections (
                original,
                corrected,
                frequency,
                confidence,
                exact_only,
                source_app,
                first_seen,
                last_seen,
                is_active,
                user_approved
             )
             VALUES (?1, ?2, 1, ?3, 0, ?4, ?5, ?6, 1, 1)
             ON CONFLICT(original, corrected) DO UPDATE SET
                frequency = MAX(auto_corrections.frequency + 1, excluded.frequency),
                confidence = MAX(auto_corrections.confidence, excluded.confidence),
                source_app = COALESCE(excluded.source_app, auto_corrections.source_app),
                last_seen = MAX(auto_corrections.last_seen, excluded.last_seen),
                is_active = 1,
                user_approved = 1",
            params![
                normalized_original,
                normalized_corrected,
                confidence,
                pair.source_app,
                pair.first_seen,
                pair.last_seen,
            ],
        )?;

        debug!(
            "Approved observed correction '{}' → '{}' (conf: {:.2})",
            normalized_original, normalized_corrected, confidence
        );
        Ok(Some(confidence))
    }

    /// Add a user-approved correction, but only when the pair looks like a
    /// genuine misrecognition fix rather than an ordinary word change.
    ///
    /// Used when the user edits a single word in a dictation transcript: we
    /// want to learn "Tari" → "Tauri" but ignore semantic swaps like
    /// "running" → "executing". The decision reuses [`auto_correction_score`],
    /// the same heuristic that gates auto-learned corrections. Returns whether
    /// an entry was added.
    pub fn add_correction_if_plausible(
        &self,
        original: &str,
        corrected: &str,
        timestamp: i64,
    ) -> Result<bool> {
        let normalized_original = original.trim();
        let normalized_corrected = corrected.trim();

        if normalized_original.is_empty()
            || normalized_corrected.is_empty()
            || normalized_original == normalized_corrected
        {
            return Ok(false);
        }

        if auto_correction_score(normalized_original, normalized_corrected).is_none() {
            return Ok(false);
        }

        self.add_manual_correction(normalized_original, normalized_corrected, false, timestamp)?;
        Ok(true)
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
                "INSERT INTO auto_corrections (original, corrected, frequency, confidence, exact_only, source_app, first_seen, last_seen, is_active, user_approved)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(original, corrected) DO UPDATE SET
                    frequency = MAX(auto_corrections.frequency, excluded.frequency),
                    confidence = MAX(auto_corrections.confidence, excluded.confidence),
                    exact_only = excluded.exact_only,
                    source_app = excluded.source_app,
                    last_seen = MAX(auto_corrections.last_seen, excluded.last_seen),
                    is_active = 1,
                    user_approved = 1",
                params![
                    correction.original,
                    correction.corrected,
                    correction.frequency,
                    correction.confidence,
                    correction.exact_only,
                    "imported",
                    correction.first_seen,
                    correction.last_seen,
                    correction.is_active,
                    true,
                ],
            )?;
            imported += 1;
        }

        info!("Imported {} corrections", imported);
        Ok(imported)
    }
}

/// Merge manual [`crate::settings::AppSettings::personal_dictionary`] with correction-store
/// entries using the same rules as live dictation.
pub fn build_effective_personal_dictionary(
    settings: &crate::settings::AppSettings,
    store: &CorrectionStore,
) -> Vec<crate::post_processing::DictionaryEntry> {
    use crate::post_processing::get_merged_dictionary;
    use crate::settings::correction_defaults;

    match store.get_dictionary_entries(
        settings.correction_tracking_enabled,
        correction_defaults::MIN_FREQUENCY,
        correction_defaults::MIN_CONFIDENCE,
    ) {
        Ok(store_entries) if !store_entries.is_empty() => {
            get_merged_dictionary(&settings.personal_dictionary, &store_entries)
        }
        Ok(_) => settings.personal_dictionary.clone(),
        Err(e) => {
            warn!("Failed to load corrections from store: {}", e);
            settings.personal_dictionary.clone()
        }
    }
}

fn evaluate_auto_apply(
    original: &str,
    corrected: &str,
    frequency: u32,
    confidence: f64,
    is_active: bool,
    user_approved: bool,
) -> CorrectionAutoApply {
    use crate::settings::correction_defaults;

    let min_frequency = correction_defaults::MIN_FREQUENCY;
    let min_confidence = correction_defaults::MIN_CONFIDENCE;
    let confirmations_remaining = min_frequency.saturating_sub(frequency);

    if !is_active {
        return CorrectionAutoApply {
            status: CorrectionAutoApplyStatus::Disabled,
            eligible: false,
            effective_confidence: confidence,
            min_frequency,
            min_confidence,
            confirmations_remaining,
        };
    }

    if user_approved {
        return CorrectionAutoApply {
            status: CorrectionAutoApplyStatus::Manual,
            eligible: true,
            effective_confidence: 1.0,
            min_frequency,
            min_confidence,
            confirmations_remaining: 0,
        };
    }

    let auto_score = auto_correction_score(original, corrected);
    let effective_confidence = auto_score.map_or(confidence, |score| confidence.max(score));

    let status = if auto_score.is_none() {
        CorrectionAutoApplyStatus::Blocked
    } else if confirmations_remaining > 0 {
        CorrectionAutoApplyStatus::Candidate
    } else if effective_confidence < min_confidence {
        CorrectionAutoApplyStatus::LowConfidence
    } else {
        CorrectionAutoApplyStatus::Active
    };

    let eligible = matches!(status, CorrectionAutoApplyStatus::Active);

    CorrectionAutoApply {
        status,
        eligible,
        effective_confidence,
        min_frequency,
        min_confidence,
        confirmations_remaining,
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
        assert!(matches!(
            all[0].auto_apply.status,
            CorrectionAutoApplyStatus::Candidate
        ));
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
    fn test_observed_user_correction_is_approved_with_confidence() {
        let (store, _dir) = setup_store();
        let pair = CorrectionPair {
            original: "Cheyene".to_string(),
            corrected: "Cheyenne".to_string(),
            confidence: 0.82,
            source_app: Some("com.apple.TextEdit".to_string()),
            first_seen: 1000,
            last_seen: 1001,
        };

        let accepted_confidence = store.add_observed_user_correction(&pair).unwrap();
        assert!(accepted_confidence.is_some());

        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].original, "Cheyene");
        assert_eq!(all[0].corrected, "Cheyenne");
        assert_eq!(all[0].frequency, 1);
        assert!(all[0].user_approved);
        assert!(matches!(
            all[0].auto_apply.status,
            CorrectionAutoApplyStatus::Manual
        ));
        assert!(all[0].confidence >= pair.confidence);

        let entries = store.get_dictionary_entries(false, 3, 0.74).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].spoken, "Cheyene");
        assert_eq!(entries[0].written, "Cheyenne");
    }

    #[test]
    fn test_observed_user_correction_rejects_semantic_rewrite() {
        let (store, _dir) = setup_store();
        let pair = CorrectionPair {
            original: "walk".to_string(),
            corrected: "run".to_string(),
            confidence: 0.95,
            source_app: Some("com.apple.TextEdit".to_string()),
            first_seen: 1000,
            last_seen: 1001,
        };

        assert!(store.add_observed_user_correction(&pair).unwrap().is_none());
        assert!(store.list_all().unwrap().is_empty());
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
    fn test_update_correction() {
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
        let saved = store.list_all().unwrap();
        let id = saved[0].id;

        store.update_correction(id, "recieve", "receive").unwrap();

        let updated = store.list_all().unwrap();
        assert_eq!(updated[0].original, "recieve");
        assert_eq!(updated[0].corrected, "receive");
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

    // ── Round-trip pipeline tests ────────────────────────────────────────

    use crate::correction_tracker::diff::extract_corrections;
    use crate::post_processing::{
        apply_personal_dictionary, build_correction_bias_prompt, get_merged_dictionary,
        DictionaryEntry,
    };

    fn make_pair(original: &str, corrected: &str) -> CorrectionPair {
        CorrectionPair {
            original: original.to_string(),
            corrected: corrected.to_string(),
            confidence: 0.9,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        }
    }

    /// Add a correction to the store `n` times to reach the desired frequency.
    fn add_n_times(store: &CorrectionStore, pair: &CorrectionPair, n: usize) {
        for _ in 0..n {
            store.add_correction(pair).unwrap();
        }
    }

    #[test]
    fn test_active_corrections_as_dictionary_entries() {
        let (store, _dir) = setup_store();
        let pair = make_pair("teh", "the");

        // Add twice to meet min_frequency=2
        add_n_times(&store, &pair, 2);

        let entries = store.get_active_corrections(2, 0.5).unwrap();
        assert_eq!(entries.len(), 1);

        let entry = &entries[0];
        assert_eq!(entry.spoken, "teh");
        assert_eq!(entry.written, "the");
        assert!(!entry.case_sensitive);
        assert!(!entry.exact_only);
        // Priority should be computed from frequency=2, confidence=0.9
        let expected_priority = compute_priority(2, 0.9);
        assert_eq!(entry.priority, expected_priority);
    }

    #[test]
    fn test_corrections_apply_to_future_transcriptions() {
        let (store, _dir) = setup_store();
        let pair = make_pair("teh", "the");

        // Add twice to reach freq >= 2
        add_n_times(&store, &pair, 2);

        let entries = store.get_active_corrections(2, 0.5).unwrap();
        assert_eq!(entries.len(), 1);

        let result = apply_personal_dictionary("teh world is great", &entries);
        assert_eq!(result.text, "the world is great");
    }

    #[test]
    fn test_inactive_corrections_dont_apply() {
        let (store, _dir) = setup_store();
        let pair = make_pair("teh", "the");

        add_n_times(&store, &pair, 3);

        // Deactivate the correction
        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);
        store.set_active(all[0].id, false).unwrap();

        // Active corrections should be empty
        let entries = store.get_active_corrections(1, 0.0).unwrap();
        assert!(entries.is_empty());

        // apply_personal_dictionary with empty entries should not change text
        let result = apply_personal_dictionary("teh world", &entries);
        assert_eq!(result.text, "teh world");
    }

    #[test]
    fn test_high_frequency_corrections_get_higher_priority() {
        let (store, _dir) = setup_store();
        let pair = make_pair("recieve", "receive");

        // Add twice — low frequency
        add_n_times(&store, &pair, 2);
        let entries_low = store.get_active_corrections(1, 0.0).unwrap();
        let priority_low = entries_low[0].priority;

        // Add many more times — high frequency
        add_n_times(&store, &pair, 20);
        let entries_high = store.get_active_corrections(1, 0.0).unwrap();
        let priority_high = entries_high[0].priority;

        assert!(
            priority_high > priority_low,
            "Higher frequency should yield higher priority: {} > {}",
            priority_high,
            priority_low
        );
    }

    #[test]
    fn test_corrections_merge_with_manual_dictionary() {
        let (store, _dir) = setup_store();

        // Auto correction: "teh" → "the"
        let pair = make_pair("teh", "the");
        add_n_times(&store, &pair, 3);

        // Auto correction: "recieve" → "receive"
        let pair2 = make_pair("recieve", "receive");
        add_n_times(&store, &pair2, 3);

        let auto_entries = store.get_active_corrections(1, 0.0).unwrap();

        // Manual dictionary has a conflicting entry for "teh" with different target
        let manual_entries = vec![DictionaryEntry {
            spoken: "teh".to_string(),
            written: "THE".to_string(),
            priority: 255,
            case_sensitive: false,
            exact_only: false,
        }];

        let merged = get_merged_dictionary(&manual_entries, &auto_entries);

        // Manual "teh" → "THE" should be present, auto "teh" → "the" should be skipped
        let teh_entries: Vec<_> = merged
            .iter()
            .filter(|e| e.spoken.to_lowercase() == "teh")
            .collect();
        assert_eq!(teh_entries.len(), 1);
        assert_eq!(teh_entries[0].written, "THE");

        // "recieve" → "receive" should still be present (no conflict)
        let recieve_entries: Vec<_> = merged.iter().filter(|e| e.spoken == "recieve").collect();
        assert_eq!(recieve_entries.len(), 1);
        assert_eq!(recieve_entries[0].written, "receive");

        // Apply to text — manual entry wins for "teh"
        let result = apply_personal_dictionary("teh recieve", &merged);
        assert_eq!(result.text, "THE receive");
    }

    #[test]
    fn test_correction_bias_prompt_generation() {
        let (store, _dir) = setup_store();
        let pair1 = make_pair("teh", "the");
        let pair2 = make_pair("recieve", "receive");
        add_n_times(&store, &pair1, 2);
        add_n_times(&store, &pair2, 2);

        let entries = store.get_active_corrections(2, 0.5).unwrap();
        assert!(!entries.is_empty());

        let prompt = build_correction_bias_prompt(&entries);
        assert!(prompt.is_some());

        let prompt_text = prompt.unwrap();
        assert!(prompt_text.contains("Known corrections"));
        assert!(prompt_text.contains("\"teh\""));
        assert!(prompt_text.contains("\"the\""));
        assert!(prompt_text.contains("\"recieve\""));
        assert!(prompt_text.contains("\"receive\""));
        // Verify arrow formatting
        assert!(prompt_text.contains("→"));
    }

    #[test]
    fn test_full_round_trip_store_to_dictionary_to_text() {
        let (store, _dir) = setup_store();

        // Step 1: Store corrections (simulating learning from user edits)
        let pair = make_pair("teh", "the");
        add_n_times(&store, &pair, 3);

        let pair2 = make_pair("recieve", "receive");
        add_n_times(&store, &pair2, 3);

        // Step 2: Export as DictionaryEntry
        let entries = store.get_active_corrections(2, 0.5).unwrap();
        assert_eq!(entries.len(), 2);

        // Step 3: Apply to new transcription text
        let result = apply_personal_dictionary("teh recieve was good", &entries);
        assert_eq!(result.text, "the receive was good");

        // Step 4: Simulate field observation — text is unchanged (user accepted corrections)
        let pasted = &result.text;
        let observed = "the receive was good";
        let new_corrections = extract_corrections(pasted, observed, None);

        // No new corrections should be extracted since text is unchanged
        assert!(
            new_corrections.is_empty(),
            "Expected no new corrections when field text matches pasted text, got: {:?}",
            new_corrections
        );
    }

    #[test]
    fn test_default_auto_apply_requires_repeated_safe_evidence() {
        let (store, _dir) = setup_store();
        let pair = make_pair("teh", "the");

        add_n_times(&store, &pair, 2);
        let entries = store
            .get_dictionary_entries(
                true,
                crate::settings::correction_defaults::MIN_FREQUENCY,
                crate::settings::correction_defaults::MIN_CONFIDENCE,
            )
            .unwrap();
        assert!(
            entries.is_empty(),
            "Two observations should remain candidate-only under production defaults"
        );

        store.add_correction(&pair).unwrap();
        let entries = store
            .get_dictionary_entries(
                true,
                crate::settings::correction_defaults::MIN_FREQUENCY,
                crate::settings::correction_defaults::MIN_CONFIDENCE,
            )
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].spoken, "teh");
        assert_eq!(entries[0].written, "the");
    }

    #[test]
    fn test_unsafe_legacy_entries_do_not_auto_apply() {
        let (store, _dir) = setup_store();
        let bad_pair = CorrectionPair {
            original: "box".to_string(),
            corrected: "Chatterbox".to_string(),
            confidence: 0.95,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        };

        add_n_times(&store, &bad_pair, 5);
        let entries = store.get_dictionary_entries(true, 3, 0.74).unwrap();
        assert!(
            entries.is_empty(),
            "Unsafe legacy correction should be listed but never exported as an auto dictionary rule"
        );
    }

    #[test]
    fn test_safe_legacy_entries_are_rescored_for_auto_apply() {
        let (store, _dir) = setup_store();
        let legacy_pair = CorrectionPair {
            original: "teh".to_string(),
            corrected: "the".to_string(),
            confidence: 0.34,
            source_app: None,
            first_seen: 1000,
            last_seen: 1000,
        };

        add_n_times(&store, &legacy_pair, 3);
        let entries = store.get_dictionary_entries(true, 3, 0.74).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].spoken, "teh");
        assert_eq!(entries[0].written, "the");

        let all = store.list_all().unwrap();
        assert!(matches!(
            all[0].auto_apply.status,
            CorrectionAutoApplyStatus::Active
        ));
        assert!(all[0].auto_apply.eligible);
    }
}
