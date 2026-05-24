//! Shortcut action handlers and the post-processing/translation/TTS pipelines
//! they orchestrate.
//!
//! Submodules:
//! - [`active_app`]   — frontmost-app capture and write-rule resolution.
//! - [`prompt`]       — prompt construction (Apple Intelligence + tone).
//! - [`route`]        — post-process routing/gating decisions.
//! - [`sanitize`]     — output sanitization, JSON parsing, paste-gate heuristics.
//! - [`post_process`] — the LLM post-process pipeline (Apple AI + remote/local).

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::correction_tracker::recent_input::RecentInputTracker;
use crate::correction_tracker::span::InsertionMethod;
use crate::correction_tracker::store::CorrectionStore;
use crate::correction_tracker::InsertedSpanTracker;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::{HistoryManager, TranslationHistoryContext};
use crate::managers::notes::NotesManager;
use crate::managers::transcription::TranscriptionManager;
use crate::post_processing::{
    apply_personal_dictionary, PostProcessPreviewPayload, PostProcessResult, PreviewManager,
};
use crate::screen_context::{
    packet_age_ms, summarize_packet_for_prompt, ContextCaptureManager, ContextImpactMetadata,
};
use crate::settings::{
    get_settings, post_process_provider_is_local, AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use crate::shortcut;
use crate::snippets::apply_snippets;
use crate::translation::{
    destination_label_for_dictation, dictation_requires_preview, normalize_language_code,
    selection_destination_label, selection_requires_preview, should_open_jot_pad_for_dictation,
    should_open_jot_pad_for_selection, translate_text, TranslationExecution, TranslationOrigin,
};
use crate::tray::{change_tray_icon, TrayIconState};
use crate::tts::{
    build_auto_speak_plan, choose_readback_locale, normalize_locale, SpeakRequest,
    TtsHistoryContext, TtsManager,
};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::write_rules::apply_resolved_rule_to_settings;
use crate::TranscriptionCoordinator;
use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

mod active_app;
mod post_process;
mod prompt;
mod route;
mod sanitize;

pub(crate) use post_process::{
    maybe_convert_chinese_variant, post_process_transcription, preview_post_process,
};
pub use route::{analyze_post_process_route, PostProcessRouteDebug};
pub(crate) use sanitize::{
    extract_spoken_submit_command, should_block_paste_candidate,
    should_fallback_to_plain_text_candidate,
};

fn schedule_correction_monitoring_after_paste(
    app_handle: AppHandle,
    inserted_text: String,
    app_identifier: Option<String>,
    app_name: Option<String>,
    insertion_method: InsertionMethod,
) {
    tauri::async_runtime::spawn(async move {
        // Let the destination app settle after paste/direct typing before
        // taking the first Accessibility snapshot. This runs after paste and
        // off the main thread, so it does not add paste latency.
        tokio::time::sleep(Duration::from_millis(75)).await;

        let Some(span_tracker) = app_handle.try_state::<InsertedSpanTracker>() else {
            debug!("Correction monitoring skipped: InsertedSpanTracker state is unavailable");
            return;
        };
        let Some(correction_store) = app_handle.try_state::<Arc<CorrectionStore>>() else {
            debug!("Correction monitoring skipped: CorrectionStore state is unavailable");
            return;
        };
        let Some(recent_input) = app_handle.try_state::<Arc<RecentInputTracker>>() else {
            debug!("Correction monitoring skipped: RecentInputTracker state is unavailable");
            return;
        };

        span_tracker.record_and_start_monitoring(
            inserted_text,
            app_identifier,
            app_name,
            insertion_method,
            (*correction_store).clone(),
            (*recent_input).clone(),
            app_handle.clone(),
        );
    });
}

use active_app::*;
#[cfg(test)]
use post_process::*;
use prompt::*;
#[cfg(test)]
use route::*;
use sanitize::*;

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes — whether it completes normally or panics.
struct FinishGuard(AppHandle);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
    }
}

fn dictation_run_cancelled(
    manager: &Arc<TranscriptionManager>,
    generation: u64,
    stage: &str,
) -> bool {
    if manager.is_processing_cancelled(generation) {
        debug!(
            "Skipping dictation pipeline step '{}' because processing run {} was cancelled",
            stage, generation
        );
        true
    } else {
        false
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
    rewrite_selection: bool,
}

struct TranslateSelectionAction;
struct SpeakSelectionAction;
struct SpeakLastOutputAction;
struct StopSpeakingAction;
struct ToggleCommandPaletteAction;

const HISTORY_FIELD_OBSERVATION_WINDOW_SECS: u64 = 30;
const HISTORY_FIELD_OBSERVATION_POLL_INTERVAL_MS: u64 = 500;

async fn rewrite_selected_text(
    settings: &AppSettings,
    selected_text: &str,
    instruction: &str,
) -> Option<String> {
    let provider = settings.active_post_process_provider()?.clone();
    if settings.local_privacy_mode && !post_process_provider_is_local(&provider) {
        warn!(
            "Local privacy mode blocked non-local provider '{}' for rewrite-selection",
            provider.id
        );
        return None;
    }

    let user_prompt = format!(
        "Rewrite the selected text based on the spoken instructions. Return only the rewritten text.\n\nSpoken instructions:\n{}\n\nSelected text:\n{}",
        instruction.trim(),
        selected_text
    );

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        let system_prompt = "You are a local writing assistant. Rewrite the provided text based on spoken instructions while preserving factual meaning. Return only the rewritten text with no explanations.";

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return match apple_intelligence::process_text_with_system_prompt(
                system_prompt,
                &user_prompt,
                0,
            ) {
                Ok(output) => Some(strip_invisible_chars(&output)),
                Err(err) => {
                    error!("Apple Intelligence rewrite-selection failed: {}", err);
                    None
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return None;
        }
    }

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        return None;
    }

    let api_key = crate::secret_store::get_post_process_api_key(&provider.id)
        .unwrap_or_else(|error| {
            warn!(
                "Failed to load secure rewrite API key for provider '{}': {}",
                provider.id, error
            );
            None
        })
        .unwrap_or_default();

    crate::llm_client::send_chat_completion(&provider, api_key, &model, user_prompt)
        .await
        .ok()
        .flatten()
        .and_then(|text| sanitize_plain_model_output(&text))
}

async fn run_translate_selection(app: AppHandle) {
    let settings = get_settings(&app);
    let selected_text = match utils::capture_selected_text(&app) {
        Ok(Some(text)) => text,
        Ok(None) => {
            let _ = app.emit(
                "translation-error",
                "No selected text was available to translate.".to_string(),
            );
            return;
        }
        Err(err) => {
            let message = format!("Failed to capture selected text: {err}");
            error!("{message}");
            let _ = app.emit("translation-error", message);
            return;
        }
    };

    let mut execution = match translate_text(
        &settings,
        &selected_text,
        normalize_language_code(Some(&settings.selected_language)).as_deref(),
        TranslationOrigin::Selection,
    )
    .await
    {
        Ok(result) => result,
        Err(err) => {
            error!("Selection translation failed: {}", err);
            let _ = app.emit("translation-error", err);
            return;
        }
    };

    let destination_label =
        selection_destination_label(settings.selection_translation_destination_mode);
    let needs_preview = selection_requires_preview(&settings, &selected_text);
    if needs_preview {
        match maybe_preview_translation_result(
            &app,
            &execution.source_text,
            execution.translated_text.as_deref(),
            &execution.final_text,
            destination_label,
            TranslationOrigin::Selection,
        )
        .await
        {
            Some(updated_text) => execution.final_text = updated_text,
            None => return,
        }
    }

    let readback_locale = choose_readback_locale(
        &settings,
        TranslationOrigin::Selection,
        execution.source_language_detected.as_deref(),
        execution.target_language.as_deref(),
    );
    remember_last_output(&app, &execution.final_text, readback_locale.clone());

    let mut routed_to_jot_pad = false;
    if should_open_jot_pad_for_selection(&settings, false) {
        send_translation_to_jot_pad(&app, &execution, destination_label);
        routed_to_jot_pad = true;
    } else {
        if let Err(err) = utils::paste(execution.final_text.clone(), app.clone()) {
            warn!("Failed to replace selected text with translation: {}", err);
            send_translation_to_jot_pad(&app, &execution, destination_label);
            routed_to_jot_pad = true;
        }
    }

    let auto_speak_plan = build_auto_speak_plan(
        &settings,
        TranslationOrigin::Selection,
        needs_preview,
        &execution.final_text,
        execution.translated_text.as_deref(),
        readback_locale.clone(),
    );

    if let Some(history_manager) = app.try_state::<Arc<HistoryManager>>() {
        match history_manager
            .save_transcription(
                Arc::new(Vec::new()),
                selected_text.clone(),
                Some(execution.final_text.clone()),
                None,
                Vec::new(),
                if routed_to_jot_pad {
                    None
                } else {
                    Some(execution.final_text.clone())
                },
                TranslationHistoryContext {
                    source_language_detected: execution.source_language_detected.clone(),
                    translation_target_language: execution.target_language.clone(),
                    translated_text: execution.translated_text.clone(),
                    translation_route: Some(translation_route_label(execution.route).to_string()),
                    translation_provider_id: execution.provider_id.clone(),
                    translation_model_id: execution.model_id.clone(),
                    translation_origin: Some("selection".to_string()),
                    translation_destination: Some(if routed_to_jot_pad {
                        "open_in_jot_pad".to_string()
                    } else {
                        destination_label.to_string()
                    }),
                },
                tts_history_context_from_plan(&auto_speak_plan),
                None,
                None,
            )
            .await
        {
            Ok(history_id) => {
                if auto_speak_plan.should_speak {
                    spawn_tts_playback(
                        &app,
                        SpeakRequest {
                            text: auto_speak_plan.text.clone(),
                            locale: auto_speak_plan.locale.clone(),
                            preferred_voice_id: None,
                            preset_id: None,
                            inline_preset: None,
                            trigger: Some(auto_speak_plan.trigger.clone()),
                            remember_last_output: false,
                        },
                        Some(history_id),
                    );
                }
            }
            Err(err) => {
                error!("Failed to save selection translation history: {}", err);
                if auto_speak_plan.should_speak {
                    spawn_tts_playback(
                        &app,
                        SpeakRequest {
                            text: auto_speak_plan.text,
                            locale: auto_speak_plan.locale,
                            preferred_voice_id: None,
                            preset_id: None,
                            inline_preset: None,
                            trigger: Some(auto_speak_plan.trigger),
                            remember_last_output: false,
                        },
                        None,
                    );
                }
            }
        }
    } else if auto_speak_plan.should_speak {
        spawn_tts_playback(
            &app,
            SpeakRequest {
                text: auto_speak_plan.text,
                locale: auto_speak_plan.locale,
                preferred_voice_id: None,
                preset_id: None,
                inline_preset: None,
                trigger: Some(auto_speak_plan.trigger),
                remember_last_output: false,
            },
            None,
        );
    }
}

