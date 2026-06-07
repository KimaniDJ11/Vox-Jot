use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::storage_paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharedModelAssetFamily {
    MlxAsr,
    GemmaAudio,
    GemmaMlxAudio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SharedModelStorageRoot {
    Stt,
    SpeechAnalysis,
}

#[derive(Debug, Clone, Copy)]
struct SharedModelAssetDefinition {
    family: SharedModelAssetFamily,
    model_ids: &'static [&'static str],
    repo_id: &'static str,
    canonical_root: SharedModelStorageRoot,
    legacy_roots: &'static [SharedModelStorageRoot],
}

const SHARED_MLX_ASR_MODELS: &[SharedModelAssetDefinition] = &[
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::MlxAsr,
        model_ids: &["mlx-qwen3-asr-0.6b"],
        repo_id: "mlx-community/Qwen3-ASR-0.6B-8bit",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::MlxAsr,
        model_ids: &["mlx-qwen3-asr", "mlx-qwen3-asr-1.7b"],
        repo_id: "mlx-community/Qwen3-ASR-1.7B-8bit",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::MlxAsr,
        model_ids: &["mlx-fireredasr2-aed"],
        repo_id: "mlx-community/FireRedASR2-AED-mlx",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::MlxAsr,
        model_ids: &["mlx-vibevoice-asr-bf16"],
        repo_id: "mlx-community/VibeVoice-ASR-bf16",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::MlxAsr,
        model_ids: &["mlx-nemotron-asr-streaming-0.6b"],
        repo_id: "mlx-community/nemotron-3.5-asr-streaming-0.6b",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::MlxAsr,
        model_ids: &["mlx-mega-asr"],
        repo_id: "mlx-community/Mega-ASR-8bit",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
];

const SHARED_GEMMA_AUDIO_MODELS: &[SharedModelAssetDefinition] = &[
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::GemmaAudio,
        model_ids: &["gemma4-e2b-audio"],
        repo_id: "google/gemma-4-E2B-it",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::GemmaAudio,
        model_ids: &["gemma4-e4b-audio"],
        repo_id: "google/gemma-4-E4B-it",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
    SharedModelAssetDefinition {
        family: SharedModelAssetFamily::GemmaMlxAudio,
        model_ids: &["gemma4-e2b-audio-mlx"],
        repo_id: "mlx-community/gemma-4-e2b-it-4bit",
        canonical_root: SharedModelStorageRoot::Stt,
        legacy_roots: &[SharedModelStorageRoot::SpeechAnalysis],
    },
];

fn definition_for_model_id(model_id: &str) -> Option<&'static SharedModelAssetDefinition> {
    SHARED_MLX_ASR_MODELS
        .iter()
        .chain(SHARED_GEMMA_AUDIO_MODELS.iter())
        .find(|definition| definition.model_ids.contains(&model_id))
}

pub fn is_shared_model_asset(model_id: &str) -> bool {
    definition_for_model_id(model_id).is_some()
}

pub fn shared_model_family(model_id: &str) -> Option<SharedModelAssetFamily> {
    definition_for_model_id(model_id).map(|definition| definition.family)
}

#[cfg(any(test, not(feature = "ci-mock-transcription")))]
pub fn shared_model_repo_id(model_id: &str) -> Option<&'static str> {
    definition_for_model_id(model_id).map(|definition| definition.repo_id)
}

#[cfg(test)]
fn shared_model_ids_for_family(family: SharedModelAssetFamily) -> Vec<&'static str> {
    SHARED_MLX_ASR_MODELS
        .iter()
        .chain(SHARED_GEMMA_AUDIO_MODELS.iter())
        .filter(|definition| definition.family == family)
        .flat_map(|definition| definition.model_ids.iter().copied())
        .collect()
}

fn canonical_relative_path(definition: &SharedModelAssetDefinition) -> PathBuf {
    match definition.family {
        SharedModelAssetFamily::MlxAsr => Path::new("MLX").join(definition.repo_id),
        SharedModelAssetFamily::GemmaAudio => Path::new("Gemma").join(definition.repo_id),
        SharedModelAssetFamily::GemmaMlxAudio => Path::new("GemmaMLX").join(definition.repo_id),
    }
}

