use std::path::{Path, PathBuf};
use std::process::Command;

use log::info;
use tauri::AppHandle;

const RUNNER_ZIP_MACOS_ARM64: &str = "llama-liquid-audio-macos-arm64.zip";
const RUNNER_DIR_NAME: &str = "runner";
const CLI_BINARY: &str = "llama-liquid-audio-cli";
const DEFAULT_QUANT: &str = "Q4_0";

/// Built-in voice variants accepted by the upstream `llama-liquid-audio-cli`
/// system prompt. Anything outside this set causes the CLI to abort with
/// `ERR: Unsupported system prompt` (regardless of GPU / Metal support).
#[derive(Debug, Clone, Copy, Default)]
pub enum LfmAudioVoice {
    #[default]
    UsFemale,
    UsMale,
    UkFemale,
    UkMale,
}

impl LfmAudioVoice {
    pub fn from_voice_id(voice_id: Option<&str>) -> Self {
        let Some(raw) = voice_id else {
            return Self::default();
        };
        let normalized: String = raw
            .chars()
            .filter_map(|ch| {
                if ch.is_ascii_alphanumeric() {
                    Some(ch.to_ascii_lowercase())
                } else {
                    None
                }
            })
            .collect();
        let has_uk = normalized.contains("uk") || normalized.contains("british");
        let has_male = normalized.contains("male") && !normalized.contains("female");
        match (has_uk, has_male) {
            (true, true) => Self::UkMale,
            (true, false) => Self::UkFemale,
            (false, true) => Self::UsMale,
            (false, false) => Self::UsFemale,
        }
    }

    fn system_prompt(self) -> &'static str {
        match self {
            Self::UsFemale => "Perform TTS. Use the US female voice.",
            Self::UsMale => "Perform TTS. Use the US male voice.",
            Self::UkFemale => "Perform TTS. Use the UK female voice.",
            Self::UkMale => "Perform TTS. Use the UK male voice.",
        }
    }
}

/// Runtime context for the Liquid Audio (LFM2.5-Audio) GGUF stack.
///
/// All assets live under `<app_data>/models/tts/store/lfm-audio-gguf/`. The
/// migration in `storage_paths::migrate_local_model_snapshots` seeds this dir
/// from `~/Apps/Models/LiquidAI_LFM2.5-Audio-1.5B-GGUF/`. Runtime extracts the
/// zipped binary on first use into a `runner/` subdir.
pub struct LfmAudioGgufContext {
    pub root_dir: PathBuf,
    pub quantization: String,
}

impl LfmAudioGgufContext {
    pub fn from_managed_store(app: &AppHandle) -> Option<Self> {
        Self::from_managed_store_with_quant(app, DEFAULT_QUANT)
    }

    pub fn from_managed_store_with_quant(app: &AppHandle, quant: &str) -> Option<Self> {
        let root_dir = crate::storage_paths::lfm_audio_gguf_dir(app).ok()?;
        let ctx = Self {
            root_dir,
            quantization: quant.to_string(),
        };
        if !ctx.model_gguf().exists() {
            return None;
        }
        Some(ctx)
    }

    pub fn is_ready(&self) -> bool {
        self.model_gguf().exists()
            && self.mmproj_gguf().exists()
            && self.vocoder_gguf().exists()
            && self.tokenizer_gguf().exists()
            && (self.cli_path().exists() || self.runner_zip_path().exists())
    }

    fn cli_path(&self) -> PathBuf {
        self.root_dir.join(RUNNER_DIR_NAME).join(CLI_BINARY)
    }

    fn runner_zip_path(&self) -> PathBuf {
        self.root_dir.join(RUNNER_ZIP_MACOS_ARM64)
    }

    fn model_gguf(&self) -> PathBuf {
        self.root_dir
            .join(format!("LFM2.5-Audio-1.5B-{}.gguf", self.quantization))
    }

    fn mmproj_gguf(&self) -> PathBuf {
        self.root_dir.join(format!(
            "mmproj-LFM2.5-Audio-1.5B-{}.gguf",
            self.quantization
        ))
    }

    fn vocoder_gguf(&self) -> PathBuf {
        self.root_dir.join(format!(
            "vocoder-LFM2.5-Audio-1.5B-{}.gguf",
            self.quantization
        ))
    }

    fn tokenizer_gguf(&self) -> PathBuf {
        self.root_dir.join(format!(
            "tokenizer-LFM2.5-Audio-1.5B-{}.gguf",
            self.quantization
        ))
    }

