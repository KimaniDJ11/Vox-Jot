use log::info;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::catalog::{MANAGED_RUNTIME_MODEL_DEFINITIONS, MLX_AUDIO_TTS_MODEL_DEFINITIONS};
use super::runtime::copy_directory_recursive;

pub fn legacy_dev_models_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join("Apps").join("Models"))
}

pub fn legacy_dev_tts_store_dir() -> Option<PathBuf> {
    legacy_dev_models_root().map(|root| root.join("TTS"))
}

fn copy_legacy_path_if_missing(
    source: &Path,
    destination: &Path,
    label: &str,
) -> Result<(), String> {
    if !source.exists() || destination.exists() {
        return Ok(());
    }

    if source.is_dir() {
        copy_directory_recursive(source, destination).map_err(|err| {
            format!(
                "Failed to migrate {label} from '{}' to '{}': {err}",
                source.display(),
                destination.display()
            )
        })?;
    } else {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create '{}': {err}", parent.display()))?;
        }
        fs::copy(source, destination).map_err(|err| {
            format!(
                "Failed to migrate {label} from '{}' to '{}': {err}",
                source.display(),
                destination.display()
            )
        })?;
    }

    info!(
        "Migrated {label} from '{}' to '{}'",
        source.display(),
        destination.display()
    );
    Ok(())
}

pub fn migrate_legacy_tts_model_layout(app_handle: &AppHandle) -> Result<(), String> {
    let store_dir = crate::storage_paths::tts_model_store_dir(app_handle)
        .map_err(|err| format!("Failed to resolve TTS store dir: {err}"))?;
    fs::create_dir_all(&store_dir).map_err(|err| {
        format!(
            "Failed to create TTS store dir '{}': {err}",
            store_dir.display()
        )
    })?;

    let Some(legacy_root) = legacy_dev_models_root() else {
        return Ok(());
    };

    if let Some(legacy_tts_store) = legacy_dev_tts_store_dir() {
        if legacy_tts_store.exists() {
            for entry in fs::read_dir(&legacy_tts_store).map_err(|err| {
                format!(
                    "Failed to read legacy TTS store '{}': {err}",
                    legacy_tts_store.display()
                )
            })? {
                let entry =
                    entry.map_err(|err| format!("Failed to read legacy TTS entry: {err}"))?;
                copy_legacy_path_if_missing(
                    &entry.path(),
                    &store_dir.join(entry.file_name()),
                    "legacy TTS asset",
                )?;
            }
        }
    }

    let legacy_mlx_dir = legacy_root.join("MLX");
    let target_mlx_dir = store_dir.join("MLX");
    if legacy_mlx_dir.exists() {
        for entry in fs::read_dir(&legacy_mlx_dir).map_err(|err| {
            format!(
                "Failed to read legacy MLX store '{}': {err}",
                legacy_mlx_dir.display()
            )
        })? {
            let entry = entry.map_err(|err| format!("Failed to read legacy MLX entry: {err}"))?;
            copy_legacy_path_if_missing(
                &entry.path(),
                &target_mlx_dir.join(entry.file_name()),
                "legacy MLX TTS asset",
            )?;
        }
    }

    for definition in MLX_AUDIO_TTS_MODEL_DEFINITIONS {
        let hf_repo_basename = definition
            .hf_model_id
            .rsplit('/')
            .next()
            .unwrap_or(definition.model_id);

        for name in definition
            .local_dir_names
            .iter()
            .copied()
            .chain(std::iter::once(definition.model_id))
            .chain(std::iter::once(hf_repo_basename))
        {
            copy_legacy_path_if_missing(
                &legacy_root.join(name),
                &store_dir.join(name),
                "legacy MLX TTS model",
            )?;
            copy_legacy_path_if_missing(
                &legacy_root.join("MLX").join(name),
                &target_mlx_dir.join(name),
                "legacy MLX TTS model",
            )?;
        }
    }

    for definition in MANAGED_RUNTIME_MODEL_DEFINITIONS {
        let Some(source_repo_dir) = definition.source_repo_dir else {
            continue;
        };

        copy_legacy_path_if_missing(
            &legacy_root.join(source_repo_dir),
            &store_dir.join(source_repo_dir),
            "legacy runtime-backed TTS asset",
        )?;
    }

    Ok(())
}