fn legacy_relative_path(definition: &SharedModelAssetDefinition, model_id: &str) -> PathBuf {
    match definition.family {
        SharedModelAssetFamily::MlxAsr => PathBuf::from(model_id),
        SharedModelAssetFamily::GemmaAudio => PathBuf::from(model_id),
        SharedModelAssetFamily::GemmaMlxAudio => PathBuf::from(model_id),
    }
}

fn root_dir(app: &AppHandle, root: SharedModelStorageRoot) -> Result<PathBuf, String> {
    match root {
        SharedModelStorageRoot::Stt => storage_paths::stt_models_dir(app)
            .map_err(|err| format!("Failed to resolve STT model dir: {err}")),
        SharedModelStorageRoot::SpeechAnalysis => storage_paths::speech_analysis_models_dir(app)
            .map_err(|err| format!("Failed to resolve speech-analysis model dir: {err}")),
    }
}

#[cfg(test)]
fn shared_model_primary_relative_path(model_id: &str) -> Option<PathBuf> {
    definition_for_model_id(model_id).map(canonical_relative_path)
}

pub fn shared_model_primary_install_dir(
    app: &AppHandle,
    model_id: &str,
) -> Result<Option<PathBuf>, String> {
    let Some(definition) = definition_for_model_id(model_id) else {
        return Ok(None);
    };

    Ok(Some(
        root_dir(app, definition.canonical_root)?.join(canonical_relative_path(definition)),
    ))
}

