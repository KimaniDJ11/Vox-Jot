use crate::helpers::subtitles::TimedSegment;
use anyhow::Result;
use serde::Deserialize;
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Deserialize)]
struct WhisperKitHelperPayload {
    text: String,
    #[serde(default)]
    segments: Vec<TimedSegment>,
}

#[derive(Debug)]
pub struct WhisperKitStreamingEngine {
    helper_path: PathBuf,
}

impl WhisperKitStreamingEngine {
    pub fn new() -> Result<Self> {
        let helper_path = resolve_helper_path().ok_or_else(|| {
            anyhow::anyhow!(
                "WhisperKit helper is not bundled. Set VOX_JOT_WHISPERKIT_HELPER to a WhisperKit-compatible helper binary."
            )
        })?;
        Ok(Self { helper_path })
    }

    pub fn transcribe(
        &self,
        audio: &[f32],
        sample_rate: u32,
        language: Option<&str>,
    ) -> Result<(String, Vec<TimedSegment>)> {
        let wav_bytes = encode_wav(audio, sample_rate)?;
        let temp_path =
            std::env::temp_dir().join(format!("vox-jot-whisperkit-{}.wav", uuid::Uuid::new_v4()));
        std::fs::write(&temp_path, wav_bytes)
            .map_err(|err| anyhow::anyhow!("Failed to write WhisperKit input audio: {err}"))?;

        let mut command = Command::new(&self.helper_path);
        command
            .arg("transcribe")
            .arg("--input")
            .arg(&temp_path)
            .arg("--json");
        if let Some(language) = language.filter(|value| !value.trim().is_empty()) {
            command.arg("--language").arg(language);
        }
        let output = command
            .output()
            .map_err(|err| anyhow::anyhow!("Failed to run WhisperKit helper: {err}"));
        let _ = std::fs::remove_file(&temp_path);
        let output = output?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!(
                "WhisperKit helper exited with status {:?}: {}",
                output.status.code(),
                stderr.trim()
            ));
        }

        let payload: WhisperKitHelperPayload = serde_json::from_slice(&output.stdout)
            .map_err(|err| anyhow::anyhow!("Failed to parse WhisperKit helper JSON: {err}"))?;
        Ok((payload.text, payload.segments))
    }
}

fn resolve_helper_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("VOX_JOT_WHISPERKIT_HELPER") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let candidates = [
        exe_dir.join("vox-jot-whisperkit-helper"),
        exe_dir.join("../Resources/vox-jot-whisperkit-helper"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn encode_wav(audio: &[f32], sample_rate: u32) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|err| anyhow::anyhow!("Failed to create WhisperKit WAV encoder: {err}"))?;
        for sample in audio {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            writer
                .write_sample(value)
                .map_err(|err| anyhow::anyhow!("Failed to encode WhisperKit WAV sample: {err}"))?;
        }
        writer
            .finalize()
            .map_err(|err| anyhow::anyhow!("Failed to finalize WhisperKit WAV output: {err}"))?;
    }
    Ok(cursor.into_inner())
}
