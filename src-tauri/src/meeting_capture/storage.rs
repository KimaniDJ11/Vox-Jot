//! Incremental PCM storage: every checkpoint leaves a playable WAV, and recovery
//! derives lengths from the data actually on disk instead of trusting a torn header.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

pub const SAMPLE_RATE: u64 = 16_000;
pub const MAX_FRAMES: u64 = SAMPLE_RATE * 60 * 60 * 8;
const HEADER_BYTES: u64 = 44;

#[derive(Debug, Default, Clone, Serialize, Deserialize, Type)]
pub struct TrackStats {
    pub frames: u64,
    pub received_frames: u64,
    pub inserted_silence_frames: u64,
    pub overlap_frames: u64,
    pub first_timestamp_us: Option<i64>,
    pub source_sample_rates: Vec<i32>,
    pub source_channel_counts: Vec<i32>,
    pub peak: f32,
}

fn header(frames: u64) -> [u8; 44] {
    let bytes = (frames * 2) as u32;
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(bytes + 36).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&1u16.to_le_bytes());
    h[24..28].copy_from_slice(&(SAMPLE_RATE as u32).to_le_bytes());
    h[28..32].copy_from_slice(&(SAMPLE_RATE as u32 * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&bytes.to_le_bytes());
    h
}

pub struct TrackWriter {
    file: File,
    pub stats: TrackStats,
}

impl TrackWriter {
    pub fn create(path: &Path) -> Result<Self, String> {
        let mut options = OpenOptions::new();
        options.write(true).read(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path).map_err(|e| e.to_string())?;
        file.write_all(&header(0)).map_err(|e| e.to_string())?;
        Ok(Self {
            file,
            stats: TrackStats::default(),
        })
    }

    fn pad_to(&mut self, target: u64) -> Result<(), String> {
        if target > MAX_FRAMES {
            return Err("Meeting reached the eight-hour recording limit.".into());
        }
        let zeros = [0u8; 32_000];
        while self.stats.frames < target {
            let n = (target - self.stats.frames).min(16_000);
            self.file
                .write_all(&zeros[..n as usize * 2])
                .map_err(|e| e.to_string())?;
            self.stats.frames += n;
            self.stats.inserted_silence_frames += n;
        }
        Ok(())
    }

    pub fn append(
        &mut self,
        samples: &[f32],
        timestamp_us: i64,
        source_rate: i32,
        channels: i32,
    ) -> Result<(), String> {
        if timestamp_us < -1_000_000 {
            return Err("Audio clock is incompatible with the meeting clock.".into());
        }
        let target = (timestamp_us.max(0) as u64).saturating_mul(SAMPLE_RATE) / 1_000_000;
        if target + samples.len() as u64 > MAX_FRAMES {
            return Err("Meeting reached the eight-hour recording limit.".into());
        }
        // ScreenCaptureKit may omit buffers while a source is silent. A long
        // valid pause is not a clock jump. The supervisor bounds timestamps
        // against elapsed capture time before they reach this storage writer.
        if self.stats.first_timestamp_us.is_none() {
            self.stats.first_timestamp_us = Some(timestamp_us);
        }
        if !self.stats.source_sample_rates.contains(&source_rate) {
            self.stats.source_sample_rates.push(source_rate);
        }
        if !self.stats.source_channel_counts.contains(&channels) {
            self.stats.source_channel_counts.push(channels);
        }
        self.pad_to(target)?;
        let skip = self
            .stats
            .frames
            .saturating_sub(target)
            .min(samples.len() as u64) as usize;
        self.stats.overlap_frames += skip as u64;
        let mut pcm = Vec::with_capacity((samples.len() - skip) * 2);
        for &value in &samples[skip..] {
            let value = if value.is_finite() {
                value.clamp(-1.0, 1.0)
            } else {
                0.0
            };
            self.stats.peak = self.stats.peak.max(value.abs());
            pcm.extend_from_slice(&((value * i16::MAX as f32).round() as i16).to_le_bytes());
        }
        self.file.write_all(&pcm).map_err(|e| e.to_string())?;
        self.stats.received_frames += (samples.len() - skip) as u64;
        self.stats.frames += (samples.len() - skip) as u64;
        Ok(())
    }

