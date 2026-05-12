use crate::settings::{
    TtsAutoReadbackMode, TtsAutoReadbackScope, TtsReadbackTextMode, TtsVoiceTuningSettings,
    TTS_PROVIDER_CHATTERBOX_ID, TTS_PROVIDER_MLX_HIGGS_AUDIO_ID, TTS_PROVIDER_MLX_INDEXTTS_ID,
    TTS_PROVIDER_MLX_IRODORI_TTS_ID, TTS_PROVIDER_MLX_KOKORO_ID,
    TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID, TTS_PROVIDER_MLX_MELOTTS_ID,
    TTS_PROVIDER_MLX_MOSS_TTS_ID, TTS_PROVIDER_MLX_OMNIVOICE_ID, TTS_PROVIDER_MLX_OUTE_ID,
    TTS_PROVIDER_MLX_POCKET_TTS_ID, TTS_PROVIDER_MLX_SOPRANO_ID, TTS_PROVIDER_MLX_VIBEVOICE_ID,
};
use crate::translation::TranslationOrigin;

use super::catalog::{
    first_mlx_audio_model_for_provider, mlx_audio_definition_available,
    mlx_audio_model_supports_inline_tags, mlx_audio_model_unavailable_reason,
    mlx_audio_tts_model_definition, MANAGED_RUNTIME_MODEL_DEFINITIONS, QWEN3_PACK_DEFINITIONS,
};
use super::chunking::chunk_text;
use super::readback::build_auto_speak_plan;
use super::sidecar::{
    build_sidecar_request_payload, sidecar_error_detail, sidecar_request_url_from_base,
};
use super::voices::{is_valid_mlx_voice_id, mlx_voice_label, mlx_voice_locale};

#[test]
fn chunk_text_splits_long_input() {
    let text = format!("{}\n\n{}", "hello ".repeat(250), "world ".repeat(250));
    let chunks = chunk_text(&text);
    assert!(chunks.len() >= 2);
    assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 1200));
}

#[test]
fn auto_speak_plan_prefers_translated_block_when_requested() {
    let mut settings = crate::settings::get_default_settings();
    settings.tts_enabled = true;
    settings.tts_auto_readback_mode = TtsAutoReadbackMode::AfterOutput;
    settings.tts_auto_readback_scope = TtsAutoReadbackScope::DictationAndSelection;
    settings.tts_readback_text_mode = TtsReadbackTextMode::TranslatedBlock;

    let plan = build_auto_speak_plan(
        &settings,
        TranslationOrigin::Dictation,
        false,
        "hola\n\nhello",
        Some("hello"),
        Some("en".to_string()),
    );

    assert!(plan.should_speak);
    assert_eq!(plan.text, "hello");
    assert_eq!(plan.tts_status.as_deref(), Some("pending"));
}

#[test]
fn auto_speak_plan_respects_preview_only_mode() {
    let mut settings = crate::settings::get_default_settings();
    settings.tts_enabled = true;
    settings.tts_auto_readback_mode = TtsAutoReadbackMode::AfterPreviewConfirm;

    let without_preview = build_auto_speak_plan(
        &settings,
        TranslationOrigin::Dictation,
        false,
        "hello",
        None,
        Some("en".to_string()),
    );
    assert!(!without_preview.should_speak);

    let with_preview = build_auto_speak_plan(
        &settings,
        TranslationOrigin::Dictation,
        true,
        "hello",
        None,
        Some("en".to_string()),
    );
    assert!(with_preview.should_speak);
}

#[test]
fn qwen3_catalog_includes_clone_capable_base_pack() {
    let base_pack = QWEN3_PACK_DEFINITIONS
        .iter()
        .find(|definition| definition.id == "qwen3-0.6b-base")
        .expect("qwen3 clone-capable base pack should stay in the catalog");

    assert_eq!(base_pack.label, "Qwen3 0.6B Base");
    assert_eq!(base_pack.locale, "mul");
}

#[test]
fn managed_catalog_includes_chatterbox_turbo() {
    let turbo = MANAGED_RUNTIME_MODEL_DEFINITIONS
        .iter()
        .find(|definition| definition.model_id == "chatterbox-turbo")
        .expect("Chatterbox Turbo should stay in the managed TTS catalog");

    assert_eq!(turbo.provider_id, TTS_PROVIDER_CHATTERBOX_ID);
    assert_eq!(turbo.hf_repo_id, Some("ResembleAI/chatterbox-turbo"));
    assert_eq!(turbo.license_label, Some("MIT"));
    assert!(turbo.supports_voice_cloning);
    assert!(turbo.supports_inline_tags);
}

