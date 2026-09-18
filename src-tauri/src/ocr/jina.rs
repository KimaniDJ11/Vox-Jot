//! Jina-OCR-v1 experimental local OCR provider.
//!
//! Exposes `jinaai/jina-ocr-v1` as an on-demand document parsing provider
//! running locally on Apple Silicon Metal (MPS) or CPU. Models are discovered
//! dynamically from external storage without copying to internal storage.
//!
//! Security Notice:
//! Jina-OCR-v1 executes local custom Python modeling code from the DeepSeek-OCR /
//! DeepSeek-V2 MoE architecture via `trust_remote_code=True`. Execution is strictly
//! bounded to local model files via `local_files_only=True` and `TRANSFORMERS_OFFLINE=1`.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::external_model_storage;
use crate::ocr::{OcrProvider, OcrProviderDescriptor, OcrResult, OcrRuntime, OcrTicket};

const PROVIDER_ID: &str = "jina-ocr-v1";
const PROVIDER_LABEL: &str = "Experimental — Jina OCR";
const PROVIDER_VENDOR: &str = "Jina AI";
const PROVIDER_DESC: &str =
    "Advanced document and table OCR returning structured Markdown (3.4B MoE, ~570M active).";
const PROVIDER_LICENSE: &str = "CC BY-NC 4.0";

pub struct JinaOcrProvider {
    runtime: OcrRuntime,
}

impl JinaOcrProvider {
    pub fn new(app: AppHandle) -> Self {
        Self {
            runtime: OcrRuntime::new(app),
        }
    }

    /// Verifies whether a candidate directory contains valid jina-ocr-v1 model assets.
    pub fn is_valid_model_dir(path: &Path) -> bool {
        if !path.is_dir() {
            return false;
        }

        let required_files = [
            "config.json",
            "model-00001-of-00002.safetensors",
            "modeling_deepseekocr.py",
        ];

        required_files.iter().all(|file| path.join(file).is_file())
    }
}

impl OcrProvider for JinaOcrProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn descriptor(&self) -> OcrProviderDescriptor {
        let model_path = self.resolve_model_path();
        let is_installed = model_path.is_some();
        let has_python = self.runtime.resolve_python_path().is_some();
        let is_available = is_installed && has_python;

        let storage_location = model_path.as_ref().map(|p| {
            let s = p.to_string_lossy();
            if s.starts_with("/Volumes") || s.starts_with("/media") || s.starts_with("/mnt") {
                "External Drive".to_string()
            } else {
                "Local Storage".to_string()
            }
        });

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let backend = "Apple Silicon Metal (MPS)".to_string();
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        let backend = "CPU".to_string();

        let status_detail = if is_available {
            Some(format!(
                "Ready for on-demand document recognition ({})",
                storage_location.as_deref().unwrap_or("Local")
            ))
        } else if !is_installed {
            Some("Jina OCR model drive is not available.".to_string())
        } else {
            Some("Python runtime with torch and torchvision not found.".to_string())
        };

        OcrProviderDescriptor {
            id: PROVIDER_ID.to_string(),
            label: PROVIDER_LABEL.to_string(),
            vendor: PROVIDER_VENDOR.to_string(),
            description: PROVIDER_DESC.to_string(),
            license: PROVIDER_LICENSE.to_string(),
            is_experimental: true,
            is_installed,
            is_available,
            storage_location,
            backend,
            status_detail,
        }
    }

    fn is_available(&self) -> bool {
        self.resolve_model_path().is_some() && self.runtime.resolve_python_path().is_some()
    }

    fn resolve_model_path(&self) -> Option<PathBuf> {
        // 1. Explicit override via environment variable
        if let Ok(env_path) = std::env::var("VOXJOT_JINA_OCR_MODEL_DIR") {
            let path = PathBuf::from(env_path.trim());
            if Self::is_valid_model_dir(&path) {
                return Some(path);
            } else {
                return None;
            }
        }

        // 2. Cached external root from Vox Jot external_model_storage
        if let Some(ext_root) = external_model_storage::cached_external_root() {
            for sub in [
                "ocr/jina-ocr-v1",
                "jina-ocr-v1",
                "AI Models/jina-ocr-v1",
                "Models/jina-ocr-v1",
            ] {
                let candidate = ext_root.join(sub);
                if Self::is_valid_model_dir(&candidate) {
                    return Some(candidate);
                }
            }
        }

        // 3. Auto-detected candidate roots from external_model_storage
        for candidate_root in external_model_storage::auto_detect_candidate_roots() {
            for sub in ["ocr/jina-ocr-v1", "jina-ocr-v1"] {
                let candidate = candidate_root.join(sub);
                if Self::is_valid_model_dir(&candidate) {
                    return Some(candidate);
                }
            }
        }

        // 4. Generic mounted volume scanning across all external disks (e.g. Samsung T7, Models, AI Storage)
        #[cfg(target_os = "macos")]
        let volume_roots = ["/Volumes"];
        #[cfg(not(target_os = "macos"))]
        let volume_roots = ["/media", "/mnt"];

        for base in &volume_roots {
            if let Ok(entries) = fs::read_dir(base) {
                for entry in entries.flatten() {
                    let volume_path = entry.path();
                    for sub in [
                        "AI Models/jina-ocr-v1",
                        "AI Models/jinaai/jina-ocr-v1",
                        "Models/jina-ocr-v1",
                        "models/ocr/jina-ocr-v1",
                        "VoxJot/models/ocr/jina-ocr-v1",
                        "VoxJot/app-support/models/ocr/jina-ocr-v1",
                        "Apps/Models/VoxJot/app-support/models/ocr/jina-ocr-v1",
                        "ocr/jina-ocr-v1",
                    ] {
                        let candidate = volume_path.join(sub);
                        if Self::is_valid_model_dir(&candidate) {
                            return Some(candidate);
                        }
                    }
                }
            }
        }

        None
    }

    fn recognize(&self, image_path: &Path, ticket: &OcrTicket) -> Result<OcrResult, String> {
        let model_dir = self
            .resolve_model_path()
            .ok_or_else(|| "Jina OCR model drive is not available.".to_string())?;

        self.runtime.execute_jina(&model_dir, image_path, ticket)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jina_provider_constants() {
        assert_eq!(PROVIDER_ID, "jina-ocr-v1");
        assert!(PROVIDER_LABEL.contains("Experimental"));
        assert_eq!(PROVIDER_LICENSE, "CC BY-NC 4.0");
    }

    #[test]
    fn test_is_valid_model_dir() {
        // Conditional check: only validate if the model exists at the env-var or
        // well-known external location. This makes the test portable across machines.
        if let Ok(env_dir) = std::env::var("VOXJOT_JINA_OCR_MODEL_DIR") {
            let dir = PathBuf::from(env_dir);
            if dir.is_dir() {
                assert!(JinaOcrProvider::is_valid_model_dir(&dir));
            }
        }

        // Negative check: temp dir must not pass validation
        let temp_dir = std::env::temp_dir();
        assert!(!JinaOcrProvider::is_valid_model_dir(&temp_dir));
    }
}
