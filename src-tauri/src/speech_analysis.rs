use crate::secret_store;
use crate::settings::{get_settings, write_settings};
use crate::storage_paths;
use futures_util::StreamExt;
use log::info;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs as tokio_fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

pub const CURRENT_DICTATION_ASR_ID: &str = "current_dictation_engine";
pub const NO_DIARIZATION_ID: &str = "no_speaker_labels";
pub const DEFAULT_DIARIZATION_ID: &str = NO_DIARIZATION_ID;
pub const PYANNOTE_COMMUNITY_DIARIZATION_ID: &str = "pyannote-community-1";
pub const POLYVOICE_DIARIZATION_ID: &str = "onnx-polyvoice-diarization";
pub const NO_EMOTION_ID: &str = "no_emotion";
pub const DEFAULT_EMOTION_ID: &str = NO_EMOTION_ID;
pub const EMOTION2VEC_PLUS_LARGE_ID: &str = "emotion2vec-plus-large";

static ACTIVE_DOWNLOADS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static DOWNLOAD_CANCEL_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static ACTIVE_MODEL_USES: Lazy<std::sync::Mutex<HashMap<String, usize>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

const DOWNLOAD_CANCELLED_MESSAGE: &str = "Download cancelled.";

pub struct SpeechAnalysisModelUseGuard {
    model_ids: Vec<String>,
}

impl Drop for SpeechAnalysisModelUseGuard {
    fn drop(&mut self) {
        let mut active = ACTIVE_MODEL_USES
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        for model_id in &self.model_ids {
            let Some(count) = active.get_mut(model_id) else {
                continue;
            };
            *count = count.saturating_sub(1);
            if *count == 0 {
                active.remove(model_id);
            }
        }
    }
}

pub fn mark_models_in_use<I>(model_ids: I) -> SpeechAnalysisModelUseGuard
where
    I: IntoIterator<Item = String>,
{
    let model_ids = model_ids
        .into_iter()
        .map(|model_id| model_id.trim().to_string())
        .filter(|model_id| !model_id.is_empty())
        .collect::<Vec<_>>();
    if !model_ids.is_empty() {
        let mut active = ACTIVE_MODEL_USES
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        for model_id in &model_ids {
            *active.entry(model_id.clone()).or_insert(0) += 1;
        }
    }
    SpeechAnalysisModelUseGuard { model_ids }
}

