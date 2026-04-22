//! Keyboard shortcut management module
//!
//! This module provides a unified interface for keyboard shortcuts with
//! multiple backend implementations:
//!
//! - `tauri`: Uses Tauri's built-in global-shortcut plugin
//! - `handy_keys`: Uses the handy-keys library for more control
//!
//! The active implementation is determined by the `keyboard_implementation`
//! setting and can be changed at runtime.

mod handler;
pub mod handy_keys;
mod tauri_impl;

use log::{error, info, warn};
use serde::Serialize;
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::managers::audio::AudioRecordingManager;
use crate::post_processing::{AppToneMapping, DictionaryEntry, PostProcessMode, ToneDefinition};
use crate::secret_store;
use crate::settings::{
    self, get_settings, is_local_base_url, AutoSubmitKey, ClipboardHandling, ContextCaptureMode,
    KeyboardImplementation, LLMPrompt, OcrQualityMode, OverlayPosition, PasteMethod,
    RecordingOverlayStyle, ShortcutBinding, SoundTheme, TranslationBilingualLayout,
    TranslationDestinationMode, TranslationOutputMode, TranslationRoutePreference,
    TtsAutoReadbackMode, TtsAutoReadbackScope, TtsEnginePreference, TtsReadbackTextMode,
    TypingTool, APPLE_INTELLIGENCE_DEFAULT_MODEL_ID, APPLE_INTELLIGENCE_PROVIDER_ID,
    OLLAMA_PROVIDER_ID, TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID, TTS_MODEL_SYSTEM_DEFAULT_ID,
    TTS_PROVIDER_LOCAL_SIDECAR_API_ID, TTS_PROVIDER_SHERPA_PACK_ID, TTS_PROVIDER_SYSTEM_BUILTIN_ID,
};
use crate::tray;

// Note: Commands are accessed via shortcut::handy_keys:: in lib.rs

/// Initialize shortcuts using the configured implementation
pub fn init_shortcuts(app: &AppHandle) {
    let user_settings = settings::load_or_create_app_settings(app);

    // Check which implementation to use
    match user_settings.keyboard_implementation {
        KeyboardImplementation::Tauri => {
            tauri_impl::init_shortcuts(app);
        }
        KeyboardImplementation::HandyKeys => {
            if let Err(e) = handy_keys::init_shortcuts(app) {
                error!("Failed to initialize handy-keys shortcuts: {}", e);
                // Fall back to Tauri implementation and persist this fallback
                warn!("Falling back to Tauri global shortcut implementation and saving fallback to settings");

                // Update settings to persist the fallback so we don't retry HandyKeys on next launch
                let mut settings = settings::get_settings(app);
                settings.keyboard_implementation = KeyboardImplementation::Tauri;
                settings::write_settings(app, settings);

                let reset_bindings =
                    register_all_shortcuts_for_implementation(app, KeyboardImplementation::Tauri);
                if !reset_bindings.is_empty() {
                    warn!(
                        "Reset incompatible shortcuts after falling back to Tauri: {:?}",
                        reset_bindings
                    );
                }
            }
        }
    }
}

/// Register the cancel shortcut (called when recording starts)
pub fn register_cancel_shortcut(app: &AppHandle) {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::register_cancel_shortcut(app),
        KeyboardImplementation::HandyKeys => handy_keys::register_cancel_shortcut(app),
    }
}

/// Unregister the cancel shortcut (called when recording stops)
pub fn unregister_cancel_shortcut(app: &AppHandle) {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::unregister_cancel_shortcut(app),
        KeyboardImplementation::HandyKeys => handy_keys::unregister_cancel_shortcut(app),
    }
}

/// Register a shortcut using the appropriate implementation
pub fn register_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::register_shortcut(app, binding),
        KeyboardImplementation::HandyKeys => handy_keys::register_shortcut(app, binding),
    }
}

/// Unregister a shortcut using the appropriate implementation
pub fn unregister_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::unregister_shortcut(app, binding),
        KeyboardImplementation::HandyKeys => handy_keys::unregister_shortcut(app, binding),
    }
}

// ============================================================================
// Binding Management Commands
// ============================================================================

