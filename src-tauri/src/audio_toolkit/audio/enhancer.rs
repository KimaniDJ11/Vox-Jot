use super::spectral::spectral_denoise;
use super::FrameResampler;
use log::{info, warn};
use nnnoiseless::DenoiseState;
use std::time::Duration;

const RNNOISE_SAMPLE_RATE: usize = 48_000;
const RNNOISE_FRAME_MS: u64 = 10;
const RNNOISE_CHUNK_SIZE: usize = DenoiseState::FRAME_SIZE;
const RNNOISE_SCALE: f32 = i16::MAX as f32;

/// Full-band output rate for the standalone Enhance Audio feature. Speech-to-text
/// wants 16 kHz, but a cleaned file the user keeps should stay full-band.
pub const FULL_BAND_SAMPLE_RATE: u32 = 48_000;

/// Default spectral-subtraction strength (`0..1`) when none is supplied.
pub const DEFAULT_ENHANCEMENT_STRENGTH: f32 = 0.75;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioEnhancementModel {
    /// Learned, voice-tuned RNN denoiser (real-time, no parameters). Default.
    Rnnoise,
    /// Spectral subtraction (offline, adjustable strength, broadband noise).
    Spectral,
}

impl AudioEnhancementModel {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" => None,
            "rnnoise" | "nnnoiseless" => Some(Self::Rnnoise),
            "spectral" | "spectral-subtraction" | "spectral_subtraction" => Some(Self::Spectral),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rnnoise => "rnnoise",
            Self::Spectral => "spectral",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AudioEnhancementConfig {
    pub model: AudioEnhancementModel,
    /// Spectral-only noise-reduction strength in `[0, 1]` (ignored by RNNoise).
    pub strength: f32,
}

impl AudioEnhancementConfig {
    pub fn from_settings(enabled: bool, requested_model: &str) -> Option<Self> {
        if !enabled {
            return None;
        }

        let model = match AudioEnhancementModel::parse(requested_model) {
            Some(model) => model,
            None => {
                if !requested_model.trim().is_empty() {
                    warn!(
                        "Unsupported audio enhancement model '{}'; falling back to rnnoise",
                        requested_model
                    );
                }
                AudioEnhancementModel::Rnnoise
            }
        };

        Some(Self {
            model,
            strength: DEFAULT_ENHANCEMENT_STRENGTH,
        })
    }

    pub fn rnnoise() -> Self {
        Self {
            model: AudioEnhancementModel::Rnnoise,
            strength: DEFAULT_ENHANCEMENT_STRENGTH,
        }
    }
}

/// Streaming RNNoise enhancer used by the live capture path and the RNNoise
/// offline path. Resamples capture audio up to RNNoise's native 48 kHz, denoises
/// frame by frame, then resamples to a caller-chosen output rate (16 kHz for STT,
/// full-band for a kept file). Spectral subtraction is whole-file only, so it is
/// not handled here — if asked for, this falls back to RNNoise for the stream.
pub struct AudioEnhancer {
    input_resampler: FrameResampler,
    output_resampler: FrameResampler,
    denoise: Box<DenoiseState<'static>>,
    denoise_input: [f32; DenoiseState::FRAME_SIZE],
    denoise_output: [f32; DenoiseState::FRAME_SIZE],
}

impl AudioEnhancer {
    pub fn new(
        input_sample_rate: u32,
        output_sample_rate: u32,
        config: AudioEnhancementConfig,
    ) -> Result<Self, String> {
        if config.model == AudioEnhancementModel::Spectral {
            warn!("Spectral enhancement is offline-only; using RNNoise for the live stream");
        }
        info!(
            "Enabling '{}' audio enhancement ({} Hz capture -> {} Hz denoise -> {} Hz out)",
            config.model.as_str(),
            input_sample_rate,
            RNNOISE_SAMPLE_RATE,
            output_sample_rate
        );

        Ok(Self {
            input_resampler: FrameResampler::with_chunk_size(
                input_sample_rate as usize,
                RNNOISE_SAMPLE_RATE,
                Duration::from_millis(RNNOISE_FRAME_MS),
                RNNOISE_CHUNK_SIZE,
            )?,
            output_resampler: FrameResampler::with_chunk_size(
                RNNOISE_SAMPLE_RATE,
                output_sample_rate as usize,
                Duration::from_millis(30),
                RNNOISE_CHUNK_SIZE,
            )?,
            denoise: DenoiseState::new(),
            denoise_input: [0.0; DenoiseState::FRAME_SIZE],
            denoise_output: [0.0; DenoiseState::FRAME_SIZE],
        })
    }