    pub fn checkpoint(&mut self) -> Result<(), String> {
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|e| e.to_string())?;
        self.file
            .write_all(&header(self.stats.frames))
            .map_err(|e| e.to_string())?;
        self.file
            .seek(SeekFrom::End(0))
            .map_err(|e| e.to_string())?;
        self.file.sync_data().map_err(|e| e.to_string())
    }

    pub fn finish(mut self, frames: u64) -> Result<TrackStats, String> {
        self.pad_to(frames)?;
        self.checkpoint()?;
        Ok(self.stats)
    }
}

pub fn repair_partial(path: &Path) -> Result<u64, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() < HEADER_BYTES || meta.len() > HEADER_BYTES + MAX_FRAMES * 2 {
        return Err("Invalid partial meeting recording.".into());
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut existing = [0u8; 44];
    file.read_exact(&mut existing).map_err(|e| e.to_string())?;
    let canonical = header(0);
    // Only repair files created by this writer, never arbitrary WAV layouts.
    if existing[..4] != canonical[..4] || existing[8..40] != canonical[8..40] {
        return Err("Unrecognized partial meeting WAV header.".into());
    }
    let frames = (meta.len() - HEADER_BYTES) / 2;
    file.set_len(HEADER_BYTES + frames * 2)
        .map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    file.write_all(&header(frames)).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(frames)
}

/// Bounded-memory mixdown; preserves wall-clock alignment and leaves originals.
pub fn mix_tracks(directory: &Path, include_microphone: bool) -> Result<u64, String> {
    let target = directory.join("mix.wav");
    if target.exists() {
        return Err(
            "A completed meeting mix already exists; originals were left unchanged.".into(),
        );
    }
    let mut system =
        hound::WavReader::open(directory.join("system.wav")).map_err(|e| e.to_string())?;
    let mut microphone = if include_microphone {
        Some(hound::WavReader::open(directory.join("microphone.wav")).map_err(|e| e.to_string())?)
    } else {
        None
    };
    let frames = u64::from(system.duration()).max(
        microphone
            .as_ref()
            .map(|r| u64::from(r.duration()))
            .unwrap_or(0),
    );
    let partial = directory.join("mix.partial.wav");
    // Retry never overwrites an original track or a completed mix.
    if partial.exists() {
        fs::remove_file(&partial).map_err(|e| e.to_string())?;
    }
    let mut writer = TrackWriter::create(&partial)?;
    let mut system_samples = system.samples::<i16>();
    let mut mic_samples = microphone.as_mut().map(|r| r.samples::<i16>());
    let mut offset = 0u64;
    while offset < frames {
        let count = (frames - offset).min(SAMPLE_RATE) as usize;
        let mut mixed = Vec::with_capacity(count);
        for _ in 0..count {
            let remote = system_samples
                .next()
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or(0) as f32
                / 32768.0;
            let local = mic_samples
                .as_mut()
                .and_then(Iterator::next)
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or(0) as f32
                / 32768.0;
            mixed.push(if include_microphone {
                (remote + local) * 0.5
            } else {
                remote
            });
        }
        writer.append(
            &mixed,
            (offset * 1_000_000 / SAMPLE_RATE) as i64,
            SAMPLE_RATE as i32,
            1,
        )?;
        offset += count as u64;
    }
    writer.finish(frames)?;
    // mix.wav is derived, app-owned output; originals are never replaced.
    fs::rename(partial, target).map_err(|e| e.to_string())?;
    Ok(frames)
}

pub struct AudioChunk {
    pub file: tempfile::NamedTempFile,
    pub start_ms: u64,
    pub duration_ms: u64,
}

const ANALYSIS_CONTEXT_FRAMES: usize = SAMPLE_RATE as usize;
const ANALYSIS_SPLIT_SILENCE_FRAMES: usize = 15 * SAMPLE_RATE as usize;
// This only treats digital or effectively digital silence as a split point.
// Real low-level microphone ambience remains in the same analysis window so
// quiet speech is not discarded by a home-grown VAD.
const ANALYSIS_SILENCE_AMPLITUDE: i16 = 16;