#[derive(Serialize, Type)]
pub struct BindingResponse {
    success: bool,
    binding: Option<ShortcutBinding>,
    error: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn change_binding(
    app: AppHandle,
    id: String,
    binding: String,
) -> Result<BindingResponse, String> {
    // Reject empty bindings — every shortcut should have a value
    if binding.trim().is_empty() {
        return Err("Binding cannot be empty".to_string());
    }

    let mut settings = settings::get_settings(&app);

    // Get the binding to modify, or create it from defaults if it doesn't exist
    let binding_to_modify = match settings.bindings.get(&id) {
        Some(binding) => binding.clone(),
        None => {
            // Try to get the default binding for this id
            let default_settings = settings::get_default_settings();
            match default_settings.bindings.get(&id) {
                Some(default_binding) => {
                    warn!(
                        "Binding '{}' not found in settings, creating from defaults",
                        id
                    );
                    default_binding.clone()
                }
                None => {
                    let error_msg = format!("Binding with id '{}' not found in defaults", id);
                    warn!("change_binding error: {}", error_msg);
                    return Ok(BindingResponse {
                        success: false,
                        binding: None,
                        error: Some(error_msg),
                    });
                }
            }
        }
    };

    // If this is the cancel binding, just update the settings and return
    // It's managed dynamically, so we don't register/unregister here
    if id == "cancel" {
        if let Some(mut b) = settings.bindings.get(&id).cloned() {
            b.current_binding = binding;
            settings.bindings.insert(id.clone(), b.clone());
            settings::write_settings(&app, settings);
            return Ok(BindingResponse {
                success: true,
                binding: Some(b.clone()),
                error: None,
            });
        }
    }

    // Unregister the existing binding
    if let Err(e) = unregister_shortcut(&app, binding_to_modify.clone()) {
        let error_msg = format!("Failed to unregister shortcut: {}", e);
        error!("change_binding error: {}", error_msg);
    }

    // Validate the new shortcut for the current keyboard implementation
    if let Err(e) = validate_shortcut_for_implementation(&binding, settings.keyboard_implementation)
    {
        warn!("change_binding validation error: {}", e);
        return Err(e);
    }

    // Create an updated binding
    let mut updated_binding = binding_to_modify;
    updated_binding.current_binding = binding;

    // Register the new binding
    if let Err(e) = register_shortcut(&app, updated_binding.clone()) {
        let error_msg = format!("Failed to register shortcut: {}", e);
        error!("change_binding error: {}", error_msg);
        return Ok(BindingResponse {
            success: false,
            binding: None,
            error: Some(error_msg),
        });
    }

    // Update the binding in the settings
    settings.bindings.insert(id, updated_binding.clone());

    // Save the settings
    settings::write_settings(&app, settings);

    // Return the updated binding
    Ok(BindingResponse {
        success: true,
        binding: Some(updated_binding),
        error: None,
    })
}

#[tauri::command]
#[specta::specta]
pub fn reset_binding(app: AppHandle, id: String) -> Result<BindingResponse, String> {
    let binding = settings::get_stored_binding(&app, &id);
    change_binding(app, id, binding.default_binding)
}

/// Temporarily unregister a binding while the user is editing it in the UI.
/// This avoids firing the action while keys are being recorded.
#[tauri::command]
#[specta::specta]
pub fn suspend_binding(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(b) = settings::get_bindings(&app).get(&id).cloned() {
        if let Err(e) = unregister_shortcut(&app, b) {
            error!("suspend_binding error for id '{}': {}", id, e);
            return Err(e);
        }
    }
    Ok(())
}

/// Re-register the binding after the user has finished editing.
#[tauri::command]
#[specta::specta]
pub fn resume_binding(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(b) = settings::get_bindings(&app).get(&id).cloned() {
        if let Err(e) = register_shortcut(&app, b) {
            error!("resume_binding error for id '{}': {}", id, e);
            return Err(e);
        }
    }
    Ok(())
}

// ============================================================================
// Keyboard Implementation Switching
// ============================================================================

/// Result of changing keyboard implementation
#[derive(Serialize, Type)]
pub struct ImplementationChangeResult {
    pub success: bool,
    /// List of binding IDs that were reset to defaults due to incompatibility
    pub reset_bindings: Vec<String>,
}

/// Change the keyboard implementation with runtime switching.
/// This will unregister all shortcuts from the old implementation,
/// validate shortcuts for the new implementation (resetting invalid ones to defaults),
/// and register them with the new implementation.
#[tauri::command]
#[specta::specta]
pub fn change_keyboard_implementation_setting(
    app: AppHandle,
    implementation: String,
) -> Result<ImplementationChangeResult, String> {
    let current_settings = settings::get_settings(&app);
    let current_impl = current_settings.keyboard_implementation;
    let new_impl = parse_keyboard_implementation(&implementation);

    // If same implementation, nothing to do
    if current_impl == new_impl {
        return Ok(ImplementationChangeResult {
            success: true,
            reset_bindings: vec![],
        });
    }

    info!(
        "Switching keyboard implementation from {:?} to {:?}",
        current_impl, new_impl
    );

    // Unregister all shortcuts from the current implementation
    unregister_all_shortcuts(&app, current_impl);

    // Update the setting
    let mut settings = settings::get_settings(&app);
    settings.keyboard_implementation = new_impl;
    settings::write_settings(&app, settings);

    // Initialize new implementation if needed (HandyKeys needs state)
    if new_impl == KeyboardImplementation::HandyKeys && initialize_handy_keys_with_rollback(&app)? {
        // Shortcuts already registered during init
        return Ok(ImplementationChangeResult {
            success: true,
            reset_bindings: vec![],
        });
    }

    // Register all shortcuts with new implementation, resetting invalid ones
    let reset_bindings = register_all_shortcuts_for_implementation(&app, new_impl);

    // Emit event to notify frontend of the change
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "keyboard_implementation",
            "value": implementation,
            "reset_bindings": reset_bindings
        }),
    );

    info!("Keyboard implementation switched to {:?}", new_impl);

    Ok(ImplementationChangeResult {
        success: true,
        reset_bindings,
    })
}