    pub fn push(&mut self, raw: &[f32], mut emit: impl FnMut(&[f32])) {
        let input_resampler = &mut self.input_resampler;
        let output_resampler = &mut self.output_resampler;
        let denoise = &mut self.denoise;
        let denoise_input = &mut self.denoise_input;
        let denoise_output = &mut self.denoise_output;

        input_resampler.push(raw, |frame| {
            Self::process_rnnoise_frame(
                denoise,
                denoise_input,
                denoise_output,
                output_resampler,
                frame,
                &mut emit,
            )
        });
    }

    pub fn finish(&mut self, mut emit: impl FnMut(&[f32])) {
        let input_resampler = &mut self.input_resampler;
        let output_resampler = &mut self.output_resampler;
        let denoise = &mut self.denoise;
        let denoise_input = &mut self.denoise_input;
        let denoise_output = &mut self.denoise_output;

        input_resampler.finish(|frame| {
            Self::process_rnnoise_frame(
                denoise,
                denoise_input,
                denoise_output,
                output_resampler,
                frame,
                &mut emit,
            )
        });
        output_resampler.finish(emit);
    }

    fn process_rnnoise_frame(
        denoise: &mut DenoiseState<'static>,
        denoise_input: &mut [f32; DenoiseState::FRAME_SIZE],
        denoise_output: &mut [f32; DenoiseState::FRAME_SIZE],
        output_resampler: &mut FrameResampler,
        frame: &[f32],
        emit: &mut impl FnMut(&[f32]),
    ) {
        debug_assert_eq!(frame.len(), DenoiseState::FRAME_SIZE);

        for (dst, src) in denoise_input.iter_mut().zip(frame.iter().copied()) {
            *dst = src.clamp(-1.0, 1.0) * RNNOISE_SCALE;
        }

        denoise.process_frame(denoise_output, denoise_input);

        for sample in denoise_output.iter_mut() {
            *sample = (*sample / RNNOISE_SCALE).clamp(-1.0, 1.0);
        }

        output_resampler.push(denoise_output, emit);
    }
}

// Resample a whole buffer in one shot (used by the offline spectral path).
fn resample_all(samples: &[f32], in_hz: u32, out_hz: u32) -> Result<Vec<f32>, String> {
    if in_hz == out_hz {
        return Ok(samples.to_vec());
    }
    let mut resampler = FrameResampler::with_chunk_size(
        in_hz as usize,
        out_hz as usize,
        Duration::from_millis(20),
        1024,
    )?;
    let mut out = Vec::with_capacity(samples.len());
    resampler.push(samples, |frame| out.extend_from_slice(frame));
    resampler.finish(|frame| out.extend_from_slice(frame));
    Ok(out)
}

/// Enhance a whole buffer offline and return audio at `output_sample_rate`.
/// RNNoise streams through the enhancer; spectral subtraction resamples to the
/// output rate first, then denoises the full signal.
pub fn enhance_audio_samples(
    samples: &[f32],
    input_sample_rate: u32,
    output_sample_rate: u32,
    config: AudioEnhancementConfig,
) -> Result<Vec<f32>, String> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    match config.model {
        AudioEnhancementModel::Rnnoise => {
            let mut enhancer = AudioEnhancer::new(input_sample_rate, output_sample_rate, config)?;
            let mut enhanced = Vec::with_capacity(samples.len());
            enhancer.push(samples, |frame| enhanced.extend_from_slice(frame));
            enhancer.finish(|frame| enhanced.extend_from_slice(frame));
            Ok(enhanced)
        }
        AudioEnhancementModel::Spectral => {
            let resampled = resample_all(samples, input_sample_rate, output_sample_rate)?;
            Ok(spectral_denoise(&resampled, config.strength))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        enhance_audio_samples, AudioEnhancementConfig, AudioEnhancementModel, AudioEnhancer,
    };
    use nnnoiseless::DenoiseState;

    fn rnnoise() -> AudioEnhancementConfig {
        AudioEnhancementConfig::rnnoise()
    }

    #[test]
    fn parses_model_aliases() {
        assert_eq!(
            AudioEnhancementModel::parse("rnnoise"),
            Some(AudioEnhancementModel::Rnnoise)
        );
        assert_eq!(
            AudioEnhancementModel::parse("NNNoiseLess"),
            Some(AudioEnhancementModel::Rnnoise)
        );
        assert_eq!(
            AudioEnhancementModel::parse("spectral"),
            Some(AudioEnhancementModel::Spectral)
        );
        assert_eq!(AudioEnhancementModel::parse("mossformer2"), None);
    }

    #[test]
    fn falls_back_to_rnnoise_for_unknown_model() {
        let config = AudioEnhancementConfig::from_settings(true, "mossformer2")
            .expect("enhancement should be enabled");
        assert_eq!(config.model, AudioEnhancementModel::Rnnoise);
    }

    #[test]
    fn enhancer_emits_16k_frames() {
        let mut enhancer = AudioEnhancer::new(48_000, 16_000, rnnoise()).expect("create enhancer");
        let input: Vec<f32> = (0..(DenoiseState::FRAME_SIZE * 12))
            .map(|index| {
                let theta = index as f32 * 2.0 * std::f32::consts::PI * 220.0 / 48_000.0;
                theta.sin() * 0.2
            })
            .collect();
        let mut frames = Vec::new();

        enhancer.push(&input, |frame| frames.push(frame.to_vec()));
        enhancer.finish(|frame| frames.push(frame.to_vec()));

        assert!(!frames.is_empty());
        assert!(frames.iter().all(|frame| frame.len() == 480));
        assert!(frames
            .iter()
            .flat_map(|frame| frame.iter())
            .all(|sample| sample.is_finite()));
    }

    #[test]
    fn rnnoise_full_band_output_is_longer_than_16k() {
        // The same source enhanced to 48 kHz should yield ~3x the samples of the
        // 16 kHz path — proof the full-band output rate is honored end to end.
        let input: Vec<f32> = (0..(DenoiseState::FRAME_SIZE * 50))
            .map(|index| {
                let theta = index as f32 * 2.0 * std::f32::consts::PI * 440.0 / 48_000.0;
                theta.sin() * 0.1
            })
            .collect();

        let out_16k = enhance_audio_samples(&input, 48_000, 16_000, rnnoise()).expect("16k");
        let out_48k = enhance_audio_samples(&input, 48_000, 48_000, rnnoise()).expect("48k");

        assert!(out_16k.iter().all(|s| s.is_finite()));
        assert!(out_48k.iter().all(|s| s.is_finite()));
        let ratio = out_48k.len() as f32 / out_16k.len().max(1) as f32;
        assert!(ratio > 2.5, "expected ~3x more samples at 48k, got {ratio}");
    }

    #[test]
    fn spectral_offline_path_preserves_rate_and_is_finite() {
        let config = AudioEnhancementConfig {
            model: AudioEnhancementModel::Spectral,
            strength: 0.8,
        };
        let input: Vec<f32> = (0..48_000)
            .map(|index| {
                let theta = index as f32 * 2.0 * std::f32::consts::PI * 440.0 / 48_000.0;
                theta.sin() * 0.2
            })
            .collect();

        // Same rate in/out: spectral keeps the length.
        let output = enhance_audio_samples(&input, 48_000, 48_000, config).expect("spectral");
        assert_eq!(output.len(), input.len());
        assert!(output.iter().all(|sample| sample.is_finite()));
    }
}
