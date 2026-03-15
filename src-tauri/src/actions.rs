#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::post_processing::{
    apply_personal_dictionary, detect_post_process_edits, ActiveAppContext, PostProcessMode,
    PostProcessPreviewPayload, PostProcessResult, PreviewManager,
};
use crate::settings::{get_settings, AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::TranscriptionCoordinator;
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

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

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
}

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

struct PostProcessExecution {
    result: PostProcessResult,
    prompt_used: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedToneContext {
    active_app_context: ActiveAppContext,
    tone_id: String,
    instruction: String,
}

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

fn app_display_name(context: &ActiveAppContext) -> &str {
    if context.localized_name.trim().is_empty() {
        &context.bundle_id
    } else {
        &context.localized_name
    }
}

fn resolve_tone_context(
    settings: &AppSettings,
    active_app_context: Option<&ActiveAppContext>,
) -> Option<ResolvedToneContext> {
    if !settings.app_aware_tone_enabled {
        return None;
    }

    let active_app_context = active_app_context?;
    let mapping = settings.app_tone_mapping(&active_app_context.bundle_id)?;
    let tone = settings.tone_definition(&mapping.tone_id)?;

    Some(ResolvedToneContext {
        active_app_context: active_app_context.clone(),
        tone_id: tone.id.clone(),
        instruction: tone.instruction.clone(),
    })
}

fn build_post_process_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    final_text: String,
    dictionary_hits: Vec<String>,
    active_app_context: Option<ActiveAppContext>,
    applied_tone_id: Option<String>,
) -> PostProcessResult {
    let final_text = strip_invisible_chars(&final_text);
    let edits = detect_post_process_edits(raw_text, &normalized_text, &final_text);

    PostProcessResult {
        raw_text: raw_text.to_string(),
        normalized_text,
        final_text,
        dictionary_hits,
        edits,
        mode: settings.post_process_mode,
        active_app_context,
        applied_tone_id,
    }
}

fn build_apple_system_prompt(
    settings: &AppSettings,
    tone_context: Option<&ResolvedToneContext>,
) -> String {
    let mode_label = match settings.post_process_mode {
        PostProcessMode::Literal => "literal",
        PostProcessMode::Intent => "intent",
    };
    let tone_rule = if let Some(tone_context) = tone_context {
        format!(
            "- Apply this tone guidance for the active app {} (tone: {}): {}",
            app_display_name(&tone_context.active_app_context),
            tone_context.tone_id,
            tone_context.instruction
        )
    } else {
        "- Do not infer or apply app-specific tone unless explicit tone guidance is provided."
            .to_string()
    };

    format!(
        "You are a local dictation post-processor.\n\
Your job is to clean speech-to-text output while preserving meaning.\n\
\n\
Active mode: {mode_label}\n\
Rewrite strength: {} (0=conservative, 2=aggressive)\n\
\n\
Rules:\n\
- Return only the final text.\n\
- Preserve meaning and the speaker's intended correction.\n\
- Never invent facts, headings, or commentary.\n\
- Apply personal dictionary spellings exactly when they appear in the transcript.\n\
- Fix capitalization, punctuation, paragraph breaks, and obvious list formatting.\n\
- In literal mode, preserve wording as much as possible.\n\
- In intent mode, remove filler words and false starts when they do not change meaning.\n\
- {tone_rule}\n\
- Do not use markdown headings or explanations.",
        settings.max_rewrite_strength
    )
}