/// Get the current keyboard implementation
#[tauri::command]
#[specta::specta]
pub fn get_keyboard_implementation(app: AppHandle) -> String {
    let settings = settings::get_settings(&app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => "tauri".to_string(),
        KeyboardImplementation::HandyKeys => "handy_keys".to_string(),
    }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/// Validate a shortcut for a specific implementation
fn validate_shortcut_for_implementation(
    raw: &str,
    implementation: KeyboardImplementation,
) -> Result<(), String> {
    match implementation {
        KeyboardImplementation::Tauri => tauri_impl::validate_shortcut(raw),
        KeyboardImplementation::HandyKeys => handy_keys::validate_shortcut(raw),
    }
}

/// Parse a keyboard implementation string into the enum
fn parse_keyboard_implementation(s: &str) -> KeyboardImplementation {
    match s {
        "tauri" => KeyboardImplementation::Tauri,
        "handy_keys" => KeyboardImplementation::HandyKeys,
        other => {
            warn!(
                "Invalid keyboard implementation '{}', defaulting to tauri",
                other
            );
            KeyboardImplementation::Tauri
        }
    }
}

/// Unregister all shortcuts for the current implementation
fn unregister_all_shortcuts(app: &AppHandle, implementation: KeyboardImplementation) {
    let bindings = settings::get_bindings(app);

    for (id, binding) in bindings {
        // Skip cancel shortcut as it's dynamically registered
        if id == "cancel" {
            continue;
        }

        let result = match implementation {
            KeyboardImplementation::Tauri => tauri_impl::unregister_shortcut(app, binding),
            KeyboardImplementation::HandyKeys => handy_keys::unregister_shortcut(app, binding),
        };

        if let Err(e) = result {
            warn!(
                "Failed to unregister shortcut '{}' during switch: {}",
                id, e
            );
        }
    }
}

/// Register all shortcuts for a specific implementation, validating and resetting invalid ones
fn register_all_shortcuts_for_implementation(
    app: &AppHandle,
    implementation: KeyboardImplementation,
) -> Vec<String> {
    let mut reset_bindings = Vec::new();
    let default_bindings = settings::get_default_settings().bindings;
    let mut current_settings = settings::get_settings(app);

    for (id, default_binding) in &default_bindings {
        // Skip cancel shortcut as it's dynamically registered
        if id == "cancel" {
            continue;
        }

        // Skip post-processing shortcut when the feature is disabled
        if (id == "transcribe_with_post_process" || id == "rewrite_selection")
            && !current_settings.post_process_enabled
        {
            continue;
        }

        let mut binding = current_settings
            .bindings
            .get(id)
            .cloned()
            .unwrap_or_else(|| default_binding.clone());

        // Validate the shortcut for the target implementation
        if let Err(e) =
            validate_shortcut_for_implementation(&binding.current_binding, implementation)
        {
            info!(
                "Shortcut '{}' ({}) is invalid for {:?}: {}. Resetting to default.",
                id, binding.current_binding, implementation, e
            );

            // Reset to default
            binding.current_binding = default_binding.current_binding.clone();
            current_settings
                .bindings
                .insert(id.clone(), binding.clone());
            reset_bindings.push(id.clone());
        }

        // Register with the appropriate implementation
        let result = match implementation {
            KeyboardImplementation::Tauri => tauri_impl::register_shortcut(app, binding),
            KeyboardImplementation::HandyKeys => handy_keys::register_shortcut(app, binding),
        };

        if let Err(e) = result {
            error!(
                "Failed to register shortcut '{}' for {:?}: {}",
                id, implementation, e
            );
        }
    }

    // Save settings if any bindings were reset
    if !reset_bindings.is_empty() {
        settings::write_settings(app, current_settings);
    }

    reset_bindings
}

/// Initialize HandyKeys if not already initialized, with rollback on failure
fn initialize_handy_keys_with_rollback(app: &AppHandle) -> Result<bool, String> {
    if app.try_state::<handy_keys::HandyKeysState>().is_some() {
        return Ok(false); // Already initialized, caller should continue
    }

    if let Err(e) = handy_keys::init_shortcuts(app) {
        error!("Failed to initialize HandyKeys: {}", e);
        // Rollback to Tauri
        let mut settings = settings::get_settings(app);
        settings.keyboard_implementation = KeyboardImplementation::Tauri;
        settings::write_settings(app, settings);

        let reset_bindings =
            register_all_shortcuts_for_implementation(app, KeyboardImplementation::Tauri);
        if !reset_bindings.is_empty() {
            warn!(
                "Reset incompatible shortcuts after reverting to Tauri: {:?}",
                reset_bindings
            );
        }

        return Err(format!(
            "Failed to initialize HandyKeys: {}. Reverted to Tauri.",
            e
        ));
    }

    // init_shortcuts already registered shortcuts
    Ok(true)
}

// ============================================================================
// General Settings Commands
// ============================================================================

#[tauri::command]
#[specta::specta]
pub fn change_ptt_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.push_to_talk = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_feedback_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_feedback_volume_setting(app: AppHandle, volume: f32) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback_volume = volume;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_sound_theme_setting(app: AppHandle, theme: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match theme.as_str() {
        "marimba" => SoundTheme::Marimba,
        "pop" => SoundTheme::Pop,
        "custom" => SoundTheme::Custom,
        other => {
            warn!("Invalid sound theme '{}', defaulting to marimba", other);
            SoundTheme::Marimba
        }
    };
    settings.sound_theme = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_app_theme_setting(app: AppHandle, theme: String) -> Result<(), String> {
    const VALID_APP_THEMES: &[&str] = &[
        "system",
        "light",
        "dark",
        "sepia",
        "ocean",
        "forest",
        "rose",
        "slate",
        "solarized",
        "graphite",
    ];
    let mut settings = settings::get_settings(&app);
    if VALID_APP_THEMES.contains(&theme.as_str()) {
        settings.app_theme = theme;
    } else {
        warn!("Invalid app theme '{}', defaulting to system", theme);
        settings.app_theme = "system".to_string();
    }
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translate_to_english_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translate_to_english = enabled;
    settings.translation_output_mode = if enabled {
        TranslationOutputMode::Translated
    } else {
        TranslationOutputMode::Source
    };
    settings.translation_target_language = "en".to_string();
    settings.translation_route_preference = if enabled {
        TranslationRoutePreference::WhisperEnglish
    } else {
        TranslationRoutePreference::Auto
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_selected_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.selected_language = language;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_output_mode_setting(app: AppHandle, mode: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translation_output_mode = match mode.as_str() {
        "source" => TranslationOutputMode::Source,
        "translated" => TranslationOutputMode::Translated,
        "bilingual" => TranslationOutputMode::Bilingual,
        other => return Err(format!("Invalid translation output mode '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_target_language_setting(
    app: AppHandle,
    language: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translation_target_language = language;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_route_preference_setting(
    app: AppHandle,
    route: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translation_route_preference = match route.as_str() {
        "auto" => TranslationRoutePreference::Auto,
        "whisper_english" => TranslationRoutePreference::WhisperEnglish,
        "offline_pack" => TranslationRoutePreference::OfflinePack,
        "local_ai" => TranslationRoutePreference::LocalAi,
        "remote_ai" => TranslationRoutePreference::RemoteAi,
        other => return Err(format!("Invalid translation route '{}'", other)),
    };
    settings.enforce_local_privacy_mode();
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_bilingual_layout_setting(
    app: AppHandle,
    layout: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translation_bilingual_layout = match layout.as_str() {
        "translation_then_source" => TranslationBilingualLayout::TranslationThenSource,
        "source_then_translation" => TranslationBilingualLayout::SourceThenTranslation,
        other => return Err(format!("Invalid bilingual layout '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_translate_snippets_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translation_translate_snippets = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_destination_mode_setting(
    app: AppHandle,
    mode: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translation_destination_mode = match mode.as_str() {
        "paste_in_place" => TranslationDestinationMode::PasteInPlace,
        "preview_then_paste" => TranslationDestinationMode::PreviewThenPaste,
        "open_in_jot_pad" => TranslationDestinationMode::OpenInJotPad,
        other => return Err(format!("Invalid translation destination '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_selection_translation_destination_mode_setting(
    app: AppHandle,
    mode: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.selection_translation_destination_mode = match mode.as_str() {
        "replace_selection" => {
            crate::settings::SelectionTranslationDestinationMode::ReplaceSelection
        }
        "preview_then_replace" => {
            crate::settings::SelectionTranslationDestinationMode::PreviewThenReplace
        }
        "open_in_jot_pad" => crate::settings::SelectionTranslationDestinationMode::OpenInJotPad,
        other => {
            return Err(format!(
                "Invalid selection translation destination '{}'",
                other
            ))
        }
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_engine_preference_setting(
    app: AppHandle,
    preference: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_engine_preference = match preference.as_str() {
        "auto" => TtsEnginePreference::Auto,
        "system" => TtsEnginePreference::System,
        "sherpa_onnx" => TtsEnginePreference::SherpaOnnx,
        "sidecar" => TtsEnginePreference::Sidecar,
        other => return Err(format!("Invalid TTS engine preference '{}'", other)),
    };
    settings.selected_tts_provider_id = match settings.tts_engine_preference {
        TtsEnginePreference::System => TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
        TtsEnginePreference::SherpaOnnx => TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
        TtsEnginePreference::Sidecar => TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
        TtsEnginePreference::Auto => {
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string()
            }
            #[cfg(target_os = "linux")]
            {
                TTS_PROVIDER_SHERPA_PACK_ID.to_string()
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string()
            }
        }
    };
    if settings.selected_tts_model_id.is_none() {
        settings.selected_tts_model_id = match settings.selected_tts_provider_id.as_str() {
            TTS_PROVIDER_SYSTEM_BUILTIN_ID => Some(TTS_MODEL_SYSTEM_DEFAULT_ID.to_string()),
            TTS_PROVIDER_LOCAL_SIDECAR_API_ID => {
                Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string())
            }
            _ => settings.tts_default_voice_id.clone(),
        };
    }
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_auto_readback_mode_setting(app: AppHandle, mode: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_auto_readback_mode = match mode.as_str() {
        "off" => TtsAutoReadbackMode::Off,
        "after_output" => TtsAutoReadbackMode::AfterOutput,
        "after_preview_confirm" => TtsAutoReadbackMode::AfterPreviewConfirm,
        other => return Err(format!("Invalid TTS readback mode '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_auto_readback_scope_setting(app: AppHandle, scope: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_auto_readback_scope = match scope.as_str() {
        "dictation_only" => TtsAutoReadbackScope::DictationOnly,
        "dictation_and_selection" => TtsAutoReadbackScope::DictationAndSelection,
        other => return Err(format!("Invalid TTS readback scope '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_readback_text_mode_setting(app: AppHandle, mode: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_readback_text_mode = match mode.as_str() {
        "final_output" => TtsReadbackTextMode::FinalOutput,
        "translated_block" => TtsReadbackTextMode::TranslatedBlock,
        other => return Err(format!("Invalid TTS readback text mode '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_default_voice_id_setting(
    app: AppHandle,
    voice_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_default_voice_id = voice_id.filter(|value| !value.trim().is_empty());
    settings.selected_tts_voice_id = settings.tts_default_voice_id.clone();
    if settings.selected_tts_provider_id == TTS_PROVIDER_SHERPA_PACK_ID {
        settings.selected_tts_model_id = settings.selected_tts_voice_id.clone();
    }
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_rate_setting(app: AppHandle, rate: f32) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_rate = rate.clamp(0.5, 2.0);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_volume_setting(app: AppHandle, volume: f32) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_volume = volume.clamp(0.0, 1.0);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_stop_on_record_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_stop_on_record = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_enhancement_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    if audio_manager.is_recording() {
        return Err("Stop recording before changing noise reduction.".to_string());
    }

    let mut settings = settings::get_settings(&app);
    settings.audio_enhancement_enabled = enabled;
    settings::write_settings(&app, settings);
    audio_manager
        .update_audio_enhancement()
        .map_err(|err| format!("Failed to refresh audio enhancement: {err}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_enhancement_model_setting(app: AppHandle, model: String) -> Result<(), String> {
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    if audio_manager.is_recording() {
        return Err("Stop recording before changing noise reduction.".to_string());
    }

    let mut settings = settings::get_settings(&app);
    settings.audio_enhancement_model = model;
    settings::write_settings(&app, settings);
    audio_manager
        .update_audio_enhancement()
        .map_err(|err| format!("Failed to refresh audio enhancement: {err}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_tts_model_store_path_setting(
    app: AppHandle,
    path: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tts_model_store_path = path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_speech_runtime_path_setting(
    app: AppHandle,
    path: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.speech_runtime_path = path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_overlay_position_setting(app: AppHandle, position: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match position.as_str() {
        "none" => OverlayPosition::None,
        "top" => OverlayPosition::Top,
        "bottom" => OverlayPosition::Bottom,
        other => {
            warn!("Invalid overlay position '{}', defaulting to bottom", other);
            OverlayPosition::Bottom
        }
    };
    settings.overlay_position = parsed;
    settings::write_settings(&app, settings);

    // Update overlay position without recreating window
    crate::utils::update_overlay_position(&app);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_recording_overlay_style_setting(app: AppHandle, style: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match style.as_str() {
        "compact" => RecordingOverlayStyle::Compact,
        "detailed" => RecordingOverlayStyle::Detailed,
        other => {
            warn!(
                "Invalid recording overlay style '{}', defaulting to compact",
                other
            );
            RecordingOverlayStyle::Compact
        }
    };
    settings.recording_overlay_style = parsed;
    settings::write_settings(&app, settings);

    crate::overlay::apply_recording_overlay_metrics(&app);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_debug_mode_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.debug_mode = enabled;
    settings::write_settings(&app, settings);

    // Emit event to notify frontend of debug mode change
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "debug_mode",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_start_hidden_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.start_hidden = enabled;
    settings::write_settings(&app, settings);

    // Notify frontend
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "start_hidden",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_autostart_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.autostart_enabled = enabled;
    settings::write_settings(&app, settings);

    // Apply the autostart setting immediately
    let autostart_manager = app.autolaunch();
    if enabled {
        let _ = autostart_manager.enable();
    } else {
        let _ = autostart_manager.disable();
    }

    // Notify frontend
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "autostart_enabled",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_update_checks_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.update_checks_enabled = enabled;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "update_checks_enabled",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_custom_words(app: AppHandle, words: Vec<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.custom_words = words;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_word_correction_threshold_setting(
    app: AppHandle,
    threshold: f64,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.word_correction_threshold = threshold;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_paste_method_setting(app: AppHandle, method: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match method.as_str() {
        "ctrl_v" => PasteMethod::CtrlV,
        "direct" => PasteMethod::Direct,
        "none" => PasteMethod::None,
        "shift_insert" => PasteMethod::ShiftInsert,
        "ctrl_shift_v" => PasteMethod::CtrlShiftV,
        "external_script" => PasteMethod::ExternalScript,
        other => {
            warn!("Invalid paste method '{}', defaulting to ctrl_v", other);
            PasteMethod::CtrlV
        }
    };
    settings.paste_method = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_available_typing_tools() -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        crate::clipboard::get_available_typing_tools()
    }
    #[cfg(not(target_os = "linux"))]
    {
        vec!["auto".to_string()]
    }
}

#[tauri::command]
#[specta::specta]
pub fn change_typing_tool_setting(app: AppHandle, tool: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match tool.as_str() {
        "auto" => TypingTool::Auto,
        "wtype" => TypingTool::Wtype,
        "kwtype" => TypingTool::Kwtype,
        "dotool" => TypingTool::Dotool,
        "ydotool" => TypingTool::Ydotool,
        "xdotool" => TypingTool::Xdotool,
        other => {
            warn!("Invalid typing tool '{}', defaulting to auto", other);
            TypingTool::Auto
        }
    };
    settings.typing_tool = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_external_script_path_setting(
    app: AppHandle,
    path: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.external_script_path = path;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_clipboard_handling_setting(app: AppHandle, handling: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match handling.as_str() {
        "dont_modify" => ClipboardHandling::DontModify,
        "copy_to_clipboard" => ClipboardHandling::CopyToClipboard,
        other => {
            warn!(
                "Invalid clipboard handling '{}', defaulting to dont_modify",
                other
            );
            ClipboardHandling::DontModify
        }
    };
    settings.clipboard_handling = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_auto_submit_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.auto_submit = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_auto_submit_key_setting(app: AppHandle, key: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match key.as_str() {
        "enter" => AutoSubmitKey::Enter,
        "ctrl_enter" => AutoSubmitKey::CtrlEnter,
        "cmd_enter" => AutoSubmitKey::CmdEnter,
        other => {
            warn!("Invalid auto submit key '{}', defaulting to enter", other);
            AutoSubmitKey::Enter
        }
    };
    settings.auto_submit_key = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_enabled = enabled;
    settings.enforce_local_privacy_mode();
    settings::write_settings(&app, settings.clone());

    // Register or unregister the post-processing shortcuts
    for binding_id in ["transcribe_with_post_process", "rewrite_selection"] {
        if let Some(binding) = settings.bindings.get(binding_id).cloned() {
            if enabled {
                let _ = register_shortcut(&app, binding);
            } else {
                let _ = unregister_shortcut(&app, binding);
            }
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_local_privacy_mode_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.local_privacy_mode = enabled;
    settings.enforce_local_privacy_mode();
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_enabled = enabled;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "screen_context_enabled",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_excluded_bundle_ids_setting(
    app: AppHandle,
    bundle_ids: Vec<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_excluded_bundle_ids = bundle_ids
        .into_iter()
        .map(|bundle_id| bundle_id.trim().to_string())
        .filter(|bundle_id| !bundle_id.is_empty())
        .fold(Vec::<String>::new(), |mut acc, bundle_id| {
            if !acc
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&bundle_id))
            {
                acc.push(bundle_id);
            }
            acc
        });
    settings::write_settings(&app, settings.clone());

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "screen_context_excluded_bundle_ids",
            "value": settings.screen_context_excluded_bundle_ids
        }),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_pause_on_idle_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_pause_on_idle = enabled;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "screen_context_pause_on_idle",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_idle_threshold_ms_setting(
    app: AppHandle,
    threshold_ms: u32,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_idle_threshold_ms = threshold_ms.clamp(10_000, 600_000);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_context_capture_mode_setting(app: AppHandle, mode: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.context_capture_mode = match mode.as_str() {
        "always_frequent" => ContextCaptureMode::AlwaysFrequent,
        "adaptive_cache" => ContextCaptureMode::AdaptiveCache,
        "mostly_on_demand" => ContextCaptureMode::MostlyOnDemand,
        other => return Err(format!("Invalid context capture mode '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_ocr_quality_setting(
    app: AppHandle,
    quality: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_ocr_quality = match quality.as_str() {
        "fast" => OcrQualityMode::Fast,
        "balanced" => OcrQualityMode::Balanced,
        "accurate" => OcrQualityMode::Accurate,
        other => return Err(format!("Invalid OCR quality '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_ocr_timeout_ms_setting(
    app: AppHandle,
    timeout_ms: u32,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_ocr_timeout_ms = timeout_ms.clamp(200, 5_000);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_token_budget_setting(
    app: AppHandle,
    token_budget: u32,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_token_budget = token_budget.clamp(100, 2_000);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_screen_context_stale_threshold_ms_setting(
    app: AppHandle,
    stale_threshold_ms: u32,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.screen_context_stale_threshold_ms = stale_threshold_ms.clamp(500, 10_000);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_mode_setting(app: AppHandle, mode: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_mode = match mode.as_str() {
        "literal" => PostProcessMode::Literal,
        "intent" => PostProcessMode::Intent,
        other => return Err(format!("Invalid post-process mode '{}'", other)),
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_personal_dictionary(
    app: AppHandle,
    entries: Vec<DictionaryEntry>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.personal_dictionary = entries;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_max_rewrite_strength_setting(app: AppHandle, strength: u8) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.max_rewrite_strength = strength.min(2);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_show_preview_before_paste_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.show_preview_before_paste = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_fallback_to_raw_on_failure_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.fallback_to_raw_on_failure = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_app_aware_tone_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_aware_tone_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_tone_definitions(
    app: AppHandle,
    definitions: Vec<ToneDefinition>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.tone_definitions = definitions;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_app_tone_mappings(
    app: AppHandle,
    mappings: Vec<AppToneMapping>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_tone_mappings = mappings;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_experimental_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.experimental_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_base_url_setting(
    app: AppHandle,
    provider_id: String,
    base_url: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let local_privacy_mode = settings.local_privacy_mode;
    let label = settings
        .post_process_provider(&provider_id)
        .map(|provider| provider.label.clone())
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    let provider = settings
        .post_process_provider_mut(&provider_id)
        .expect("Provider looked up above must exist");

    if provider.id != "custom" {
        return Err(format!(
            "Provider '{}' does not allow editing the base URL",
            label
        ));
    }

    if local_privacy_mode && !is_local_base_url(&base_url) {
        return Err(
            "Local privacy mode is enabled. Custom provider URL must point to localhost or loopback."
                .to_string(),
        );
    }

    provider.base_url = base_url;
    settings.enforce_local_privacy_mode();
    settings::write_settings(&app, settings);
    Ok(())
}

/// Generic helper to validate provider exists
fn validate_provider_exists(
    settings: &settings::AppSettings,
    provider_id: &str,
) -> Result<(), String> {
    if !settings
        .post_process_providers
        .iter()
        .any(|provider| provider.id == provider_id)
    {
        return Err(format!("Provider '{}' not found", provider_id));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_api_key_setting(
    app: AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    let settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;

    if api_key.trim().is_empty() {
        secret_store::clear_post_process_api_key(&provider_id)?;
    } else {
        secret_store::set_post_process_api_key(&provider_id, api_key.trim())?;
    }

    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_model_setting(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;
    settings
        .post_process_models
        .insert(provider_id.clone(), model.clone());
    if settings.post_process_provider_id == provider_id {
        settings.selected_llm_provider_id = settings.post_process_provider_id.clone();
        settings.selected_llm_model_id = model;
    }
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translation_model_setting(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;
    settings.translation_model_ids.insert(provider_id, model);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_post_process_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;

    if settings.local_privacy_mode && !settings.is_post_process_provider_local(&provider_id) {
        return Err(
            "Local privacy mode is enabled. Select a local post-processing provider.".to_string(),
        );
    }

    settings.post_process_provider_id = provider_id.clone();
    settings.selected_llm_provider_id = provider_id.clone();
    settings.selected_llm_model_id = settings
        .post_process_models
        .get(&provider_id)
        .cloned()
        .unwrap_or_default();
    settings.enforce_local_privacy_mode();
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_translation_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;

    if settings.local_privacy_mode && !settings.is_post_process_provider_local(&provider_id) {
        return Err(
            "Local privacy mode is enabled. Select a local translation provider.".to_string(),
        );
    }

    settings.translation_provider_id = provider_id;
    settings.enforce_local_privacy_mode();
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn add_post_process_prompt(
    app: AppHandle,
    name: String,
    prompt: String,
) -> Result<LLMPrompt, String> {
    let mut settings = settings::get_settings(&app);

    // Generate unique ID using timestamp and random component
    let id = format!("prompt_{}", chrono::Utc::now().timestamp_millis());

    let new_prompt = LLMPrompt {
        id: id.clone(),
        name,
        prompt,
    };

    settings.post_process_prompts.push(new_prompt.clone());
    settings::write_settings(&app, settings);

    Ok(new_prompt)
}

#[tauri::command]
#[specta::specta]
pub fn update_post_process_prompt(
    app: AppHandle,
    id: String,
    name: String,
    prompt: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    if let Some(existing_prompt) = settings
        .post_process_prompts
        .iter_mut()
        .find(|p| p.id == id)
    {
        existing_prompt.name = name;
        existing_prompt.prompt = prompt;
        settings::write_settings(&app, settings);
        Ok(())
    } else {
        Err(format!("Prompt with id '{}' not found", id))
    }
}

#[tauri::command]
#[specta::specta]
pub fn delete_post_process_prompt(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    // Don't allow deleting the last prompt
    if settings.post_process_prompts.len() <= 1 {
        return Err("Cannot delete the last prompt".to_string());
    }

    // Find and remove the prompt
    let original_len = settings.post_process_prompts.len();
    settings.post_process_prompts.retain(|p| p.id != id);

    if settings.post_process_prompts.len() == original_len {
        return Err(format!("Prompt with id '{}' not found", id));
    }

    // If the deleted prompt was selected, select the first one or None
    if settings.post_process_selected_prompt_id.as_ref() == Some(&id) {
        settings.post_process_selected_prompt_id =
            settings.post_process_prompts.first().map(|p| p.id.clone());
    }

    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_post_process_models(
    app: AppHandle,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let settings = settings::get_settings(&app);

    // Find the provider
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return Ok(vec![APPLE_INTELLIGENCE_DEFAULT_MODEL_ID.to_string()]);
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return Err("Apple Intelligence is only available on Apple silicon Macs running macOS 26 or later.".to_string());
        }
    }

    // Get API key
    let api_key = secret_store::get_post_process_api_key(&provider_id)
        .unwrap_or_else(|error| {
            warn!(
                "Failed to load secure API key for provider '{}': {}",
                provider_id, error
            );
            None
        })
        .unwrap_or_default();

    // Skip fetching if no API key for providers that typically need one
    if api_key.trim().is_empty()
        && provider.id != "custom"
        && provider.id != "lmstudio"
        && provider.id != OLLAMA_PROVIDER_ID
    {
        return Err(format!(
            "API key is required for {}. Please add an API key to list available models.",
            provider.label
        ));
    }

    crate::llm_client::fetch_models(provider, api_key).await
}

#[tauri::command]
#[specta::specta]
pub fn set_post_process_selected_prompt(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    // Verify the prompt exists
    if !settings.post_process_prompts.iter().any(|p| p.id == id) {
        return Err(format!("Prompt with id '{}' not found", id));
    }

    settings.post_process_selected_prompt_id = Some(id);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_mute_while_recording_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.mute_while_recording = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_append_trailing_space_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.append_trailing_space = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_app_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_language = language.clone();
    settings::write_settings(&app, settings);

    // Refresh the tray menu with the new language
    tray::update_tray_menu(&app, &tray::TrayIconState::Idle, Some(&language));

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_global_language_sync_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.global_language_sync_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_show_tray_icon_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.show_tray_icon = enabled;
    settings::write_settings(&app, settings);

    // Apply change immediately
    tray::set_tray_visibility(&app, enabled);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_correction_tracking_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.correction_tracking_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_snippets_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.snippets_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_snippets(
    app: AppHandle,
    snippets: Vec<crate::snippets::Snippet>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.snippets = snippets;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn import_snippets(app: AppHandle, json: String) -> Result<usize, String> {
    let imported: Vec<crate::snippets::Snippet> =
        serde_json::from_str(&json).map_err(|e| format!("Invalid JSON: {}", e))?;

    if imported.len() > 1000 {
        return Err("Import limit is 1,000 snippets".to_string());
    }

    let mut settings = settings::get_settings(&app);
    let existing_triggers: std::collections::HashSet<String> = settings
        .snippets
        .iter()
        .map(|s| s.trigger.to_lowercase())
        .collect();

    let mut added = 0;
    for snippet in imported {
        if snippet.trigger.is_empty() || snippet.expansion.is_empty() {
            continue;
        }
        if snippet.trigger.len() > 60 || snippet.expansion.len() > 4000 {
            continue;
        }
        if existing_triggers.contains(&snippet.trigger.to_lowercase()) {
            continue;
        }
        settings.snippets.push(snippet);
        added += 1;
    }

    settings::write_settings(&app, settings);
    Ok(added)
}

#[tauri::command]
#[specta::specta]
pub fn export_snippets(app: AppHandle) -> Result<String, String> {
    let settings = settings::get_settings(&app);
    serde_json::to_string_pretty(&settings.snippets)
        .map_err(|e| format!("Failed to serialize snippets: {}", e))
}
