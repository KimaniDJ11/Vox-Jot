use anyhow::Result;
use log::{debug, info};
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

static MIGRATIONS: &[M] = &[M::up(
    "CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_pinned BOOLEAN NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
    );",
)];

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub sort_order: i64,
}

pub struct NotesManager {
    app_handle: AppHandle,
    db_path: PathBuf,
}

impl NotesManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        let db_path = app_data_dir.join("notes.db");

        let manager = Self {
            app_handle: app_handle.clone(),
            db_path,
        };

        manager.init_database()?;
        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing notes database at {:?}", self.db_path);
        let mut conn = Connection::open(&self.db_path)?;

        let migrations = Migrations::new(MIGRATIONS.to_vec());
        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid notes migrations");

        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!("Notes DB version before migration: {}", version_before);

        migrations.to_latest(&mut conn)?;

        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version_after > version_before {
            info!(
                "Notes DB migrated from version {} to {}",
                version_before, version_after
            );
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn emit_updated(&self) {
        let _ = self.app_handle.emit("notes-updated", ());
    }

    pub fn list_notes(&self) -> Result<Vec<Note>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, content, created_at, updated_at, is_pinned, sort_order
             FROM notes
             ORDER BY is_pinned DESC, updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                is_pinned: row.get(5)?,
                sort_order: row.get(6)?,
            })
        })?;

        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }
        Ok(notes)
    }

    pub fn create_note(&self, title: &str, content: &str) -> Result<Note> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "INSERT INTO notes (title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![title, content, now, now],
        )?;

        let id = conn.last_insert_rowid();
        debug!("Created note id={}", id);
        self.emit_updated();

        Ok(Note {
            id,
            title: title.to_string(),
            content: content.to_string(),
            created_at: now,
            updated_at: now,
            is_pinned: false,
            sort_order: 0,
        })
    }

    pub fn update_note(&self, id: i64, title: &str, content: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, content, now, id],
        )?;

        debug!("Updated note id={}", id);
        self.emit_updated();
        Ok(())
    }

    /// Append text to an existing note's content, separated by a newline.
    #[allow(dead_code)]
    pub fn append_to_note(&self, id: i64, text: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "UPDATE notes SET content = CASE WHEN content = '' THEN ?1 ELSE content || char(10) || ?1 END, updated_at = ?2 WHERE id = ?3",
            params![text, now, id],
        )?;

        debug!("Appended text to note id={}", id);
        self.emit_updated();
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        debug!("Deleted note id={}", id);
        self.emit_updated();
        Ok(())
    }

    pub fn toggle_pin(&self, id: i64, pinned: bool) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE notes SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![pinned, now, id],
        )?;
        self.emit_updated();
        Ok(())
    }

    pub fn get_note(&self, id: i64) -> Result<Option<Note>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, content, created_at, updated_at, is_pinned, sort_order
             FROM notes WHERE id = ?1",
        )?;
        let result = stmt
            .query_row(params![id], |row| {
                Ok(Note {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    is_pinned: row.get(5)?,
                    sort_order: row.get(6)?,
                })
            })
            .ok();
        Ok(result)
    }

    pub fn export_json(&self) -> Result<String> {
        let notes = self.list_notes()?;
        Ok(serde_json::to_string_pretty(&notes)?)
    }

    pub fn delete_all(&self) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM notes", [])?;
        self.emit_updated();
        Ok(())
    }
}
