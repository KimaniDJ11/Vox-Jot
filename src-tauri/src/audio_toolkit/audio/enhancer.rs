use super::FrameResampler;
use crate::audio_toolkit::constants;
use log::{info, warn};
use nnnoiseless::DenoiseState;
use std::time::Duration;

const RNNOISE_SAMPLE_RATE: usize = 48_000;
const RNNOISE_FRAME_MS: u64 = 10;
const RNNOISE_CHUNK_SIZE: usize = DenoiseState::FRAME_SIZE;
const RNNOISE_SCALE: f32 = i16::MAX as f32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioEnhancementModel {
    Rnnoise,
}

impl AudioEnhancementModel {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" => None,
            "rnnoise" | "nnnoiseless" => Some(Self::Rnnoise),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rnnoise => "rnnoise",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioEnhancementConfig {
    pub model: AudioEnhancementModel,
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

        Some(Self { model })
    }
}

pub struct AudioEnhancer {
    input_resampler: FrameResampler,
    output_resampler: FrameResampler,
    denoise: Box<DenoiseState<'static>>,
    denoise_input: [f32; DenoiseState::FRAME_SIZE],
    denoise_output: [f32; DenoiseState::FRAME_SIZE],
}

impl AudioEnhancer {
    pub fn new(input_sample_rate: u32, config: AudioEnhancementConfig) -> Result<Self, String> {
        info!(
            "Enabling '{}' audio enhancement ({} Hz capture -> {} Hz denoise -> {} Hz STT)",
            config.model.as_str(),
            input_sample_rate,
            RNNOISE_SAMPLE_RATE,
            constants::WHISPER_SAMPLE_RATE
        );

        match config.model {
            AudioEnhancementModel::Rnnoise => Ok(Self {
                input_resampler: FrameResampler::with_chunk_size(
                    input_sample_rate as usize,
                    RNNOISE_SAMPLE_RATE,
                    Duration::from_millis(RNNOISE_FRAME_MS),
                    RNNOISE_CHUNK_SIZE,
                )?,
                output_resampler: FrameResampler::with_chunk_size(
                    RNNOISE_SAMPLE_RATE,
                    constants::WHISPER_SAMPLE_RATE as usize,
                    Duration::from_millis(30),
                    RNNOISE_CHUNK_SIZE,
                )?,
                denoise: DenoiseState::new(),
                denoise_input: [0.0; DenoiseState::FRAME_SIZE],
                denoise_output: [0.0; DenoiseState::FRAME_SIZE],
            }),
        }
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

#[cfg(test)]
mod tests {
    use super::{AudioEnhancementConfig, AudioEnhancementModel, AudioEnhancer};
    use nnnoiseless::DenoiseState;

    #[test]
    fn parses_rnnoise_aliases() {
        assert_eq!(
            AudioEnhancementModel::parse("rnnoise"),
            Some(AudioEnhancementModel::Rnnoise)
        );
        assert_eq!(
            AudioEnhancementModel::parse("NNNoiseLess"),
            Some(AudioEnhancementModel::Rnnoise)
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
    fn enhancer_emits_whisper_frames() {
        let config = AudioEnhancementConfig {
            model: AudioEnhancementModel::Rnnoise,
        };
        let mut enhancer = AudioEnhancer::new(48_000, config).expect("create enhancer");
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
}