async fn maybe_preview_post_process_result(
    app: &AppHandle,
    settings: &AppSettings,
    result: &PostProcessResult,
) -> Option<String> {
    if !settings.show_preview_before_paste {
        return Some(result.final_text.clone());
    }

    let preview_manager = app.state::<PreviewManager>();
    let (request_id, rx) = preview_manager.create_request();
    let payload = PostProcessPreviewPayload {
        request_id: request_id.clone(),
        source_text: result.normalized_text.clone(),
        preview_text: result.final_text.clone(),
        translated_text: None,
        destination_label: None,
        origin: Some("post_process".to_string()),
    };

    crate::show_main_window(app);
    if let Err(err) = app.emit("post-process-preview-request", payload) {
        error!("Failed to emit post-process preview request: {}", err);
        preview_manager.clear_request(&request_id);
        return Some(result.final_text.clone());
    }

    match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(resolution)) => {
            if resolution.accepted {
                Some(
                    resolution
                        .final_text
                        .unwrap_or_else(|| result.final_text.clone()),
                )
            } else {
                None
            }
        }
        Ok(Err(_)) => {
            warn!("Preview request '{}' closed before resolution", request_id);
            None
        }
        Err(_) => {
            warn!("Preview request '{}' timed out", request_id);
            preview_manager.clear_request(&request_id);
            None
        }
    }
}

async fn maybe_preview_translation_result(
    app: &AppHandle,
    source_text: &str,
    translated_text: Option<&str>,
    preview_text: &str,
    destination_label: &str,
    origin: TranslationOrigin,
) -> Option<String> {
    let preview_manager = app.state::<PreviewManager>();
    let (request_id, rx) = preview_manager.create_request();
    let payload = PostProcessPreviewPayload {
        request_id: request_id.clone(),
        source_text: source_text.to_string(),
        preview_text: preview_text.to_string(),
        translated_text: translated_text.map(|value| value.to_string()),
        destination_label: Some(destination_label.to_string()),
        origin: Some(
            match origin {
                TranslationOrigin::Dictation => "translation_dictation",
                TranslationOrigin::Selection => "translation_selection",
            }
            .to_string(),
        ),
    };

    crate::show_main_window(app);
    if let Err(err) = app.emit("post-process-preview-request", payload) {
        error!("Failed to emit translation preview request: {}", err);
        preview_manager.clear_request(&request_id);
        return Some(preview_text.to_string());
    }

    match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(resolution)) => {
            if resolution.accepted {
                Some(
                    resolution
                        .final_text
                        .unwrap_or_else(|| preview_text.to_string()),
                )
            } else {
                None
            }
        }
        Ok(Err(_)) => {
            warn!(
                "Translation preview request '{}' closed before resolution",
                request_id
            );
            None
        }
        Err(_) => {
            warn!("Translation preview request '{}' timed out", request_id);
            preview_manager.clear_request(&request_id);
            None
        }
    }
}

fn build_translation_note(
    execution: &TranslationExecution,
    destination_label: &str,
) -> (String, String) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %I:%M %p").to_string();
    let target = execution
        .target_language
        .clone()
        .unwrap_or_else(|| "translated".to_string());
    let title = format!("Translation {timestamp}");
    let content = format!(
        "Origin: {}\nDestination: {}\nSource language: {}\nTarget language: {}\n\nSource:\n{}\n\nTranslated:\n{}",
        match execution.origin {
            TranslationOrigin::Dictation => "dictation",
            TranslationOrigin::Selection => "selection",
        },
        destination_label,
        execution
            .source_language_detected
            .clone()
            .unwrap_or_else(|| "auto".to_string()),
        target,
        execution.source_text,
        execution.final_text
    );
    (title, content)
}

fn send_translation_to_jot_pad(
    app: &AppHandle,
    execution: &TranslationExecution,
    destination_label: &str,
) {
    if let Some(notes_manager) = app.try_state::<Arc<NotesManager>>() {
        let (title, content) = build_translation_note(execution, destination_label);
        if let Err(err) = notes_manager.create_note(&title, &content) {
            error!("Failed to create translation note: {}", err);
        }
    }

    crate::scratchpad::show_scratchpad(app);
}

fn remember_last_output(app: &AppHandle, text: &str, locale: Option<String>) {
    if let Some(tts_manager) = app.try_state::<Arc<TtsManager>>() {
        tts_manager.set_last_output(text.to_string(), locale);
    }
}

fn tts_history_context_from_plan(plan: &crate::tts::TtsAutoSpeakPlan) -> TtsHistoryContext {
    TtsHistoryContext {
        tts_requested: Some(plan.tts_requested),
        tts_engine: plan.tts_engine.clone(),
        tts_voice_id: plan.tts_voice_id.clone(),
        tts_locale: plan.tts_locale.clone(),
        tts_trigger: Some(plan.trigger.clone()),
        tts_status: plan.tts_status.clone(),
    }
}

#[derive(Clone)]
struct DeferredHistorySave {
    audio_samples: Arc<Vec<f32>>,
    transcription_text: String,
    post_processed_text: Option<String>,
    post_process_prompt: Option<String>,
    dictionary_hits: Vec<String>,
    pasted_text: Option<String>,
    translation_context: TranslationHistoryContext,
    tts_context: TtsHistoryContext,
    screen_context_metadata: Option<crate::managers::history::ScreenContextHistoryMetadata>,
    field_snapshot_app_id: Option<String>,
}

fn spawn_history_save(
    app: &AppHandle,
    history_manager: Arc<HistoryManager>,
    request: DeferredHistorySave,
) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let pasted_text = request.pasted_text.clone();
        let field_snapshot_app_id = request.field_snapshot_app_id.clone();

        let duration_ms = if request.audio_samples.is_empty() {
            None
        } else {
            Some(
                (request.audio_samples.len() as i64 * 1000)
                    / crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE as i64,
            )
        };

        match history_manager
            .save_transcription(
                request.audio_samples,
                request.transcription_text,
                request.post_processed_text,
                request.post_process_prompt,
                request.dictionary_hits,
                request.pasted_text,
                request.translation_context,
                request.tts_context,
                request.screen_context_metadata,
                duration_ms,
            )
            .await
        {
            Ok(history_entry_id) => {
                info!("Saved transcription to history (id={})", history_entry_id);

                if pasted_text.is_some() {
                    if let Err(err) = history_manager.mark_field_snapshot_pending(history_entry_id)
                    {
                        warn!("Failed to mark field snapshot pending: {}", err);
                    }

                    let app_for_snapshot = app_handle.clone();
                    let history_manager = Arc::clone(&history_manager);
                    tauri::async_runtime::spawn(async move {
                        match crate::correction_tracker::observe_field_snapshot(
                            field_snapshot_app_id,
                            HISTORY_FIELD_OBSERVATION_WINDOW_SECS,
                            Duration::from_millis(HISTORY_FIELD_OBSERVATION_POLL_INTERVAL_MS),
                        )
                        .await
                        {
                            crate::correction_tracker::FieldObservationOutcome::Captured {
                                snapshot_text,
                            } => {
                                if let Err(err) =
                                    history_manager.update_field_snapshot(history_entry_id, snapshot_text)
                                {
                                    warn!("Failed to save field snapshot: {}", err);
                                }
                            }
                            crate::correction_tracker::FieldObservationOutcome::SkippedFocusChanged {
                                snapshot_text,
                            } => {
                                if let Err(err) = history_manager
                                    .update_field_snapshot_skipped(history_entry_id, snapshot_text)
                                {
                                    warn!("Failed to save skipped field snapshot: {}", err);
                                }
                            }
                            crate::correction_tracker::FieldObservationOutcome::SkippedUnreadable {
                                snapshot_text,
                                reason,
                            } => {
                                debug!(
                                    "Skipping field snapshot for history entry {}: {}",
                                    history_entry_id, reason
                                );
                                if let Err(err) = history_manager
                                    .update_field_snapshot_skipped(history_entry_id, snapshot_text)
                                {
                                    warn!(
                                        "Failed to save unreadable field snapshot as skipped: {}",
                                        err
                                    );
                                }
                            }
                            crate::correction_tracker::FieldObservationOutcome::Failed {
                                error_message,
                            } => {
                                if let Err(err) = history_manager
                                    .update_field_snapshot_failure(
                                        history_entry_id,
                                        error_message.clone(),
                                    )
                                {
                                    warn!("Failed to save field snapshot failure: {}", err);
                                }
                                let _ = app_for_snapshot.emit("field-snapshot-failed", error_message);
                            }
                        }
                    });
                }
            }
            Err(err) => {
                error!("Failed to save transcription to history: {}", err);
                let _ = app_handle.emit("history-save-failed", err.to_string());
            }
        }
    });
}

