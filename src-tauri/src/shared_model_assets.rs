use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::storage_paths;

pub fn shared_mlx_asr_repo_id(model_id: &str) -> Option<&'static str> {
    match model_id {
        "mlx-qwen3-asr-0.6b" => Some("mlx-community/Qwen3-ASR-0.6B-8bit"),
        "mlx-qwen3-asr" | "mlx-qwen3-asr-1.7b" => Some("mlx-community/Qwen3-ASR-1.7B-8bit"),
        "mlx-fireredasr2-aed" => Some("mlx-community/FireRedASR2-AED-mlx"),
        "mlx-vibevoice-asr-bf16" => Some("mlx-community/VibeVoice-ASR-bf16"),
        _ => None,
    }
}

pub fn shared_mlx_asr_stt_relative_path(model_id: &str) -> Option<PathBuf> {
    shared_mlx_asr_repo_id(model_id).map(|repo_id| Path::new("MLX").join(repo_id))
}

pub fn shared_mlx_asr_stt_install_dir(
    app: &AppHandle,
    model_id: &str,
) -> Result<Option<PathBuf>, String> {
    let Some(relative_path) = shared_mlx_asr_stt_relative_path(model_id) else {
        return Ok(None);
    };

    Ok(Some(
        storage_paths::stt_models_dir(app)
            .map_err(|err| format!("Failed to resolve STT model dir: {err}"))?
            .join(relative_path),
    ))
}

pub fn shared_mlx_asr_legacy_speech_analysis_dir(
    app: &AppHandle,
    model_id: &str,
) -> Result<Option<PathBuf>, String> {
    if shared_mlx_asr_repo_id(model_id).is_none() {
        return Ok(None);
    }

    Ok(Some(
        storage_paths::speech_analysis_models_dir(app)
            .map_err(|err| format!("Failed to resolve speech-analysis model dir: {err}"))?
            .join(model_id),
    ))
}

pub fn shared_mlx_asr_candidate_dirs(
    app: &AppHandle,
    model_id: &str,
) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    if let Some(path) = shared_mlx_asr_stt_install_dir(app, model_id)? {
        paths.push(path);
    }
    if let Some(path) = shared_mlx_asr_legacy_speech_analysis_dir(app, model_id)? {
        paths.push(path);
    }
    Ok(paths)
}

pub fn shared_mlx_asr_has_required_files(path: &Path) -> bool {
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

pub fn installed_shared_mlx_asr_dir(
    app: &AppHandle,
    model_id: &str,
) -> Result<Option<PathBuf>, String> {
    for path in shared_mlx_asr_candidate_dirs(app, model_id)? {
        if shared_mlx_asr_has_required_files(&path) {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn maps_shared_file_asr_models_to_stt_snapshot_layout() {
        assert_eq!(
            shared_mlx_asr_stt_relative_path("mlx-qwen3-asr").unwrap(),
            Path::new("MLX").join("mlx-community/Qwen3-ASR-1.7B-8bit")
        );
        assert_eq!(
            shared_mlx_asr_stt_relative_path("mlx-fireredasr2-aed").unwrap(),
            Path::new("MLX").join("mlx-community/FireRedASR2-AED-mlx")
        );
        assert!(shared_mlx_asr_stt_relative_path("mlx-sortformer-4spk-v1").is_none());
    }

    #[test]
    fn accepts_single_file_and_sharded_safetensors_snapshots() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let single_file = temp_dir.path().join("single");
        fs::create_dir(&single_file).unwrap();
        fs::write(single_file.join("config.json"), "{}").unwrap();
        fs::write(single_file.join("model.safetensors"), "").unwrap();
        assert!(shared_mlx_asr_has_required_files(&single_file));

        let sharded = temp_dir.path().join("sharded");
        fs::create_dir(&sharded).unwrap();
        fs::write(sharded.join("config.json"), "{}").unwrap();
        fs::write(sharded.join("model.safetensors.index.json"), "{}").unwrap();
        fs::write(sharded.join("model-00001-of-00004.safetensors"), "").unwrap();
        assert!(shared_mlx_asr_has_required_files(&sharded));
    }
}
