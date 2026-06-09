// Re-export all audio components
mod device;
mod enhancer;
mod recorder;
mod resampler;
mod spectral;
mod utils;
mod visualizer;

pub use device::{list_input_devices, list_output_devices, CpalDeviceInfo};
pub use enhancer::{
    enhance_audio_samples, AudioEnhancementConfig, AudioEnhancementModel, AudioEnhancer,
    DEFAULT_ENHANCEMENT_STRENGTH, FULL_BAND_SAMPLE_RATE,
};
pub use recorder::AudioRecorder;
pub use resampler::FrameResampler;
pub use utils::save_wav_file;
pub use visualizer::AudioVisualiser;
