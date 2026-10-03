//! A recording-bound destination. Shared state contains no native AX objects.
#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
use crate::managers::history::HistoryManager;
use serde::{Deserialize, Serialize};
use specta::Type;
#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
mod macos;
#[cfg(any(test, all(target_os = "macos", not(vox_jot_app_store))))]
mod resolve;
#[cfg(any(test, all(target_os = "macos", not(vox_jot_app_store))))]
mod write;

pub const AVAILABLE: bool = cfg!(all(target_os = "macos", not(vox_jot_app_store)));
#[cfg(vox_jot_app_store)]
const _: () = assert!(!AVAILABLE);

pub(crate) fn frontmost_pid() -> Option<i32> {
    #[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
    {
        macos::frontmost_pid()
    }
    #[cfg(not(all(target_os = "macos", not(vox_jot_app_store))))]
    {
        None
    }
}
pub const BINDING_IDS: [&str; 2] = ["pin_field", "clear_pin"];

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PinFailure {
    Unsupported,
    NoPermission,
    AppGone,
    NotFound,
    Ambiguous,
    NotSettable,
    ValueChanged,
    VerifyFailed,
    Cancelled,
    TooLarge,
    TimedOut,
    HistorySaveFailed,
    Interrupted,
    FocusChanged,
    OutputDisabled,
    StatusSaveFailed,
}

