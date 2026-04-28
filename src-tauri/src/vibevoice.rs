use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

const BRIDGE_SCRIPT: &str = "vibevoice_bridge.py";
/// Stem of `demo/voices/streaming_model/en-Carter_man.pt`; short names like `Carter` still resolve via the bridge matcher.
const DEFAULT_SPEAKER: &str = "en-Carter_man";
const VENDOR_VOICES_REL: &[&str] = &["vendor", "VibeVoice", "demo", "voices", "streaming_model"];

/// Runtime context for VibeVoice TTS.
///
/// Model assets live at `<app_data>/models/tts/store/vibevoice/`. Synthesis
/// runs through a Python bridge script that imports `vibevoice` + `torch`, so
/// this provider must be gated behind `experimental_enabled` and depends on
/// the speech-runtime venv having `pip install -e ./vendor/VibeVoice[streamingtts]`
/// applied. Voice .pt files are read from the vendored VibeVoice clone at
/// `speech-runtime/vendor/VibeVoice/demo/voices/streaming_model/`.
pub struct VibeVoiceContext {
    pub model_dir: PathBuf,
    pub python_path: PathBuf,
    pub bridge_script: PathBuf,
    pub voices_dir: PathBuf,
}

impl VibeVoiceContext {
    pub fn from_managed_store(
        app: &AppHandle,
        python_path: PathBuf,
        runtime_root: &Path,
    ) -> Option<Self> {
        let model_dir = crate::storage_paths::vibevoice_dir(app).ok()?;
        if !model_dir.join("config.json").exists()
            || !model_dir.join("model.safetensors").exists()
            || !model_dir.join("preprocessor_config.json").exists()
        {
            return None;
        }
        let bridge_script = runtime_root.join(BRIDGE_SCRIPT);
        if !bridge_script.exists() {
            return None;
        }
        let mut voices_dir = runtime_root.to_path_buf();
        for segment in VENDOR_VOICES_REL {
            voices_dir = voices_dir.join(segment);
        }
        if !voices_dir.is_dir() {
            return None;
        }
        Some(Self {
            model_dir,
            python_path,
            bridge_script,
            voices_dir,
        })
    }

    pub fn synthesize(
        &self,
        text: &str,
        output_path: &Path,
        speaker: Option<&str>,
    ) -> Result<(), String> {
        let speaker = speaker.unwrap_or(DEFAULT_SPEAKER);
        let runtime_cwd = self.bridge_script.parent().ok_or_else(|| {
            "VibeVoice bridge script path must have a parent directory.".to_string()
        })?;
        let output = Command::new(&self.python_path)
            .current_dir(runtime_cwd)
            .arg(&self.bridge_script)
            .arg("--model-path")
            .arg(&self.model_dir)
            .arg("--voices-dir")
            .arg(&self.voices_dir)
            .arg("--text")
            .arg(text)
            .arg("--output")
            .arg(output_path)
            .arg("--speaker")
            .arg(speaker)
            .env("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")
            .env("PYTHONUNBUFFERED", "1")
            .output()
            .map_err(|err| format!("Failed to spawn VibeVoice bridge: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let truncated: String = stderr.chars().take(800).collect();
            return Err(format!(
                "VibeVoice bridge exited with {}: {}",
                output.status, truncated
            ));
        }
        if !output_path.exists() {
            return Err("VibeVoice bridge completed but produced no output file.".to_string());
        }
        Ok(())
    }
}