fn analysis_activity_ranges(samples: &[i16]) -> Vec<(usize, usize)> {
    let Some(first_active) = samples
        .iter()
        .position(|sample| sample.unsigned_abs() > ANALYSIS_SILENCE_AMPLITUDE as u16)
    else {
        return Vec::new();
    };
    let last_active = samples
        .iter()
        .rposition(|sample| sample.unsigned_abs() > ANALYSIS_SILENCE_AMPLITUDE as u16)
        .expect("first active sample implies a last active sample")
        + 1;

    let mut groups = Vec::new();
    let mut group_start = first_active;
    let mut cursor = first_active;
    while cursor < last_active {
        if samples[cursor].unsigned_abs() > ANALYSIS_SILENCE_AMPLITUDE as u16 {
            cursor += 1;
            continue;
        }
        let silence_start = cursor;
        while cursor < last_active
            && samples[cursor].unsigned_abs() <= ANALYSIS_SILENCE_AMPLITUDE as u16
        {
            cursor += 1;
        }
        if cursor - silence_start >= ANALYSIS_SPLIT_SILENCE_FRAMES {
            groups.push((group_start, silence_start));
            group_start = cursor;
        }
    }
    groups.push((group_start, last_active));

    groups
        .into_iter()
        .map(|(start, end)| {
            (
                start.saturating_sub(ANALYSIS_CONTEXT_FRAMES),
                end.saturating_add(ANALYSIS_CONTEXT_FRAMES)
                    .min(samples.len()),
            )
        })
        .collect()
}