#[test]
fn managed_catalog_includes_chatterbox_multilingual() {
    let multilingual = MANAGED_RUNTIME_MODEL_DEFINITIONS
        .iter()
        .find(|definition| definition.model_id == "chatterbox-multilingual")
        .expect("Chatterbox Multilingual should stay in the managed TTS catalog");

    assert_eq!(multilingual.provider_id, TTS_PROVIDER_CHATTERBOX_ID);
    assert_eq!(multilingual.hf_repo_id, Some("ResembleAI/chatterbox"));
    assert_eq!(multilingual.license_label, Some("MIT"));
    assert_eq!(multilingual.locale, Some("mul"));
    assert!(multilingual.supported_languages.contains(&"fr"));
    assert!(multilingual.supported_languages.contains(&"zh"));
    assert!(multilingual.supports_voice_cloning);
    assert!(!multilingual.supports_inline_tags);
}

#[test]
fn outetts_checkpoint_is_marked_unavailable() {
    let definition = mlx_audio_tts_model_definition("outetts-0.6b")
        .expect("OuteTTS model definition should remain discoverable");

    assert!(!mlx_audio_definition_available(definition));
    assert!(mlx_audio_model_unavailable_reason(definition.model_id)
        .expect("blocked MLX checkpoints should explain why")
        .contains("temporarily disabled"));
}

#[test]
fn unavailable_mlx_provider_has_no_default_model() {
    assert!(first_mlx_audio_model_for_provider(TTS_PROVIDER_MLX_OUTE_ID).is_none());
}

#[test]
fn inline_tags_are_limited_to_nonverbal_mlx_models() {
    assert!(mlx_audio_model_supports_inline_tags("dia-1.6b"));
    assert!(mlx_audio_model_supports_inline_tags("bark-small"));
    assert!(!mlx_audio_model_supports_inline_tags("qwen3-tts-1.7b"));
    assert!(!mlx_audio_model_supports_inline_tags("kokoro-82m"));
}

#[test]
fn sidecar_payload_uses_preset_owned_identity_and_tuning() {
    let tuning = TtsVoiceTuningSettings {
        tempo_rate: 1.25,
        expressiveness: 0.6,
        exaggeration: 0.7,
        randomness: 0.3,
        guidance: 0.8,
        stability: 0.5,
        repetition_penalty: 1.6,
        style_instructions: Some("warm and steady".to_string()),
        advanced_overrides: std::collections::HashMap::new(),
    };

    let payload = build_sidecar_request_payload(
        "Hello world",
        "chatterbox",
        Some("chatterbox"),
        Some("profile-1"),
        Some("en-US"),
        Some("voice-123"),
        None,
        &tuning,
    );

    assert_eq!(payload["model"], "chatterbox");
    assert_eq!(payload["voice"], "voice-123");
    assert_eq!(payload["profile_id"], "profile-1");
    assert_eq!(payload["extra_controls"]["provider_id"], "chatterbox");
    assert_eq!(payload["extra_controls"]["model_id"], "chatterbox");
    assert_eq!(
        payload["extra_controls"]["tuning"]["tempo_rate"]
            .as_f64()
            .expect("tempo rate should serialize"),
        1.25
    );
    assert!(
        (payload["extra_controls"]["tuning"]["guidance"]
            .as_f64()
            .expect("guidance should serialize")
            - 0.8)
            .abs()
            < 0.0001
    );
    assert_eq!(
        payload["extra_controls"]["tuning"]["style_instructions"],
        "warm and steady"
    );
}

#[test]
fn sidecar_payload_maps_mlx_model_ids_to_huggingface_ids() {
    let tuning = TtsVoiceTuningSettings {
        tempo_rate: 1.0,
        expressiveness: 0.5,
        exaggeration: 0.5,
        randomness: 0.2,
        guidance: 1.0,
        stability: 0.5,
        repetition_penalty: 1.2,
        style_instructions: None,
        advanced_overrides: std::collections::HashMap::new(),
    };

    let payload = build_sidecar_request_payload(
        "Hello world",
        TTS_PROVIDER_MLX_KOKORO_ID,
        Some("kokoro-82m"),
        None,
        Some("en-US"),
        None,
        None,
        &tuning,
    );

    assert_eq!(payload["model"], "mlx-community/Kokoro-82M-bf16");
    assert_eq!(
        payload["extra_controls"]["model_id"],
        "mlx-community/Kokoro-82M-bf16"
    );
}

#[test]
fn sidecar_payload_maps_new_mlx_model_ids_to_huggingface_ids() {
    let tuning = TtsVoiceTuningSettings {
        tempo_rate: 1.0,
        expressiveness: 0.5,
        exaggeration: 0.5,
        randomness: 0.2,
        guidance: 1.0,
        stability: 0.5,
        repetition_penalty: 1.2,
        style_instructions: None,
        advanced_overrides: std::collections::HashMap::new(),
    };

    let payload = build_sidecar_request_payload(
        "Hello world",
        TTS_PROVIDER_MLX_POCKET_TTS_ID,
        Some("pocket-tts-4bit"),
        None,
        Some("en-US"),
        None,
        None,
        &tuning,
    );

    assert_eq!(payload["model"], "mlx-community/pocket-tts-4bit");
    assert_eq!(
        payload["extra_controls"]["model_id"],
        "mlx-community/pocket-tts-4bit"
    );
}

