//! Durable claims shared by dictation and meeting delivery.
use super::*;
use crate::pinned_target::{DeliveryRecord, DeliverySource, DeliveryState, PinFailure};

pub(super) const SCHEMA: &str = "CREATE TABLE pinned_deliveries (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
    state TEXT NOT NULL, record_json TEXT NOT NULL,
    UNIQUE(source, source_id)
);";

pub(super) const CLEANUP_SCHEMA: &str = "
CREATE TRIGGER protect_active_pinned_history BEFORE DELETE ON transcription_history
WHEN EXISTS (SELECT 1 FROM pinned_deliveries WHERE source='history'
    AND source_id=CAST(OLD.id AS TEXT) AND state IN ('pending','delivering'))
BEGIN SELECT RAISE(ABORT, 'Wait for pinned delivery to finish before deleting this recording.'); END;
CREATE TRIGGER delete_pinned_history AFTER DELETE ON transcription_history
BEGIN DELETE FROM pinned_deliveries WHERE source='history' AND source_id=CAST(OLD.id AS TEXT); END;
";

fn source_key(source: &DeliverySource) -> &'static str {
    match source {
        DeliverySource::History => "history",
        DeliverySource::Meeting => "meeting",
    }
}
fn state_key(state: &DeliveryState) -> &'static str {
    match state {
        DeliveryState::Pending => "pending",
        DeliveryState::Delivering => "delivering",
        DeliveryState::Delivered => "delivered",
        DeliveryState::Deferred => "deferred",
        DeliveryState::Partial => "partial",
        DeliveryState::Uncertain => "uncertain",
        DeliveryState::Cancelled => "cancelled",
    }
}

pub(super) fn insert(conn: &Connection, record: &DeliveryRecord) -> Result<()> {
    conn.execute("INSERT INTO pinned_deliveries(id,source,source_id,state,record_json) VALUES(?1,?2,?3,?4,?5)",params![record.id,source_key(&record.source),record.source_id,state_key(&record.state),serde_json::to_string(record)?])?;
    Ok(())
}

fn read(conn: &Connection, id: &str) -> Result<DeliveryRecord> {
    let json: String = conn.query_row(
        "SELECT record_json FROM pinned_deliveries WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&json)?)
}

fn update(conn: &Connection, record: &DeliveryRecord) -> Result<()> {
    let changed = conn.execute(
        "UPDATE pinned_deliveries SET state=?1,record_json=?2 WHERE id=?3",
        params![
            state_key(&record.state),
            serde_json::to_string(record)?,
            record.id
        ],
    )?;
    anyhow::ensure!(changed == 1, "Saved delivery was removed.");
    Ok(())
}

fn claim(conn: &mut Connection, id: &str) -> Result<DeliveryRecord> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut record = read(&tx, id)?;
    anyhow::ensure!(
        record.retryable(),
        "This result may already be inserted. Check the field and use Copy to recover it."
    );
    record.state = DeliveryState::Delivering;
    record.reason = None;
    record.message = None;
    record.updated_at = Utc::now().timestamp();
    update(&tx, &record)?;
    tx.commit()?;
    Ok(record)
}

