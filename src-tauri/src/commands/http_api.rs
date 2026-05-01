//! Tauri commands the Settings UI calls to toggle the loopback API and
//! query its current status.
//!
//! The actual server lives in `crate::http_api`. These commands persist
//! the user-visible settings to disk; the `settings-changed` listener in
//! `lib.rs` then asks the manager to start/stop the server. This split
//! keeps the UI thin and means flipping the toggle from any window
//! (main, scratchpad, etc.) is consistent.

use crate::http_api::HttpApiManager;
use crate::settings::{get_settings, write_settings};
use serde::Serialize;
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[derive(Serialize, Type)]
pub struct HttpApiStatus {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

#[tauri::command]
#[specta::specta]
pub async fn set_http_api_enabled(
    app: AppHandle,
    manager: State<'_, Arc<HttpApiManager>>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    if settings.http_api_enabled == enabled {
        return Ok(());
    }
    settings.http_api_enabled = enabled;
    let port = settings.http_api_port;
    write_settings(&app, settings);

    // The settings-changed listener will eventually re-sync, but we also
    // call directly here so the UI doesn't need to wait a tick to see
    // the badge flip.
    if enabled {
        manager.start(port).await;
    } else {
        manager.stop().await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_http_api_port(
    app: AppHandle,
    manager: State<'_, Arc<HttpApiManager>>,
    port: u16,
) -> Result<(), String> {
    if port == 0 {
        return Err("Port must be > 0".into());
    }
    let mut settings = get_settings(&app);
    settings.http_api_port = port;
    let enabled = settings.http_api_enabled;
    write_settings(&app, settings);

    if enabled {
        // Restart on the new port.
        manager.start(port).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_http_api_status(app: AppHandle) -> Result<HttpApiStatus, String> {
    let s = get_settings(&app);
    Ok(HttpApiStatus {
        enabled: s.http_api_enabled,
        port: s.http_api_port,
        token: s.http_api_token,
    })
}
