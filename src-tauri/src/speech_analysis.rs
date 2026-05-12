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

static ACTIVE_DOWNLOADS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static DOWNLOAD_CANCEL_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const DOWNLOAD_CANCELLED_MESSAGE: &str = "Download cancelled.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SpeechAnalysisTask {
    Asr,
    Diarization,
    AsrDiarization,
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
            SpeechAnalysisReadiness::Ready,
            &[
                "en", "fr", "de", "it", "es", "pt", "el", "nl", "pl", "ja", "ko", "zh", "ar", "tr",
            ],
            &["text", "segments"],
            capability(false, true, false, true, true, true, false, false, false),
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
            "mlx-qwen3-asr-1.7b",
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
            "diarizen-wavlm-large-s80-md",
            "DiariZen WavLM Large S80 MD",
            "BUT-FIT",
            Some("BUT-FIT/diarizen-wavlm-large-s80-md-v2"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("CC-BY-NC-4.0"),
            false,
            true,
            Some("~1.5 GB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::Diarizen,
            SpeechAnalysisRuntime::PythonSidecar,
            "DiariZen diarization adapter with WavLM/Conformer backend.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["speaker_turns", "rttm"],
            capability(true, true, false, false, true, true, false, false, false),
        ),
        descriptor(
            "nemo-sortformer-4spk-v1",
            "NVIDIA Sortformer 4spk v1",
            "NVIDIA",
            Some("nvidia/diar_sortformer_4spk-v1"),
            SpeechAnalysisSourceKind::HuggingFace,
            None,
            Some("CC-BY-NC-4.0"),
            false,
            true,
            Some("~500 MB"),
            SpeechAnalysisTask::Diarization,
            SpeechAnalysisEngine::Nemo,
            SpeechAnalysisRuntime::PythonSidecar,
            "NVIDIA NeMo Sortformer diarization adapter for up to four speakers.",
            SpeechAnalysisReadiness::Ready,
            &["mul"],
            &["speaker_turns", "rttm"],
            capability(true, true, false, false, true, true, true, false, false),
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
            "Combined Whisper ASR and diarization adapter.",
            SpeechAnalysisReadiness::RequiresRuntimeInstall,
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
    Ok(storage_paths::speech_analysis_models_dir(app)
        .map_err(|err| format!("Failed to resolve speech analysis model dir: {err}"))?
        .join(model_id))
}

fn staging_dir(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
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
    model: &SpeechAnalysisModelDescriptor,
    installed: bool,
) -> SpeechAnalysisReadiness {
    if installed {
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
    let local_path = match model.source_kind {
        SpeechAnalysisSourceKind::BuiltIn | SpeechAnalysisSourceKind::RuntimeManaged => None,
        SpeechAnalysisSourceKind::LocalOnnxBundle if model.id == POLYVOICE_DIARIZATION_ID => {
            bundled_polyvoice_dir()
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
    model.readiness = readiness_for(&model, installed);
    model
}

fn hugging_face_model_has_required_files(model_id: &str, path: &Path) -> bool {
    let required_files: &[&str] = match model_id {
        "granite-speech-4-1-2b" => &["config.json", "model.safetensors.index.json"],
        "cohere-transcribe-03-2026" => &["config.json", "model.safetensors"],
        "mlx-qwen3-asr-0.6b"
        | "mlx-qwen3-asr-1.7b"
        | "mlx-fireredasr2-aed"
        | "mlx-vibevoice-asr-bf16"
        | "mlx-sortformer-4spk-v1"
        | "mlx-sortformer-4spk-v2-1" => &["config.json", "model.safetensors"],
        "pyannote-community-1" => &["config.yaml"],
        "pyannote-3-1" => &["config.yaml"],
        "diarizen-wavlm-large-s80-md" => &[
            "config.toml",
            "pytorch_model.bin",
            "plda/plda.npz",
            "plda/xvec_transform.npz",
        ],
        "nemo-sortformer-4spk-v1" => &["diar_sortformer_4spk-v1.nemo"],
        "reverb-diarization-v2" => &["config.yaml", "pytorch_model.bin"],
        "whisper-diarization" => &["model.bin", "config.json"],
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

fn emit_download_progress(
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
    let _ = app.emit("speech-analysis-download-progress", payload);
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

    let response = hf_request(client, &url)
        .send()
        .await
        .map_err(|err| format!("Failed to fetch {rel_path}: {err}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {rel_path}: HTTP {}",
            response.status()
        ));
    }
    ensure_download_not_cancelled(cancel_flag)?;

    let mut file = tokio_fs::File::create(target)
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
            last_emit = Instant::now();
        }
    }
    file.flush()
        .await
        .map_err(|err| format!("Failed to flush {rel_path}: {err}"))?;
    Ok(())
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
        let _ = cleanup_staging_dir(app, &model_id).await;
        if err == DOWNLOAD_CANCELLED_MESSAGE {
            emit_download_progress(app, &model_id, "cancelled", 0, 0, None, None, None, None);
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
    for file in &files {
        ensure_download_not_cancelled(cancel_flag)?;
        let url = format!(
            "https://huggingface.co/{repo_id}/resolve/main/{}",
            encode_hf_path(file)
        );
        if let Some(size) = head_size(&client, &url).await {
            total_bytes += size;
        }
    }
    emit_download_progress(
        app,
        &model.id,
        "downloading",
        0,
        total_bytes,
        None,
        Some(0),
        Some(file_count),
        None,
    );

    let staging = staging_dir(app, &model.id)?;
    ensure_download_not_cancelled(cancel_flag)?;
    if staging.exists() {
        tokio_fs::remove_dir_all(&staging)
            .await
            .map_err(|err| format!("Failed to clear staging dir: {err}"))?;
    }
    tokio_fs::create_dir_all(&staging)
        .await
        .map_err(|err| format!("Failed to create staging dir: {err}"))?;

    let mut cumulative = 0u64;
    for (idx, rel) in files.iter().enumerate() {
        ensure_download_not_cancelled(cancel_flag)?;
        download_one_file(
            app,
            &client,
            cancel_flag,
            &model.id,
            repo_id,
            rel,
            &staging.join(rel),
            idx + 1,
            file_count,
            total_bytes,
            &mut cumulative,
        )
        .await?;
        emit_download_progress(
            app,
            &model.id,
            "downloading",
            cumulative,
            total_bytes,
            Some(rel),
            Some(idx + 1),
            Some(file_count),
            None,
        );
    }

    ensure_download_not_cancelled(cancel_flag)?;
    let final_dir = install_dir(app, &model.id)?;
    if final_dir.exists() {
        tokio_fs::remove_dir_all(&final_dir)
            .await
            .map_err(|err| format!("Failed to clear existing install: {err}"))?;
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
        "complete",
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

    let final_dir = install_dir(app, &model.id)?;
    if final_dir.exists() {
        fs::remove_dir_all(&final_dir).map_err(|err| {
            format!(
                "Failed to delete speech analysis model '{}': {err}",
                final_dir.display()
            )
        })?;
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
    if changed {
        write_settings(app, settings.clone());
        let _ = app.emit("settings-changed", settings);
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

pub fn selection_from_settings(app: &AppHandle) -> SpeechAnalysisSelection {
    let settings = get_settings(app);
    SpeechAnalysisSelection {
        asr_model_id: settings.file_transcription_asr_model_id,
        diarization_model_id: settings.file_transcription_diarization_model_id,
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

    let mut settings = get_settings(app);
    settings.file_transcription_asr_model_id = asr_model_id;
    settings.file_transcription_diarization_model_id = diarization_model_id;
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

pub fn should_run_diarization(model_id: &str) -> bool {
    let trimmed = model_id.trim();
    !trimmed.is_empty() && trimmed != NO_DIARIZATION_ID
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
            "pyannote-community-1",
            "pyannote-3-1",
            "diarizen-wavlm-large-s80-md",
            "nemo-sortformer-4spk-v1",
            "reverb-diarization-v2",
            "whisper-diarization",
            "onnx-polyvoice-diarization",
        ] {
            assert!(ids.contains(required), "missing required model {required}");
        }
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
}
