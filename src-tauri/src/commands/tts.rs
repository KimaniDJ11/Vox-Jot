use crate::tts::{default_preview_request, SpeakRequest, TtsManager, TtsPackInfo, VoiceInfo};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
#[specta::specta]
pub async fn tts_speak(
    app: AppHandle,
    text: String,
    locale: Option<String>,
    preferred_voice_id: Option<String>,
    trigger: Option<String>,
    remember_last_output: Option<bool>,
) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager
        .speak(SpeakRequest {
            text,
            locale,
            preferred_voice_id,
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub fn tts_stop(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.stop();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_available_tts_voices(app: AppHandle) -> Result<Vec<VoiceInfo>, String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.get_available_voices()
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice(
    app: AppHandle,
    voice_id: Option<String>,
) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.speak(default_preview_request(voice_id)).await
}

#[tauri::command]
#[specta::specta]
pub fn get_available_tts_packs(app: AppHandle) -> Result<Vec<TtsPackInfo>, String> {
    let manager = app.state::<Arc<TtsManager>>();
    Ok(manager.get_available_packs())
}

#[tauri::command]
#[specta::specta]
pub async fn download_tts_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.download_pack(&pack_id).await
}

#[tauri::command]
#[specta::specta]
pub fn remove_tts_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.remove_pack(&pack_id)
}