    /// Extract the platform runner zip on first use. Returns the path to the
    /// CLI binary, ensuring it's marked executable on Unix.
    pub fn ensure_runner(&self) -> Result<PathBuf, String> {
        let cli = self.cli_path();
        if cli.exists() {
            ensure_executable(&cli);
            return Ok(cli);
        }

        let zip_path = self.runner_zip_path();
        if !zip_path.exists() {
            return Err(format!(
                "LFM Audio runner zip is missing at {}",
                zip_path.display()
            ));
        }

        let runner_dir = self.root_dir.join(RUNNER_DIR_NAME);
        std::fs::create_dir_all(&runner_dir).map_err(|err| {
            format!(
                "Failed to create runner dir {}: {err}",
                runner_dir.display()
            )
        })?;

        let status = Command::new("unzip")
            .args(["-o", "-q"])
            .arg(&zip_path)
            .arg("-d")
            .arg(&runner_dir)
            .status()
            .map_err(|err| format!("Failed to spawn unzip: {err}"))?;
        if !status.success() {
            return Err(format!(
                "Failed to extract LFM Audio runner: unzip exited with {status}"
            ));
        }

        // Some zips include a top-level wrapper directory — flatten it if so.
        flatten_runner_dir(&runner_dir)?;

        if !cli.exists() {
            return Err(format!(
                "LFM Audio CLI binary not found after extraction at {}",
                cli.display()
            ));
        }
        ensure_executable(&cli);
        info!("Extracted LFM Audio runner to {}", cli.display());
        Ok(cli)
    }

    /// Synthesize `text` using a built-in voice variant. The CLI rejects any
    /// system prompt outside the four built-in voices with
    /// `ERR: Unsupported system prompt`, so the variant has to be one of
    /// `LfmAudioVoice`'s cases.
    pub fn synthesize_with_voice(
        &self,
        text: &str,
        output_path: &Path,
        voice: LfmAudioVoice,
    ) -> Result<(), String> {
        let cli = self.ensure_runner()?;
        let output = Command::new(&cli)
            .arg("-m")
            .arg(self.model_gguf())
            .arg("--mmproj")
            .arg(self.mmproj_gguf())
            .arg("-mv")
            .arg(self.vocoder_gguf())
            .arg("--tts-speaker-file")
            .arg(self.tokenizer_gguf())
            .arg("-sys")
            .arg(voice.system_prompt())
            .arg("-p")
            .arg(text)
            .arg("-o")
            .arg(output_path)
            .output()
            .map_err(|err| format!("Failed to run LFM Audio CLI: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let preview = cli_stderr_preview(&stderr);
            return Err(format!(
                "LFM Audio TTS exited with {}: {}",
                output.status, preview
            ));
        }
        if !output_path.exists() {
            return Err("LFM Audio CLI completed but produced no output file.".to_string());
        }
        Ok(())
    }
}

/// Prefer the full stderr when short; otherwise keep the tail so CLI usage /
/// error lines after verbose GGML init logs remain visible in UI previews.
fn cli_stderr_preview(stderr: &str) -> String {
    const MAX_FULL_CHARS: usize = 2048;
    const TAIL_CHARS: usize = 1000;
    let chars: Vec<char> = stderr.chars().collect();
    if chars.len() <= MAX_FULL_CHARS {
        chars.into_iter().collect()
    } else {
        let start = chars.len().saturating_sub(TAIL_CHARS);
        format!("…{}", chars[start..].iter().collect::<String>())
    }
}

#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = std::fs::metadata(path) {
        let mut perms = metadata.permissions();
        perms.set_mode(0o755);
        let _ = std::fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) {}

/// If unzip produced `runner/<wrapper>/llama-liquid-audio-cli`, lift the inner
/// contents up so the CLI sits at `runner/llama-liquid-audio-cli`.
fn flatten_runner_dir(runner_dir: &Path) -> Result<(), String> {
    let cli = runner_dir.join(CLI_BINARY);
    if cli.exists() {
        return Ok(());
    }

    let entries: Vec<_> = std::fs::read_dir(runner_dir)
        .map_err(|err| format!("Failed to inspect runner dir: {err}"))?
        .filter_map(Result::ok)
        .collect();

    let wrappers: Vec<_> = entries
        .iter()
        .filter(|entry| entry.path().is_dir())
        .collect();
    if wrappers.len() != 1 {
        return Ok(());
    }
    let wrapper = wrappers[0].path();

    for entry in
        std::fs::read_dir(&wrapper).map_err(|err| format!("Failed to read wrapper dir: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Failed to read wrapper entry: {err}"))?;
        let target = runner_dir.join(entry.file_name());
        std::fs::rename(entry.path(), &target).map_err(|err| {
            format!(
                "Failed to flatten runner asset {} → {}: {err}",
                entry.path().display(),
                target.display()
            )
        })?;
    }
    let _ = std::fs::remove_dir_all(&wrapper);
    Ok(())
}