fn spawn_tts_playback(app: &AppHandle, request: SpeakRequest, history_entry_id: Option<i64>) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = if let Some(tts_manager) = app_handle.try_state::<Arc<TtsManager>>() {
            tts_manager.speak(request).await
        } else {
            Err("TTS manager is unavailable.".to_string())
        };

        if let Some(history_entry_id) = history_entry_id {
            if let Some(history_manager) = app_handle.try_state::<Arc<HistoryManager>>() {
                let status = if result.is_ok() { "played" } else { "failed" };
                if let Err(err) = history_manager.update_tts_status(history_entry_id, status) {
                    error!("Failed to update TTS history status: {}", err);
                }
            }
        }

        if let Err(err) = result {
            error!("Speech output failed: {}", err);
            let _ = app_handle.emit("tts-error", err);
        }
    });
}

pub(crate) async fn run_speak_selection(app: AppHandle) {
    let selected_text = match utils::capture_selected_text(&app) {
        Ok(Some(text)) => text,
        Ok(None) => {
            let _ = app.emit(
                "tts-error",
                "No selected text was available to speak.".to_string(),
            );
            return;
        }
        Err(err) => {
            let message = format!("Failed to capture selected text: {err}");
            let _ = app.emit("tts-error", message);
            return;
        }
    };

    let locale = normalize_locale(Some(&get_settings(&app).selected_language));
    let request = SpeakRequest {
        text: selected_text,
        locale,
        preferred_voice_id: None,
        preset_id: None,
        inline_preset: None,
        trigger: Some("speak_selection".to_string()),
        remember_last_output: false,
    };
    spawn_tts_playback(&app, request, None);
}

async fn run_speak_last_output(app: AppHandle) {
    let Some(tts_manager) = app.try_state::<Arc<TtsManager>>() else {
        let _ = app.emit("tts-error", "TTS manager is unavailable.".to_string());
        return;
    };

    match tts_manager.speak_last_output_request() {
        Ok(request) => spawn_tts_playback(&app, request, None),
        Err(err) => {
            let _ = app.emit("tts-error", err);
        }
    }
}

