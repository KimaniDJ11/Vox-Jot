//! Post-process pipeline orchestration.
//!
//! Runs the LLM call (Apple Intelligence or remote/local provider) once
//! the router has decided cleanup is needed, plus the result-building and
//! preview/Chinese-variant helpers consumed only by post-process flows.

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::post_processing::{
    apply_personal_dictionary, detect_post_process_edits, ActiveAppContext, PostProcessResult,
    ResolvedWriteRule,
};
use crate::screen_context::{ContextImpactMetadata, DictationContextPacket};
use crate::settings::{
    get_settings, post_process_provider_is_local, AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, warn};
use std::time::Instant;
use tauri::AppHandle;

use super::active_app::preview_app_context_from_override;
use super::prompt::{
    build_apple_system_prompt, build_apple_user_content, build_model_system_prompt,
    build_model_user_content, build_system_prompt, looks_like_builtin_post_process_prompt,
    resolve_tone_context,
};
use super::route::{
    choose_post_process_pass, extract_route_features, should_force_conservative_rewrite,
    PostProcessPass,
};
use super::sanitize::{
    estimate_text_tokens, maybe_apply_verification_request_fallback,
    parse_transcription_field_from_json, sanitize_plain_model_output,
    should_fallback_to_plain_text_drift, strip_invisible_chars, TRANSCRIPTION_FIELD,
};

pub(crate) struct PostProcessExecution {
    pub(crate) result: PostProcessResult,
    pub(crate) prompt_used: Option<String>,
}

pub(super) fn build_post_process_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    final_text: String,
    dictionary_hits: Vec<String>,
    context_impact: Option<ContextImpactMetadata>,
    active_app_context: Option<ActiveAppContext>,
    applied_tone_id: Option<String>,
) -> PostProcessResult {
    let final_text = strip_invisible_chars(&final_text);
    let final_text =
        maybe_apply_verification_request_fallback(raw_text, &final_text).unwrap_or(final_text);

    // Apply drift gate: fall back to normalized text when LLM drifted too far
    let final_text = if should_fallback_to_plain_text_drift(raw_text, &final_text, &normalized_text)
    {
        debug!(
            "Drift gate triggered — falling back to plain text: '{}'",
            normalized_text
        );
        normalized_text.clone()
    } else {
        final_text
    };

    let edits = detect_post_process_edits(raw_text, &normalized_text, &final_text);

    PostProcessResult {
        raw_text: raw_text.to_string(),
        normalized_text,
        final_text,
        dictionary_hits,
        context_impact,
        edits,
        mode: settings.post_process_cleanup_level.mode(),
        cleanup_level: settings.post_process_cleanup_level,
        active_app_context,
        applied_tone_id,
    }
}

pub(super) fn build_apple_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    final_text: String,
    dictionary_hits: Vec<String>,
    context_impact: Option<ContextImpactMetadata>,
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
            context_impact,
            active_app_context,
            applied_tone_id,
        ),
        prompt_used: Some(system_prompt),
    }
}

pub(super) fn apple_fallback_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    dictionary_hits: Vec<String>,
    context_impact: Option<ContextImpactMetadata>,
    active_app_context: Option<ActiveAppContext>,
) -> Option<PostProcessExecution> {
    if settings.fallback_to_raw_on_failure {
        Some(build_apple_result(
            settings,
            raw_text,
            normalized_text.clone(),
            normalized_text,
            dictionary_hits,
            context_impact,
            build_apple_system_prompt(
                settings,
                None,
                false,
                PostProcessPass::Pass1,
                settings.max_rewrite_strength,
                false,
            ),
            active_app_context,
            None,
        ))
    } else {
        None
    }
}

/// Creates a channel whose receiver forwards each accumulated chunk to the
/// overlay `post-process-chunk` event. Emits a `streaming` status on start
/// and `complete` on close. The returned sender should be passed to the LLM
/// client; when the LLM call finishes, dropping it closes the channel and
/// the forwarder task exits.
pub(super) fn spawn_post_process_overlay_forwarder(
    app_handle: &AppHandle,
) -> (crate::llm_client::ChunkSink, tokio::task::JoinHandle<()>) {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
    let app_for_forwarder = app_handle.clone();
    crate::overlay::emit_post_process_status(app_handle, "streaming");
    let handle = tokio::spawn(async move {
        while let Some(accumulated) = rx.recv().await {
            crate::overlay::emit_post_process_chunk(&app_for_forwarder, &accumulated);
        }
        crate::overlay::emit_post_process_status(&app_for_forwarder, "complete");
    });
    (tx, handle)
}

