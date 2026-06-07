//! Tauri commands the Settings UI calls to toggle the loopback API and
//! query its current status.
//!
//! The actual server lives in `crate::http_api`. These commands persist
//! the user-visible settings to disk; the `settings-changed` listener in
//! `lib.rs` then asks the manager to start/stop the server. This split
//! keeps the UI thin and means flipping the toggle from any window
//! (main, detail, etc.) is consistent.

use crate::http_api::HttpApiManager;
use crate::secret_store;
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
    pub token_available: bool,
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
    let mut s = get_settings(&app);
    let token = secret_store::get_or_create_http_api_token(Some(&s.http_api_token))?;
    if !s.http_api_token.trim().is_empty() {
        s.http_api_token.clear();
        write_settings(&app, s.clone());
    }
    Ok(HttpApiStatus {
        enabled: s.http_api_enabled,
        port: s.http_api_port,
        token: mask_token(&token),
        token_available: true,
    })
}

#[tauri::command]
#[specta::specta]
pub fn reveal_http_api_token(app: AppHandle) -> Result<String, String> {
    let mut settings = get_settings(&app);
    let token = secret_store::get_or_create_http_api_token(Some(&settings.http_api_token))?;
    if !settings.http_api_token.trim().is_empty() {
        settings.http_api_token.clear();
        write_settings(&app, settings);
    }
    Ok(token)
}

#[tauri::command]
#[specta::specta]
pub fn rotate_http_api_token(app: AppHandle) -> Result<HttpApiStatus, String> {
    let settings = get_settings(&app);
    let token = secret_store::rotate_http_api_token()?;
    Ok(HttpApiStatus {
        enabled: settings.http_api_enabled,
        port: settings.http_api_port,
        token: mask_token(&token),
        token_available: true,
    })
}

fn mask_token(token: &str) -> String {
    let trimmed = token.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 12 {
        return "••••".to_string();
    }
    let prefix: String = chars.iter().take(6).copied().collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(6)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}…{suffix}")
}
