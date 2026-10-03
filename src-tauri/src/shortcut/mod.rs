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
use tauri::{AppHandle, Manager};

use crate::settings::{self, get_settings, KeyboardImplementation, ShortcutBinding};

/// Shortcuts that exist only while post-processing is enabled.
const POST_PROCESS_BINDING_IDS: [&str; 2] = ["transcribe_with_post_process", "rewrite_selection"];

pub(crate) fn pin_binding_enabled(id: &str, settings: &settings::AppSettings) -> bool {
    !crate::pinned_target::BINDING_IDS.contains(&id)
        || (crate::pinned_target::AVAILABLE && settings.pinned_paste_enabled)
}

pub fn set_pin_shortcuts_registered(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let bindings = settings::get_bindings(app);
    let mut errors = Vec::new();
    for id in crate::pinned_target::BINDING_IDS {
        if let Some(binding) = bindings.get(id).cloned() {
            let result = if enabled && crate::pinned_target::AVAILABLE {
                register_shortcut(app, binding)
            } else {
                unregister_shortcut(app, binding)
            };
            if let Err(error) = result {
                errors.push(error);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

pub(crate) fn is_post_process_binding(id: &str) -> bool {
    POST_PROCESS_BINDING_IDS.contains(&id)
}

/// Register the post-processing shortcuts when post-processing turns on and
/// release them when it turns off.
pub fn set_post_process_shortcuts_registered(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let bindings = settings::get_bindings(app);
    let mut first_error = None;
    for id in POST_PROCESS_BINDING_IDS {
        let Some(binding) = bindings.get(id).cloned() else {
            continue;
        };
        let result = if enabled {
            register_shortcut(app, binding)
        } else {
            unregister_shortcut(app, binding)
        };
        if let Err(error) = result {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Initialize shortcuts using the configured implementation
pub fn init_shortcuts(app: &AppHandle) {
    let user_settings = settings::load_or_create_app_settings(app);

    match user_settings.keyboard_implementation {
        KeyboardImplementation::Tauri => {
            let reset_bindings =
                register_all_shortcuts_for_implementation(app, KeyboardImplementation::Tauri);
            if !reset_bindings.is_empty() {
                warn!("Reset invalid Tauri shortcuts: {:?}", reset_bindings);
            }
        }
        KeyboardImplementation::HandyKeys => {
            if let Err(e) = handy_keys::init_shortcuts(app) {
                error!("Failed to initialize handy-keys shortcuts: {}", e);
                // Fall back to Tauri implementation and persist this fallback
                warn!("Falling back to Tauri global shortcut implementation and saving fallback to settings");

                // Update settings to persist the fallback so we don't retry HandyKeys on next launch
                settings::update(app, |settings| {
                    settings.keyboard_implementation = KeyboardImplementation::Tauri
                });

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
    if !pin_binding_enabled(&binding.id, &settings) {
        return Ok(());
    }
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
    pub success: bool,
    pub binding: Option<ShortcutBinding>,
    pub error: Option<String>,
}

impl BindingResponse {
    fn saved(binding: ShortcutBinding) -> Self {
        Self {
            success: true,
            binding: Some(binding),
            error: None,
        }
    }

    fn failed(error: String) -> Self {
        Self {
            success: false,
            binding: None,
            error: Some(error),
        }
    }
}

/// Assign a new key combination to a shortcut. The previous combination stays
/// registered unless the new one is valid and registers successfully.
#[tauri::command]
#[specta::specta]
pub fn change_binding(
    app: AppHandle,
    id: String,
    binding: String,
) -> Result<BindingResponse, String> {
    if binding.trim().is_empty() {
        return Err("Binding cannot be empty".to_string());
    }

    let current = settings::get_settings(&app);
    let Some(previous) = current
        .bindings
        .get(&id)
        .cloned()
        .or_else(|| settings::get_default_settings().bindings.get(&id).cloned())
    else {
        return Ok(BindingResponse::failed(format!(
            "Binding with id '{id}' not found in defaults"
        )));
    };
    let mut updated = previous.clone();
    updated.current_binding = binding;

    // The cancel shortcut is registered only while recording, so it is
    // persisted without touching the live registration.
    if id != "cancel" {
        validate_shortcut_for_implementation(
            &updated.current_binding,
            current.keyboard_implementation,
        )?;
        if let Err(error) = unregister_shortcut(&app, previous.clone()) {
            // A binding suspended for editing is already unregistered.
            info!("Shortcut '{id}' was not registered before rebinding: {error}");
        }
        if let Err(error) = register_shortcut(&app, updated.clone()) {
            if let Err(restore_error) = register_shortcut(&app, previous) {
                error!("Failed to restore shortcut '{id}': {restore_error}");
            }
            return Ok(BindingResponse::failed(format!(
                "Failed to register shortcut: {error}"
            )));
        }
    }

    settings::update(&app, |settings| {
        settings.bindings.insert(id, updated.clone());
    });
    Ok(BindingResponse::saved(updated))
}

#[tauri::command]
#[specta::specta]
pub fn reset_binding(app: AppHandle, id: String) -> Result<BindingResponse, String> {
    let binding = settings::get_stored_binding(&app, &id)
        .or_else(|| settings::get_default_settings().bindings.get(&id).cloned())
        .ok_or_else(|| format!("Shortcut binding '{id}' was not found"))?;
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
pub fn change_keyboard_implementation(
    app: AppHandle,
    implementation: KeyboardImplementation,
) -> Result<ImplementationChangeResult, String> {
    let current_impl = settings::get_settings(&app).keyboard_implementation;
    if current_impl == implementation {
        return Ok(ImplementationChangeResult {
            success: true,
            reset_bindings: vec![],
        });
    }

    info!(
        "Switching keyboard implementation from {:?} to {:?}",
        current_impl, implementation
    );

    unregister_all_shortcuts(&app, current_impl);
    settings::update(&app, |settings| {
        settings.keyboard_implementation = implementation
    });

    // HandyKeys registers every shortcut while it initializes.
    if implementation == KeyboardImplementation::HandyKeys
        && initialize_handy_keys_with_rollback(&app)?
    {
        return Ok(ImplementationChangeResult {
            success: true,
            reset_bindings: vec![],
        });
    }

    let reset_bindings = register_all_shortcuts_for_implementation(&app, implementation);
    info!("Keyboard implementation switched to {:?}", implementation);

    Ok(ImplementationChangeResult {
        success: true,
        reset_bindings,
    })
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
    let current_settings = settings::get_settings(app);

    for (id, default_binding) in &default_bindings {
        // Skip cancel shortcut as it's dynamically registered
        if id == "cancel" {
            continue;
        }

        if is_post_process_binding(id) && !current_settings.post_process_enabled {
            continue;
        }
        if !pin_binding_enabled(id, &current_settings) {
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

            binding.current_binding = default_binding.current_binding.clone();
            reset_bindings.push(binding.clone());
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

    if !reset_bindings.is_empty() {
        settings::update(app, |settings| {
            for binding in &reset_bindings {
                settings
                    .bindings
                    .insert(binding.id.clone(), binding.clone());
            }
        });
    }

    reset_bindings
        .into_iter()
        .map(|binding| binding.id)
        .collect()
}

/// Initialize HandyKeys if not already initialized, with rollback on failure
fn initialize_handy_keys_with_rollback(app: &AppHandle) -> Result<bool, String> {
    if app.try_state::<handy_keys::HandyKeysState>().is_some() {
        return Ok(false); // Already initialized, caller should continue
    }

    if let Err(e) = handy_keys::init_shortcuts(app) {
        error!("Failed to initialize HandyKeys: {}", e);
        settings::update(app, |settings| {
            settings.keyboard_implementation = KeyboardImplementation::Tauri
        });

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