pub fn model_in_use(model_id: &str) -> bool {
    let active = ACTIVE_MODEL_USES
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    active.get(model_id).copied().unwrap_or(0) > 0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SpeechAnalysisTask {
    Asr,
    Diarization,
    AsrDiarization,
    Emotion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SpeechAnalysisEngine {
    CurrentDictation,
    Transformers,
    OnnxRuntime,
    Pyannote,
    Diarizen,
    Nemo,
    Reverb,
    WhisperDiarization,
    CoreMl,
    Mlx,
    Funasr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SpeechAnalysisRuntime {
    InProcess,
    PythonSidecar,
    OnnxCoreMl,
    OnnxCpu,
    MlxNative,
    CoreMlNative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SpeechAnalysisReadiness {
    BuiltIn,
    RequiresRuntimeInstall,
    RequiresModelDownload,
    RequiresHfToken,
    Blocked,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SpeechAnalysisSourceKind {
    BuiltIn,
    HuggingFace,
    GitHub,
    LocalOnnxBundle,
    RuntimeManaged,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeechAnalysisCapabilityFlags {
    pub file_transcription: bool,
    pub live_dictation: bool,
    pub speaker_labels: bool,
    pub timestamps: bool,
    pub word_timestamps: bool,
    pub requires_hf_token: bool,
    pub requires_trust_remote_code: bool,
    pub requires_cloud_gpu_validation: bool,
    pub supports_onnx: bool,
    pub supports_coreml: bool,
    pub supports_mlx: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeechAnalysisModelDescriptor {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub repo_id: Option<String>,
    pub source_kind: SpeechAnalysisSourceKind,
    pub source_url: Option<String>,
    pub license_label: Option<String>,
    pub gated: bool,
    pub downloadable: bool,
    pub installed: bool,
    pub local_path: Option<String>,
    pub size_hint_label: Option<String>,
    pub task: SpeechAnalysisTask,
    pub engine: SpeechAnalysisEngine,
    pub runtime: SpeechAnalysisRuntime,
    pub description: String,
    pub readiness: SpeechAnalysisReadiness,
    pub supported_languages: Vec<String>,
    pub output_contract: Vec<String>,
    pub capabilities: SpeechAnalysisCapabilityFlags,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeechAnalysisSelection {
    pub asr_model_id: String,
    pub diarization_model_id: String,
    pub emotion_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct EmotionScore {
    pub label: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct EmotionResult {
    pub source_model_id: String,
    pub top_label: String,
    pub top_score: f32,
    pub scores: Vec<EmotionScore>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeechAnalysisCatalog {
    pub models: Vec<SpeechAnalysisModelDescriptor>,
    pub selection: SpeechAnalysisSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct HuggingFaceTokenStatus {
    pub configured: bool,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct SpeakerTurn {
    pub speaker_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub confidence: Option<f32>,
    pub source_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct SpeechAnalysisSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct SpeakerLabeledSegment {
    pub speaker_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub confidence: Option<f32>,
}

fn langs(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn outputs(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn capability(
    speaker_labels: bool,
    timestamps: bool,
    word_timestamps: bool,
    requires_hf_token: bool,
    requires_trust_remote_code: bool,
    requires_cloud_gpu_validation: bool,
    supports_onnx: bool,
    supports_coreml: bool,
    supports_mlx: bool,
) -> SpeechAnalysisCapabilityFlags {
    SpeechAnalysisCapabilityFlags {
        file_transcription: true,
        live_dictation: false,
        speaker_labels,
        timestamps,
        word_timestamps,
        requires_hf_token,
        requires_trust_remote_code,
        requires_cloud_gpu_validation,
        supports_onnx,
        supports_coreml,
        supports_mlx,
    }
}

/// Mark a capability set as also usable on the live dictation path. File-ASR
/// catalog entries default to `live_dictation: false`; models wired into the
/// `TranscriptionManager` engine path (e.g. Higgs Audio v3) opt in here.
fn with_live_dictation(
    mut capabilities: SpeechAnalysisCapabilityFlags,
) -> SpeechAnalysisCapabilityFlags {
    capabilities.live_dictation = true;
    capabilities
}

#[allow(clippy::too_many_arguments)]
fn descriptor(
    id: &str,
    label: &str,
    provider: &str,
    repo_id: Option<&str>,
    source_kind: SpeechAnalysisSourceKind,
    source_url: Option<&str>,
    license_label: Option<&str>,
    gated: bool,
    downloadable: bool,
    size_hint_label: Option<&str>,
    task: SpeechAnalysisTask,
    engine: SpeechAnalysisEngine,
    runtime: SpeechAnalysisRuntime,
    description: &str,
    readiness: SpeechAnalysisReadiness,
    supported_languages: &[&str],
    output_contract: &[&str],
    capabilities: SpeechAnalysisCapabilityFlags,
) -> SpeechAnalysisModelDescriptor {
    SpeechAnalysisModelDescriptor {
        id: id.to_string(),
        label: label.to_string(),
        provider: provider.to_string(),
        repo_id: repo_id.map(str::to_string),
        source_kind,
        source_url: source_url
            .map(str::to_string)
            .or_else(|| repo_id.map(|repo| format!("https://huggingface.co/{repo}"))),
        license_label: license_label.map(str::to_string),
        gated,
        downloadable,
        installed: matches!(
            source_kind,
            SpeechAnalysisSourceKind::BuiltIn | SpeechAnalysisSourceKind::RuntimeManaged
        ),
        local_path: None,
        size_hint_label: size_hint_label.map(str::to_string),
        task,
        engine,
        runtime,
        description: description.to_string(),
        readiness,
        supported_languages: langs(supported_languages),
        output_contract: outputs(output_contract),
        capabilities,
    }
}

pub fn built_in_catalog_models() -> Vec<SpeechAnalysisModelDescriptor> {
    vec![
        descriptor(
            CURRENT_DICTATION_ASR_ID,
            "Current Dictation Engine",
            "Vox Jot",
            None,
            SpeechAnalysisSourceKind::BuiltIn,
            None,
            None,
            false,
            false,
            None,
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::CurrentDictation,
            SpeechAnalysisRuntime::InProcess,
            "Uses the currently selected low-latency Vox Jot transcription engine.",
            SpeechAnalysisReadiness::BuiltIn,
            &["mul"],
            &["text", "segments_when_available"],
            capability(false, true, false, false, false, false, false, false, false),
        ),
        descriptor(
            NO_DIARIZATION_ID,
            "No Speaker Labels",
            "Vox Jot",
            None,
            SpeechAnalysisSourceKind::BuiltIn,
            None,
            None,
            false,
            false,
            None,
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::CurrentDictation,
            SpeechAnalysisRuntime::InProcess,
            "Keeps file transcription on the selected ASR engine without running speaker diarization.",
            SpeechAnalysisReadiness::BuiltIn,
            &["mul"],
            &["none"],
            capability(false, false, false, false, false, false, false, false, false),
        ),
        descriptor(
            "granite-speech-4-1-2b",
            "Granite Speech 4.1 2B",
            "IBM Granite",
            Some("ibm-granite/granite-speech-4.1-2b"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~4.6 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Transformers,
            SpeechAnalysisRuntime::PythonSidecar,
            "Transformers ASR adapter for Granite Speech 4.1 2B.",
            SpeechAnalysisReadiness::Ready,
            &["en", "fr", "de", "es", "pt", "ja"],
            &["text", "segments"],
            capability(false, true, false, false, true, true, false, false, false),
        ),
        descriptor(
            "cohere-transcribe-03-2026",
            "Cohere Transcribe 03-2026",
            "CohereLabs",
            Some("CohereLabs/cohere-transcribe-03-2026"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            true,
            true,
            Some("~4 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Transformers,
            SpeechAnalysisRuntime::PythonSidecar,
            "Transformers/vLLM-compatible ASR adapter for Cohere Transcribe.",
            SpeechAnalysisReadiness::RequiresHfToken,
            &[
                "en", "fr", "de", "it", "es", "pt", "el", "nl", "pl", "ja", "ko", "zh", "ar", "tr",
            ],
            &["text", "segments"],
            capability(false, true, false, true, true, true, false, false, false),
        ),
        descriptor(
            "higgs-audio-v3-stt",
            "Higgs Audio v3 STT",
            "Boson AI",
            Some("bosonai/higgs-audio-v3-stt"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~5.1 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Transformers,
            SpeechAnalysisRuntime::PythonSidecar,
            "Whisper-Large-v3 encoder plus Qwen3 decoder ASR through the model's Transformers custom code. Also available for live dictation via a cached Transformers server.",
            SpeechAnalysisReadiness::Ready,
            &["en"],
            &["text"],
            with_live_dictation(capability(
                false, false, false, false, true, false, false, false, false,
            )),
        ),
        descriptor(
            "gemma4-e2b-audio",
            "Gemma 4 E2B Audio",
            "Google",
            Some("google/gemma-4-E2B-it"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~5.1 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Transformers,
            SpeechAnalysisRuntime::PythonSidecar,
            "Gemma 4 multimodal ASR through Transformers AutoModelForMultimodalLM.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["text"],
            capability(false, false, false, false, false, false, false, false, false),
        ),
        descriptor(
            "gemma4-e2b-audio-mlx",
            "Gemma 4 E2B Audio 4-bit (MLX)",
            "MLX Community",
            Some("mlx-community/gemma-4-e2b-it-4bit"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~2.6 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::PythonSidecar,
            "Quantized Gemma 4 E2B audio transcription through mlx-vlm on Apple Silicon.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["text"],
            capability(false, false, false, false, false, false, false, false, false),
        ),
        descriptor(
            "gemma4-e4b-audio",
            "Gemma 4 E4B Audio",
            "Google",
            Some("google/gemma-4-E4B-it"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~8 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Transformers,
            SpeechAnalysisRuntime::PythonSidecar,
            "Larger Gemma 4 multimodal ASR model through Transformers.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["text"],
            capability(false, false, false, false, false, false, false, false, false),
        ),
        descriptor(
            "mlx-qwen3-asr-0.6b",
            "Qwen3 ASR 0.6B (MLX)",
            "Alibaba Qwen",
            Some("mlx-community/Qwen3-ASR-0.6B-8bit"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~900 MB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "MLX Qwen3 ASR checkpoint for multilingual file transcription on Apple Silicon.",
            SpeechAnalysisReadiness::Ready,
            &["zh", "en", "ja", "ko", "mul"],
            &["text", "segments"],
            capability(false, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "mlx-qwen3-asr",
            "Qwen3 ASR 1.7B (MLX)",
            "Alibaba Qwen",
            Some("mlx-community/Qwen3-ASR-1.7B-8bit"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~2 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "Larger MLX Qwen3 ASR checkpoint for higher-quality multilingual file transcription.",
            SpeechAnalysisReadiness::Ready,
            &["zh", "en", "ja", "ko", "mul"],
            &["text", "segments"],
            capability(false, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "mlx-fireredasr2-aed",
            "FireRedASR2 AED (MLX)",
            "Xiaohongshu",
            Some("mlx-community/FireRedASR2-AED-mlx"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~2.6 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "Chinese and English conformer-decoder ASR through mlx-audio.",
            SpeechAnalysisReadiness::Ready,
            &["zh", "en"],
            &["text"],
            capability(false, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "mlx-vibevoice-asr-bf16",
            "VibeVoice ASR 9B (MLX)",
            "Microsoft",
            Some("mlx-community/VibeVoice-ASR-bf16"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("MIT"),
            false,
            true,
            Some("~18 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "Large MLX ASR model with timestamp and diarization-oriented outputs for long-form file transcription.",
            SpeechAnalysisReadiness::Ready,
            &["en", "zh"],
            &["text", "segments"],
            capability(true, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "mlx-nemotron-asr-streaming-0.6b",
            "Nemotron 3.5 ASR Streaming 0.6B (MLX)",
            "NVIDIA",
            Some("mlx-community/nemotron-3.5-asr-streaming-0.6b"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("NVIDIA Open Model License"),
            false,
            true,
            Some("~800 MB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "Streaming FastConformer-RNNT multilingual ASR through mlx-audio.",
            SpeechAnalysisReadiness::Ready,
            &[
                "en", "es", "de", "fr", "it", "ar", "ja", "ko", "pt", "ru", "hi", "zh", "vi",
                "he", "nl", "cs", "da", "pl", "no", "sv", "th", "tr", "bg", "el", "et", "fi",
                "hr", "hu", "lt", "lv", "ro", "sk", "uk", "mt",
            ],
            &["text"],
            capability(false, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "mlx-mega-asr",
            "Mega-ASR 8-bit (MLX)",
            "Mega-ASR",
            Some("mlx-community/Mega-ASR-8bit"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Apache-2.0"),
            false,
            true,
            Some("~1.1 GB"),
            SpeechAnalysisTask::Asr,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "Quantized Mega-ASR for English and Mandarin file transcription through mlx-audio.",
            SpeechAnalysisReadiness::Ready,
            &["en", "zh"],
            &["text"],
            capability(false, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "pyannote-community-1",
            "PyAnnote Community-1",
            "pyannote",
            Some("pyannote/speaker-diarization-community-1"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("CC-BY-4.0"),
            true,
            true,
            Some("~350 MB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::Pyannote,
            SpeechAnalysisRuntime::PythonSidecar,
            "Default open-source pyannote diarization adapter for speaker turns.",
            SpeechAnalysisReadiness::RequiresHfToken,
            &["mul"],
            &["speaker_turns", "rttm"],
            capability(true, true, false, true, false, true, false, false, false),
        ),
        descriptor(
            "pyannote-3-1",
            "PyAnnote 3.1",
            "pyannote",
            Some("pyannote/speaker-diarization-3.1"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("MIT"),
            true,
            true,
            Some("~450 MB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::Pyannote,
            SpeechAnalysisRuntime::PythonSidecar,
            "Legacy gated pyannote 3.1 speaker diarization pipeline.",
            SpeechAnalysisReadiness::RequiresHfToken,
            &["mul"],
            &["speaker_turns", "rttm"],
            capability(true, true, false, true, false, true, false, false, false),
        ),
        descriptor(
            "mlx-sortformer-4spk-v1",
            "Sortformer 4spk v1 (MLX)",
            "NVIDIA",
            Some("mlx-community/diar_sortformer_4spk-v1-fp16"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            None,
            false,
            true,
            Some("~180 MB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "MLX Sortformer diarization adapter for up to four speakers.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["speaker_turns"],
            capability(true, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "mlx-sortformer-4spk-v2-1",
            "Sortformer 4spk v2.1 (MLX)",
            "NVIDIA",
            Some("mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            None,
            false,
            true,
            Some("~250 MB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::Mlx,
            SpeechAnalysisRuntime::MlxNative,
            "Streaming MLX Sortformer v2.1 diarization adapter with AOSC compression.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["speaker_turns"],
            capability(true, true, false, false, true, false, false, false, true),
        ),
        descriptor(
            "reverb-diarization-v2",
            "Revai Reverb Diarization V2",
            "Revai",
            Some("Revai/reverb-diarization-v2"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("Custom / gated"),
            true,
            true,
            Some("~430 MB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::Reverb,
            SpeechAnalysisRuntime::PythonSidecar,
            "Revai Reverb V2 diarization adapter built around pyannote-style output.",
            SpeechAnalysisReadiness::RequiresHfToken,
            &["mul"],
            &["speaker_turns", "rttm"],
            capability(true, true, false, true, true, true, false, false, false),
        ),
        descriptor(
            "whisper-diarization",
            "Whisper Diarization",
            "WhisperX",
            Some("Systran/faster-whisper-large-v3"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("MIT"),
            false,
            true,
            Some("~3 GB"),
            SpeechAnalysisTask::AsrDiarization,
            SpeechAnalysisEngine::WhisperDiarization,
            SpeechAnalysisRuntime::PythonSidecar,
            "WhisperX ASR with speaker diarization through the Python sidecar.",
            SpeechAnalysisReadiness::RequiresModelDownload,
            &["mul"],
            &["text", "segments", "speaker_turns", "speaker_segments"],
            capability(true, true, true, false, true, true, false, false, false),
        ),
        descriptor(
            "onnx-polyvoice-diarization",
            "Polyvoice ONNX Diarization",
            "polyvoice",
            Some("Wespeaker/wespeaker-voxceleb-resnet34"),
            SpeechAnalysisSourceKind::LocalOnnxBundle,
            Some("https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34"),
            None,
            false,
            false,
            Some("~170 MB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::OnnxRuntime,
            SpeechAnalysisRuntime::OnnxCpu,
            "ONNX diarization pipeline using Silero VAD, WeSpeaker ResNet34 embeddings, and AHC clustering.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["speaker_turns", "rttm"],
            capability(true, true, false, false, false, false, true, false, false),
        ),
        descriptor(
            NO_EMOTION_ID,
            "No Emotion Labels",
            "Vox Jot",
            None,
            SpeechAnalysisSourceKind::BuiltIn,
            None,
            None,
            false,
            false,
            None,
            SpeechAnalysisTask::Emotion,
            SpeechAnalysisEngine::CurrentDictation,
            SpeechAnalysisRuntime::InProcess,
            "Skips speech emotion recognition during file transcription.",
            SpeechAnalysisReadiness::BuiltIn,
            &["mul"],
            &["none"],
            capability(false, false, false, false, false, false, false, false, false),
        ),
        descriptor(
            EMOTION2VEC_PLUS_LARGE_ID,
            "emotion2vec+ Large",
            "emotion2vec",
            Some("emotion2vec/emotion2vec_plus_large"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("emotion2vec License"),
            false,
            true,
            Some("~1.8 GB"),
            SpeechAnalysisTask::Emotion,
            SpeechAnalysisEngine::Funasr,
            SpeechAnalysisRuntime::PythonSidecar,
            "Speech emotion recognition over eight classes (angry, disgusted, fearful, happy, neutral, other, sad, surprised) through FunASR.",
            SpeechAnalysisReadiness::Ready,
            &["en", "zh"],
            &["emotion"],
            capability(false, false, false, false, false, false, false, false, false),
        ),
    ]
}

#[derive(Debug, Deserialize)]
struct HfModelInfo {
    siblings: Vec<HfSibling>,
}

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SpeechAnalysisDownloadProgress {
    pub model_id: String,
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub file: Option<String>,
    pub file_index: Option<usize>,
    pub file_count: Option<usize>,
    pub error: Option<String>,
}

fn install_dir(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    if let Some(path) = crate::shared_model_assets::shared_model_primary_install_dir(app, model_id)?
    {
        return Ok(path);
    }

    Ok(storage_paths::speech_analysis_models_dir(app)
        .map_err(|err| format!("Failed to resolve speech analysis model dir: {err}"))?
        .join(model_id))
}

fn staging_dir(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    if let Some(path) = crate::shared_model_assets::shared_model_primary_staging_dir(app, model_id)?
    {
        return Ok(path);
    }

    Ok(storage_paths::speech_analysis_models_dir(app)
        .map_err(|err| format!("Failed to resolve speech analysis staging dir: {err}"))?
        .join(format!("{model_id}.partial")))
}

async fn cleanup_staging_dir(app: &AppHandle, model_id: &str) -> Result<(), String> {
    let staging = staging_dir(app, model_id)?;
    if staging.exists() {
        tokio_fs::remove_dir_all(&staging)
            .await
            .map_err(|err| format!("Failed to remove partial download: {err}"))?;
    }
    Ok(())
}

fn ensure_download_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        Err(DOWNLOAD_CANCELLED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

fn bundled_polyvoice_dir() -> Option<PathBuf> {
    let candidate = std::env::current_dir()
        .ok()?
        .join("src-tauri")
        .join("resources")
        .join("models")
        .join("polyvoice");
    candidate.exists().then_some(candidate)
}

fn readiness_for(
    app: &AppHandle,
    model: &SpeechAnalysisModelDescriptor,
    installed: bool,
) -> SpeechAnalysisReadiness {
    if installed {
        if model_uses_gemma_audio_runtime(&model.id)
            && !crate::sidecar::SidecarManager::gemma_audio_runtime_installed_for_app(app)
        {
            return SpeechAnalysisReadiness::RequiresRuntimeInstall;
        }
        if matches!(model.runtime, SpeechAnalysisRuntime::MlxNative)
            && !crate::sidecar::SidecarManager::mlx_audio_runtime_installed_for_app(app)
        {
            return SpeechAnalysisReadiness::RequiresRuntimeInstall;
        }
        if matches!(
            model.runtime,
            SpeechAnalysisRuntime::PythonSidecar | SpeechAnalysisRuntime::OnnxCpu
        ) && !crate::sidecar::SidecarManager::speech_analysis_runtime_installed_for_app(app)
        {
            return SpeechAnalysisReadiness::RequiresRuntimeInstall;
        }
        return SpeechAnalysisReadiness::Ready;
    }
    if model.downloadable {
        return if model.gated {
            SpeechAnalysisReadiness::RequiresHfToken
        } else {
            SpeechAnalysisReadiness::RequiresModelDownload
        };
    }
    model.readiness
}

fn descriptor_with_install_state(
    app: &AppHandle,
    mut model: SpeechAnalysisModelDescriptor,
) -> SpeechAnalysisModelDescriptor {
    let installed_shared_model_path =
        crate::shared_model_assets::installed_shared_model_dir(app, &model.id)
            .ok()
            .flatten();

    let local_path = match model.source_kind {
        SpeechAnalysisSourceKind::BuiltIn | SpeechAnalysisSourceKind::RuntimeManaged => None,
        SpeechAnalysisSourceKind::LocalOnnxBundle if model.id == POLYVOICE_DIARIZATION_ID => {
            crate::portable::resolve_resource(app, "resources/models/polyvoice")
                .ok()
                .or_else(bundled_polyvoice_dir)
        }
        SpeechAnalysisSourceKind::HuggingFace
            if crate::shared_model_assets::is_shared_model_asset(&model.id) =>
        {
            installed_shared_model_path
                .clone()
                .or_else(|| install_dir(app, &model.id).ok())
        }
        _ => install_dir(app, &model.id).ok(),
    };

    let installed = match model.source_kind {
        SpeechAnalysisSourceKind::BuiltIn | SpeechAnalysisSourceKind::RuntimeManaged => true,
        SpeechAnalysisSourceKind::GitHub => false,
        SpeechAnalysisSourceKind::LocalOnnxBundle => {
            local_path.as_ref().is_some_and(|p| p.exists())
        }
        SpeechAnalysisSourceKind::HuggingFace => local_path
            .as_ref()
            .is_some_and(|p| hugging_face_model_has_required_files(&model.id, p)),
    };

    model.installed = installed;
    model.local_path = local_path.map(|p| p.to_string_lossy().to_string());
    model.readiness = readiness_for(app, &model, installed);
    model
}

fn hugging_face_model_has_required_files(model_id: &str, path: &Path) -> bool {
    if crate::shared_model_assets::is_shared_model_asset(model_id) {
        return crate::shared_model_assets::shared_model_has_required_files(model_id, path);
    }

    let required_files: &[&str] = match model_id {
        "granite-speech-4-1-2b" => &["config.json", "model.safetensors.index.json"],
        "cohere-transcribe-03-2026" => &["config.json", "model.safetensors"],
        "higgs-audio-v3-stt" => &[
            "config.json",
            "generation_config.json",
            "higgs_audio_collator.py",
            "model-00001-of-00002.safetensors",
            "model-00002-of-00002.safetensors",
            "model.safetensors.index.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "transcribe.py",
        ],
        "gemma4-e2b-audio" | "gemma4-e4b-audio" => &[
            "config.json",
            "model.safetensors",
            "processor_config.json",
            "tokenizer.json",
        ],
        "mlx-sortformer-4spk-v1" | "mlx-sortformer-4spk-v2-1" => {
            &["config.json", "model.safetensors"]
        }
        "pyannote-community-1" => &["config.yaml"],
        "pyannote-3-1" => &[
            "config.yaml",
            "segmentation/config.yaml",
            "segmentation/pytorch_model.bin",
            "embedding/config.yaml",
            "embedding/pytorch_model.bin",
        ],
        "reverb-diarization-v2" => &["config.yaml", "pytorch_model.bin"],
        "whisper-diarization" => &["model.bin", "config.json"],
        EMOTION2VEC_PLUS_LARGE_ID => &["model.pt", "config.yaml", "configuration.json"],
        _ => &[],
    };

    if required_files.is_empty() {
        return path.exists();
    }

    required_files.iter().all(|file| path.join(file).exists())
}

fn hf_env_token() -> Option<String> {
    for key in [
        "HF_TOKEN",
        "HUGGINGFACE_HUB_TOKEN",
        "HUGGING_FACE_HUB_TOKEN",
    ] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

fn hf_cli_cache_token() -> Option<String> {
    dirs::home_dir()
        .map(|home| home.join(".cache").join("huggingface").join("token"))
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn hf_stored_token() -> Option<String> {
    secret_store::get_hugging_face_token()
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn hf_token_with_source() -> Option<(String, &'static str)> {
    hf_env_token()
        .map(|token| (token, "environment"))
        .or_else(|| hf_stored_token().map(|token| (token, "vox_jot_keychain")))
        .or_else(|| hf_cli_cache_token().map(|token| (token, "hf_cli_cache")))
}

fn hf_token() -> Option<String> {
    hf_token_with_source().map(|(token, _)| token)
}

pub fn hugging_face_token_for_runtime() -> Option<String> {
    hf_token()
}

pub fn hugging_face_token_status() -> HuggingFaceTokenStatus {
    if let Some((_, source)) = hf_token_with_source() {
        return HuggingFaceTokenStatus {
            configured: true,
            source: Some(source.to_string()),
        };
    }

    HuggingFaceTokenStatus {
        configured: false,
        source: None,
    }
}

async fn validate_hugging_face_token(token: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let response = client
        .get("https://huggingface.co/api/whoami-v2")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|err| format!("Failed to validate Hugging Face token: {err}"))?;

    if response.status().is_success() {
        return Ok(());
    }
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Err(
            "Hugging Face rejected this token. Use a valid read token from huggingface.co/settings/tokens."
                .to_string(),
        );
    }

    Err(format!(
        "Failed to validate Hugging Face token: HTTP {}",
        response.status()
    ))
}

pub async fn set_hugging_face_token(token: String) -> Result<HuggingFaceTokenStatus, String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        secret_store::clear_hugging_face_token()?;
        return Ok(hugging_face_token_status());
    }

    validate_hugging_face_token(trimmed).await?;
    secret_store::set_hugging_face_token(trimmed)?;
    Ok(HuggingFaceTokenStatus {
        configured: true,
        source: Some("vox_jot_keychain".to_string()),
    })
}

pub fn clear_hugging_face_token() -> Result<HuggingFaceTokenStatus, String> {
    secret_store::clear_hugging_face_token()?;
    Ok(hugging_face_token_status())
}

fn hf_request(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    let request = client.get(url);
    if let Some(token) = hf_token() {
        request.bearer_auth(token)
    } else {
        request
    }
}

fn hf_head_request(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    let request = client.head(url);
    if let Some(token) = hf_token() {
        request.bearer_auth(token)
    } else {
        request
    }
}

pub fn emit_download_progress(
    app: &AppHandle,
    model_id: &str,
    phase: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    file: Option<&str>,
    file_index: Option<usize>,
    file_count: Option<usize>,
    error: Option<&str>,
) {
    let payload = SpeechAnalysisDownloadProgress {
        model_id: model_id.to_string(),
        phase: phase.to_string(),
        downloaded_bytes,
        total_bytes,
        file: file.map(str::to_string),
        file_index,
        file_count,
        error: error.map(str::to_string),
    };
    crate::artifact_download::emit_artifact_progress(
        app,
        crate::artifact_download::progress(
            "speech_analysis",
            model_id,
            phase,
            file,
            file_index,
            file_count,
            downloaded_bytes,
            total_bytes,
            error,
        ),
    );
    let _ = app.emit("speech-analysis-download-progress", payload);
}

fn emit_shared_stt_download_progress(
    app: &AppHandle,
    model_id: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
) {
    if !crate::shared_model_assets::is_shared_model_asset(model_id) {
        return;
    }

    let percentage = if total_bytes > 0 {
        (downloaded_bytes as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };
    let payload = crate::managers::model::DownloadProgress {
        model_id: model_id.to_string(),
        downloaded: downloaded_bytes,
        total: total_bytes,
        percentage,
    };
    let _ = app.emit("model-download-progress", payload);
}

async fn fetch_hf_repo_files(
    client: &reqwest::Client,
    repo_id: &str,
    gated: bool,
) -> Result<Vec<String>, String> {
    if gated && hf_token().is_none() {
        return Err(format!(
            "{repo_id} requires Hugging Face access. Open the model access page, accept the terms with your Hugging Face account, save a read token in Vox Jot, then download again."
        ));
    }

    let url = format!("https://huggingface.co/api/models/{repo_id}");
    let resp = hf_request(client, &url)
        .send()
        .await
        .map_err(|err| format!("Failed to query {repo_id}: {err}"))?;
    if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        let token_hint = if gated {
            " Accept the model terms on Hugging Face, then save a read token in Vox Jot or run `hf auth login`."
        } else {
            " Run `hf auth login` or set HF_TOKEN if this repo requires authentication."
        };
        return Err(format!(
            "{repo_id} cannot be accessed from Hugging Face.{token_hint}"
        ));
    }
    if resp.status().as_u16() == 404 {
        return Err(format!("{repo_id} was not found on Hugging Face."));
    }
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to fetch Hugging Face repo info for {repo_id}: HTTP {}",
            resp.status()
        ));
    }

    let info: HfModelInfo = resp
        .json()
        .await
        .map_err(|err| format!("Failed to decode repo info for {repo_id}: {err}"))?;
    let files = info
        .siblings
        .into_iter()
        .map(|s| s.rfilename)
        .filter(|name| {
            !name.starts_with('.')
                && !name.contains("/.cache/")
                && !name.starts_with(".cache/")
                && !name.contains("/.git/")
                && !name.starts_with(".git/")
        })
        .collect::<Vec<_>>();
    if files.is_empty() {
        return Err(format!("No downloadable files were found in {repo_id}."));
    }
    Ok(files)
}

fn encode_hf_path(rel_path: &str) -> String {
    rel_path
        .split('/')
        .map(|seg| seg.replace(' ', "%20"))
        .collect::<Vec<_>>()
        .join("/")
}

async fn head_size(client: &reqwest::Client, url: &str) -> Option<u64> {
    if let Ok(no_redir) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        if let Ok(resp) = no_redir.head(url).send().await {
            if let Some(linked) = resp
                .headers()
                .get("x-linked-size")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
            {
                return Some(linked);
            }
        }
    }

    hf_head_request(client, url)
        .send()
        .await
        .ok()
        .and_then(|r| {
            r.headers()
                .get("x-linked-size")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .or_else(|| r.content_length())
        })
}

#[derive(Debug, Clone)]
struct HfDownloadFile {
    path: String,
    size: Option<u64>,
}

async fn local_file_len(path: &Path) -> Result<Option<u64>, String> {
    match tokio_fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() => Ok(Some(metadata.len())),
        Ok(_) => Ok(None),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Failed to inspect {}: {err}", path.display())),
    }
}

#[allow(clippy::too_many_arguments)]
async fn download_one_file(
    app: &AppHandle,
    client: &reqwest::Client,
    cancel_flag: &Arc<AtomicBool>,
    model_id: &str,
    repo_id: &str,
    rel_path: &str,
    target: &Path,
    file_index: usize,
    file_count: usize,
    total_bytes: u64,
    cumulative_bytes: &mut u64,
    expected_bytes: Option<u64>,
    resume_from: u64,
) -> Result<(), String> {
    ensure_download_not_cancelled(cancel_flag)?;

    let url = format!(
        "https://huggingface.co/{repo_id}/resolve/main/{}",
        encode_hf_path(rel_path)
    );

    if let Some(parent) = target.parent() {
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    }

    let mut request = hf_request(client, &url);
    if resume_from > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("Failed to fetch {rel_path}: {err}"))?;
    let status = response.status();
    let is_resuming = resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if !status.is_success() {
        return Err(format!("Failed to download {rel_path}: HTTP {}", status));
    }
    ensure_download_not_cancelled(cancel_flag)?;

    if resume_from > 0 && !is_resuming {
        *cumulative_bytes = cumulative_bytes.saturating_sub(resume_from);
    }

    let mut open_options = tokio_fs::OpenOptions::new();
    open_options.create(true).write(true);
    if is_resuming {
        open_options.append(true);
    } else {
        open_options.truncate(true);
    }
    let mut file = open_options
        .open(target)
        .await
        .map_err(|err| format!("Failed to open {}: {err}", target.display()))?;

    let throttle = Duration::from_millis(200);
    let mut last_emit = Instant::now();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        ensure_download_not_cancelled(cancel_flag)?;
        let chunk = chunk.map_err(|err| format!("Stream failed for {rel_path}: {err}"))?;
        ensure_download_not_cancelled(cancel_flag)?;
        *cumulative_bytes += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|err| format!("Failed to write {rel_path}: {err}"))?;

        if last_emit.elapsed() >= throttle {
            emit_download_progress(
                app,
                model_id,
                "downloading",
                *cumulative_bytes,
                total_bytes,
                Some(rel_path),
                Some(file_index),
                Some(file_count),
                None,
            );
            emit_shared_stt_download_progress(app, model_id, *cumulative_bytes, total_bytes);
            last_emit = Instant::now();
        }
    }
    file.flush()
        .await
        .map_err(|err| format!("Failed to flush {rel_path}: {err}"))?;
    if let Some(expected) = expected_bytes {
        if let Some(actual) = local_file_len(target).await? {
            if actual != expected {
                return Err(format!(
                    "Downloaded {rel_path} but expected {expected} bytes and found {actual} bytes."
                ));
            }
        }
    }
    Ok(())
}

async fn download_hf_repo_to_dir(
    app: &AppHandle,
    client: &reqwest::Client,
    cancel_flag: &Arc<AtomicBool>,
    model_id: &str,
    repo_id: &str,
    gated: bool,
    target_dir: &Path,
) -> Result<(), String> {
    let files = fetch_hf_repo_files(client, repo_id, gated).await?;
    let file_count = files.len();
    let mut download_files = Vec::with_capacity(file_count);
    let mut total_bytes = 0u64;

    for file in files {
        ensure_download_not_cancelled(cancel_flag)?;
        let url = format!(
            "https://huggingface.co/{repo_id}/resolve/main/{}",
            encode_hf_path(&file)
        );
        let size = head_size(client, &url).await;
        if let Some(size) = size {
            total_bytes += size;
        }
        download_files.push(HfDownloadFile { path: file, size });
    }

    let mut cumulative = 0u64;
    for (idx, file) in download_files.iter().enumerate() {
        ensure_download_not_cancelled(cancel_flag)?;
        let target = target_dir.join(&file.path);
        let existing_len = local_file_len(&target).await?.unwrap_or(0);
        if let Some(expected) = file.size {
            if existing_len == expected {
                cumulative += existing_len;
                continue;
            }
        }
        let resume_from = match file.size {
            Some(expected) if existing_len > 0 && existing_len < expected => existing_len,
            _ => 0,
        };
        cumulative += resume_from;
        download_one_file(
            app,
            client,
            cancel_flag,
            model_id,
            repo_id,
            &file.path,
            &target,
            idx + 1,
            file_count,
            total_bytes,
            &mut cumulative,
            file.size,
            resume_from,
        )
        .await?;
    }

    Ok(())
}

async fn download_related_assets(
    app: &AppHandle,
    client: &reqwest::Client,
    cancel_flag: &Arc<AtomicBool>,
    model: &SpeechAnalysisModelDescriptor,
    staging: &Path,
) -> Result<(), String> {
    if model.id != "pyannote-3-1" {
        return Ok(());
    }

    emit_download_progress(
        app,
        &model.id,
        "downloading-related-assets",
        0,
        0,
        Some("pyannote/segmentation-3.0"),
        None,
        None,
        None,
    );
    download_hf_repo_to_dir(
        app,
        client,
        cancel_flag,
        &model.id,
        "pyannote/segmentation-3.0",
        true,
        &staging.join("segmentation"),
    )
    .await?;

    emit_download_progress(
        app,
        &model.id,
        "downloading-related-assets",
        0,
        0,
        Some("pyannote/wespeaker-voxceleb-resnet34-LM"),
        None,
        None,
        None,
    );
    download_hf_repo_to_dir(
        app,
        client,
        cancel_flag,
        &model.id,
        "pyannote/wespeaker-voxceleb-resnet34-LM",
        true,
        &staging.join("embedding"),
    )
    .await
}

pub async fn download_model(
    app: &AppHandle,
    model_id: String,
) -> Result<SpeechAnalysisModelDescriptor, String> {
    let model = model_by_id(&model_id)
        .ok_or_else(|| format!("Unknown speech analysis model '{}'.", model_id))?;
    if !model.downloadable || model.source_kind != SpeechAnalysisSourceKind::HuggingFace {
        return Err(format!(
            "{} is not a downloadable Hugging Face model.",
            model.label
        ));
    }
    let repo_id = model
        .repo_id
        .clone()
        .ok_or_else(|| format!("{} has no Hugging Face repo id.", model.label))?;

    {
        let mut active = ACTIVE_DOWNLOADS.lock().await;
        if !active.insert(model_id.clone()) {
            return Err(format!("{} is already downloading.", model.label));
        }
    }
    let cancel_flag = Arc::new(AtomicBool::new(false));
    DOWNLOAD_CANCEL_FLAGS
        .lock()
        .await
        .insert(model_id.clone(), Arc::clone(&cancel_flag));

    let result = download_model_inner(app, &model, &repo_id, &cancel_flag).await;
    ACTIVE_DOWNLOADS.lock().await.remove(&model_id);
    DOWNLOAD_CANCEL_FLAGS.lock().await.remove(&model_id);
    if let Err(err) = &result {
        if err == DOWNLOAD_CANCELLED_MESSAGE {
            let _ = cleanup_staging_dir(app, &model_id).await;
            emit_download_progress(app, &model_id, "cancelled", 0, 0, None, None, None, None);
            if crate::shared_model_assets::is_shared_model_asset(&model_id) {
                let _ = app.emit("model-download-cancelled", &model_id);
            }
        } else {
            emit_download_progress(app, &model_id, "failed", 0, 0, None, None, None, Some(err));
        }
    }
    result
}

async fn download_model_inner(
    app: &AppHandle,
    model: &SpeechAnalysisModelDescriptor,
    repo_id: &str,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<SpeechAnalysisModelDescriptor, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1800))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    emit_download_progress(app, &model.id, "preparing", 0, 0, None, None, None, None);
    let files = fetch_hf_repo_files(&client, repo_id, model.gated).await?;
    ensure_download_not_cancelled(cancel_flag)?;
    let file_count = files.len();
    let mut total_bytes = 0u64;
    let mut download_files = Vec::with_capacity(files.len());
    for file in files {
        ensure_download_not_cancelled(cancel_flag)?;
        let url = format!(
            "https://huggingface.co/{repo_id}/resolve/main/{}",
            encode_hf_path(&file)
        );
        let size = head_size(&client, &url).await;
        if let Some(size) = size {
            total_bytes += size;
        }
        download_files.push(HfDownloadFile { path: file, size });
    }

    let staging = staging_dir(app, &model.id)?;
    ensure_download_not_cancelled(cancel_flag)?;
    let has_partial = staging.exists();
    if has_partial && !staging.is_dir() {
        tokio_fs::remove_file(&staging)
            .await
            .map_err(|err| format!("Failed to clear invalid staging file: {err}"))?;
    }
    tokio_fs::create_dir_all(&staging)
        .await
        .map_err(|err| format!("Failed to create staging dir: {err}"))?;

    let mut cumulative = 0u64;
    let initial_phase = if has_partial {
        "recovering"
    } else {
        "downloading"
    };
    emit_download_progress(
        app,
        &model.id,
        initial_phase,
        0,
        total_bytes,
        None,
        Some(0),
        Some(file_count),
        None,
    );
    emit_shared_stt_download_progress(app, &model.id, 0, total_bytes);

    for (idx, file) in download_files.iter().enumerate() {
        ensure_download_not_cancelled(cancel_flag)?;
        let target = staging.join(&file.path);
        let existing_len = local_file_len(&target).await?.unwrap_or(0);
        if let Some(expected) = file.size {
            if existing_len == expected {
                cumulative += existing_len;
                emit_download_progress(
                    app,
                    &model.id,
                    initial_phase,
                    cumulative,
                    total_bytes,
                    Some(&file.path),
                    Some(idx + 1),
                    Some(file_count),
                    None,
                );
                emit_shared_stt_download_progress(app, &model.id, cumulative, total_bytes);
                continue;
            }
        }
        let resume_from = match file.size {
            Some(expected) if existing_len > 0 && existing_len < expected => existing_len,
            _ => 0,
        };
        cumulative += resume_from;
        download_one_file(
            app,
            &client,
            cancel_flag,
            &model.id,
            repo_id,
            &file.path,
            &target,
            idx + 1,
            file_count,
            total_bytes,
            &mut cumulative,
            file.size,
            resume_from,
        )
        .await?;
        emit_download_progress(
            app,
            &model.id,
            "downloading",
            cumulative,
            total_bytes,
            Some(&file.path),
            Some(idx + 1),
            Some(file_count),
            None,
        );
        emit_shared_stt_download_progress(app, &model.id, cumulative, total_bytes);
    }

    ensure_download_not_cancelled(cancel_flag)?;
    download_related_assets(app, &client, cancel_flag, model, &staging).await?;
    ensure_download_not_cancelled(cancel_flag)?;
    let final_dir = install_dir(app, &model.id)?;
    if let Some(parent) = final_dir.parent() {
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    }
    if final_dir.exists() {
        tokio_fs::remove_dir_all(&final_dir)
            .await
            .map_err(|err| format!("Failed to clear existing install: {err}"))?;
    }
    if !hugging_face_model_has_required_files(&model.id, &staging) {
        return Err(format!(
            "Downloaded {} but the required model files are still incomplete.",
            model.label
        ));
    }
    tokio_fs::rename(&staging, &final_dir)
        .await
        .map_err(|err| {
            format!(
                "Failed to move speech analysis model into place ({} -> {}): {err}",
                staging.display(),
                final_dir.display()
            )
        })?;

    info!(
        "Downloaded speech analysis model '{}' from {} to {}",
        model.id,
        repo_id,
        final_dir.display()
    );
    emit_download_progress(
        app,
        &model.id,
        "installing-model",
        cumulative,
        total_bytes,
        None,
        Some(file_count),
        Some(file_count),
        None,
    );

    model_by_id(&model.id)
        .map(|model| descriptor_with_install_state(app, model))
        .ok_or_else(|| format!("Downloaded unknown model '{}'.", model.id))
}

pub fn delete_model(
    app: &AppHandle,
    model_id: String,
) -> Result<SpeechAnalysisModelDescriptor, String> {
    let model = model_by_id(&model_id)
        .ok_or_else(|| format!("Unknown speech analysis model '{}'.", model_id))?;
    if !model.downloadable || model.source_kind != SpeechAnalysisSourceKind::HuggingFace {
        return Err(format!(
            "{} is not stored as a deletable download.",
            model.label
        ));
    }
    if model_in_use(&model.id) {
        return Err(format!(
            "{} is currently being used by a file transcription. Try deleting it again after that transcription finishes.",
            model.label
        ));
    }

    let deleted = if crate::shared_model_assets::is_shared_model_asset(&model.id) {
        crate::shared_model_assets::delete_shared_model_assets(app, &model.id)?
    } else {
        let dir = install_dir(app, &model.id)?;
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|err| {
                format!(
                    "Failed to delete speech analysis model '{}': {err}",
                    dir.display()
                )
            })?;
            true
        } else {
            false
        }
    };

    if !deleted {
        return Err(format!("No local files were found for {}.", model.label));
    }

    let mut settings = get_settings(app);
    let mut changed = false;
    if settings.file_transcription_asr_model_id == model.id {
        settings.file_transcription_asr_model_id = default_asr_model_id();
        changed = true;
    }
    if settings.file_transcription_diarization_model_id == model.id {
        settings.file_transcription_diarization_model_id = default_diarization_model_id();
        changed = true;
    }
    if settings.file_transcription_emotion_model_id == model.id {
        settings.file_transcription_emotion_model_id = default_emotion_model_id();
        changed = true;
    }
    if changed {
        write_settings(app, settings.clone());
        let _ = app.emit("settings-changed", settings);
    }
    if crate::shared_model_assets::is_shared_model_asset(&model.id) {
        let _ = app.emit("model-deleted", &model.id);
    }

    Ok(descriptor_with_install_state(app, model))
}

pub async fn cancel_download(app: &AppHandle, model_id: String) -> Result<(), String> {
    let model = model_by_id(&model_id)
        .ok_or_else(|| format!("Unknown speech analysis model '{}'.", model_id))?;

    let flag = DOWNLOAD_CANCEL_FLAGS.lock().await.get(&model_id).cloned();
    let Some(flag) = flag else {
        cleanup_staging_dir(app, &model_id).await?;
        return Err(format!("{} is not currently downloading.", model.label));
    };

    flag.store(true, Ordering::Relaxed);
    let _ = cleanup_staging_dir(app, &model_id).await;
    emit_download_progress(app, &model_id, "cancelling", 0, 0, None, None, None, None);
    Ok(())
}

pub async fn active_downloads() -> Vec<String> {
    ACTIVE_DOWNLOADS.lock().await.iter().cloned().collect()
}

pub fn model_by_id(model_id: &str) -> Option<SpeechAnalysisModelDescriptor> {
    built_in_catalog_models()
        .into_iter()
        .find(|model| model.id == model_id)
}

pub fn model_uses_mlx_native(model_id: &str) -> bool {
    model_by_id(model_id)
        .is_some_and(|model| matches!(model.runtime, SpeechAnalysisRuntime::MlxNative))
}

pub fn model_uses_managed_python_runtime(model_id: &str) -> bool {
    model_by_id(model_id).is_some_and(|model| {
        matches!(
            model.runtime,
            SpeechAnalysisRuntime::PythonSidecar | SpeechAnalysisRuntime::OnnxCpu
        )
    })
}

pub fn model_uses_gemma_audio_runtime(model_id: &str) -> bool {
    matches!(
        model_id,
        "gemma4-e2b-audio" | "gemma4-e2b-audio-mlx" | "gemma4-e4b-audio"
    )
}

pub fn get_model(app: &AppHandle, model_id: &str) -> Option<SpeechAnalysisModelDescriptor> {
    model_by_id(model_id).map(|model| descriptor_with_install_state(app, model))
}

pub fn selection_from_settings(app: &AppHandle) -> SpeechAnalysisSelection {
    let mut settings = get_settings(app);
    let mut changed = false;
    if model_by_id(&settings.file_transcription_asr_model_id).is_none() {
        settings.file_transcription_asr_model_id = default_asr_model_id();
        changed = true;
    }
    if model_by_id(&settings.file_transcription_diarization_model_id).is_none() {
        settings.file_transcription_diarization_model_id = default_diarization_model_id();
        changed = true;
    }
    if model_by_id(&settings.file_transcription_emotion_model_id).is_none() {
        settings.file_transcription_emotion_model_id = default_emotion_model_id();
        changed = true;
    }
    if changed {
        write_settings(app, settings.clone());
        let _ = app.emit("settings-changed", settings.clone());
    }
    SpeechAnalysisSelection {
        asr_model_id: settings.file_transcription_asr_model_id,
        diarization_model_id: settings.file_transcription_diarization_model_id,
        emotion_model_id: settings.file_transcription_emotion_model_id,
    }
}

pub fn get_catalog(app: &AppHandle) -> SpeechAnalysisCatalog {
    SpeechAnalysisCatalog {
        models: built_in_catalog_models()
            .into_iter()
            .map(|model| descriptor_with_install_state(app, model))
            .collect(),
        selection: selection_from_settings(app),
    }
}

pub fn set_selection(
    app: &AppHandle,
    asr_model_id: String,
    diarization_model_id: String,
    emotion_model_id: String,
) -> Result<SpeechAnalysisSelection, String> {
    if model_by_id(&asr_model_id).is_none() {
        return Err(format!(
            "Unknown speech analysis ASR model '{}'.",
            asr_model_id
        ));
    }
    if model_by_id(&diarization_model_id).is_none() {
        return Err(format!(
            "Unknown speech analysis diarization model '{}'.",
            diarization_model_id
        ));
    }
    if model_by_id(&emotion_model_id).is_none() {
        return Err(format!(
            "Unknown speech analysis emotion model '{}'.",
            emotion_model_id
        ));
    }

    let mut settings = get_settings(app);
    settings.file_transcription_asr_model_id = asr_model_id;
    settings.file_transcription_diarization_model_id = diarization_model_id;
    settings.file_transcription_emotion_model_id = emotion_model_id;
    write_settings(app, settings.clone());
    let _ = app.emit("settings-changed", settings);
    Ok(selection_from_settings(app))
}

pub fn default_asr_model_id() -> String {
    CURRENT_DICTATION_ASR_ID.to_string()
}

pub fn default_diarization_model_id() -> String {
    DEFAULT_DIARIZATION_ID.to_string()
}

pub fn default_emotion_model_id() -> String {
    DEFAULT_EMOTION_ID.to_string()
}

pub fn should_run_diarization(model_id: &str) -> bool {
    let trimmed = model_id.trim();
    !trimmed.is_empty() && trimmed != NO_DIARIZATION_ID
}

pub fn should_run_emotion(model_id: &str) -> bool {
    let trimmed = model_id.trim();
    !trimmed.is_empty() && trimmed != NO_EMOTION_ID
}

fn overlap_ms(a_start: u64, a_end: u64, b_start: u64, b_end: u64) -> u64 {
    let start = a_start.max(b_start);
    let end = a_end.min(b_end);
    end.saturating_sub(start)
}

pub fn align_segments_to_speakers(
    segments: &[SpeechAnalysisSegment],
    turns: &[SpeakerTurn],
) -> Vec<SpeakerLabeledSegment> {
    segments
        .iter()
        .map(|segment| {
            let best_turn = turns
                .iter()
                .filter_map(|turn| {
                    let overlap =
                        overlap_ms(segment.start_ms, segment.end_ms, turn.start_ms, turn.end_ms);
                    (overlap > 0).then_some((turn, overlap))
                })
                .max_by(|(left_turn, left_overlap), (right_turn, right_overlap)| {
                    left_overlap.cmp(right_overlap).then_with(|| {
                        left_turn
                            .confidence
                            .partial_cmp(&right_turn.confidence)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                })
                .map(|(turn, _)| turn);

            SpeakerLabeledSegment {
                speaker_id: best_turn
                    .map(|turn| turn.speaker_id.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                start_ms: segment.start_ms,
                end_ms: segment.end_ms,
                text: segment.text.clone(),
                confidence: best_turn.and_then(|turn| turn.confidence),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_ids_are_unique_and_include_required_models() {
        let catalog = built_in_catalog_models();
        let mut ids = HashSet::new();
        for model in &catalog {
            assert!(ids.insert(model.id.as_str()), "duplicate id {}", model.id);
        }

        for required in [
            CURRENT_DICTATION_ASR_ID,
            NO_DIARIZATION_ID,
            "granite-speech-4-1-2b",
            "cohere-transcribe-03-2026",
            "higgs-audio-v3-stt",
            "mlx-qwen3-asr-0.6b",
            "mlx-qwen3-asr",
            "mlx-fireredasr2-aed",
            "mlx-vibevoice-asr-bf16",
            "mlx-nemotron-asr-streaming-0.6b",
            "mlx-mega-asr",
            "pyannote-community-1",
            "pyannote-3-1",
            "mlx-sortformer-4spk-v1",
            "mlx-sortformer-4spk-v2-1",
            "reverb-diarization-v2",
            "whisper-diarization",
            "onnx-polyvoice-diarization",
            NO_EMOTION_ID,
            EMOTION2VEC_PLUS_LARGE_ID,
        ] {
            assert!(ids.contains(required), "missing required model {required}");
        }
    }

    #[test]
    fn model_use_guard_tracks_active_models_until_drop() {
        let model_id = format!("test-model-use-{}", std::process::id());
        assert!(!model_in_use(&model_id));
        {
            let _guard = mark_models_in_use(vec![model_id.clone()]);
            assert!(model_in_use(&model_id));
        }
        assert!(!model_in_use(&model_id));
    }

    #[test]
    fn diarization_models_advertise_speaker_labels() {
        for model in built_in_catalog_models() {
            if matches!(
                model.task,
                SpeechAnalysisTask::Diarization | SpeechAnalysisTask::AsrDiarization
            ) && model.id != NO_DIARIZATION_ID
            {
                assert!(
                    model.capabilities.speaker_labels,
                    "{} must advertise speaker labels",
                    model.id
                );
            }
        }
    }

    #[test]
    fn aligns_segments_to_highest_overlap_speaker_turn() {
        let segments = vec![
            SpeechAnalysisSegment {
                start_ms: 1_000,
                end_ms: 3_000,
                text: "first".to_string(),
            },
            SpeechAnalysisSegment {
                start_ms: 3_000,
                end_ms: 5_000,
                text: "second".to_string(),
            },
        ];
        let turns = vec![
            SpeakerTurn {
                speaker_id: "SPEAKER_00".to_string(),
                start_ms: 500,
                end_ms: 2_200,
                confidence: Some(0.7),
                source_model_id: DEFAULT_DIARIZATION_ID.to_string(),
            },
            SpeakerTurn {
                speaker_id: "SPEAKER_01".to_string(),
                start_ms: 2_200,
                end_ms: 5_500,
                confidence: Some(0.8),
                source_model_id: DEFAULT_DIARIZATION_ID.to_string(),
            },
        ];

        let labeled = align_segments_to_speakers(&segments, &turns);

        assert_eq!(labeled[0].speaker_id, "SPEAKER_00");
        assert_eq!(labeled[1].speaker_id, "SPEAKER_01");
    }

    #[test]
    fn labels_unmatched_segments_unknown() {
        let segments = vec![SpeechAnalysisSegment {
            start_ms: 10_000,
            end_ms: 12_000,
            text: "gap".to_string(),
        }];

        let labeled = align_segments_to_speakers(&segments, &[]);

        assert_eq!(labeled[0].speaker_id, "unknown");
        assert_eq!(labeled[0].confidence, None);
    }

    #[test]
    fn default_diarization_keeps_speaker_labels_off() {
        assert_eq!(default_diarization_model_id(), NO_DIARIZATION_ID);
        assert!(!should_run_diarization(&default_diarization_model_id()));
        assert!(should_run_diarization(PYANNOTE_COMMUNITY_DIARIZATION_ID));
    }

    #[test]
    fn default_emotion_keeps_emotion_labels_off() {
        assert_eq!(default_emotion_model_id(), NO_EMOTION_ID);
        assert!(!should_run_emotion(&default_emotion_model_id()));
        assert!(should_run_emotion(EMOTION2VEC_PLUS_LARGE_ID));
    }
}