fn build_apple_user_content(settings: &AppSettings, normalized_text: &str) -> String {
    let mode_label = match settings.post_process_mode {
        PostProcessMode::Literal => "literal",
        PostProcessMode::Intent => "intent",
    };

    let dictionary_section = if settings.personal_dictionary.is_empty() {
        "Personal dictionary:\n- (none)".to_string()
    } else {
        let entries = settings
            .personal_dictionary
            .iter()
            .map(|entry| {
                let qualifier = if entry.exact_only {
                    " [exact only]"
                } else {
                    ""
                };
                format!("- {} => {}{}", entry.spoken, entry.written, qualifier)
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!("Personal dictionary:\n{}", entries)
    };

    format!(
        "Mode: {mode_label}\n\
Rewrite strength: {}\n\
\n\
{dictionary_section}\n\
\n\
Transcript:\n{normalized_text}",
        settings.max_rewrite_strength
    )
}

fn build_apple_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    final_text: String,
    dictionary_hits: Vec<String>,
    system_prompt: String,
    active_app_context: Option<ActiveAppContext>,
    applied_tone_id: Option<String>,
) -> PostProcessExecution {
    PostProcessExecution {
        result: build_post_process_result(
            settings,
            raw_text,
            normalized_text,
            final_text,
            dictionary_hits,
            active_app_context,
            applied_tone_id,
        ),
        prompt_used: Some(system_prompt),
    }
}

fn apple_fallback_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    dictionary_hits: Vec<String>,
    active_app_context: Option<ActiveAppContext>,
) -> Option<PostProcessExecution> {
    if settings.fallback_to_raw_on_failure {
        Some(build_apple_result(
            settings,
            raw_text,
            normalized_text.clone(),
            normalized_text,
            dictionary_hits,
            build_apple_system_prompt(settings, None),
            active_app_context,
            None,
        ))
    } else {
        None
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn capture_active_app_context(settings: &AppSettings) -> Option<ActiveAppContext> {
    if !settings.app_aware_tone_enabled {
        return None;
    }

    match apple_intelligence::get_frontmost_app_context() {
        Ok(context) => Some(context),
        Err(err) => {
            warn!("Failed to detect frontmost app for app-aware tone: {}", err);
            None
        }
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn capture_active_app_context(_settings: &AppSettings) -> Option<ActiveAppContext> {
    None
}

fn preview_app_context_from_override(
    settings: &AppSettings,
    app_bundle_id_override: Option<&str>,
) -> Option<ActiveAppContext> {
    let bundle_id = app_bundle_id_override?.trim();
    if bundle_id.is_empty() {
        return None;
    }

    if let Some(mapping) = settings.app_tone_mapping(bundle_id) {
        return Some(ActiveAppContext {
            bundle_id: mapping.bundle_id.clone(),
            localized_name: mapping.app_name.clone(),
        });
    }

    Some(ActiveAppContext {
        bundle_id: bundle_id.to_string(),
        localized_name: String::new(),
    })
}

async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
    active_app_context: Option<ActiveAppContext>,
) -> Option<PostProcessExecution> {
    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        let dictionary_result = apply_personal_dictionary(transcription, &settings.personal_dictionary);
        let tone_context = resolve_tone_context(settings, active_app_context.as_ref());
        let system_prompt = build_apple_system_prompt(settings, tone_context.as_ref());
        let user_content = build_apple_user_content(settings, &dictionary_result.text);
        let applied_tone_id = tone_context.as_ref().map(|tone| tone.tone_id.clone());

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                debug!("Apple Intelligence selected but not currently available on this device");
                return apple_fallback_result(
                    settings,
                    transcription,
                    dictionary_result.text,
                    dictionary_result.hits,
                    active_app_context,
                );
            }

            return match apple_intelligence::process_text_with_system_prompt(
                &system_prompt,
                &user_content,
                0,
            ) {
                Ok(result) => {
                    let final_text = strip_invisible_chars(&result);
                    if final_text.trim().is_empty() {
                        debug!("Apple Intelligence returned an empty response");
                        apple_fallback_result(
                            settings,
                            transcription,
                            dictionary_result.text,
                            dictionary_result.hits,
                            active_app_context,
                        )
                    } else {
                        debug!(
                            "Apple Intelligence post-processing succeeded. Output length: {} chars",
                            final_text.len()
                        );
                        Some(build_apple_result(
                            settings,
                            transcription,
                            dictionary_result.text,
                            final_text,
                            dictionary_result.hits,
                            system_prompt.clone(),
                            active_app_context,
                            applied_tone_id,
                        ))
                    }
                }
                Err(err) => {
                    error!("Apple Intelligence post-processing failed: {}", err);
                    apple_fallback_result(
                        settings,
                        transcription,
                        dictionary_result.text,
                        dictionary_result.hits,
                        active_app_context,
                    )
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            debug!("Apple Intelligence provider selected on unsupported platform");
            return apple_fallback_result(
                settings,
                transcription,
                dictionary_result.text,
                dictionary_result.hits,
                active_app_context,
            );
        }
    }

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            debug!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = build_system_prompt(&prompt);
        let user_content = transcription.to_string();

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt.clone()),
            Some(json_schema),
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(PostProcessExecution {
                                result: build_post_process_result(
                                    settings,
                                    transcription,
                                    transcription.to_string(),
                                    result.clone(),
                                    Vec::new(),
                                    None,
                                    None,
                                ),
                                prompt_used: Some(system_prompt.clone()),
                            });
                        } else {
                            error!("Structured output response missing 'transcription' field");
                            let fallback = strip_invisible_chars(&content);
                            return Some(PostProcessExecution {
                                result: build_post_process_result(
                                    settings,
                                    transcription,
                                    transcription.to_string(),
                                    fallback.clone(),
                                    Vec::new(),
                                    None,
                                    None,
                                ),
                                prompt_used: Some(system_prompt.clone()),
                            });
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse structured output JSON: {}. Returning raw content.",
                            e
                        );
                        let fallback = strip_invisible_chars(&content);
                        return Some(PostProcessExecution {
                            result: build_post_process_result(
                                settings,
                                transcription,
                                transcription.to_string(),
                                fallback.clone(),
                                Vec::new(),
                                None,
                                None,
                            ),
                            prompt_used: Some(system_prompt.clone()),
                        });
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(&provider, api_key, &model, processed_prompt)
        .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(PostProcessExecution {
                result: build_post_process_result(
                    settings,
                    transcription,
                    transcription.to_string(),
                    content.clone(),
                    Vec::new(),
                    None,
                    None,
                ),
                prompt_used: Some(prompt),
            })
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
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

pub(crate) async fn preview_post_process(
    app: &AppHandle,
    transcription: &str,
    app_bundle_id_override: Option<&str>,
) -> Result<PostProcessResult, String> {
    let settings = get_settings(app);
    let base_text = maybe_convert_chinese_variant(&settings, transcription)
        .await
        .unwrap_or_else(|| transcription.to_string());
    let active_app_context = preview_app_context_from_override(&settings, app_bundle_id_override);

    post_process_transcription(&settings, &base_text, active_app_context)
        .await
        .map(|execution| execution.result)
        .ok_or_else(|| "Post-processing did not produce a result".to_string())
}

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        let settings = get_settings(app);
        if self.post_process && !settings.post_process_enabled {
            debug!(
                "Ignoring post-process binding '{}' because post-processing is disabled",
                binding_id
            );
            return;
        }

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        tm.initiate_model_load();

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
                    debug!("Recording started in {:?}", recording_start_time.elapsed());
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
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        } else {
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
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

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let post_process = self.post_process;

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard(ah.clone());
            let binding_id = binding_id.clone(); // Clone for the inner async task
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let stop_recording_time = Instant::now();
            if let Some(samples) = rm.stop_recording(&binding_id) {
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                let transcription_time = Instant::now();
                let samples_clone = samples.clone(); // Clone for history saving
                match tm.transcribe(samples) {
                    Ok(transcription) => {
                        debug!(
                            "Transcription completed in {:?}: '{}'",
                            transcription_time.elapsed(),
                            transcription
                        );
                        if !transcription.is_empty() {
                            let settings = get_settings(&ah);
                            let mut final_text = transcription.clone();
                            let mut post_processed_text: Option<String> = None;
                            let mut post_process_prompt: Option<String> = None;

                            // First, check if Chinese variant conversion is needed
                            if let Some(converted_text) =
                                maybe_convert_chinese_variant(&settings, &transcription).await
                            {
                                final_text = converted_text;
                            }

                            // Then apply LLM post-processing if this is the post-process hotkey
                            // Uses final_text which may already have Chinese conversion applied
                            let should_post_process = post_process && settings.post_process_enabled;
                            let active_app_context = if should_post_process {
                                capture_active_app_context(&settings)
                            } else {
                                None
                            };
                            if should_post_process {
                                show_processing_overlay(&ah);
                            }
                            let processed = if should_post_process {
                                post_process_transcription(
                                    &settings,
                                    &final_text,
                                    active_app_context,
                                )
                                .await
                            } else {
                                None
                            };
                            let mut text_to_paste = Some(final_text.clone());
                            if let Some(processed) = processed {
                                let preview_text = if should_post_process {
                                    maybe_preview_post_process_result(
                                        &ah,
                                        &settings,
                                        &processed.result,
                                    )
                                    .await
                                } else {
                                    Some(processed.result.final_text.clone())
                                };

                                if let Some(preview_text) = preview_text {
                                    final_text = preview_text;
                                    text_to_paste = Some(final_text.clone());
                                } else {
                                    text_to_paste = None;
                                    final_text = processed.result.final_text.clone();
                                }

                                post_processed_text = Some(final_text.clone());
                                post_process_prompt = processed.prompt_used;
                            } else if final_text != transcription {
                                // Chinese conversion was applied but no LLM post-processing
                                post_processed_text = Some(final_text.clone());
                            }

                            // Save to history after preview resolution so stored text matches
                            // the final pasted output when preview editing is enabled.
                            let hm_clone = Arc::clone(&hm);
                            let transcription_for_history = transcription.clone();
                            let post_processed_for_history = post_processed_text.clone();
                            let post_process_prompt_for_history = post_process_prompt.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = hm_clone
                                    .save_transcription(
                                        samples_clone,
                                        transcription_for_history,
                                        post_processed_for_history,
                                        post_process_prompt_for_history,
                                    )
                                    .await
                                {
                                    error!("Failed to save transcription to history: {}", e);
                                }
                            });

                            if let Some(text_to_paste) = text_to_paste {
                                // Paste the final text (either processed or original)
                                let ah_clone = ah.clone();
                                let paste_time = Instant::now();
                                ah.run_on_main_thread(move || {
                                    match utils::paste(text_to_paste, ah_clone.clone()) {
                                        Ok(()) => debug!(
                                            "Text pasted successfully in {:?}",
                                            paste_time.elapsed()
                                        ),
                                        Err(e) => error!("Failed to paste transcription: {}", e),
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
                                debug!("Post-process preview was cancelled; skipping paste");
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
        apple_fallback_result, build_apple_system_prompt, build_apple_user_content,
        preview_app_context_from_override, resolve_tone_context,
    };
    use crate::post_processing::{ActiveAppContext, DictionaryEntry, PostProcessMode};
    use crate::settings::get_default_settings;

    #[test]
    fn apple_prompt_uses_selected_mode_and_strength() {
        let mut settings = get_default_settings();
        settings.post_process_mode = PostProcessMode::Intent;
        settings.max_rewrite_strength = 2;

        let prompt = build_apple_system_prompt(&settings, None);

        assert!(prompt.contains("Active mode: intent"));
        assert!(prompt.contains("Rewrite strength: 2"));
        assert!(prompt.contains("Return only the final text."));
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

        let content = build_apple_user_content(&settings, "swift ui example");

        assert!(content.contains("Mode: literal"));
        assert!(content.contains("- swift ui => SwiftUI [exact only]"));
        assert!(content.contains("Transcript:\nswift ui example"));
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
        );
        assert!(fallback.is_some());

        settings.fallback_to_raw_on_failure = false;
        let no_fallback = apple_fallback_result(
            &settings,
            "raw text",
            "normalized text".to_string(),
            vec![],
            None,
        );
        assert!(no_fallback.is_none());
    }

    #[test]
    fn app_aware_tone_prompt_includes_matching_instruction() {
        let mut settings = get_default_settings();
        settings.app_aware_tone_enabled = true;
        let context = ActiveAppContext {
            bundle_id: "com.tinyspeck.slackmacgap".to_string(),
            localized_name: "Slack".to_string(),
        };

        let tone_context = resolve_tone_context(&settings, Some(&context))
            .expect("Slack should resolve to a default tone");
        let prompt = build_apple_system_prompt(&settings, Some(&tone_context));

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
        let prompt = build_apple_system_prompt(&settings, tone_context.as_ref());

        assert!(tone_context.is_none());
        assert!(prompt.contains("Do not infer or apply app-specific tone"));
    }

    #[test]
    fn preview_override_uses_mapping_without_live_lookup() {
        let settings = get_default_settings();
        let context =
            preview_app_context_from_override(&settings, Some("com.apple.mail")).unwrap();

        assert_eq!(context.bundle_id, "com.apple.mail");
        assert_eq!(context.localized_name, "Mail");
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction { post_process: true }) as Arc<dyn ShortcutAction>,
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