impl std::fmt::Display for PinFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Unsupported=>"Pinned delivery is available in the macOS desktop distribution.",
            Self::NoPermission=>"Allow Vox Jot in System Settings → Privacy & Security → Accessibility.",
            Self::AppGone=>"The pinned application closed or restarted.",
            Self::NotFound=>"The original field or window is no longer available. Copy the saved text to recover it.",
            Self::Ambiguous=>"The original field cannot be identified uniquely.",
            Self::NotSettable=>"This field does not support safe background insertion.",
            Self::ValueChanged=>"The field changed during delivery. The saved text was not inserted.",
            Self::VerifyFailed=>"The application did not confirm the insertion. Check the field before copying the saved text.",
            Self::Cancelled=>"The destination was cleared or changed. The text is saved.",
            Self::TooLarge=>"This field is too large for a safe background insertion.",
            Self::TimedOut=>"The pinned application did not respond in time.",
            Self::HistorySaveFailed=>"The result could not be saved. No background insertion was attempted.",
            Self::Interrupted=>"Delivery was interrupted. Check the field before inserting this text again.",
            Self::FocusChanged=>"Focus changed before the requested paste. Nothing was pasted.",
            Self::OutputDisabled=>"Automatic insertion is disabled in Output & Paste. Your text is saved; use Copy to recover it.",
            Self::StatusSaveFailed=>"The insertion status could not be saved. Check the field before inserting this text again.",
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct FieldLocator {
    pub role: String,
    pub subrole: Option<String>,
    pub identifier: Option<String>,
    pub label: String,
    pub document: Option<String>,
    pub window_title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct PinnedTarget {
    pub id: String,
    pub generation: u64,
    pub pid: i32,
    pub bundle_id: String,
    pub app_name: String,
    pub pinned_at: i64,
    pub locator: FieldLocator,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct PinState {
    pub available: bool,
    pub revision: u64,
    pub target: Option<PinnedTarget>,
    pub bound: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Pending,
    Delivering,
    Delivered,
    Deferred,
    Partial,
    Uncertain,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliverySource {
    History,
    Meeting,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DeliveryRecord {
    pub id: String,
    pub source: DeliverySource,
    pub source_id: String,
    pub target: PinnedTarget,
    pub text: String,
    pub state: DeliveryState,
    pub reason: Option<PinFailure>,
    pub message: Option<String>,
    pub confirmed_utf16: usize,
    pub may_have_written: bool,
    pub updated_at: i64,
}

impl DeliveryRecord {
    pub fn pending(
        source: DeliverySource,
        source_id: String,
        target: PinnedTarget,
        text: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            source,
            source_id,
            target,
            text,
            state: DeliveryState::Pending,
            reason: None,
            message: None,
            confirmed_utf16: 0,
            may_have_written: false,
            updated_at: chrono::Utc::now().timestamp(),
        }
    }
    pub fn retryable(&self) -> bool {
        matches!(self.state, DeliveryState::Pending | DeliveryState::Deferred)
            && !self.may_have_written
            && self.confirmed_utf16 == 0
    }
}

#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
type Reply<T> = tokio::sync::oneshot::Sender<Result<T, String>>;
type Cancellation = Arc<dyn Fn() -> bool + Send + Sync>;
#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
enum Request {
    Pin {
        generation: u64,
        pid: Option<i32>,
        reply: Reply<PinState>,
    },
    Clear {
        generation: u64,
    },
    Deliver {
        record: DeliveryRecord,
        cancel: Cancellation,
        reply: Reply<DeliveryRecord>,
    },
    Fallback {
        record: DeliveryRecord,
        reply: Reply<DeliveryRecord>,
    },
    Open {
        target: PinnedTarget,
        reply: Reply<()>,
    },
}

pub struct PinManager {
    state: Mutex<PinState>,
    generation: AtomicU64,
    #[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
    sender: Mutex<Option<mpsc::Sender<Request>>>,
    // Last-resort in-memory recovery if durable saving itself failed.
    unsaved: Mutex<Vec<DeliveryRecord>>,
}

impl Default for PinManager {
    fn default() -> Self {
        Self {
            state: Mutex::new(PinState {
                available: AVAILABLE,
                revision: 0,
                target: None,
                bound: false,
                error: None,
            }),
            generation: AtomicU64::new(0),
            #[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
            sender: Mutex::new(None),
            unsaved: Mutex::new(Vec::new()),
        }
    }
}

impl PinManager {
    pub fn snapshot(&self) -> PinState {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub fn bind(&self) -> Option<PinnedTarget> {
        if !AVAILABLE {
            return None;
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.bound {
            return None;
        }
        let target = state.target.clone()?;
        state.bound = true;
        state.revision += 1;
        Some(target)
    }
    pub fn release_binding(&self, target: &PinnedTarget) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.target.as_ref().is_some_and(|t| t.id == target.id) {
            state.bound = false;
            state.revision += 1;
        }
    }
    pub fn valid(&self, target: &PinnedTarget) -> bool {
        self.generation.load(Ordering::Acquire) == target.generation
    }
    pub fn publish(&self, app: &AppHandle) {
        let _ = app.emit("pin-state-changed", self.snapshot());
        crate::tray::refresh_current_menu(app);
    }
    pub fn clear(&self, app: &AppHandle) -> u64 {
        let generation = {
            let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
            s.target = None;
            s.bound = false;
            s.error = None;
            s.revision += 1;
            generation
        };
        #[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
        if let Some(sender) = self
            .sender
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let _ = sender.send(Request::Clear { generation });
        }
        self.publish(app);
        generation
    }
    pub fn retain_unsaved(&self, app: &AppHandle, mut record: DeliveryRecord) {
        record.state = DeliveryState::Deferred;
        record.reason = Some(PinFailure::HistorySaveFailed);
        record.message = Some(PinFailure::HistorySaveFailed.to_string());
        self.unsaved
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(record.clone());
        let _ = app.emit("pin-delivery-updated", &record);
    }
    pub fn unsaved(&self) -> Vec<DeliveryRecord> {
        self.unsaved
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
impl PinManager {
    fn sender(self: &Arc<Self>, app: &AppHandle) -> Result<mpsc::Sender<Request>, String> {
        if !AVAILABLE {
            return Err(PinFailure::Unsupported.to_string());
        }
        let mut sender = self.sender.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sender) = sender.as_ref() {
            return Ok(sender.clone());
        }
        let (tx, rx) = mpsc::channel();
        let manager = self.clone();
        let app = app.clone();
        std::thread::Builder::new()
            .name("pinned-target-ax".into())
            .spawn(move || worker(manager, app, rx))
            .map_err(|e| e.to_string())?;
        *sender = Some(tx.clone());
        Ok(tx)
    }
    pub async fn pin(self: &Arc<Self>, app: &AppHandle) -> Result<PinState, String> {
        self.pin_for_pid(app, frontmost_pid()).await
    }
    pub async fn pin_for_pid(
        self: &Arc<Self>,
        app: &AppHandle,
        pid: Option<i32>,
    ) -> Result<PinState, String> {
        if !crate::settings::get_settings(app).pinned_paste_enabled {
            return Err("Enable pinned delivery in Output & Paste first.".into());
        }
        let generation = self.clear(app);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender(app)?
            .send(Request::Pin {
                generation,
                pid,
                reply: tx,
            })
            .map_err(|_| "Destination worker stopped.".to_string())?;
        rx.await
            .map_err(|_| "Destination worker stopped.".to_string())?
    }
    pub async fn deliver(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        cancelled: Cancellation,
    ) -> Result<DeliveryRecord, String> {
        let sender = self.sender(app)?;
        let history = app.state::<Arc<HistoryManager>>().inner().clone();
        let id = id.to_owned();
        let record = tauri::async_runtime::spawn_blocking(move || history.claim_delivery(&id))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        sender
            .send(Request::Deliver {
                record,
                cancel: cancelled,
                reply: tx,
            })
            .map_err(|_| "Destination worker stopped.".to_string())?;
        rx.await.map_err(|_| {
            "Destination worker stopped. Check the target before retrying.".to_string()
        })?
    }
    pub async fn fallback(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
    ) -> Result<DeliveryRecord, String> {
        let sender = self.sender(app)?;
        let history = app.state::<Arc<HistoryManager>>().inner().clone();
        let id = id.to_owned();
        let record = tauri::async_runtime::spawn_blocking(move || history.claim_delivery(&id))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        sender
            .send(Request::Fallback { record, reply: tx })
            .map_err(|_| "Destination worker stopped.".to_string())?;
        rx.await.map_err(|_| {
            "Paste was interrupted. Check the target before inserting again.".to_string()
        })?
    }
    pub async fn open_target(
        self: &Arc<Self>,
        app: &AppHandle,
        target: PinnedTarget,
    ) -> Result<(), String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender(app)?
            .send(Request::Open { target, reply: tx })
            .map_err(|_| "Destination worker stopped.".to_string())?;
        rx.await
            .map_err(|_| "Destination worker stopped.".to_string())?
    }
}

#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
fn finish_delivery(
    app: &AppHandle,
    manager: &PinManager,
    mut record: DeliveryRecord,
    outcome: write::WriteOutcome,
) -> Result<DeliveryRecord, String> {
    record.state = outcome.state;
    record.reason = outcome.reason;
    record.message = record.reason.as_ref().map(ToString::to_string);
    record.confirmed_utf16 = outcome.confirmed_utf16;
    record.may_have_written = outcome.may_have_written;
    if let Err(error) = app.state::<Arc<HistoryManager>>().finish_delivery(&record) {
        // The durable pre-write checkpoint still prevents retries after restart.
        // Publish an honest outcome even when the final status write fails.
        record.state = DeliveryState::Uncertain;
        record.reason = Some(PinFailure::StatusSaveFailed);
        record.message = Some(PinFailure::StatusSaveFailed.to_string());
        manager
            .unsaved
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(record.clone());
        let _ = app.emit("pin-delivery-updated", &record);
        return Err(format!("{}: {error}", PinFailure::StatusSaveFailed));
    }
    if record.state == DeliveryState::Delivered && manager.valid(&record.target) {
        manager.clear(app);
    }
    let _ = app.emit("pin-delivery-updated", &record);
    Ok(record)
}

#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
fn worker(manager: Arc<PinManager>, app: AppHandle, rx: mpsc::Receiver<Request>) {
    let mut backend = macos::Backend::default();
    while let Ok(request) = rx.recv() {
        match request {
            Request::Clear { generation } => backend.clear_before(generation),
            Request::Pin {
                generation,
                pid,
                reply,
            } => {
                let result = backend.capture(generation, pid).and_then(|target| {
                    let mut s = manager.state.lock().unwrap_or_else(|e| e.into_inner());
                    if !manager.valid(&target) {
                        return Err(PinFailure::Cancelled);
                    }
                    s.target = Some(target);
                    s.bound = false;
                    s.error = None;
                    s.revision += 1;
                    Ok(s.clone())
                });
                if let Err(reason) = &result {
                    let mut s = manager.state.lock().unwrap_or_else(|e| e.into_inner());
                    if manager.generation.load(Ordering::Acquire) == generation {
                        s.error = Some(reason.to_string());
                        s.revision += 1;
                    }
                }
                manager.publish(&app);
                let _ = reply.send(result.map_err(|e| e.to_string()));
            }
            Request::Deliver {
                mut record,
                cancel,
                reply,
            } => {
                let outcome = if !manager.valid(&record.target) || cancel() {
                    write::WriteOutcome::deferred(PinFailure::Cancelled)
                } else if crate::settings::get_settings(&app).paste_method
                    == crate::settings::PasteMethod::None
                {
                    write::WriteOutcome::deferred(PinFailure::OutputDisabled)
                } else {
                    match backend.resolve(&record.target) {
                        Ok(mut field) => {
                            let history = app.state::<Arc<HistoryManager>>();
                            use write::TextField;
                            let prepare = field.value().and_then(|baseline| {
                                record.text = write::text_for_append(&baseline, &record.text);
                                history
                                    .prepare_delivery_text(&record.id, &record.text)
                                    .map_err(|_| PinFailure::HistorySaveFailed)
                            });
                            if let Err(reason) = prepare {
                                let _ = reply.send(finish_delivery(
                                    &app,
                                    &manager,
                                    record,
                                    write::WriteOutcome::deferred(reason),
                                ));
                                continue;
                            }
                            write::append_verified(
                                &mut field,
                                &record.text,
                                || manager.valid(&record.target) && !cancel(),
                                |n, possible| {
                                    history
                                        .checkpoint_delivery(&record.id, n, possible)
                                        .map_err(|_| PinFailure::HistorySaveFailed)
                                },
                            )
                        }
                        Err(reason) => write::WriteOutcome::deferred(reason),
                    }
                };
                let _ = reply.send(finish_delivery(&app, &manager, record, outcome));
            }
            Request::Fallback { mut record, reply } => {
                let outcome = backend.fallback(&app, &manager, &mut record);
                let _ = reply.send(finish_delivery(&app, &manager, record, outcome));
            }
            Request::Open { target, reply } => {
                let _ = reply.send(backend.open(&target).map_err(|e| e.to_string()));
            }
        }
    }
}

#[cfg(not(all(target_os = "macos", not(vox_jot_app_store))))]
impl PinManager {
    pub async fn pin(self: &Arc<Self>, _app: &AppHandle) -> Result<PinState, String> {
        Err(PinFailure::Unsupported.to_string())
    }
    pub async fn pin_for_pid(
        self: &Arc<Self>,
        _app: &AppHandle,
        _pid: Option<i32>,
    ) -> Result<PinState, String> {
        Err(PinFailure::Unsupported.to_string())
    }
    pub async fn deliver(
        self: &Arc<Self>,
        _app: &AppHandle,
        _id: &str,
        _cancelled: Cancellation,
    ) -> Result<DeliveryRecord, String> {
        Err(PinFailure::Unsupported.to_string())
    }
    pub async fn fallback(
        self: &Arc<Self>,
        _app: &AppHandle,
        _id: &str,
    ) -> Result<DeliveryRecord, String> {
        Err(PinFailure::Unsupported.to_string())
    }
    pub async fn open_target(
        self: &Arc<Self>,
        _app: &AppHandle,
        _target: PinnedTarget,
    ) -> Result<(), String> {
        Err(PinFailure::Unsupported.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target(generation: u64) -> PinnedTarget {
        PinnedTarget {
            id: "pin".into(),
            generation,
            pid: 1,
            bundle_id: "test".into(),
            app_name: "Test".into(),
            pinned_at: 0,
            locator: FieldLocator {
                role: "AXTextArea".into(),
                subrole: None,
                identifier: None,
                label: "Text".into(),
                document: None,
                window_title: None,
            },
        }
    }
    #[test]
    fn possible_writes_never_allow_full_retry() {
        let mut r = DeliveryRecord::pending(
            DeliverySource::History,
            "1".into(),
            target(0),
            "text".into(),
        );
        assert!(r.retryable());
        r.may_have_written = true;
        assert!(!r.retryable());
        r.may_have_written = false;
        r.confirmed_utf16 = 1;
        assert!(!r.retryable());
        r.confirmed_utf16 = 0;
        r.state = DeliveryState::Uncertain;
        assert!(!r.retryable());
    }
    #[test]
    fn generation_cancellation_is_immediate_without_worker() {
        let manager = PinManager::default();
        let pin = target(0);
        assert!(manager.valid(&pin));
        manager.generation.fetch_add(1, Ordering::AcqRel);
        assert!(!manager.valid(&pin));
    }
}