#[test]
fn sidecar_payload_maps_expanded_mlx_provider_catalog_to_huggingface_ids() {
    let tuning = TtsVoiceTuningSettings {
        tempo_rate: 1.0,
        expressiveness: 0.5,
        exaggeration: 0.5,
        randomness: 0.2,
        guidance: 1.0,
        stability: 0.5,
        repetition_penalty: 1.2,
        style_instructions: None,
        advanced_overrides: std::collections::HashMap::new(),
    };

    let cases: &[(&str, &str, &str)] = &[
        (
            TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID,
            "longcat-audiodit-1b-4bit",
            "mlx-community/LongCat-AudioDiT-1B-4bit",
        ),
        (
            TTS_PROVIDER_MLX_SOPRANO_ID,
            "soprano-80m-4bit",
            "mlx-community/Soprano-80M-4bit",
        ),
        (
            TTS_PROVIDER_MLX_MELOTTS_ID,
            "melotts-english",
            "mlx-community/MeloTTS-English-MLX",
        ),
        (
            TTS_PROVIDER_MLX_HIGGS_AUDIO_ID,
            "higgs-audio-v2-3b-q6",
            "mlx-community/higgs-audio-v2-3B-mlx-q6",
        ),
        (
            TTS_PROVIDER_MLX_MOSS_TTS_ID,
            "moss-tts-nano-100m",
            "mlx-community/MOSS-TTS-Nano-100M",
        ),
        (
            TTS_PROVIDER_MLX_IRODORI_TTS_ID,
            "irodori-tts-500m-v2-4bit",
            "mlx-community/Irodori-TTS-500M-v2-4bit",
        ),
        (
            TTS_PROVIDER_MLX_INDEXTTS_ID,
            "indextts-1-5",
            "mlx-community/IndexTTS-1.5",
        ),
        (
            TTS_PROVIDER_MLX_OMNIVOICE_ID,
            "omnivoice",
            "k2-fsa/OmniVoice",
        ),
        (
            TTS_PROVIDER_MLX_VIBEVOICE_ID,
            "vibevoice-realtime-0-5b-4bit-mlx",
            "mlx-community/VibeVoice-Realtime-0.5B-4bit",
        ),
    ];

    for (provider_id, model_id, expected_hf_id) in cases {
        let payload = build_sidecar_request_payload(
            "Hello world",
            provider_id,
            Some(model_id),
            None,
            Some("en-US"),
            None,
            None,
            &tuning,
        );

        assert_eq!(
            payload["model"], *expected_hf_id,
            "provider {} model {} should map to HF id {}",
            provider_id, model_id, expected_hf_id
        );
        assert_eq!(
            payload["extra_controls"]["model_id"], *expected_hf_id,
            "provider {} extra_controls.model_id should map to HF id {}",
            provider_id, expected_hf_id
        );
        assert_eq!(payload["extra_controls"]["provider_id"], *provider_id);
    }
}

#[test]
fn sidecar_request_url_uses_resolved_base_url() {
    let url = sidecar_request_url_from_base(
        "http://127.0.0.1:9123/v1/audio/speech?token=abc#fragment",
        "listen/prepare",
    )
    .expect("sidecar URL should resolve");

    assert_eq!(url.as_str(), "http://127.0.0.1:9123/listen/prepare");
}

#[test]
fn sidecar_error_detail_extracts_validation_detail_arrays() {
    let body = r#"{"detail":[{"loc":["body","text"],"msg":"ensure this value has at least 24 characters"}]}"#;

    assert_eq!(
        sidecar_error_detail(body),
        "body.text: ensure this value has at least 24 characters"
    );
}

#[test]
fn mlx_voice_sanitizer_rejects_placeholder_and_model_ids() {
    assert!(!is_valid_mlx_voice_id("__auto__"));
    assert!(!is_valid_mlx_voice_id("qwen3-tts-0.6b"));
    assert!(!is_valid_mlx_voice_id("pocket-tts-4bit"));
    assert!(!is_valid_mlx_voice_id(TTS_PROVIDER_MLX_KOKORO_ID));
    assert!(!is_valid_mlx_voice_id(TTS_PROVIDER_MLX_POCKET_TTS_ID));
    assert!(is_valid_mlx_voice_id("af_heart"));
}

#[test]
fn mlx_voice_helpers_format_kokoro_voice_metadata() {
    assert_eq!(mlx_voice_label("af_heart"), "Heart");
    assert_eq!(mlx_voice_label("jf_gongitsune"), "Gongitsune");
    assert_eq!(mlx_voice_locale("af_heart"), Some("en-US"));
    assert_eq!(mlx_voice_locale("bf_isabella"), Some("en-GB"));
    assert_eq!(mlx_voice_locale("zf_xiaobei"), Some("zh-CN"));
}