fn translation_route_label(route: crate::translation::TranslationRoute) -> &'static str {
    match route {
        crate::translation::TranslationRoute::None => "none",
        crate::translation::TranslationRoute::WhisperEnglish => "whisper_english",
        crate::translation::TranslationRoute::OfflinePack => "offline_pack",
        crate::translation::TranslationRoute::LocalAi => "local_ai",
        crate::translation::TranslationRoute::RemoteAi => "remote_ai",
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        let settings = get_settings(app);
        if (self.post_process || self.rewrite_selection) && !settings.post_process_enabled {
            debug!(
                "Ignoring post-process binding '{}' because post-processing is disabled",
                binding_id
            );
            return;
        }

        if settings.tts_stop_on_record {
            if let Some(tts_manager) = app.try_state::<Arc<TtsManager>>() {
                tts_manager.stop();
            }
        }

        // Load after recording starts so rule URL capture cannot add start latency.
        let tm = app.state::<Arc<TranscriptionManager>>();
        crate::scratchpad::snapshot_pending_insert_target(app);
        if let Some(context_manager) = app.try_state::<Arc<ContextCaptureManager>>() {
            context_manager.request_immediate_capture("dictation_start");
        }

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Get the microphone mode to determine audio feedback timing
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_error: Option<String> = None;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            if let Err(e) = rm.try_start_recording(&binding_id) {
                debug!("Recording failed: {}", e);
                recording_error = Some(e);
            }
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            match rm.try_start_recording(&binding_id) {
                Ok(()) => {
                    let recording_start_elapsed = recording_start_time.elapsed();
                    crate::product_architecture::record_dictation_latency(
                        "recording_start",
                        recording_start_elapsed,
                    );
                    debug!("Recording started in {:?}", recording_start_elapsed);
                    // Small delay to ensure microphone stream is active
                    let app_clone = app.clone();
                    let rm_clone = Arc::clone(&rm);
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        debug!("Handling delayed audio feedback/mute sequence");
                        // Helper handles disabled audio feedback by returning early, so we reuse it
                        // to keep mute sequencing consistent in every mode.
                        play_feedback_sound_blocking(&app_clone, SoundType::Start);
                        rm_clone.apply_mute();
                    });
                }
                Err(e) => {
                    debug!("Failed to start recording: {}", e);
                    recording_error = Some(e);
                }
            }
        }

        if recording_error.is_none() {
            let prepared_context = capture_prepared_write_context(app, &settings);
            let resolved_rule = resolve_active_write_rule(&settings, &prepared_context);
            emit_write_rule_resolution(app, resolved_rule.as_ref());
            let effective_settings =
                apply_resolved_rule_to_settings(&settings, resolved_rule.as_ref());
            rm.set_temporary_mute_override(
                resolved_rule
                    .as_ref()
                    .and_then(|rule| rule.overrides.mute_while_recording),
            );
            tm.initiate_model_load_for_model(effective_settings.selected_model.clone());
            remember_prepared_active_app_context(&binding_id, prepared_context);
            tm.start_partial_provider(&binding_id, Arc::clone(&rm));
            // Live partial STT currently shares the same engine as the final
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        } else {
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
            tm.stop_partial_provider();
            clear_prepared_active_app_context(&binding_id);
            utils::hide_recording_overlay(app);
            change_tray_icon(app, TrayIconState::Idle);
            if let Some(err) = recording_error {
                let _ = app.emit("recording-error", err);
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());
        let context_manager = Arc::clone(&app.state::<Arc<ContextCaptureManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);
        tm.stop_partial_provider();

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let post_process = self.post_process;
        let rewrite_selection = self.rewrite_selection;
        let processing_generation = tm.begin_processing_run();

        tauri::async_runtime::spawn(async move {
            // Held in an Option so we can transfer ownership into the main-thread
            // paste closure. If the pipeline exits before scheduling a paste, the
            // guard drops here and ProcessingFinished fires. If paste is scheduled,
            // the guard drops only after paste completes on the main thread,
            // preventing a new dictation from racing the in-flight paste.
            let mut finish_guard = Some(FinishGuard(ah.clone()));
            let _scratchpad_guard = crate::scratchpad::PendingScratchpadInsertGuard::new(&ah);
            crate::overlay::emit_partial_transcription(&ah, "");
            let binding_id = binding_id.clone(); // Clone for the inner async task
            let prepared_write_context = take_prepared_active_app_context(&binding_id);
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let stop_recording_time = Instant::now();
            if let Some(samples) = rm.stop_recording(&binding_id) {
                let stop_capture_elapsed = stop_recording_time.elapsed();
                crate::product_architecture::record_dictation_latency(
                    "stop_capture",
                    stop_capture_elapsed,
                );
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_capture_elapsed,
                    samples.len()
                );

                if dictation_run_cancelled(&tm, processing_generation, "before transcription") {
                    return;
                }

                let transcription_time = Instant::now();
                // Wrap once and share via Arc so history + voice-cloning +
                // transcribe don't each pay a full Vec copy of the buffer.
                let samples = Arc::new(samples);
                let samples_for_history = Arc::clone(&samples);
                let settings = get_settings(&ah);
                let fallback_context = if prepared_write_context.active_app_context.is_some() {
                    None
                } else {
                    capture_active_app_context(&ah, &settings)
                };
                let active_app_context = prepared_write_context
                    .active_app_context
                    .clone()
                    .or(fallback_context);
                let prepared_for_resolution = PreparedActiveAppContext {
                    active_app_context: active_app_context.clone(),
                    active_url: prepared_write_context.active_url.clone(),
                };
                let resolved_rule = resolve_active_write_rule(&settings, &prepared_for_resolution);
                emit_write_rule_resolution(&ah, resolved_rule.as_ref());
                let mut effective_settings =
                    apply_resolved_rule_to_settings(&settings, resolved_rule.as_ref());
                if resolved_rule.is_none() && !settings.write_rules.is_empty() {
                    effective_settings.app_aware_tone_enabled = false;
                }
                // A rule may force post-processing on/off regardless of which
                // shortcut the user pressed. This shapes the action, not the
                // settings, so we override the local `post_process` flag.
                let post_process = resolved_rule
                    .as_ref()
                    .and_then(|rule| rule.overrides.force_post_process)
                    .unwrap_or(post_process);

                let transcription_result = {
                    let tm_for_transcription = Arc::clone(&tm);
                    let transcribe_settings = effective_settings.clone();
                    tokio::task::spawn_blocking(move || {
                        tm_for_transcription.transcribe_with_settings(samples, transcribe_settings)
                    })
                    .await
                    .unwrap_or_else(|err| {
                        Err(anyhow::anyhow!("Transcription worker failed: {}", err))
                    })
                };

                match transcription_result {
                    Ok(transcription) => {
                        let transcription_elapsed = transcription_time.elapsed();
                        crate::product_architecture::record_dictation_latency(
                            "warm_transcription",
                            transcription_elapsed,
                        );
                        debug!(
                            "Transcription completed in {:?} ({} chars)",
                            transcription_elapsed,
                            transcription.chars().count()
                        );
                        // Require at least one alphanumeric character. Whisper
                        // can hallucinate punctuation-only strings (".", "?")
                        // on silent audio or short noise — pasting those is
                        // worse than a no-op.
                        let has_meaningful_text =
                            transcription.chars().any(|c| c.is_alphanumeric());
                        if has_meaningful_text {
                            if dictation_run_cancelled(
                                &tm,
                                processing_generation,
                                "after transcription",
                            ) {
                                return;
                            }
                            let mut final_text = transcription.clone();
                            let mut post_processed_text: Option<String> = None;
                            let mut post_process_prompt: Option<String> = None;
                            let mut dictionary_hits_for_history: Vec<String> = Vec::new();
                            let mut preview_was_shown = false;

                            // First, check if Chinese variant conversion is needed
                            if let Some(converted_text) =
                                maybe_convert_chinese_variant(&effective_settings, &transcription)
                                    .await
                            {
                                final_text = converted_text;
                            }

                            if dictation_run_cancelled(
                                &tm,
                                processing_generation,
                                "after language conversion",
                            ) {
                                return;
                            }

                            // Then apply LLM post-processing if this is the post-process hotkey
                            // Uses final_text which may already have Chinese conversion applied
                            let should_post_process = post_process
                                && effective_settings.post_process_enabled
                                && !rewrite_selection;
                            // Always capture app context — needed for correction tracking
                            // and field snapshots, not just post-processing.
                            let screen_context = context_manager.resolve_context_for_dictation(
                                &effective_settings,
                                active_app_context.clone(),
                            );
                            let mut context_impact = ContextImpactMetadata::default();
                            let screen_context_summary = screen_context
                                .as_ref()
                                .map(|packet| summarize_packet_for_prompt(packet, false))
                                .filter(|summary| !summary.trim().is_empty());
                            if should_post_process {
                                show_processing_overlay(&ah);
                            }

                            // Merge auto-learned corrections into the personal dictionary
                            // and always include user-approved manual corrections
                            // from the corrections store.
                            if let Some(correction_store) = ah.try_state::<Arc<CorrectionStore>>() {
                                let merged = crate::correction_tracker::store::build_effective_personal_dictionary(
                                    &effective_settings,
                                    correction_store.as_ref(),
                                );
                                if merged != effective_settings.personal_dictionary {
                                    debug!(
                                        "Merged correction-store entries into personal dictionary"
                                    );
                                }
                                effective_settings.personal_dictionary = merged;
                            }

                            // Always apply personal dictionary (including learned corrections)
                            // before post-processing so corrections are applied even if
                            // post-processing fails or returns None.
                            if !effective_settings.personal_dictionary.is_empty() {
                                let dict_result = apply_personal_dictionary(
                                    &final_text,
                                    &effective_settings.personal_dictionary,
                                );
                                if dict_result.text != final_text {
                                    debug!(
                                        "Applied personal dictionary: {} hit(s)",
                                        dict_result.hits.len()
                                    );
                                    dictionary_hits_for_history = dict_result.hits;
                                    final_text = dict_result.text;
                                }
                            }

                            let (contextual_text, contextual_hits) =
                                apply_contextual_entity_corrections(
                                    &final_text,
                                    screen_context.as_ref(),
                                );
                            if contextual_text != final_text {
                                context_impact.dictionary_context_hits = contextual_hits.clone();
                                final_text = contextual_text;
                                dictionary_hits_for_history.extend(contextual_hits);
                            }

                            // Apply snippet expansions (after dictionary, before post-processing)
                            if effective_settings.snippets_enabled
                                && !effective_settings.snippets.is_empty()
                            {
                                let snippet_result =
                                    apply_snippets(&final_text, &effective_settings.snippets);
                                if snippet_result.text != final_text {
                                    debug!(
                                        "Applied {} snippet expansion(s)",
                                        snippet_result.hits.len()
                                    );
                                    context_impact.snippet_context_hits = effective_settings
                                        .snippets
                                        .iter()
                                        .filter(|snippet| {
                                            snippet_result.hits.contains(&snippet.trigger)
                                                && context_confirms_snippet(
                                                    &snippet.trigger,
                                                    &snippet.expansion,
                                                    screen_context.as_ref(),
                                                )
                                        })
                                        .map(|snippet| snippet.trigger.clone())
                                        .collect();
                                    final_text = snippet_result.text;
                                }
                            }

                            let source_language_hint = normalize_language_code(Some(
                                &effective_settings.selected_language,
                            ));
                            let mut translation_execution = if rewrite_selection {
                                None
                            } else {
                                if dictation_run_cancelled(
                                    &tm,
                                    processing_generation,
                                    "before translation",
                                ) {
                                    return;
                                }
                                match translate_text(
                                    &effective_settings,
                                    &final_text,
                                    source_language_hint.as_deref(),
                                    TranslationOrigin::Dictation,
                                )
                                .await
                                {
                                    Ok(execution) => Some(execution),
                                    Err(err) => {
                                        warn!("Translation failed: {}", err);
                                        let _ = ah.emit("translation-error", err.clone());
                                        None
                                    }
                                }
                            };

                            if dictation_run_cancelled(
                                &tm,
                                processing_generation,
                                "after translation",
                            ) {
                                return;
                            }

                            if let Some(execution) = translation_execution.as_ref() {
                                if execution.translated_text.is_some() {
                                    final_text = execution.final_text.clone();
                                }
                            }

                            let safe_plain_text_fallback = translation_execution
                                .as_ref()
                                .and_then(|execution| {
                                    execution
                                        .translated_text
                                        .as_ref()
                                        .map(|_| execution.final_text.clone())
                                })
                                .unwrap_or_else(|| final_text.clone());

                            let mut text_to_paste = Some(final_text.clone());
                            let post_process_input = translation_execution
                                .as_ref()
                                .and_then(|execution| execution.translated_text.clone())
                                .unwrap_or_else(|| final_text.clone());

                            let processed = if should_post_process {
                                if dictation_run_cancelled(
                                    &tm,
                                    processing_generation,
                                    "before post-processing",
                                ) {
                                    return;
                                }
                                post_process_transcription(
                                    &effective_settings,
                                    &post_process_input,
                                    screen_context.clone(),
                                    Some(context_impact.clone()),
                                    active_app_context.clone(),
                                    Some(&ah),
                                )
                                .await
                            } else {
                                None
                            };
                            if dictation_run_cancelled(
                                &tm,
                                processing_generation,
                                "after post-processing",
                            ) {
                                return;
                            }
                            if let Some(processed) = processed {
                                if let Some(impact) = processed.result.context_impact.clone() {
                                    context_impact = impact;
                                }
                                if should_post_process
                                    && effective_settings.show_preview_before_paste
                                {
                                    preview_was_shown = true;
                                }
                                let preview_text = if should_post_process {
                                    if dictation_run_cancelled(
                                        &tm,
                                        processing_generation,
                                        "before post-process preview",
                                    ) {
                                        return;
                                    }
                                    maybe_preview_post_process_result(
                                        &ah,
                                        &effective_settings,
                                        &processed.result,
                                    )
                                    .await
                                } else {
                                    Some(processed.result.final_text.clone())
                                };

                                if dictation_run_cancelled(
                                    &tm,
                                    processing_generation,
                                    "after post-process preview",
                                ) {
                                    return;
                                }

                                if let Some(preview_text) = preview_text {
                                    if let Some(execution) = translation_execution.as_mut() {
                                        execution.translated_text = Some(preview_text.clone());
                                        execution.final_text = match effective_settings.translation_output_mode {
                                            crate::settings::TranslationOutputMode::Bilingual => {
                                                if effective_settings.translation_bilingual_layout
                                                    == crate::settings::TranslationBilingualLayout::TranslationThenSource
                                                {
                                                    format!(
                                                        "{}\n\n{}",
                                                        preview_text, execution.source_text
                                                    )
                                                } else {
                                                    format!(
                                                        "{}\n\n{}",
                                                        execution.source_text, preview_text
                                                    )
                                                }
                                            }
                                            _ => preview_text.clone(),
                                        };
                                        final_text = execution.final_text.clone();
                                    } else {
                                        final_text = preview_text;
                                    }
                                    text_to_paste = Some(final_text.clone());
                                } else {
                                    text_to_paste = None;
                                    final_text = processed.result.final_text.clone();
                                }

                                post_processed_text = Some(final_text.clone());
                                post_process_prompt = processed.prompt_used;
                                if !processed.result.dictionary_hits.is_empty() {
                                    dictionary_hits_for_history = processed.result.dictionary_hits;
                                }
                            } else if final_text != transcription {
                                post_processed_text = Some(final_text.clone());
                            }

                            context_impact.context_changed_output = final_text != transcription;

                            if !rewrite_selection {
                                if let Some(execution) = translation_execution.as_mut() {
                                    let destination_label =
                                        destination_label_for_dictation(&effective_settings);
                                    let should_preview_translation =
                                        execution.translated_text.is_some()
                                            && dictation_requires_preview(
                                                &effective_settings,
                                                &execution.final_text,
                                            )
                                            && !(should_post_process
                                                && effective_settings.show_preview_before_paste);

                                    if should_preview_translation {
                                        preview_was_shown = true;
                                        if dictation_run_cancelled(
                                            &tm,
                                            processing_generation,
                                            "before translation preview",
                                        ) {
                                            return;
                                        }
                                        match maybe_preview_translation_result(
                                            &ah,
                                            &execution.source_text,
                                            execution.translated_text.as_deref(),
                                            &execution.final_text,
                                            destination_label,
                                            TranslationOrigin::Dictation,
                                        )
                                        .await
                                        {
                                            Some(updated_text) => {
                                                execution.final_text = updated_text.clone();
                                                final_text = updated_text.clone();
                                                text_to_paste = Some(updated_text);
                                            }
                                            None => {
                                                text_to_paste = None;
                                            }
                                        }
                                        if dictation_run_cancelled(
                                            &tm,
                                            processing_generation,
                                            "after translation preview",
                                        ) {
                                            return;
                                        }
                                    }
                                }
                            }

                            if rewrite_selection {
                                if dictation_run_cancelled(
                                    &tm,
                                    processing_generation,
                                    "before selection rewrite",
                                ) {
                                    return;
                                }
                                match utils::capture_selected_text(&ah) {
                                    Ok(Some(selected_text)) => {
                                        if let Some(rewritten) = rewrite_selected_text(
                                            &effective_settings,
                                            &selected_text,
                                            &final_text,
                                        )
                                        .await
                                        {
                                            final_text = rewritten;
                                            post_processed_text = Some(final_text.clone());
                                        } else {
                                            warn!(
                                                "Rewrite-selection failed; keeping selected text unchanged"
                                            );
                                            text_to_paste = None;
                                        }
                                    }
                                    Ok(None) => {
                                        warn!(
                                            "Rewrite-selection shortcut used without selected text"
                                        );
                                        text_to_paste = None;
                                    }
                                    Err(err) => {
                                        error!("Failed to capture selected text: {}", err);
                                        text_to_paste = None;
                                    }
                                }
                                if dictation_run_cancelled(
                                    &tm,
                                    processing_generation,
                                    "after selection rewrite",
                                ) {
                                    return;
                                }
                            }

                            let mut routed_to_jot_pad = false;
                            if !rewrite_selection {
                                if let Some(execution) = translation_execution.as_ref() {
                                    if execution.translated_text.is_some()
                                        && should_open_jot_pad_for_dictation(&effective_settings)
                                    {
                                        send_translation_to_jot_pad(
                                            &ah,
                                            execution,
                                            destination_label_for_dictation(&effective_settings),
                                        );
                                        text_to_paste = None;
                                        routed_to_jot_pad = true;
                                    }
                                }
                            }

                            let (cleaned_text, submit_override) =
                                extract_spoken_submit_command(&final_text);
                            if let Some(text) = text_to_paste.as_mut() {
                                *text = cleaned_text.clone();
                            }

                            if let Some(text) = text_to_paste.as_ref() {
                                let block_candidate = should_block_paste_candidate(text);
                                let suspicious_drift = should_fallback_to_plain_text_candidate(
                                    text,
                                    &safe_plain_text_fallback,
                                );

                                if block_candidate || suspicious_drift {
                                    if rewrite_selection {
                                        warn!(
                                            "Blocking suspicious rewrite-selection output for binding '{}'; skipping paste",
                                            binding_id
                                        );
                                        text_to_paste = None;
                                    } else {
                                        if suspicious_drift {
                                            warn!(
                                                "Blocking suspicious rewrite drift for binding '{}'; using plain-text fallback instead",
                                                binding_id
                                            );
                                        } else {
                                            warn!(
                                                "Blocking suspicious paste candidate for binding '{}'; using plain-text fallback instead",
                                                binding_id
                                            );
                                        }
                                        text_to_paste = Some(safe_plain_text_fallback.clone());
                                    }
                                }
                            }

                            let readback_locale = choose_readback_locale(
                                &effective_settings,
                                TranslationOrigin::Dictation,
                                translation_execution
                                    .as_ref()
                                    .and_then(|execution| {
                                        execution.source_language_detected.as_deref()
                                    })
                                    .or(source_language_hint.as_deref()),
                                translation_execution
                                    .as_ref()
                                    .and_then(|execution| execution.target_language.as_deref()),
                            );
                            let spoken_output_text = if routed_to_jot_pad {
                                cleaned_text.clone()
                            } else {
                                text_to_paste
                                    .clone()
                                    .unwrap_or_else(|| cleaned_text.clone())
                            };
                            if !spoken_output_text.trim().is_empty() {
                                remember_last_output(
                                    &ah,
                                    &spoken_output_text,
                                    readback_locale.clone(),
                                );
                            }
                            let mut auto_speak_plan = build_auto_speak_plan(
                                &effective_settings,
                                TranslationOrigin::Dictation,
                                preview_was_shown,
                                if routed_to_jot_pad || text_to_paste.is_some() {
                                    &spoken_output_text
                                } else {
                                    ""
                                },
                                translation_execution
                                    .as_ref()
                                    .and_then(|execution| execution.translated_text.as_deref()),
                                readback_locale.clone(),
                            );

                            let translation_history_context = translation_execution
                                .as_ref()
                                .map(|execution| TranslationHistoryContext {
                                    source_language_detected: execution
                                        .source_language_detected
                                        .clone(),
                                    translation_target_language: execution.target_language.clone(),
                                    translated_text: execution.translated_text.clone(),
                                    translation_route: Some(
                                        translation_route_label(execution.route).to_string(),
                                    ),
                                    translation_provider_id: execution.provider_id.clone(),
                                    translation_model_id: execution.model_id.clone(),
                                    translation_origin: Some("dictation".to_string()),
                                    translation_destination: Some(if routed_to_jot_pad {
                                        "open_in_jot_pad".to_string()
                                    } else {
                                        destination_label_for_dictation(&effective_settings)
                                            .to_string()
                                    }),
                                })
                                .unwrap_or_default();
                            let history_save_request = DeferredHistorySave {
                                audio_samples: samples_for_history,
                                transcription_text: transcription.clone(),
                                post_processed_text: post_processed_text.clone(),
                                post_process_prompt: post_process_prompt.clone(),
                                dictionary_hits: dictionary_hits_for_history.clone(),
                                pasted_text: text_to_paste.clone(),
                                translation_context: translation_history_context,
                                tts_context: tts_history_context_from_plan(&auto_speak_plan),
                                screen_context_metadata:
                                    Some(crate::managers::history::ScreenContextHistoryMetadata {
                                        source: screen_context
                                            .as_ref()
                                            .map(|packet| packet.source.clone()),
                                        capture_status: screen_context
                                            .as_ref()
                                            .map(|packet| {
                                                if packet_age_ms(packet)
                                                    > effective_settings.screen_context_stale_threshold_ms as u64
                                                {
                                                    crate::screen_context::ContextCaptureStatus::Stale
                                                } else {
                                                    crate::screen_context::ContextCaptureStatus::Ready
                                                }
                                            })
                                            .unwrap_or_else(|| context_manager.diagnostics().status),
                                        cache_age_ms: screen_context
                                            .as_ref()
                                            .map(packet_age_ms),
                                        summary: screen_context_summary.clone(),
                                        active_app_bundle_id: active_app_context
                                            .as_ref()
                                            .map(|context| context.bundle_id.clone()),
                                        active_app_name: active_app_context.as_ref().map(
                                            |context| app_display_name(context).to_string(),
                                        ),
                                        sent_externally: should_post_process
                                            && context_manager.context_sent_externally(
                                                &effective_settings,
                                                screen_context.as_ref(),
                                                effective_settings
                                                    .active_post_process_provider()
                                                    .map(post_process_provider_is_local)
                                                    .unwrap_or(true),
                                            ),
                                        changed_output: context_impact.context_changed_output,
                                    }),
                                field_snapshot_app_id: active_app_context
                                    .as_ref()
                                    .map(|ctx| ctx.bundle_id.clone()),
                            };

                            if routed_to_jot_pad {
                                if dictation_run_cancelled(
                                    &tm,
                                    processing_generation,
                                    "before jot pad routing",
                                ) {
                                    return;
                                }
                                spawn_history_save(&ah, Arc::clone(&hm), history_save_request);
                                if auto_speak_plan.should_speak {
                                    spawn_tts_playback(
                                        &ah,
                                        SpeakRequest {
                                            text: auto_speak_plan.text.clone(),
                                            locale: auto_speak_plan.locale.clone(),
                                            preferred_voice_id: None,
                                            preset_id: None,
                                            inline_preset: None,
                                            trigger: Some(auto_speak_plan.trigger.clone()),
                                            remember_last_output: false,
                                        },
                                        None,
                                    );
                                    auto_speak_plan.should_speak = false;
                                }
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            } else if let Some(ref text_to_paste) = text_to_paste {
                                if dictation_run_cancelled(
                                    &tm,
                                    processing_generation,
                                    "before paste setup",
                                ) {
                                    return;
                                }
                                let correction_monitoring_request = if effective_settings
                                    .correction_tracking_enabled
                                    && effective_settings.paste_method
                                        != crate::settings::PasteMethod::None
                                {
                                    let insertion_method = match effective_settings.paste_method {
                                        crate::settings::PasteMethod::Direct => {
                                            InsertionMethod::DirectType
                                        }
                                        crate::settings::PasteMethod::ExternalScript => {
                                            InsertionMethod::ExternalScript
                                        }
                                        _ => InsertionMethod::Clipboard,
                                    };

                                    Some((
                                        text_to_paste.clone(),
                                        active_app_context.as_ref().map(|c| c.bundle_id.clone()),
                                        active_app_context
                                            .as_ref()
                                            .map(|c| c.localized_name.clone()),
                                        insertion_method,
                                    ))
                                } else {
                                    None
                                };

                                // Paste the final text (either processed or original)
                                let text_for_paste = text_to_paste.clone();
                                let ah_clone = ah.clone();
                                let paste_settings = effective_settings.clone();
                                let paste_time = Instant::now();
                                let submit_override = submit_override;
                                let scratchpad_guard = _scratchpad_guard;
                                let hm_for_paste = Arc::clone(&hm);
                                let tm_for_paste = Arc::clone(&tm);
                                let history_save_request = history_save_request;
                                let finish_guard_for_paste = finish_guard.take();
                                let auto_speak_request = if auto_speak_plan.should_speak {
                                    Some(SpeakRequest {
                                        text: auto_speak_plan.text.clone(),
                                        locale: auto_speak_plan.locale.clone(),
                                        preferred_voice_id: None,
                                        preset_id: None,
                                        inline_preset: None,
                                        trigger: Some(auto_speak_plan.trigger.clone()),
                                        remember_last_output: false,
                                    })
                                } else {
                                    None
                                };
                                ah.run_on_main_thread(move || {
                                    // Hold the FinishGuard for the duration of the main-thread
                                    // paste so ProcessingFinished only fires after paste actually
                                    // completes.
                                    let _finish_guard_for_paste = finish_guard_for_paste;
                                    if dictation_run_cancelled(
                                        &tm_for_paste,
                                        processing_generation,
                                        "before main-thread paste",
                                    ) {
                                        return;
                                    }
                                    let _scratchpad_guard = scratchpad_guard;
                                    let paste_result = if let Some(submit_key) = submit_override {
                                        utils::paste_with_settings_and_submit_override(
                                            text_for_paste,
                                            ah_clone.clone(),
                                            &paste_settings,
                                            Some(submit_key),
                                        )
                                    } else {
                                        utils::paste_with_settings_and_submit_override(
                                            text_for_paste,
                                            ah_clone.clone(),
                                            &paste_settings,
                                            None,
                                        )
                                    };

                                    let mut history_save_request = history_save_request;
                                    match paste_result {
                                        Ok(()) => {
                                            crate::product_architecture::record_dictation_latency(
                                                "paste",
                                                paste_time.elapsed(),
                                            );
                                            debug!(
                                                "Text pasted successfully in {:?}",
                                                paste_time.elapsed()
                                            );
                                            if let Some((
                                                inserted_text,
                                                app_id,
                                                app_name,
                                                insertion_method,
                                            )) = correction_monitoring_request
                                            {
                                                schedule_correction_monitoring_after_paste(
                                                    ah_clone.clone(),
                                                    inserted_text,
                                                    app_id,
                                                    app_name,
                                                    insertion_method,
                                                );
                                            }
                                            spawn_history_save(
                                                &ah_clone,
                                                Arc::clone(&hm_for_paste),
                                                history_save_request,
                                            );

                                            if let Some(auto_speak_request) =
                                                auto_speak_request.clone()
                                            {
                                                spawn_tts_playback(
                                                    &ah_clone,
                                                    auto_speak_request,
                                                    None,
                                                );
                                            }
                                        }
                                        Err(e) => {
                                            error!("Failed to paste transcription: {}", e);
                                            // Paste did not reach the user; clear pasted_text so
                                            // history reflects actual delivery, but still save the
                                            // transcription so the user can recover it.
                                            history_save_request.pasted_text = None;
                                            spawn_history_save(
                                                &ah_clone,
                                                Arc::clone(&hm_for_paste),
                                                history_save_request,
                                            );
                                        }
                                    }
                                    // Hide the overlay after transcription is complete
                                    utils::hide_recording_overlay(&ah_clone);
                                    change_tray_icon(&ah_clone, TrayIconState::Idle);
                                })
                                .unwrap_or_else(|e| {
                                    error!("Failed to run paste on main thread: {:?}", e);
                                    utils::hide_recording_overlay(&ah);
                                    change_tray_icon(&ah, TrayIconState::Idle);
                                });
                            } else {
                                debug!(
                                    "Paste was skipped (preview cancelled, rewrite-selection \
                                     failed, or output blocked); persisting transcription to \
                                     history so it is recoverable."
                                );
                                // text_to_paste is None here, so history_save_request.pasted_text
                                // already reflects that nothing was pasted.
                                spawn_history_save(&ah, Arc::clone(&hm), history_save_request);
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            }
                        } else {
                            utils::hide_recording_overlay(&ah);
                            change_tray_icon(&ah, TrayIconState::Idle);
                        }
                    }
                    Err(err) => {
                        debug!("Global Shortcut Transcription error: {}", err);
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                    }
                }
            } else {
                debug!("No samples retrieved from recording stop");
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

impl ShortcutAction for TranslateSelectionAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        debug!(
            "TranslateSelectionAction::start called for binding: {}",
            binding_id
        );

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            run_translate_selection(app_handle).await;
        });
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

impl ShortcutAction for SpeakSelectionAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        debug!(
            "SpeakSelectionAction::start called for binding: {}",
            binding_id
        );

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            run_speak_selection(app_handle).await;
        });
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

