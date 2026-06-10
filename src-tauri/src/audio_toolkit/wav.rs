use std::io::{Cursor, Read};
use std::path::Path;

const MAX_WAV_CHANNELS: u16 = 8;
const MAX_WAV_SAMPLE_RATE: u32 = 384_000;
const MAX_WAV_MONO_FRAMES: usize = 120_000_000;

pub fn read_wav_file_as_mono_f32(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let reader = hound::WavReader::open(path)
        .map_err(|err| format!("Failed to open WAV file '{}': {err}", path.display()))?;
    decode_wav_reader_as_mono_f32(reader, &format!("WAV file '{}'", path.display()))
}

pub fn decode_wav_bytes_as_mono_f32(bytes: &[u8]) -> Result<(Vec<f32>, u32), String> {
    let reader =
        hound::WavReader::new(Cursor::new(bytes)).map_err(|err| format!("WavReader: {err}"))?;
    decode_wav_reader_as_mono_f32(reader, "WAV data")
}

fn decode_wav_reader_as_mono_f32<R: Read>(
    mut reader: hound::WavReader<R>,
    label: &str,
) -> Result<(Vec<f32>, u32), String> {
    let spec = reader.spec();
    validate_wav_spec(&spec, reader.duration(), label)?;

    let channels = spec.channels as usize;
    let mut mono = Vec::new();

    match spec.sample_format {
        hound::SampleFormat::Float => {
            let mut frame_sum = 0.0f32;
            let mut frame_len = 0usize;

            for sample in reader.samples::<f32>() {
                frame_sum +=
                    sample.map_err(|err| format!("Failed reading WAV float samples: {err}"))?;
                frame_len += 1;

                if frame_len == channels {
                    push_mono_frame(&mut mono, frame_sum / frame_len as f32, label)?;
                    frame_sum = 0.0;
                    frame_len = 0;
                }
            }

            if frame_len > 0 {
                push_mono_frame(&mut mono, frame_sum / frame_len as f32, label)?;
            }
        }
        hound::SampleFormat::Int => {
            let scale = 2f32.powi((spec.bits_per_sample as i32) - 1);
            let mut frame_sum = 0.0f32;
            let mut frame_len = 0usize;

            for sample in reader.samples::<i32>() {
                let sample =
                    sample.map_err(|err| format!("Failed reading WAV int samples: {err}"))?;
                frame_sum += (sample as f32) / scale;
                frame_len += 1;

                if frame_len == channels {
                    push_mono_frame(&mut mono, frame_sum / frame_len as f32, label)?;
                    frame_sum = 0.0;
                    frame_len = 0;
                }
            }

            if frame_len > 0 {
                push_mono_frame(&mut mono, frame_sum / frame_len as f32, label)?;
            }
        }
    }

    Ok((mono, spec.sample_rate))
}

fn validate_wav_spec(
    spec: &hound::WavSpec,
    declared_frames: u32,
    label: &str,
) -> Result<(), String> {
    if spec.channels == 0 {
        return Err(format!("{label} has no channels"));
    }
    if spec.channels > MAX_WAV_CHANNELS {
        return Err(format!(
            "{label} has {} channels; the supported maximum is {MAX_WAV_CHANNELS}",
            spec.channels
        ));
    }
    if spec.sample_rate == 0 {
        return Err(format!("{label} has no sample rate"));
    }
    if spec.sample_rate > MAX_WAV_SAMPLE_RATE {
        return Err(format!(
            "{label} sample rate {} Hz is above the supported maximum of {MAX_WAV_SAMPLE_RATE} Hz",
            spec.sample_rate
        ));
    }

    match spec.sample_format {
        hound::SampleFormat::Float if spec.bits_per_sample != 32 => {
            return Err(format!(
                "{label} uses {}-bit float samples; only 32-bit float WAV is supported",
                spec.bits_per_sample
            ));
        }
        hound::SampleFormat::Int if spec.bits_per_sample == 0 || spec.bits_per_sample > 32 => {
            return Err(format!(
                "{label} integer sample width must be between 1 and 32 bits"
            ));
        }
        _ => {}
    }

    let declared_frames = declared_frames as usize;
    if declared_frames > MAX_WAV_MONO_FRAMES {
        return Err(format!(
            "{label} declares {declared_frames} frames; the supported maximum is {MAX_WAV_MONO_FRAMES}"
        ));
    }

    Ok(())
}

fn push_mono_frame(mono: &mut Vec<f32>, sample: f32, label: &str) -> Result<(), String> {
    if mono.len() >= MAX_WAV_MONO_FRAMES {
        return Err(format!(
            "{label} exceeds the supported maximum of {MAX_WAV_MONO_FRAMES} mono frames"
        ));
    }

    mono.push(sample.clamp(-1.0, 1.0));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn int_spec(channels: u16, sample_rate: u32, bits_per_sample: u16) -> hound::WavSpec {
        hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample,
            sample_format: hound::SampleFormat::Int,
        }
    }

    #[test]
    fn rejects_zero_channels() {
        let err = validate_wav_spec(&int_spec(0, 16_000, 16), 1, "test WAV").unwrap_err();
        assert!(err.contains("no channels"));
    }

    #[test]
    fn rejects_zero_sample_rate() {
        let err = validate_wav_spec(&int_spec(1, 0, 16), 1, "test WAV").unwrap_err();
        assert!(err.contains("no sample rate"));
    }

    #[test]
    fn rejects_invalid_int_width() {
        let err = validate_wav_spec(&int_spec(1, 16_000, 0), 1, "test WAV").unwrap_err();
        assert!(err.contains("between 1 and 32 bits"));
    }

    #[test]
    fn rejects_declared_frame_count_above_limit() {
        let err = validate_wav_spec(
            &int_spec(1, 16_000, 16),
            (MAX_WAV_MONO_FRAMES as u32).saturating_add(1),
            "test WAV",
        )
        .unwrap_err();
        assert!(err.contains("supported maximum"));
    }

    #[test]
    fn rejects_stereo_frame_count_above_limit_without_channel_division() {
        let err = validate_wav_spec(
            &int_spec(2, 16_000, 16),
            (MAX_WAV_MONO_FRAMES as u32).saturating_add(1),
            "test WAV",
        )
        .unwrap_err();
        assert!(err.contains("supported maximum"));
    }

    #[test]
    fn decodes_stereo_int_wav_to_mono() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.wav");
        let spec = int_spec(2, 16_000, 16);
        {
            let mut writer = hound::WavWriter::create(&path, spec).unwrap();
            writer.write_sample::<i16>(16_384).unwrap();
            writer.write_sample::<i16>(-16_384).unwrap();
            writer.write_sample::<i16>(16_384).unwrap();
            writer.write_sample::<i16>(16_384).unwrap();
            writer.finalize().unwrap();
        }

        let bytes = std::fs::read(path).unwrap();
        let (mono, sample_rate) = decode_wav_bytes_as_mono_f32(&bytes).unwrap();

        assert_eq!(sample_rate, 16_000);
        assert_eq!(mono.len(), 2);
        assert!(mono[0].abs() < 0.0001);
        assert!((mono[1] - 0.5).abs() < 0.0001);
    }
}