pub fn shared_model_candidate_dirs(
    app: &AppHandle,
    model_id: &str,
) -> Result<Vec<PathBuf>, String> {
    let Some(definition) = definition_for_model_id(model_id) else {
        return Ok(Vec::new());
    };

    let mut paths =
        vec![root_dir(app, definition.canonical_root)?.join(canonical_relative_path(definition))];
    for legacy_root in definition.legacy_roots {
        paths.push(root_dir(app, *legacy_root)?.join(legacy_relative_path(definition, model_id)));
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn remove_dir_if_exists(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(path).map_err(|err| {
        format!(
            "Failed to delete shared model directory '{}': {err}",
            path.display()
        )
    })?;
    Ok(true)
}

fn progress_dirs_for_install_dir(dir: &Path) -> Vec<PathBuf> {
    let Some(file_name) = dir.file_name().and_then(|name| name.to_str()) else {
        return Vec::new();
    };

    vec![
        dir.with_file_name(format!("{file_name}.partial")),
        dir.with_file_name(format!("{file_name}.extracting")),
    ]
}

pub fn delete_shared_model_assets(app: &AppHandle, model_id: &str) -> Result<bool, String> {
    if definition_for_model_id(model_id).is_none() {
        return Ok(false);
    }

    let mut deleted = false;
    for dir in shared_model_candidate_dirs(app, model_id)? {
        deleted |= remove_dir_if_exists(&dir)?;

        for progress_dir in progress_dirs_for_install_dir(&dir) {
            deleted |= remove_dir_if_exists(&progress_dir)?;
        }
    }

    Ok(deleted)
}

pub fn shared_model_has_required_files(model_id: &str, path: &Path) -> bool {
    match shared_model_family(model_id) {
        Some(SharedModelAssetFamily::MlxAsr) => shared_mlx_asr_has_required_files(path),
        Some(SharedModelAssetFamily::GemmaAudio) => shared_gemma_audio_has_required_files(path),
        Some(SharedModelAssetFamily::GemmaMlxAudio) => shared_mlx_asr_has_required_files(path),
        None => false,
    }
}

pub fn installed_shared_model_dir(
    app: &AppHandle,
    model_id: &str,
) -> Result<Option<PathBuf>, String> {
    for path in shared_model_candidate_dirs(app, model_id)? {
        if shared_model_has_required_files(model_id, &path) {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn shared_mlx_asr_has_required_files(path: &Path) -> bool {
    if !path.is_dir() || !path.join("config.json").exists() {
        return false;
    }
    if path.join("model.safetensors").exists() {
        return true;
    }
    if !path.join("model.safetensors.index.json").exists() {
        return false;
    }

    path.read_dir()
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("model-") && name.ends_with(".safetensors"))
        })
}

fn shared_gemma_audio_has_required_files(path: &Path) -> bool {
    path.is_dir()
        && path.join("config.json").exists()
        && path.join("model.safetensors").exists()
        && path.join("processor_config.json").exists()
        && path.join("tokenizer.json").exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn registry_maps_shared_file_asr_models_to_stt_snapshot_layout() {
        assert_eq!(
            shared_model_primary_relative_path("mlx-qwen3-asr").unwrap(),
            Path::new("MLX").join("mlx-community/Qwen3-ASR-1.7B-8bit")
        );
        assert_eq!(
            shared_model_primary_relative_path("mlx-fireredasr2-aed").unwrap(),
            Path::new("MLX").join("mlx-community/FireRedASR2-AED-mlx")
        );
        assert_eq!(
            shared_model_primary_relative_path("mlx-nemotron-asr-streaming-0.6b").unwrap(),
            Path::new("MLX").join("mlx-community/nemotron-3.5-asr-streaming-0.6b")
        );
        assert_eq!(
            shared_model_primary_relative_path("mlx-mega-asr").unwrap(),
            Path::new("MLX").join("mlx-community/Mega-ASR-8bit")
        );
        assert_eq!(
            shared_model_repo_id("mlx-qwen3-asr-1.7b"),
            Some("mlx-community/Qwen3-ASR-1.7B-8bit")
        );
        assert_eq!(
            shared_model_primary_relative_path("gemma4-e2b-audio-mlx").unwrap(),
            Path::new("GemmaMLX").join("mlx-community/gemma-4-e2b-it-4bit")
        );
        assert!(shared_model_primary_relative_path("mlx-sortformer-4spk-v1").is_none());
    }

    #[test]
    fn registry_exposes_all_shared_mlx_asr_aliases() {
        assert_eq!(
            shared_model_ids_for_family(SharedModelAssetFamily::MlxAsr),
            vec![
                "mlx-qwen3-asr-0.6b",
                "mlx-qwen3-asr",
                "mlx-qwen3-asr-1.7b",
                "mlx-fireredasr2-aed",
                "mlx-vibevoice-asr-bf16",
                "mlx-nemotron-asr-streaming-0.6b",
                "mlx-mega-asr",
            ]
        );
    }

    #[test]
    fn accepts_single_file_and_sharded_safetensors_snapshots() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let single_file = temp_dir.path().join("single");
        fs::create_dir(&single_file).unwrap();
        fs::write(single_file.join("config.json"), "{}").unwrap();
        fs::write(single_file.join("model.safetensors"), "").unwrap();
        assert!(shared_model_has_required_files(
            "mlx-fireredasr2-aed",
            &single_file
        ));

        let sharded = temp_dir.path().join("sharded");
        fs::create_dir(&sharded).unwrap();
        fs::write(sharded.join("config.json"), "{}").unwrap();
        fs::write(sharded.join("model.safetensors.index.json"), "{}").unwrap();
        fs::write(sharded.join("model-00001-of-00004.safetensors"), "").unwrap();
        assert!(shared_model_has_required_files("mlx-qwen3-asr", &sharded));
    }

    #[test]
    fn derives_progress_dirs_next_to_nested_snapshot_dir() {
        let snapshot_dir = Path::new("MLX")
            .join("mlx-community")
            .join("FireRedASR2-AED-mlx");
        assert_eq!(
            progress_dirs_for_install_dir(&snapshot_dir),
            vec![
                Path::new("MLX")
                    .join("mlx-community")
                    .join("FireRedASR2-AED-mlx.partial"),
                Path::new("MLX")
                    .join("mlx-community")
                    .join("FireRedASR2-AED-mlx.extracting"),
            ]
        );
    }
}
