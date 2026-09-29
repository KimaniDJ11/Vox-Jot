//! Stable command names for operations now owned by dedicated domain modules.

use crate::{commands::post_process, settings, shortcut};
use std::collections::HashMap;
use tauri::AppHandle;

macro_rules! provider_commands {
    ($($name:ident($argument:ident) => $operation:ident;)*) => {
        $(
            #[tauri::command]
            #[specta::specta]
            pub fn $name(app: AppHandle, provider_id: String, $argument: String) -> Result<(), String> {
                post_process::$operation(app, provider_id, $argument)
            }
        )*
    };
}

provider_commands! {
    change_post_process_api_key_setting(api_key) => set_post_process_api_key;
    change_post_process_model_setting(model) => set_post_process_model;
    change_translation_model_setting(model) => set_translation_model;
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_base_url_setting(
    app: AppHandle,
    provider_id: String,
    base_url: String,
) -> Result<(), String> {
    post_process::configure_provider_endpoint(app, provider_id, base_url, false)
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_model_ids_setting(
    app: AppHandle,
    model_ids: HashMap<String, String>,
) -> Result<(), String> {
    post_process::replace_translation_models(app, model_ids)
}

#[tauri::command]
#[specta::specta]
pub fn change_keyboard_implementation_setting(
    app: AppHandle,
    implementation: String,
) -> Result<shortcut::ImplementationChangeResult, String> {
    let implementation = match implementation.as_str() {
        "handy_keys" => settings::KeyboardImplementation::HandyKeys,
        "tauri" => settings::KeyboardImplementation::Tauri,
        _ => {
            log::warn!("Unrecognized keyboard implementation; using tauri");
            settings::KeyboardImplementation::Tauri
        }
    };
    shortcut::change_keyboard_implementation(app, implementation)
}

#[tauri::command]
#[specta::specta]
pub fn get_keyboard_implementation(app: AppHandle) -> String {
    match settings::get_settings(&app).keyboard_implementation {
        settings::KeyboardImplementation::Tauri => "tauri",
        settings::KeyboardImplementation::HandyKeys => "handy_keys",
    }
    .to_string()
}