pub(super) fn recover(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    let ids: Vec<String> = {
        let mut stmt =
            tx.prepare("SELECT id FROM pinned_deliveries WHERE state IN ('pending','delivering')")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for id in ids {
        let mut record = read(&tx, &id)?;
        record.state = if record.may_have_written {
            DeliveryState::Uncertain
        } else {
            DeliveryState::Deferred
        };
        record.reason = Some(PinFailure::Interrupted);
        record.message = Some(PinFailure::Interrupted.to_string());
        update(&tx, &record)?;
    }
    tx.commit()?;
    Ok(())
}

impl HistoryManager {
    pub fn create_meeting_delivery(&self, record: &DeliveryRecord) -> Result<()> {
        anyhow::ensure!(
            record.source == DeliverySource::Meeting,
            "Expected a meeting delivery."
        );
        insert(&self.get_connection()?, record)
    }
    pub fn get_delivery(&self, id: &str) -> Result<DeliveryRecord> {
        read(&self.get_connection()?, id)
    }
    pub fn list_unresolved_deliveries(&self) -> Result<Vec<DeliveryRecord>> {
        let conn = self.get_connection()?;
        let mut stmt=conn.prepare("SELECT record_json FROM pinned_deliveries WHERE state!='delivered' ORDER BY rowid DESC LIMIT 50")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    pub fn get_delivery_for_source(
        &self,
        source: DeliverySource,
        id: &str,
    ) -> Result<Option<DeliveryRecord>> {
        let json: Option<String> = self
            .get_connection()?
            .query_row(
                "SELECT record_json FROM pinned_deliveries WHERE source=?1 AND source_id=?2",
                params![source_key(&source), id],
                |r| r.get(0),
            )
            .optional()?;
        json.map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    }
    pub fn claim_delivery(&self, id: &str) -> Result<DeliveryRecord> {
        let mut conn = self.get_connection()?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        claim(&mut conn, id)
    }
    pub fn prepare_delivery_text(&self, id: &str, text: &str) -> Result<()> {
        let mut conn = self.get_connection()?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut record = read(&tx, id)?;
        anyhow::ensure!(
            record.state == DeliveryState::Delivering && !record.may_have_written,
            "Delivery has already started writing."
        );
        record.text = text.to_owned();
        update(&tx, &record)?;
        tx.commit()?;
        Ok(())
    }
    pub fn checkpoint_delivery(&self, id: &str, confirmed: usize, possible: bool) -> Result<()> {
        let mut conn = self.get_connection()?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut record = read(&tx, id)?;
        anyhow::ensure!(
            record.state == DeliveryState::Delivering,
            "The delivery claim was cancelled."
        );
        record.confirmed_utf16 = confirmed;
        record.may_have_written |= possible;
        record.updated_at = Utc::now().timestamp();
        update(&tx, &record)?;
        tx.commit()?;
        Ok(())
    }
    pub fn finish_delivery(&self, record: &DeliveryRecord) -> Result<()> {
        let mut conn = self.get_connection()?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current = read(&tx, &record.id)?;
        anyhow::ensure!(
            current.state == DeliveryState::Delivering,
            "Delivery no longer owns this result."
        );
        // An acknowledged result is the only path that sets pasted_text.
        update(&tx, record)?;
        if record.source == DeliverySource::History && record.state == DeliveryState::Delivered {
            tx.execute(
                "UPDATE transcription_history SET pasted_text=?1 WHERE id=?2",
                params![record.text, record.source_id],
            )?;
        }
        tx.commit()?;
        let _ = self.app_handle.emit("history-updated", ());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pinned_target::{FieldLocator, PinnedTarget};
    fn record() -> DeliveryRecord {
        DeliveryRecord::pending(
            DeliverySource::History,
            "1".into(),
            PinnedTarget {
                id: "pin".into(),
                generation: 1,
                pid: 1,
                bundle_id: "test".into(),
                app_name: "Test".into(),
                pinned_at: 0,
                locator: FieldLocator {
                    role: "AXTextArea".into(),
                    subrole: None,
                    identifier: None,
                    label: "text".into(),
                    document: None,
                    window_title: None,
                },
            },
            "exact output 😀".into(),
        )
    }
    #[test]
    fn a_durable_claim_excludes_duplicate_attempts() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let r = record();
        insert(&conn, &r).unwrap();
        assert_eq!(
            claim(&mut conn, &r.id).unwrap().state,
            DeliveryState::Delivering
        );
        assert!(claim(&mut conn, &r.id).is_err());
    }
    #[test]
    fn restart_never_replays_a_possible_write() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let mut r = record();
        r.state = DeliveryState::Delivering;
        r.may_have_written = true;
        insert(&conn, &r).unwrap();
        recover(&mut conn).unwrap();
        let recovered = read(&conn, &r.id).unwrap();
        assert_eq!(recovered.state, DeliveryState::Uncertain);
        assert_eq!(recovered.text, r.text);
        assert!(claim(&mut conn, &r.id).is_err());
    }
    #[test]
    fn pending_after_restart_is_preserved_for_explicit_recovery() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let r = record();
        insert(&conn, &r).unwrap();
        recover(&mut conn).unwrap();
        assert_eq!(read(&conn, &r.id).unwrap().state, DeliveryState::Deferred);
        assert_eq!(read(&conn, &r.id).unwrap().text, r.text);
    }
    #[test]
    fn history_deletion_protects_active_delivery_and_removes_completed_text() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE transcription_history(id INTEGER PRIMARY KEY);
            INSERT INTO transcription_history VALUES(1);",
        )
        .unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(CLEANUP_SCHEMA).unwrap();
        let mut r = record();
        insert(&conn, &r).unwrap();
        for state in [DeliveryState::Pending, DeliveryState::Delivering] {
            r.state = state;
            update(&conn, &r).unwrap();
            assert!(conn
                .execute("DELETE FROM transcription_history WHERE id=1", [])
                .is_err());
            assert!(read(&conn, &r.id).is_ok());
        }
        r.state = DeliveryState::Delivered;
        update(&conn, &r).unwrap();
        conn.execute("DELETE FROM transcription_history WHERE id=1", [])
            .unwrap();
        assert!(read(&conn, &r.id).is_err());
    }
}
