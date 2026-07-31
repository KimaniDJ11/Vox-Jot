use rubato::{audioadapter_buffers::direct::InterleavedSlice, Fft, FixedSync, Resampler};
use std::time::Duration;

// Make this a constant you can tweak
const RESAMPLER_CHUNK_SIZE: usize = 1024;

pub struct FrameResampler {
    resampler: Option<Fft<f32>>,
    chunk_in: usize,
    in_buf: Vec<f32>,
    frame_samples: usize,
    pending: Vec<f32>,
    /// Chunks Rubato refused to process. Dropping these silently truncates the
    /// recording, so they are counted and reported instead.
    dropped_chunks: u64,
}

impl FrameResampler {
    pub fn new(in_hz: usize, out_hz: usize, frame_dur: Duration) -> Result<Self, String> {
        Self::with_chunk_size(in_hz, out_hz, frame_dur, RESAMPLER_CHUNK_SIZE)
    }

    /// Build a resampler. Returns an error (instead of panicking) when the
    /// parameters are invalid or Rubato cannot construct an FFT resampler for
    /// the given rate ratio, so callers can surface a clean failure rather than
    /// killing the audio worker thread.
    pub fn with_chunk_size(
        in_hz: usize,
        out_hz: usize,
        frame_dur: Duration,
        chunk_in: usize,
    ) -> Result<Self, String> {
        let frame_samples = ((out_hz as f64 * frame_dur.as_secs_f64()).round()) as usize;
        if frame_samples == 0 {
            return Err("frame duration too short for output sample rate".to_string());
        }
        if chunk_in == 0 {
            return Err("resampler chunk size must be positive".to_string());
        }

        let resampler = if in_hz != out_hz {
            Some(
                Fft::<f32>::new(in_hz, out_hz, chunk_in, 1, FixedSync::Input).map_err(|e| {
                    format!("Failed to create resampler ({in_hz} Hz -> {out_hz} Hz): {e}")
                })?,
            )
        } else {
            None
        };

        Ok(Self {
            resampler,
            chunk_in,
            in_buf: Vec::with_capacity(chunk_in),
            frame_samples,
            pending: Vec::with_capacity(frame_samples),
            dropped_chunks: 0,
        })
    }

    /// Log the first failure loudly and keep counting the rest, so a persistent
    /// fault stays visible without flooding the log from the capture loop.
    fn note_dropped_chunk(&mut self, error: &rubato::ResampleError) {
        self.dropped_chunks += 1;
        if self.dropped_chunks == 1 {
            log::error!("Resampler failed to process an audio chunk; captured audio will be truncated: {error}");
        }
    }

    pub fn push(&mut self, mut src: &[f32], mut emit: impl FnMut(&[f32])) {
        if self.resampler.is_none() {
            self.emit_frames(src, &mut emit);
            return;
        }

        while !src.is_empty() {
            let space = self.chunk_in - self.in_buf.len();
            let take = space.min(src.len());
            self.in_buf.extend_from_slice(&src[..take]);
            src = &src[take..];

            if self.in_buf.len() == self.chunk_in {
                // let start = std::time::Instant::now();
                let output = {
                    let input = InterleavedSlice::new(&self.in_buf, 1, self.chunk_in)
                        .expect("mono resampler input length is validated");
                    self.resampler
                        .as_mut()
                        .unwrap()
                        .process(&input, None)
                        .map(|out| out.take_data())
                };
                match output {
                    Ok(out) => self.emit_frames(&out, &mut emit),
                    Err(e) => self.note_dropped_chunk(&e),
                }
                self.in_buf.clear();
            }
        }
    }

    pub fn finish(&mut self, mut emit: impl FnMut(&[f32])) {
        // Process any remaining input samples
        if let Some(ref mut resampler) = self.resampler {
            if !self.in_buf.is_empty() {
                // Pad with zeros to reach chunk size
                self.in_buf.resize(self.chunk_in, 0.0);
                let output = {
                    let input = InterleavedSlice::new(&self.in_buf, 1, self.chunk_in)
                        .expect("mono resampler input length is validated");
                    resampler.process(&input, None).map(|out| out.take_data())
                };
                match output {
                    Ok(out) => self.emit_frames(&out, &mut emit),
                    Err(e) => self.note_dropped_chunk(&e),
                }
                self.in_buf.clear();
            }
        }

        if self.dropped_chunks > 0 {
            log::error!(
                "Resampler dropped {} audio chunk(s) during this pass",
                self.dropped_chunks
            );
        }

        // Emit any remaining pending frame (padded with zeros)
        if !self.pending.is_empty() {
            self.pending.resize(self.frame_samples, 0.0);
            emit(&self.pending);
            self.pending.clear();
        }
    }

    fn emit_frames(&mut self, mut data: &[f32], emit: &mut impl FnMut(&[f32])) {
        while !data.is_empty() {
            let space = self.frame_samples - self.pending.len();
            let take = space.min(data.len());
            self.pending.extend_from_slice(&data[..take]);
            data = &data[take..];

            if self.pending.len() == self.frame_samples {
                emit(&self.pending);
                self.pending.clear();
            }
        }
    }
}
