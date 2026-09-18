//! Tauri command handlers for OCR operations.

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::ocr::{OcrManager, OcrProviderDescriptor, OcrResult};

#[tauri::command]
#[specta::specta]
pub fn ocr_get_providers(app: AppHandle) -> Result<Vec<OcrProviderDescriptor>, String> {
    let Some(manager) = app.try_state::<Arc<OcrManager>>() else {
        return Err("OCR manager is not initialized.".to_string());
    };
    Ok(manager.get_providers())
}

#[tauri::command]
#[specta::specta]
pub async fn ocr_recognize_image(
    app: AppHandle,
    image_path: String,
    engine: Option<String>,
    delete_after: Option<bool>,
) -> Result<OcrResult, String> {
    let Some(manager) = app.try_state::<Arc<OcrManager>>() else {
        return Err("OCR manager is not initialized.".to_string());
    };

    let manager = manager.inner().clone();
    let path = PathBuf::from(&image_path);
    let should_delete = delete_after.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = if should_delete {
            Some(crate::ocr::TempImageGuard::new(path.clone()))
        } else {
            None
        };

        manager.recognize(&path, engine.as_deref())
    })
    .await
    .map_err(|e| format!("OCR task join error: {e}"))?
}

#[tauri::command]
#[specta::specta]
pub fn ocr_cancel(app: AppHandle) -> Result<(), String> {
    let Some(manager) = app.try_state::<Arc<OcrManager>>() else {
        return Err("OCR manager is not initialized.".to_string());
    };

    manager.cancel_active_ocr_session();
    Ok(())
}
