use crate::{
    managers::history::HistoryManager,
    pinned_target::{DeliveryRecord, PinManager, PinState},
};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
#[specta::specta]
pub fn get_pin_state(app: AppHandle) -> PinState {
    app.state::<Arc<PinManager>>().snapshot()
}
#[tauri::command]
#[specta::specta]
pub async fn pin_field(app: AppHandle) -> Result<PinState, String> {
    app.state::<Arc<PinManager>>()
        .inner()
        .clone()
        .pin(&app)
        .await
}
#[tauri::command]
#[specta::specta]
pub fn clear_pin(app: AppHandle) {
    app.state::<Arc<PinManager>>().clear(&app);
}
#[tauri::command]
#[specta::specta]
pub async fn copy_pinned_delivery(app: AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let history = app.state::<Arc<HistoryManager>>().inner().clone();
    let unsaved = app.state::<Arc<PinManager>>().unsaved();
    let record = tauri::async_runtime::spawn_blocking(move || {
        history
            .get_delivery(&id)
            .map_err(|e| e.to_string())
            .or_else(|error| unsaved.into_iter().find(|r| r.id == id).ok_or(error))
    })
    .await
    .map_err(|e| e.to_string())??;
    app.clipboard()
        .write_text(record.text)
        .map_err(|e| e.to_string())
}
#[tauri::command]
#[specta::specta]
pub async fn get_pinned_delivery(app: AppHandle, id: String) -> Result<DeliveryRecord, String> {
    let history = app.state::<Arc<HistoryManager>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || history.get_delivery(&id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
#[tauri::command]
#[specta::specta]
pub fn get_unsaved_pinned_deliveries(app: AppHandle) -> Vec<DeliveryRecord> {
    app.state::<Arc<PinManager>>().unsaved()
}
#[tauri::command]
#[specta::specta]
pub async fn get_unresolved_pinned_deliveries(
    app: AppHandle,
) -> Result<Vec<DeliveryRecord>, String> {
    let history = app.state::<Arc<HistoryManager>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || history.list_unresolved_deliveries())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
#[tauri::command]
#[specta::specta]
pub async fn retry_delivery(app: AppHandle, id: String) -> Result<DeliveryRecord, String> {
    app.state::<Arc<PinManager>>()
        .inner()
        .clone()
        .deliver(&app, &id, Arc::new(|| false))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn deliver_via_paste(app: AppHandle, id: String) -> Result<DeliveryRecord, String> {
    app.state::<Arc<PinManager>>()
        .inner()
        .clone()
        .fallback(&app, &id)
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn open_pinned_delivery_target(app: AppHandle, id: String) -> Result<(), String> {
    let history = app.state::<Arc<HistoryManager>>().inner().clone();
    let record = tauri::async_runtime::spawn_blocking(move || history.get_delivery(&id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    app.state::<Arc<PinManager>>()
        .inner()
        .clone()
        .open_target(&app, record.target)
        .await
}
