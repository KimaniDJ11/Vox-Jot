use crate::settings::{
    AppSettings, TtsAutoReadbackMode, TtsAutoReadbackScope, TtsEnginePreference,
    TtsReadbackTextMode,
};
use crate::translation::TranslationOrigin;

use super::chunking::normalize_locale;
use super::{SpeakRequest, TtsAutoSpeakPlan};

pub const PREVIEW_SAMPLE_TEXT: &str = r#"After the rain, Mina laughed softly, then whispered, 'Wait - did you hear that?' The room grew quiet, warm, and full of wonder."#;

#[derive(Debug, Clone)]
pub struct LastOutput {
    pub text: String,
    pub locale: Option<String>,
}

pub fn is_preview_trigger(trigger: Option<&str>) -> bool {
    matches!(trigger, Some(value) if value.starts_with("preview_tts_voice"))
}

pub fn build_auto_speak_plan(
    settings: &AppSettings,
    origin: TranslationOrigin,
    had_preview: bool,
    final_text: &str,
    translated_text: Option<&str>,
    locale: Option<String>,
) -> TtsAutoSpeakPlan {
    let scope_allows = match settings.tts_auto_readback_scope {
        TtsAutoReadbackScope::DictationOnly => matches!(origin, TranslationOrigin::Dictation),
        TtsAutoReadbackScope::DictationAndSelection => true,
    };
    let mode_allows = match settings.tts_auto_readback_mode {
        TtsAutoReadbackMode::Off => false,
        TtsAutoReadbackMode::AfterOutput => true,
        TtsAutoReadbackMode::AfterPreviewConfirm => had_preview,
    };

    let should_speak =
        settings.tts_enabled && scope_allows && mode_allows && !final_text.trim().is_empty();
    let text = match settings.tts_readback_text_mode {
        TtsReadbackTextMode::TranslatedBlock => translated_text
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(final_text)
            .to_string(),
        TtsReadbackTextMode::FinalOutput => final_text.to_string(),
    };

    let engine = if should_speak {
        Some(
            match settings.tts_engine_preference {
                TtsEnginePreference::Auto => "auto",
                TtsEnginePreference::System => "system",
                TtsEnginePreference::SherpaOnnx => "sherpa_onnx",
                TtsEnginePreference::Sidecar => "sidecar",
            }
            .to_string(),
        )
    } else {
        None
    };

    TtsAutoSpeakPlan {
        should_speak,
        text,
        locale: locale.clone(),
        trigger: match origin {
            TranslationOrigin::Dictation => "auto_readback_dictation".to_string(),
            TranslationOrigin::Selection => "auto_readback_selection".to_string(),
        },
        tts_requested: should_speak,
        tts_engine: engine,
        tts_voice_id: settings.tts_default_voice_id.clone(),
        tts_locale: locale,
        tts_status: if should_speak {
            Some("pending".to_string())
        } else {
            None
        },
    }
}

pub fn choose_readback_locale(
    settings: &AppSettings,
    origin: TranslationOrigin,
    source_language: Option<&str>,
    target_language: Option<&str>,
) -> Option<String> {
    match settings.tts_readback_text_mode {
        TtsReadbackTextMode::TranslatedBlock => {
            normalize_locale(target_language.or(source_language))
        }
        TtsReadbackTextMode::FinalOutput => {
            if matches!(origin, TranslationOrigin::Dictation)
                && settings.translation_output_mode
                    == crate::settings::TranslationOutputMode::Bilingual
            {
                normalize_locale(target_language.or(source_language))
            } else {
                normalize_locale(source_language.or(target_language))
            }
        }
    }
}

pub fn default_preview_request(
    voice_id: Option<String>,
    preview_text: Option<String>,
) -> SpeakRequest {
    SpeakRequest {
        text: preview_text.unwrap_or_else(|| PREVIEW_SAMPLE_TEXT.to_string()),
        locale: None,
        preferred_voice_id: voice_id,
        preset_id: None,
        inline_preset: None,
        trigger: Some("preview_tts_voice".to_string()),
        remember_last_output: false,
    }
}