pub(crate) async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
    screen_context: Option<DictationContextPacket>,
    context_impact: Option<ContextImpactMetadata>,
    active_app_context: Option<ActiveAppContext>,
    app_handle: Option<&AppHandle>,
) -> Option<PostProcessExecution> {
    let mut context_impact = context_impact.unwrap_or_default();
    if !settings.post_process_cleanup_level.should_run() {
        debug!("Skipping post-process because cleanup level is raw");
        return None;
    }
    let route_features = extract_route_features(transcription);
    let selected_pass = choose_post_process_pass(transcription);

    if selected_pass == PostProcessPass::Skip {
        debug!(
            "Skipping post-process for short clean utterance ({} words)",
            route_features.word_count
        );
        return None;
    }

    let force_conservative_rewrite = should_force_conservative_rewrite(transcription);
    let prefers_stronger_list_rewrite = route_features.has_list_cue
        && (route_features.has_correction_cue || route_features.word_count >= 10);
    let cleanup_rewrite_strength = settings.post_process_cleanup_level.rewrite_strength();
    let effective_rewrite_strength = if force_conservative_rewrite {
        0
    } else {
        match selected_pass {
            PostProcessPass::Skip => unreachable!(),
            PostProcessPass::Pass1 => cleanup_rewrite_strength.min(1),
            PostProcessPass::Pass2 => {
                if prefers_stronger_list_rewrite {
                    cleanup_rewrite_strength.max(2)
                } else {
                    cleanup_rewrite_strength
                }
            }
            PostProcessPass::Command => 2,
        }
    };

    if force_conservative_rewrite {
        debug!(
            "Applying conservative post-process safeguard for low-boundary-confidence utterance"
        );
    }

    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    if settings.local_privacy_mode && !post_process_provider_is_local(&provider) {
        warn!(
            "Local privacy mode blocked non-local provider '{}'; skipping post-processing",
            provider.id
        );
        return None;
    }

    context_impact.context_sent_externally =
        screen_context.is_some() && !post_process_provider_is_local(&provider);

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        let dictionary_result =
            apply_personal_dictionary(transcription, &settings.personal_dictionary);
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let tone_context = resolve_tone_context(settings, active_app_context.as_ref());
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let system_prompt = build_apple_system_prompt(
            settings,
            tone_context.as_ref(),
            screen_context.is_some(),
            selected_pass,
            effective_rewrite_strength,
            force_conservative_rewrite,
        );
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let user_content = build_apple_user_content(
            settings,
            &dictionary_result.text,
            effective_rewrite_strength,
            force_conservative_rewrite,
            screen_context.as_ref(),
            false,
        );
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
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
                    Some(context_impact.clone()),
                    active_app_context,
                );
            }

            // Apple Intelligence does not stream, but we still flip the overlay
            // into a "thinking" state so the user gets feedback during the call.
            if let Some(app) = app_handle {
                crate::overlay::emit_post_process_status(app, "thinking");
            }

            let ai_result = apple_intelligence::process_text_with_system_prompt(
                &system_prompt,
                &user_content,
                0,
            );

            if let Some(app) = app_handle {
                if let Ok(text) = ai_result.as_ref() {
                    let preview = strip_invisible_chars(text);
                    if !preview.trim().is_empty() {
                        crate::overlay::emit_post_process_chunk(app, &preview);
                    }
                }
                crate::overlay::emit_post_process_status(app, "complete");
            }

            return match ai_result {
                Ok(result) => {
                    let final_text = strip_invisible_chars(&result);
                    if final_text.trim().is_empty() {
                        debug!("Apple Intelligence returned an empty response");
                        apple_fallback_result(
                            settings,
                            transcription,
                            dictionary_result.text,
                            dictionary_result.hits,
                            Some(context_impact.clone()),
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
                            Some(context_impact.clone()),
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
                        Some(context_impact.clone()),
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
                Some(context_impact),
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

    let api_key = crate::secret_store::get_post_process_api_key(&provider.id)
        .unwrap_or_else(|error| {
            warn!(
                "Failed to load secure post-process API key for provider '{}': {}",
                provider.id, error
            );
            None
        })
        .unwrap_or_default();

    // Apply personal dictionary before sending to LLM (for all providers)
    let dictionary_result = apply_personal_dictionary(transcription, &settings.personal_dictionary);
    let dict_text = &dictionary_result.text;
    let dict_hits = dictionary_result.hits;
    if !dict_hits.is_empty() {
        debug!(
            "Applied {} personal dictionary correction(s) before LLM post-processing",
            dict_hits.len()
        );
    }

    let tone_context = resolve_tone_context(settings, active_app_context.as_ref());
    let applied_tone_id = tone_context.as_ref().map(|tc| tc.tone_id.clone());
    let tone_app_context = tone_context
        .as_ref()
        .map(|tc| tc.active_app_context.clone());
    let mut base_system_prompt = build_model_system_prompt(
        settings,
        tone_context.as_ref(),
        screen_context.is_some(),
        selected_pass,
        effective_rewrite_strength,
        force_conservative_rewrite,
        &model,
    );
    let custom_prompt = build_system_prompt(&prompt);
    if !custom_prompt.is_empty() && !looks_like_builtin_post_process_prompt(&custom_prompt) {
        base_system_prompt.push_str("\n\nAdditional custom instructions:\n");
        base_system_prompt.push_str(&custom_prompt);
    } else if !custom_prompt.is_empty() {
        debug!("Skipping duplicate built-in post-process prompt instructions");
    }

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = base_system_prompt.clone();
        let user_content = build_model_user_content(
            settings,
            dict_text,
            effective_rewrite_strength,
            force_conservative_rewrite,
            screen_context.as_ref(),
            !post_process_provider_is_local(&provider),
            &model,
        );

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
        let estimated_prompt_tokens = estimate_text_tokens(&system_prompt)
            + estimate_text_tokens(&user_content)
            + estimate_text_tokens(&json_schema.to_string());
        let request_started_at = Instant::now();

        debug!(
            "Dispatching structured post-process request (provider='{}', model='{}', prompt_tokens_est={})",
            provider.id,
            model,
            estimated_prompt_tokens
        );

        let (structured_chunk_tx, structured_forwarder) = match app_handle {
            Some(app) => {
                let (tx, handle) = spawn_post_process_overlay_forwarder(app);
                (Some(tx), Some(handle))
            }
            None => (None, None),
        };

        let structured_result = crate::llm_client::send_chat_completion_with_schema_streaming(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt.clone()),
            Some(json_schema),
            structured_chunk_tx,
        )
        .await;

        if let Some(handle) = structured_forwarder {
            let _ = handle.await;
        }

        match structured_result {
            Ok(Some(content)) => {
                debug!(
                    "Structured post-process request finished in {:?} (provider='{}', model='{}', prompt_tokens_est={})",
                    request_started_at.elapsed(),
                    provider.id,
                    model,
                    estimated_prompt_tokens
                );
                if let Some(result) = parse_transcription_field_from_json(&content) {
                    debug!(
                        "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                        provider.id,
                        result.len()
                    );
                    return Some(PostProcessExecution {
                        result: build_post_process_result(
                            settings,
                            transcription,
                            dict_text.clone(),
                            result.clone(),
                            dict_hits.clone(),
                            Some(context_impact.clone()),
                            tone_app_context.clone(),
                            applied_tone_id.clone(),
                        ),
                        prompt_used: Some(system_prompt.clone()),
                    });
                }

                warn!(
                    "Structured output for provider '{}' was malformed or missing the transcription field; retrying in plain-text mode",
                    provider.id
                );
                // Fall through to legacy mode below rather than trusting malformed content.
            }
            Ok(None) => {
                debug!(
                    "Structured post-process request finished in {:?} without content (provider='{}', model='{}', prompt_tokens_est={})",
                    request_started_at.elapsed(),
                    provider.id,
                    model,
                    estimated_prompt_tokens
                );
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                debug!(
                    "Structured post-process request failed in {:?} (provider='{}', model='{}', prompt_tokens_est={})",
                    request_started_at.elapsed(),
                    provider.id,
                    model,
                    estimated_prompt_tokens
                );
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: send system/user split so tiny models respect instructions
    let system_prompt = base_system_prompt.clone();
    let user_content = build_model_user_content(
        settings,
        dict_text,
        effective_rewrite_strength,
        force_conservative_rewrite,
        screen_context.as_ref(),
        !post_process_provider_is_local(&provider),
        &model,
    );
    let estimated_prompt_tokens =
        estimate_text_tokens(&system_prompt) + estimate_text_tokens(&user_content);
    let request_started_at = Instant::now();

    debug!(
        "Dispatching plain-text post-process request (provider='{}', model='{}', prompt_tokens_est={})",
        provider.id,
        model,
        estimated_prompt_tokens
    );

    let (plain_chunk_tx, plain_forwarder) = match app_handle {
        Some(app) => {
            let (tx, handle) = spawn_post_process_overlay_forwarder(app);
            (Some(tx), Some(handle))
        }
        None => (None, None),
    };

    let plain_result = crate::llm_client::send_chat_completion_with_schema_streaming(
        &provider,
        api_key,
        &model,
        user_content,
        Some(system_prompt.clone()),
        None,
        plain_chunk_tx,
    )
    .await;

    if let Some(handle) = plain_forwarder {
        let _ = handle.await;
    }

    match plain_result {
        Ok(Some(content)) => {
            debug!(
                "Plain-text post-process request finished in {:?} (provider='{}', model='{}', prompt_tokens_est={})",
                request_started_at.elapsed(),
                provider.id,
                model,
                estimated_prompt_tokens
            );
            let Some(content) = sanitize_plain_model_output(&content) else {
                warn!(
                    "LLM post-processing for provider '{}' returned non-transcript output; falling back to non-LLM result",
                    provider.id
                );
                return None;
            };

            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(PostProcessExecution {
                result: build_post_process_result(
                    settings,
                    transcription,
                    dict_text.clone(),
                    content.clone(),
                    dict_hits,
                    Some(context_impact),
                    tone_app_context.clone(),
                    applied_tone_id.clone(),
                ),
                prompt_used: Some(system_prompt),
            })
        }
        Ok(None) => {
            debug!(
                "Plain-text post-process request finished in {:?} without content (provider='{}', model='{}', prompt_tokens_est={})",
                request_started_at.elapsed(),
                provider.id,
                model,
                estimated_prompt_tokens
            );
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            debug!(
                "Plain-text post-process request failed in {:?} (provider='{}', model='{}', prompt_tokens_est={})",
                request_started_at.elapsed(),
                provider.id,
                model,
                estimated_prompt_tokens
            );
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
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

    post_process_transcription(
        &settings,
        &base_text,
        None,
        None,
        active_app_context,
        Some(app),
    )
    .await
    .map(|execution| execution.result)
    .ok_or_else(|| "Post-processing did not produce a result".to_string())
}

pub(crate) async fn preview_write_rule(
    app: &AppHandle,
    rule_id: &str,
    transcription: &str,
) -> Result<PostProcessResult, String> {
    let settings = get_settings(app);
    let rule = settings
        .write_rules
        .iter()
        .find(|rule| rule.id == rule_id)
        .cloned()
        .ok_or_else(|| "Dictation Mode was not found.".to_string())?;

    let preview_bundle_id = rule
        .matchers
        .bundle_ids
        .iter()
        .find(|bundle_id| !bundle_id.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| "voxjot.preview-mode".to_string());
    let active_app_context = ActiveAppContext {
        bundle_id: preview_bundle_id.clone(),
        localized_name: rule.name.clone(),
    };
    let resolved = ResolvedWriteRule {
        rule_id: rule.id.clone(),
        rule_name: rule.name.clone(),
        matched_bundle_id: Some(preview_bundle_id.clone()),
        matched_app_name: Some(rule.name.clone()),
        matched_url: rule.matchers.url_patterns.first().cloned(),
        matched_url_pattern: rule.matchers.url_patterns.first().cloned(),
        overrides: rule.overrides.clone(),
    };

    let mut preview_settings =
        crate::write_rules::apply_resolved_rule_to_settings(&settings, Some(&resolved));
    let mut forced_rule = rule.clone();
    forced_rule.enabled = true;
    forced_rule.matchers.bundle_ids = vec![preview_bundle_id];
    forced_rule.matchers.url_patterns.clear();
    preview_settings.write_rules = vec![forced_rule];
    if rule.overrides.tone_id.is_some() {
        preview_settings.app_aware_tone_enabled = true;
    }

    let base_text = maybe_convert_chinese_variant(&preview_settings, transcription)
        .await
        .unwrap_or_else(|| transcription.to_string());
    let dictionary_result =
        apply_personal_dictionary(&base_text, &preview_settings.personal_dictionary);

    if let Some(execution) = post_process_transcription(
        &preview_settings,
        &dictionary_result.text,
        None,
        None,
        Some(active_app_context.clone()),
        Some(app),
    )
    .await
    {
        return Ok(execution.result);
    }

    Ok(build_post_process_result(
        &preview_settings,
        transcription,
        dictionary_result.text.clone(),
        dictionary_result.text,
        dictionary_result.hits,
        None,
        Some(active_app_context),
        rule.overrides.tone_id.clone(),
    ))
}

pub(crate) async fn maybe_convert_chinese_variant(
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