impl ShortcutAction for SpeakLastOutputAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        debug!(
            "SpeakLastOutputAction::start called for binding: {}",
            binding_id
        );

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            run_speak_last_output(app_handle).await;
        });
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

impl ShortcutAction for StopSpeakingAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        debug!(
            "StopSpeakingAction::start called for binding: {}",
            binding_id
        );
        if let Some(tts_manager) = app.try_state::<Arc<TtsManager>>() {
            tts_manager.stop();
        }
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

impl ShortcutAction for ToggleCommandPaletteAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        crate::show_main_window(app);
        let _ = app.emit("toggle-command-menu", ());
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{
        analyze_post_process_route, apple_fallback_result, build_apple_system_prompt,
        build_apple_user_content, build_model_system_prompt, build_model_user_content,
        build_non_apple_tone_instruction, build_post_process_result, build_system_prompt,
        choose_post_process_pass, extract_spoken_submit_command, has_ordinal_list_cues,
        live_partial_config_for_model, looks_incomplete_utterance,
        maybe_apply_verification_request_fallback, parse_transcription_field_from_json,
        preview_app_context_from_override, prompt_profile_for_model, resolve_tone_context,
        sanitize_plain_model_output, should_block_paste_candidate,
        should_fallback_to_plain_text_candidate, should_fallback_to_plain_text_drift,
        should_force_conservative_rewrite, ModelPromptProfile, PostProcessPass,
    };
    use crate::post_processing::{
        ActiveAppContext, DictionaryEntry, PostProcessMode, WriteRule, WriteRuleMatchers,
        WriteRuleOverrides,
    };
    use crate::settings::{get_default_settings, AutoSubmitKey};

    #[test]
    fn apple_prompt_uses_selected_mode_and_strength() {
        let mut settings = get_default_settings();
        settings.post_process_mode = PostProcessMode::Intent;
        settings.max_rewrite_strength = 2;

        let prompt = build_apple_system_prompt(
            &settings,
            None,
            false,
            PostProcessPass::Pass2,
            settings.max_rewrite_strength,
            false,
        );

        assert!(prompt.contains("Active mode: intent"));
        assert!(prompt.contains("Rewrite strength: 2"));
        assert!(prompt.contains("Return only the final text."));
        assert!(prompt.contains("scratch that"));
        assert!(prompt.contains("Make the smallest possible change"));
        assert!(prompt.contains("Do not force bullets, numbering, or heavy formatting"));
        assert!(prompt.contains("verification requests"));
        assert!(prompt.contains("lightly clean for readability"));
    }

    #[test]
    fn model_prompt_profiles_select_strict_literal_when_benchmark_supported_it() {
        assert_eq!(
            prompt_profile_for_model("tinyllama:1.1b"),
            ModelPromptProfile::Standard
        );
        assert_eq!(
            prompt_profile_for_model("phi4-mini:latest"),
            ModelPromptProfile::StrictLiteral
        );
        assert_eq!(
            prompt_profile_for_model("qwen2.5:1.5b"),
            ModelPromptProfile::Standard
        );
    }

    #[test]
    fn strict_literal_model_prompt_adds_preservation_guardrail() {
        let settings = get_default_settings();
        let system_prompt = build_model_system_prompt(
            &settings,
            None,
            false,
            PostProcessPass::Pass1,
            1,
            false,
            "phi4-mini:latest",
        );
        let user_content = build_model_user_content(
            &settings,
            "check the file at src slash components slash settings dot tsx",
            1,
            false,
            None,
            false,
            "phi4-mini:latest",
        );

        assert!(system_prompt.contains("This model tends to paraphrase"));
        assert!(system_prompt.contains("Do not shorten, summarize, formalize"));
        assert!(user_content.contains("Model-specific reminder"));
        assert!(user_content.contains("Preserve original wording"));
    }

    #[test]
    fn apple_user_content_includes_dictionary_entries() {
        let mut settings = get_default_settings();
        settings.personal_dictionary = vec![DictionaryEntry {
            spoken: "swift ui".to_string(),
            written: "SwiftUI".to_string(),
            priority: 0,
            case_sensitive: false,
            exact_only: true,
        }];

        let content = build_apple_user_content(
            &settings,
            "swift ui example",
            settings.max_rewrite_strength,
            false,
            None,
            false,
        );

        assert!(content.contains("Mode: literal"));
        assert!(content.contains("Special handling:"));
        assert!(content.contains("Keep only the corrected wording"));
        assert!(content.contains("format the items as `* ` bullets"));
        assert!(content.contains("verification-style content"));
        assert!(content.contains("- swift ui => SwiftUI [exact only]"));
        assert!(content.contains("Transcript:\nswift ui example"));
    }

    #[test]
    fn verification_request_fallback_formats_flat_sequence() {
        let input = "Required verifications Request Government Issue ID conduct in person meeting employment verification income documentation personal reference previous reference I meant previous landlord reference and credit check also security verification";
        let rewritten = maybe_apply_verification_request_fallback(input, input)
            .expect("verification request fallback should trigger");

        assert_eq!(
            rewritten,
            "Required Verification Request:\n* Government-issued ID\n* Conduct in-person meeting\n* Employment verification\n* Income documentation\n* Personal references\n* Previous landlord reference\n* Credit check\n* Social security verification"
        );
    }

    #[test]
    fn verification_request_fallback_skips_unrelated_text() {
        assert!(maybe_apply_verification_request_fallback(
            "Please call me tomorrow morning",
            "Please call me tomorrow morning"
        )
        .is_none());
    }

    #[test]
    fn build_system_prompt_removes_trailing_transcript_label() {
        let prompt = "Clean this up.\n\nTranscript:\n${output}";
        assert_eq!(build_system_prompt(prompt), "Clean this up.");
    }

    #[test]
    fn parse_transcription_field_handles_fenced_json() {
        let content = "```json\n{\"transcription\":\"Hello world\"}\n```";
        assert_eq!(
            parse_transcription_field_from_json(content).as_deref(),
            Some("Hello world")
        );
    }

    #[test]
    fn sanitize_plain_model_output_strips_common_labels() {
        let content = "Final text:\nHello world";
        assert_eq!(
            sanitize_plain_model_output(content).as_deref(),
            Some("Hello world")
        );
    }

    #[test]
    fn sanitize_plain_model_output_rejects_json_blob() {
        assert!(sanitize_plain_model_output("{\"transcription\":\"Hello\"}").is_none());
    }

    #[test]
    fn sanitize_plain_model_output_strips_wrapping_quotes() {
        assert_eq!(
            sanitize_plain_model_output("\"Most wonderful\"").as_deref(),
            Some("Most wonderful")
        );
    }

    #[test]
    fn sanitize_plain_model_output_strips_simple_markdown_wrappers() {
        assert_eq!(
            sanitize_plain_model_output("**I've given my orders, sir.**").as_deref(),
            Some("I've given my orders, sir.")
        );
    }

    #[test]
    fn sanitize_plain_model_output_rejects_prompt_artifact() {
        assert!(sanitize_plain_model_output(
            "\"⚠️ Additional system instruction: Keep context active.\\n\\n---\\n**Transcript Output**\\n```oops```\""
        )
        .is_none());
    }

    #[test]
    fn sanitize_plain_model_output_rejects_parenthetical_meta_note() {
        assert!(sanitize_plain_model_output(
            "Comfortable, dear? (**No punctuation added; as spoken, no changes**)."
        )
        .is_none());
    }

    #[test]
    fn sanitize_plain_model_output_rejects_instruction_leak_variant() {
        assert!(sanitize_plain_model_output(
            ": **Understand prompt structure, optimize for output quality, handle corrections, format as dictation post-processor strictly, and adapt tone/mode dynamically for intent preservation. Now, to fulfill specific user requests delivered without alteration or commentary**."
        )
        .is_none());
    }

    #[test]
    fn sanitize_plain_model_output_rejects_role_label_leaks() {
        assert!(
            sanitize_plain_model_output("Assistant: Suggested rewrite: Hello world.").is_none()
        );
        assert!(sanitize_plain_model_output("System: Return only the final text.").is_none());
    }

    #[test]
    fn sanitize_plain_model_output_rejects_subtitle_artifacts() {
        assert!(
            sanitize_plain_model_output("00:00:01,000 --> 00:00:02,000\nHello world.").is_none()
        );
    }

    #[test]
    fn final_paste_gate_blocks_code_fence_wrappers() {
        assert!(should_block_paste_candidate(
            "```json\n{\"transcription\":\"Hello\"}\n```"
        ));
    }

    #[test]
    fn final_paste_gate_blocks_prompt_artifact_wrappers() {
        assert!(should_block_paste_candidate(
            "\"⚠️ Additional system instruction: Keep context active.\\n\\n---\\n**Transcript Output**\\n```oops```\""
        ));
    }

    #[test]
    fn final_paste_gate_blocks_instruction_leak_variant() {
        assert!(should_block_paste_candidate(
            ": **Understand prompt structure, optimize for output quality, handle corrections, format as dictation post-processor strictly, and adapt tone/mode dynamically for intent preservation. Now, to fulfill specific user requests delivered without alteration or commentary**."
        ));
    }

    #[test]
    fn final_paste_gate_blocks_subtitle_artifacts() {
        assert!(should_block_paste_candidate(
            "00:00:01.000 --> 00:00:02.000\nHello world."
        ));
    }

    #[test]
    fn final_paste_gate_allows_normal_plain_text() {
        assert!(!should_block_paste_candidate("Hello world from Vox Jot"));
    }

    #[test]
    fn plain_text_fallback_detects_suspicious_expansion() {
        assert!(should_fallback_to_plain_text_candidate(
            "Wait, I mean where are we talking about that from?",
            "Where is that?"
        ));
    }

    #[test]
    fn plain_text_fallback_detects_two_word_collapse() {
        assert!(should_fallback_to_plain_text_candidate(
            "comfortable",
            "Comfortable, dear?"
        ));
    }

    #[test]
    fn fallback_only_returns_result_when_enabled() {
        let mut settings = get_default_settings();
        settings.fallback_to_raw_on_failure = true;

        let fallback = apple_fallback_result(
            &settings,
            "raw text",
            "normalized text".to_string(),
            vec!["SwiftUI".to_string()],
            None,
            None,
        );
        assert!(fallback.is_some());

        settings.fallback_to_raw_on_failure = false;
        let no_fallback = apple_fallback_result(
            &settings,
            "raw text",
            "normalized text".to_string(),
            vec![],
            None,
            None,
        );
        assert!(no_fallback.is_none());
    }

    fn slack_casual_rule() -> WriteRule {
        WriteRule {
            id: "slack-casual".to_string(),
            name: "Slack".to_string(),
            enabled: true,
            priority: 100,
            matchers: WriteRuleMatchers {
                bundle_ids: vec!["com.tinyspeck.slackmacgap".to_string()],
                url_patterns: Vec::new(),
            },
            overrides: WriteRuleOverrides {
                tone_id: Some("casual".to_string()),
                ..Default::default()
            },
        }
    }

    #[test]
    fn app_aware_tone_prompt_includes_matching_instruction() {
        let mut settings = get_default_settings();
        settings.app_aware_tone_enabled = true;
        settings.write_rules.push(slack_casual_rule());
        let context = ActiveAppContext {
            bundle_id: "com.tinyspeck.slackmacgap".to_string(),
            localized_name: "Slack".to_string(),
        };

        let tone_context = resolve_tone_context(&settings, Some(&context))
            .expect("Slack should resolve to a default tone");
        let prompt = build_apple_system_prompt(
            &settings,
            Some(&tone_context),
            false,
            PostProcessPass::Pass2,
            settings.max_rewrite_strength,
            false,
        );

        assert_eq!(tone_context.tone_id, "casual");
        assert!(prompt.contains("tone: casual"));
        assert!(prompt.contains("Slack"));
        assert!(prompt.contains("casual, conversational tone"));
    }

    #[test]
    fn unmatched_app_keeps_neutral_prompt_behavior() {
        let mut settings = get_default_settings();
        settings.app_aware_tone_enabled = true;
        let context = ActiveAppContext {
            bundle_id: "com.example.Unknown".to_string(),
            localized_name: "Unknown".to_string(),
        };

        let tone_context = resolve_tone_context(&settings, Some(&context));
        let prompt = build_apple_system_prompt(
            &settings,
            tone_context.as_ref(),
            false,
            PostProcessPass::Pass2,
            settings.max_rewrite_strength,
            false,
        );

        assert!(tone_context.is_none());
        assert!(prompt.contains(
            "Notes (tone: neutral): Keep the tone neutral and close to the speaker's original wording."
        ));
    }

    #[test]
    fn preview_override_uses_write_rule_name() {
        let mut settings = get_default_settings();
        settings.write_rules.push(WriteRule {
            id: "mail".to_string(),
            name: "Mail".to_string(),
            enabled: true,
            priority: 100,
            matchers: WriteRuleMatchers {
                bundle_ids: vec!["com.apple.mail".to_string()],
                url_patterns: Vec::new(),
            },
            overrides: WriteRuleOverrides::default(),
        });
        let context = preview_app_context_from_override(&settings, Some("com.apple.mail")).unwrap();

        assert_eq!(context.bundle_id, "com.apple.mail");
        assert_eq!(context.localized_name, "Mail");
    }

    #[test]
    fn spoken_submit_command_is_extracted_from_suffix() {
        let (text, submit) = extract_spoken_submit_command("Thanks for your help and send.");
        assert_eq!(text, "Thanks for your help");
        assert_eq!(submit, Some(AutoSubmitKey::Enter));
    }

    #[test]
    fn spoken_submit_command_respects_ctrl_enter_suffix() {
        let (text, submit) =
            extract_spoken_submit_command("Please revise this sentence press ctrl enter");
        assert_eq!(text, "Please revise this sentence");
        assert_eq!(submit, Some(AutoSubmitKey::CtrlEnter));
    }

    #[test]
    fn non_apple_tone_instruction_contains_app_and_tone() {
        let mut settings = get_default_settings();
        settings.app_aware_tone_enabled = true;
        settings.write_rules.push(slack_casual_rule());
        let context = ActiveAppContext {
            bundle_id: "com.tinyspeck.slackmacgap".to_string(),
            localized_name: "Slack".to_string(),
        };

        let tone_context = resolve_tone_context(&settings, Some(&context)).unwrap();
        let instruction = build_non_apple_tone_instruction(Some(&tone_context)).unwrap();

        assert!(instruction.contains("Slack"));
        assert!(instruction.contains("tone: casual"));
    }

    #[test]
    fn post_process_result_preserves_tone_metadata() {
        let settings = get_default_settings();
        let active_app_context = ActiveAppContext {
            bundle_id: "com.tinyspeck.slackmacgap".to_string(),
            localized_name: "Slack".to_string(),
        };

        let result = build_post_process_result(
            &settings,
            "raw text",
            "normalized text".to_string(),
            "final text".to_string(),
            vec![],
            None,
            Some(active_app_context.clone()),
            Some("casual".to_string()),
        );

        assert_eq!(result.applied_tone_id.as_deref(), Some("casual"));
        assert_eq!(result.active_app_context, Some(active_app_context));
    }

    #[test]
    fn live_partial_config_picks_fast_streaming_profile() {
        let (interval_ms, min_samples, min_growth) =
            live_partial_config_for_model("moonshine-streaming");

        assert_eq!(interval_ms, 450);
        assert_eq!(min_samples, 8_000);
        assert_eq!(min_growth, 2_400);
    }

    #[test]
    fn conservative_rewrite_gate_detects_short_fragment_without_boundary() {
        assert!(should_force_conservative_rewrite(
            "draft email to marketing"
        ));
    }

    #[test]
    fn conservative_rewrite_gate_allows_correction_cue() {
        assert!(!should_force_conservative_rewrite(
            "Actually wait no send this update to product"
        ));
    }

    #[test]
    fn conservative_rewrite_gate_allows_complete_sentence() {
        assert!(!should_force_conservative_rewrite(
            "Please send this to the team after lunch."
        ));
    }

    #[test]
    fn choose_pass_skips_short_plain_phrase() {
        assert_eq!(
            choose_post_process_pass("sounds good"),
            PostProcessPass::Skip
        );
    }

    #[test]
    fn choose_pass_skips_clean_sentence_without_cleanup_signals() {
        assert_eq!(
            choose_post_process_pass("Please send the update to finance after lunch tomorrow."),
            PostProcessPass::Skip
        );
    }

    #[test]
    fn choose_pass_skips_ultra_short_phrase_even_with_pass1_cue() {
        assert_eq!(
            choose_post_process_pass("new paragraph thanks"),
            PostProcessPass::Skip
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_sequence_cues() {
        assert_eq!(
            choose_post_process_pass(
                "my top goals this week are first finish the report second send the presentation"
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_sentence_level_correction_restart() {
        assert_eq!(
            choose_post_process_pass(
                "Hi Greg, let's connect soon. Are you available Friday at three o'clock? No, I'm at four o'clock."
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_intro_plus_items() {
        assert_eq!(
            choose_post_process_pass(
                "I want to pick up a few things from the store. Bread, potato chips, ice cream."
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_verification_request_list() {
        assert_eq!(
            choose_post_process_pass(
                "Required verifications request government issue ID conduct in person meeting employment verification income documentation"
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_command_for_transform_intent() {
        assert_eq!(
            choose_post_process_pass("make this shorter and clearer"),
            PostProcessPass::Command
        );
    }

    #[test]
    fn analyze_route_reports_expected_flags() {
        let result = analyze_post_process_route(
            "my top goals this week are first finish the report second send the presentation",
        );

        assert_eq!(result.route, "pass2");
        assert!(result.has_list_cue);
        assert!(!result.has_transform_cue);
        assert!(!result.looks_incomplete);
    }

    #[test]
    fn analyze_route_detects_intro_plus_items_as_list_cue() {
        let result = analyze_post_process_route(
            "I want to pick up a few things from the store. Bread, potato chips, ice cream.",
        );

        assert_eq!(result.route, "pass2");
        assert!(result.has_list_cue);
        assert!(!result.has_transform_cue);
    }

    #[test]
    fn analyze_route_detects_verification_request_as_list_cue() {
        let result = analyze_post_process_route(
            "Required verifications request government issue ID conduct in person meeting employment verification income documentation",
        );

        assert_eq!(result.route, "pass2");
        assert!(result.has_list_cue);
        assert!(!result.has_transform_cue);
    }

    // --- Regression tests for the 4 worsened entries ---

    #[test]
    fn trailing_comma_detected_as_incomplete() {
        assert!(looks_incomplete_utterance("After the very first,"));
    }

    #[test]
    fn incomplete_trailing_comma_routes_to_pass1() {
        assert_eq!(
            choose_post_process_pass("After the very first,"),
            PostProcessPass::Pass1
        );
    }

    #[test]
    fn drift_gate_catches_hallucination_on_incomplete_clause() {
        assert!(should_fallback_to_plain_text_drift(
            "After the very first,",
            "I meant previous landlord reference",
            "After the very first,",
        ));
    }

    #[test]
    fn single_then_in_prose_is_not_list_cue() {
        assert!(!has_ordinal_list_cues("What, then, my lord?"));
    }

    #[test]
    fn short_prose_with_then_routes_to_skip() {
        assert_eq!(
            choose_post_process_pass("What, then, my lord?"),
            PostProcessPass::Skip
        );
    }

    #[test]
    fn drift_gate_catches_semantic_rewrite() {
        assert!(should_fallback_to_plain_text_drift(
            "What, then, my lord?",
            "What shall I do, my lord?",
            "What, then, my lord?",
        ));
    }

    #[test]
    fn single_then_in_sentence_routes_to_skip() {
        assert_eq!(
            choose_post_process_pass("Then you don't know what you're talking about."),
            PostProcessPass::Skip
        );
    }

    #[test]
    fn single_one_in_sentence_routes_to_skip() {
        assert_eq!(
            choose_post_process_pass("I have one great privilege."),
            PostProcessPass::Skip
        );
    }

    #[test]
    fn drift_gate_catches_single_word_swap() {
        assert!(should_fallback_to_plain_text_drift(
            "I have one great privilege.",
            "I have the great privilege.",
            "I have one great privilege.",
        ));
    }

    #[test]
    fn multiple_ordinals_in_long_text_triggers_list_cue() {
        assert!(has_ordinal_list_cues(
            "my top goals this week are first finish the report second send the presentation"
        ));
    }

    #[test]
    fn single_ordinal_does_not_trigger_list_cue() {
        assert!(!has_ordinal_list_cues("I have one great privilege."));
        assert!(!has_ordinal_list_cues("After the very first,"));
        assert!(!has_ordinal_list_cues(
            "Then you don't know what you're talking about."
        ));
    }

    #[test]
    fn drift_gate_allows_legitimate_correction_cue() {
        assert!(!should_fallback_to_plain_text_drift(
            "Send the report to marketing actually send it to sales instead.",
            "Send the report to sales instead.",
            "Send the report to marketing actually send it to sales instead.",
        ));
    }

    #[test]
    fn drift_gate_allows_identical_text() {
        assert!(!should_fallback_to_plain_text_drift(
            "Hello world.",
            "Hello world.",
            "Hello world.",
        ));
    }

    #[test]
    fn analyze_route_skip_label_shown() {
        let result = analyze_post_process_route("I have one great privilege.");
        assert_eq!(result.route, "skip");
        assert!(!result.has_list_cue);
    }

    #[test]
    fn drift_gate_catches_llm_answering_question() {
        // User asked a question; LLM answered it instead of cleaning the transcription
        assert!(should_fallback_to_plain_text_drift(
            "In the history area what's the difference between raw text and transcribed text",
            "In the History area, the **Raw text** and **Transcribed text** differ in processing:\n\n* **Raw text** → The exact speech-to-text output as recorded without modifications.\n* **Transcribed text** → Processed to make it readable while preserving the intended meaning.",
            "In the history area what's the difference between raw text and transcribed text",
        ));
    }

    #[test]
    fn drift_gate_catches_markdown_formatting_injection() {
        // LLM added markdown formatting that wasn't in the original
        assert!(should_fallback_to_plain_text_drift(
            "tell me about the app settings",
            "The **app settings** allow you to configure:\n\n* **Audio** — recording device\n* **Model** — transcription model\n* **Shortcuts** — keyboard bindings",
            "tell me about the app settings",
        ));
    }

    #[test]
    fn drift_gate_catches_dramatic_expansion_on_longer_input() {
        // 14-word input gets a 50+ word explanation
        assert!(should_fallback_to_plain_text_drift(
            "Yes come up with a sound solution that works that we can also test",
            "Here is a comprehensive solution that addresses the issue. First, we need to implement proper validation checks. Second, we should add unit tests covering edge cases. Third, we need integration tests to verify the full pipeline works correctly end to end. Finally, we should add regression tests to prevent future breakage.",
            "Yes come up with a sound solution that works that we can also test",
        ));
    }

    #[test]
    fn drift_gate_allows_normal_cleanup_on_longer_input() {
        // Legitimate cleanup: minor punctuation/capitalization fixes
        assert!(!should_fallback_to_plain_text_drift(
            "in the history area what's the difference between raw text and transcribed text",
            "In the history area, what's the difference between raw text and transcribed text?",
            "in the history area what's the difference between raw text and transcribed text",
        ));
    }

    #[test]
    fn drift_gate_allows_moderate_list_formatting() {
        // Legitimate list formatting from spoken items (no markdown bold)
        assert!(!should_fallback_to_plain_text_drift(
            "pick up milk eggs bread and butter from the store",
            "Pick up from the store:\n* Milk\n* Eggs\n* Bread\n* Butter",
            "pick up milk eggs bread and butter from the store",
        ));
    }

    #[test]
    fn paste_gate_catches_llm_answering_unrelated_question() {
        // LLM generated a long answer with low overlap to the original input
        assert!(should_fallback_to_plain_text_candidate(
            "Sure! The best approach is to implement a comprehensive validation layer that checks all inputs before processing. You should add unit tests for each validation rule, integration tests for the full pipeline, and regression tests to prevent future issues from occurring in production environments.",
            "How should we handle input validation in the app",
        ));
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            rewrite_selection: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            rewrite_selection: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "rewrite_selection".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            rewrite_selection: true,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "translate_selection".to_string(),
        Arc::new(TranslateSelectionAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "speak_selection".to_string(),
        Arc::new(SpeakSelectionAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "speak_last_output".to_string(),
        Arc::new(SpeakLastOutputAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "stop_speaking".to_string(),
        Arc::new(StopSpeakingAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "toggle_command_menu".to_string(),
        Arc::new(ToggleCommandPaletteAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