/// Extract one five-minute core as one or more bounded analysis windows. Long
/// spans of near-digital silence are excluded while each speech island keeps a
/// one-second context margin. Memory use stays bounded even for an eight-hour
/// recording, and sparse meetings do not become one mostly-silent ASR request.
pub fn analysis_chunks(path: &Path, core_start_frame: u64) -> Result<Vec<AudioChunk>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FRAMES * 2 + HEADER_BYTES {
        return Err("Invalid meeting track.".into());
    }
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    if spec.channels != 1
        || spec.sample_rate != SAMPLE_RATE as u32
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Err("Meeting track must be 16 kHz mono PCM.".into());
    }
    let start = core_start_frame.saturating_sub(SAMPLE_RATE);
    let end = (core_start_frame + 301 * SAMPLE_RATE).min(u64::from(reader.duration()));
    if start >= end {
        return Ok(Vec::new());
    }
    reader.seek(start as u32).map_err(|e| e.to_string())?;
    let samples: Vec<i16> = reader
        .samples()
        .take((end - start) as usize)
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let parent = path.parent().ok_or("Missing track directory")?;
    analysis_activity_ranges(&samples)
        .into_iter()
        .map(|(range_start, range_end)| {
            let mut file = tempfile::Builder::new()
                .prefix("meeting-analysis-")
                .suffix(".wav")
                .tempfile_in(parent)
                .map_err(|e| e.to_string())?;
            let mut writer =
                hound::WavWriter::new(file.as_file_mut(), spec).map_err(|e| e.to_string())?;
            for sample in &samples[range_start..range_end] {
                writer.write_sample(*sample).map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;
            let absolute_start = start + range_start as u64;
            Ok(AudioChunk {
                file,
                start_ms: absolute_start * 1000 / SAMPLE_RATE,
                duration_ms: (range_end - range_start) as u64 * 1000 / SAMPLE_RATE,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_header_is_recoverable_after_uncheckpointed_audio() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("system.partial.wav");
        let mut writer = TrackWriter::create(&path).unwrap();
        writer.append(&[0.5; 160], 10_000, 48_000, 2).unwrap();
        drop(writer);
        assert_eq!(repair_partial(&path).unwrap(), 320);
        let mut reader = hound::WavReader::open(path).unwrap();
        assert_eq!(reader.duration(), 320);
        assert!(reader.samples::<i16>().take(160).all(|x| x.unwrap() == 0));
    }
    #[test]
    fn alignment_trims_overlap_and_preserves_long_silence() {
        let dir = tempfile::tempdir().unwrap();
        let mut writer = TrackWriter::create(&dir.path().join("track.wav")).unwrap();
        writer.append(&[0.25; 320], 0, 48_000, 1).unwrap();
        writer.append(&[0.5; 320], 10_000, 44_100, 1).unwrap();
        assert_eq!(writer.stats.frames, 480);
        assert_eq!(writer.stats.overlap_frames, 160);
        assert_eq!(writer.stats.source_sample_rates, [48_000, 44_100]);
        writer.append(&[0.5; 1], 70_000_000, 48_000, 1).unwrap();
        assert_eq!(writer.stats.frames, 70 * SAMPLE_RATE + 1);
        assert!(writer.append(&[0.5; 1], -2_000_000, 48_000, 1).is_err());
    }
    #[test]
    fn mix_retains_separate_tracks_and_equal_duration() {
        let dir = tempfile::tempdir().unwrap();
        for (name, value) in [("system.wav", 0.5), ("microphone.wav", 0.25)] {
            let mut writer = TrackWriter::create(&dir.path().join(name)).unwrap();
            writer.append(&[value; 1600], 0, 16_000, 1).unwrap();
            writer.finish(1600).unwrap();
        }
        assert_eq!(mix_tracks(dir.path(), true).unwrap(), 1600);
        assert!(dir.path().join("system.wav").exists());
        let mut reader = hound::WavReader::open(dir.path().join("mix.wav")).unwrap();
        assert!(
            (reader.samples::<i16>().next().unwrap().unwrap() as f32 / 32768.0 - 0.375).abs()
                < 0.001
        );
        drop(reader);
        let completed_mix = fs::read(dir.path().join("mix.wav")).unwrap();
        assert!(mix_tracks(dir.path(), true).is_err());
        assert_eq!(fs::read(dir.path().join("mix.wav")).unwrap(), completed_mix);
    }
    #[test]
    fn writer_refuses_to_overwrite_and_repair_rejects_foreign_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("track.wav");
        TrackWriter::create(&path).unwrap();
        assert!(TrackWriter::create(&path).is_err());
        fs::write(&path, [0u8; 80]).unwrap();
        assert!(repair_partial(&path).is_err());
    }

    #[test]
    fn analysis_ignores_silence_and_preserves_context_offsets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("system.wav");
        let mut writer = TrackWriter::create(&path).unwrap();
        writer.append(&[0.0; 1600], 0, 16000, 1).unwrap();
        writer.finish(1600).unwrap();
        assert!(analysis_chunks(&path, 0).unwrap().is_empty());
        let other = dir.path().join("microphone.wav");
        let mut writer = TrackWriter::create(&other).unwrap();
        writer.append(&[0.5; 1600], 0, 16000, 1).unwrap();
        writer.finish(1600).unwrap();
        let chunk = analysis_chunks(&other, 0).unwrap().pop().unwrap();
        assert_eq!(chunk.start_ms, 0);
        assert_eq!(chunk.duration_ms, 100);
        assert_eq!(
            hound::WavReader::open(chunk.file.path())
                .unwrap()
                .duration(),
            1600
        );
    }

    #[test]
    fn analysis_splits_long_digital_silence_and_preserves_offsets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("system.wav");
        let mut writer = TrackWriter::create(&path).unwrap();
        let mut samples = vec![0.0; SAMPLE_RATE as usize];
        samples.extend(vec![0.25; SAMPLE_RATE as usize]);
        samples.extend(vec![0.0; 20 * SAMPLE_RATE as usize]);
        samples.extend(vec![0.5; SAMPLE_RATE as usize]);
        writer.append(&samples, 0, SAMPLE_RATE as i32, 1).unwrap();
        writer.finish(samples.len() as u64).unwrap();

        let chunks = analysis_chunks(&path, 0).unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].start_ms, 0);
        assert_eq!(chunks[0].duration_ms, 3_000);
        assert_eq!(chunks[1].start_ms, 21_000);
        assert_eq!(chunks[1].duration_ms, 2_000);
    }
}
