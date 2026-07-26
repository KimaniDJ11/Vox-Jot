use std::{
    io::Error,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    Device, Sample, SizedSample,
};

use crate::audio_toolkit::{
    audio::{AudioEnhancementConfig, AudioEnhancer, AudioVisualiser, FrameResampler},
    constants,
    vad::{self, VadFrame},
    VoiceActivityDetector,
};

const VAD_FALLBACK_FRAME_SAMPLES: usize = constants::WHISPER_SAMPLE_RATE as usize * 30 / 1_000;
const VAD_FALLBACK_MIN_FRAME_RMS: f32 = 0.0025;
const VAD_FALLBACK_MIN_FRAME_PEAK: f32 = 0.02;
const VAD_FALLBACK_MIN_ACTIVE_FRAMES: usize = 2;
const VAD_FALLBACK_SILENCE_KEEP_SAMPLES: usize = VAD_FALLBACK_FRAME_SAMPLES * 67;
const VAD_FALLBACK_SILENCE_COMPACT_SAMPLES: usize = VAD_FALLBACK_FRAME_SAMPLES * 134;

struct VadFallbackAudio {
    samples: Vec<f32>,
    consecutive_active_frames: usize,
    signal_detected: bool,
}

impl VadFallbackAudio {
    fn new() -> Self {
        Self {
            samples: Vec::with_capacity(160_000),
            consecutive_active_frames: 0,
            signal_detected: false,
        }
    }

    fn clear(&mut self) {
        self.samples.clear();
        self.consecutive_active_frames = 0;
        self.signal_detected = false;
    }

    fn push_frame(&mut self, frame: &[f32]) {
        if frame.iter().any(|sample| !sample.is_finite()) {
            // Never let an invalid device/resampler frame poison the rescue
            // buffer that may be sent directly to transcription at stop time.
            self.clear();
            return;
        }

        self.samples.extend_from_slice(frame);

        if self.signal_detected {
            return;
        }

        if frame_has_speech_like_energy(frame) {
            self.consecutive_active_frames += 1;
            if self.consecutive_active_frames >= VAD_FALLBACK_MIN_ACTIVE_FRAMES {
                self.signal_detected = true;
                return;
            }
        } else {
            self.consecutive_active_frames = 0;
        }

        // A recording left open in silence must not grow this rescue buffer
        // forever. Compact in batches to keep roughly two seconds of pre-roll
        // without shifting the vector on every 30-ms frame.
        if self.samples.len() > VAD_FALLBACK_SILENCE_COMPACT_SAMPLES {
            let drop_count = self
                .samples
                .len()
                .saturating_sub(VAD_FALLBACK_SILENCE_KEEP_SAMPLES);
            self.samples.drain(..drop_count);
        }
    }

    fn take_if_signal_detected(&mut self) -> Option<Vec<f32>> {
        if !self.signal_detected {
            self.clear();
            return None;
        }

        self.consecutive_active_frames = 0;
        self.signal_detected = false;
        Some(std::mem::replace(
            &mut self.samples,
            Vec::with_capacity(160_000),
        ))
    }
}

struct FinalizedRecording {
    samples: Vec<f32>,
    used_vad_fallback: bool,
}

/// A neural VAD is a useful noise filter, but it must not turn an audible
/// utterance into a silent no-op. Requiring both meaningful AC RMS energy and
/// a clear peak keeps this rescue gate conservative for enhanced and plain
/// resampled input while ignoring a steady microphone DC offset.
fn frame_has_speech_like_energy(frame: &[f32]) -> bool {
    if frame.is_empty() {
        return false;
    }

    let mut sample_sum = 0.0f64;
    let mut squared_sum = 0.0f64;
    let mut peak = 0.0f32;
    for sample in frame.iter().copied() {
        if !sample.is_finite() {
            return false;
        }

        sample_sum += f64::from(sample);
        squared_sum += f64::from(sample) * f64::from(sample);
        peak = peak.max(sample.abs());
    }

    let sample_count = frame.len() as f64;
    let mean = sample_sum / sample_count;
    let variance = (squared_sum / sample_count - mean * mean).max(0.0);
    let ac_rms = variance.sqrt() as f32;
    ac_rms >= VAD_FALLBACK_MIN_FRAME_RMS && peak >= VAD_FALLBACK_MIN_FRAME_PEAK
}

fn finalize_recording_samples(
    vad_samples: &mut Vec<f32>,
    fallback_audio: &mut VadFallbackAudio,
) -> FinalizedRecording {
    if !vad_samples.is_empty() {
        fallback_audio.clear();
        return FinalizedRecording {
            samples: std::mem::take(vad_samples),
            used_vad_fallback: false,
        };
    }

    if let Some(samples) = fallback_audio.take_if_signal_detected() {
        return FinalizedRecording {
            samples,
            used_vad_fallback: true,
        };
    }

    FinalizedRecording {
        samples: Vec::new(),
        used_vad_fallback: false,
    }
}

enum Cmd {
    Start,
    Stop(mpsc::Sender<Vec<f32>>),
    Snapshot(mpsc::Sender<AudioSnapshot>, Option<usize>),
    Shutdown,
}

/// A point-in-time view of the in-progress recording buffer.
///
/// `samples` may be capped to the most recent N samples (see
/// [`AudioRecorder::snapshot`]); `total_samples` always reports the full
/// buffer length so callers can track growth across snapshots without
/// forcing a full-buffer copy every poll.
pub struct AudioSnapshot {
    pub total_samples: usize,
    pub samples: Vec<f32>,
}

pub struct AudioRecorder {
    device: Option<Device>,
    cmd_tx: Option<mpsc::Sender<Cmd>>,
    worker_handle: Option<std::thread::JoinHandle<()>>,
    vad: Option<Arc<Mutex<Box<dyn vad::VoiceActivityDetector>>>>,
    enhancement_config: Option<AudioEnhancementConfig>,
    level_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    error_cb: Option<Arc<dyn Fn(String) + Send + Sync + 'static>>,
}

impl AudioRecorder {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(AudioRecorder {
            device: None,
            cmd_tx: None,
            worker_handle: None,
            vad: None,
            enhancement_config: None,
            level_cb: None,
            error_cb: None,
        })
    }

    pub fn with_vad(mut self, vad: Box<dyn VoiceActivityDetector>) -> Self {
        self.vad = Some(Arc::new(Mutex::new(vad)));
        self
    }

    pub fn with_enhancement(mut self, config: AudioEnhancementConfig) -> Self {
        self.enhancement_config = Some(config);
        self
    }

    pub fn with_level_callback<F>(mut self, cb: F) -> Self
    where
        F: Fn(Vec<f32>) + Send + Sync + 'static,
    {
        self.level_cb = Some(Arc::new(cb));
        self
    }

    /// Register a callback invoked (once per open) when the capture stream
    /// reports an error — e.g. the device disappeared mid-recording.
    pub fn with_error_callback<F>(mut self, cb: F) -> Self
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        self.error_cb = Some(Arc::new(cb));
        self
    }

    pub fn open(&mut self, device: Option<Device>) -> Result<(), Box<dyn std::error::Error>> {
        if self.worker_handle.is_some() {
            return Ok(()); // already open
        }

        let (sample_tx, sample_rx) = mpsc::channel::<Vec<f32>>();
        // Buffers travel back to the capture callback here so the audio thread
        // can reuse allocations instead of cloning a Vec per callback.
        let (recycled_tx, recycled_rx) = mpsc::channel::<Vec<f32>>();
        let dropped_chunks = Arc::new(AtomicU64::new(0));
        let callback_dropped_chunks = dropped_chunks.clone();
        let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();
        let (error_tx, error_rx) = mpsc::channel::<String>();
        let (init_tx, init_rx) = mpsc::sync_channel::<Result<(), String>>(1);

        let host = crate::audio_toolkit::get_cpal_host();
        let device = match device {
            Some(dev) => dev,
            None => host
                .default_input_device()
                .ok_or_else(|| Error::new(std::io::ErrorKind::NotFound, "No input device found"))?,
        };

        let thread_device = device.clone();
        let vad = self.vad.clone();
        let enhancement_config = self.enhancement_config;
        // Move the optional level/error callbacks into the worker thread
        let level_cb = self.level_cb.clone();
        let error_cb = self.error_cb.clone();

        let worker = std::thread::spawn(move || {
            let init_result = (|| -> Result<
                (cpal::Stream, u32, Option<AudioEnhancer>, FrameResampler),
                String,
            > {
                let config = AudioRecorder::get_preferred_config(&thread_device)
                    .map_err(|e| format!("Failed to fetch preferred config: {e}"))?;

                let sample_rate = config.sample_rate().0;
                let channels = config.channels() as usize;

                log::info!(
                    "Using device: {:?}\nSample rate: {}\nChannels: {}\nFormat: {:?}",
                    thread_device.name(),
                    sample_rate,
                    channels,
                    config.sample_format()
                );

                let stream = match config.sample_format() {
                    cpal::SampleFormat::U8 => AudioRecorder::build_stream::<u8>(
                        &thread_device,
                        &config,
                        sample_tx,
                        recycled_rx,
                        callback_dropped_chunks,
                        error_tx,
                        channels,
                    )
                    .map_err(|e| format!("Failed to build input stream: {e}"))?,
                    cpal::SampleFormat::I8 => AudioRecorder::build_stream::<i8>(
                        &thread_device,
                        &config,
                        sample_tx,
                        recycled_rx,
                        callback_dropped_chunks,
                        error_tx,
                        channels,
                    )
                    .map_err(|e| format!("Failed to build input stream: {e}"))?,
                    cpal::SampleFormat::I16 => AudioRecorder::build_stream::<i16>(
                        &thread_device,
                        &config,
                        sample_tx,
                        recycled_rx,
                        callback_dropped_chunks,
                        error_tx,
                        channels,
                    )
                    .map_err(|e| format!("Failed to build input stream: {e}"))?,
                    cpal::SampleFormat::I32 => AudioRecorder::build_stream::<i32>(
                        &thread_device,
                        &config,
                        sample_tx,
                        recycled_rx,
                        callback_dropped_chunks,
                        error_tx,
                        channels,
                    )
                    .map_err(|e| format!("Failed to build input stream: {e}"))?,
                    cpal::SampleFormat::F32 => AudioRecorder::build_stream::<f32>(
                        &thread_device,
                        &config,
                        sample_tx,
                        recycled_rx,
                        callback_dropped_chunks,
                        error_tx,
                        channels,
                    )
                    .map_err(|e| format!("Failed to build input stream: {e}"))?,
                    sample_format => {
                        return Err(format!("Unsupported sample format: {sample_format:?}"));
                    }
                };

                stream
                    .play()
                    .map_err(|e| format!("Failed to start microphone stream: {e}"))?;

                // Build the resamplers before reporting init success so a
                // construction failure surfaces as a clean error through the
                // init channel instead of silently killing the worker thread
                // (which would leave recording "active" with no audio captured).
                let enhancer = match enhancement_config {
                    Some(config) => Some(AudioEnhancer::new(
                        sample_rate,
                        constants::WHISPER_SAMPLE_RATE,
                        config,
                    )?),
                    None => None,
                };
                let frame_resampler = FrameResampler::new(
                    sample_rate as usize,
                    constants::WHISPER_SAMPLE_RATE as usize,
                    Duration::from_millis(30),
                )?;

                Ok((stream, sample_rate, enhancer, frame_resampler))
            })();

            match init_result {
                Ok((stream, sample_rate, enhancer, frame_resampler)) => {
                    let _ = init_tx.send(Ok(()));
                    // Keep the stream alive while we process samples.
                    run_consumer(
                        sample_rate,
                        vad,
                        enhancer,
                        frame_resampler,
                        sample_rx,
                        recycled_tx,
                        dropped_chunks,
                        cmd_rx,
                        error_rx,
                        level_cb,
                        error_cb,
                    );
                    drop(stream);
                }
                Err(error_message) => {
                    let normalized_error = normalize_microphone_error(error_message);
                    log::error!("{normalized_error}");
                    let _ = init_tx.send(Err(normalized_error));
                }
            }
        });

        match init_rx.recv() {
            Ok(Ok(())) => {
                self.device = Some(device);
                self.cmd_tx = Some(cmd_tx);
                self.worker_handle = Some(worker);
                Ok(())
            }
            Ok(Err(error_message)) => {
                let _ = worker.join();
                let kind = if is_microphone_access_denied(&error_message) {
                    std::io::ErrorKind::PermissionDenied
                } else {
                    std::io::ErrorKind::Other
                };
                Err(Box::new(Error::new(kind, error_message)))
            }
            Err(recv_error) => {
                let _ = worker.join();
                Err(Box::new(Error::other(format!(
                    "Failed to initialize microphone worker: {recv_error}"
                ))))
            }
        }
    }

    pub fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(tx) = &self.cmd_tx {
            tx.send(Cmd::Start)?;
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        // Without a worker there is nothing to stop; waiting on the reply
        // channel would block forever since the request was never sent.
        let Some(tx) = &self.cmd_tx else {
            return Ok(Vec::new());
        };
        let (resp_tx, resp_rx) = mpsc::channel();
        tx.send(Cmd::Stop(resp_tx))?;
        Ok(resp_rx.recv()?) // wait for the samples
    }

    /// Copy the current recording buffer. With `max_samples` set, only the
    /// most recent samples are copied — essential for live partials during
    /// long recordings, where cloning the whole buffer every poll would cost
    /// O(recording length) per tick.
    pub fn snapshot(
        &self,
        max_samples: Option<usize>,
    ) -> Result<AudioSnapshot, Box<dyn std::error::Error>> {
        let (resp_tx, resp_rx) = mpsc::channel();
        if let Some(tx) = &self.cmd_tx {
            tx.send(Cmd::Snapshot(resp_tx, max_samples))?;
            return Ok(resp_rx.recv()?);
        }
        Ok(AudioSnapshot {
            total_samples: 0,
            samples: Vec::new(),
        })
    }

    pub fn close(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(tx) = self.cmd_tx.take() {
            let _ = tx.send(Cmd::Shutdown);
        }
        if let Some(h) = self.worker_handle.take() {
            let _ = h.join();
        }
        self.device = None;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::SupportedStreamConfig,
        sample_tx: mpsc::Sender<Vec<f32>>,
        recycled_rx: mpsc::Receiver<Vec<f32>>,
        dropped_chunks: Arc<AtomicU64>,
        error_tx: mpsc::Sender<String>,
        channels: usize,
    ) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        T: Sample + SizedSample + Send + 'static,
        f32: cpal::FromSample<T>,
    {
        // This closure runs on the OS audio thread, so it must avoid work that
        // can block or take an unbounded amount of time. Buffers are taken from
        // the consumer's recycle channel instead of being cloned per callback,
        // and a failed send bumps a counter that the consumer logs, because
        // `log::` takes a lock and formats a string.
        let stream_cb = move |data: &[T], _: &cpal::InputCallbackInfo| {
            let mut output_buffer = match recycled_rx.try_recv() {
                Ok(mut buffer) => {
                    buffer.clear();
                    buffer
                }
                // Only allocates while the pool warms up (or if the consumer has
                // fallen behind); recycled buffers keep their capacity.
                Err(_) => Vec::with_capacity(data.len() / channels.max(1)),
            };

            if channels == 1 {
                // Direct conversion without intermediate Vec
                output_buffer.extend(data.iter().map(|&sample| sample.to_sample::<f32>()));
            } else {
                // Convert to mono directly
                let frame_count = data.len() / channels;
                output_buffer.reserve(frame_count);

                for frame in data.chunks_exact(channels) {
                    let mono_sample = frame
                        .iter()
                        .map(|&sample| sample.to_sample::<f32>())
                        .sum::<f32>()
                        / channels as f32;
                    output_buffer.push(mono_sample);
                }
            }

            if sample_tx.send(output_buffer).is_err() {
                dropped_chunks.fetch_add(1, Ordering::Relaxed);
            }
        };

        let stream_config: cpal::StreamConfig = config.clone().into();
        device.build_input_stream(
            &stream_config,
            stream_cb,
            // Forward stream failures (e.g. the device disappeared) to the
            // worker so they can be surfaced instead of dying as a log line.
            move |err| {
                log::error!("Microphone stream error: {}", err);
                let _ = error_tx.send(err.to_string());
            },
            None,
        )
    }

    fn get_preferred_config(
        device: &cpal::Device,
    ) -> Result<cpal::SupportedStreamConfig, Box<dyn std::error::Error>> {
        let supported_configs = device.supported_input_configs()?;
        let mut best_config: Option<cpal::SupportedStreamConfigRange> = None;

        // Try to find a config that supports 16kHz, prioritizing better formats
        for config_range in supported_configs {
            if config_range.min_sample_rate().0 <= constants::WHISPER_SAMPLE_RATE
                && config_range.max_sample_rate().0 >= constants::WHISPER_SAMPLE_RATE
            {
                match best_config {
                    None => best_config = Some(config_range),
                    Some(ref current) => {
                        // Prioritize F32 > I16 > I32 > others
                        let score = |fmt: cpal::SampleFormat| match fmt {
                            cpal::SampleFormat::F32 => 4,
                            cpal::SampleFormat::I16 => 3,
                            cpal::SampleFormat::I32 => 2,
                            _ => 1,
                        };

                        if score(config_range.sample_format()) > score(current.sample_format()) {
                            best_config = Some(config_range);
                        }
                    }
                }
            }
        }

        if let Some(config) = best_config {
            return Ok(config.with_sample_rate(cpal::SampleRate(constants::WHISPER_SAMPLE_RATE)));
        }

        // If no config supports 16kHz, fall back to default
        Ok(device.default_input_config()?)
    }
}

fn is_microphone_access_denied(error_message: &str) -> bool {
    let normalized = error_message.to_lowercase();
    normalized.contains("access is denied")
        || normalized.contains("permission denied")
        || normalized.contains("0x80070005")
}

fn normalize_microphone_error(error_message: String) -> String {
    if is_microphone_access_denied(&error_message) {
        return "Microphone access was denied by the operating system. On Windows, enable Settings → Privacy & security → Microphone (including desktop app access), then restart Vox Jot.".to_string();
    }

    error_message
}

#[allow(clippy::too_many_arguments)]
fn run_consumer(
    in_sample_rate: u32,
    vad: Option<Arc<Mutex<Box<dyn vad::VoiceActivityDetector>>>>,
    mut enhancer: Option<AudioEnhancer>,
    mut frame_resampler: FrameResampler,
    sample_rx: mpsc::Receiver<Vec<f32>>,
    recycled_tx: mpsc::Sender<Vec<f32>>,
    dropped_chunks: Arc<AtomicU64>,
    cmd_rx: mpsc::Receiver<Cmd>,
    error_rx: mpsc::Receiver<String>,
    level_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    error_cb: Option<Arc<dyn Fn(String) + Send + Sync + 'static>>,
) {
    // Pre-allocate for ~10 seconds of audio at 16kHz to avoid repeated reallocs
    let mut processed_samples = Vec::<f32>::with_capacity(160_000);
    // Retain enhanced/resampled audio only until VAD accepts its first frame.
    // This keeps the normal hot path bounded while giving fully rejected
    // utterances a conservative recovery path at stop time.
    let mut vad_fallback_audio = VadFallbackAudio::new();
    let mut recording = false;

    // ---------- spectrum visualisation setup ---------------------------- //
    const BUCKETS: usize = 16;
    const WINDOW_SIZE: usize = 512;
    let mut visualizer = AudioVisualiser::new(
        in_sample_rate,
        WINDOW_SIZE,
        BUCKETS,
        400.0,  // vocal_min_hz
        4000.0, // vocal_max_hz
    );

    fn handle_frame(
        samples: &[f32],
        recording: bool,
        vad: &Option<Arc<Mutex<Box<dyn vad::VoiceActivityDetector>>>>,
        out_buf: &mut Vec<f32>,
        fallback_audio: &mut VadFallbackAudio,
    ) {
        if !recording {
            return;
        }

        if let Some(vad_arc) = vad {
            if out_buf.is_empty() {
                fallback_audio.push_frame(samples);
            }
            let mut det = vad_arc.lock().unwrap_or_else(|e| e.into_inner());
            match det.push_frame(samples).unwrap_or(VadFrame::Speech(samples)) {
                VadFrame::Speech(buf) => {
                    out_buf.extend_from_slice(buf);
                    fallback_audio.clear();
                }
                VadFrame::Noise => {}
            }
        } else {
            fallback_audio.clear();
            out_buf.extend_from_slice(samples);
        }
    }

    let mut stream_error_reported = false;
    let mut reported_dropped_chunks = 0u64;

    loop {
        // Block briefly for samples, but wake up regularly so commands are
        // still serviced when the stream stops delivering (e.g. the capture
        // device disappeared mid-recording). With the old `recv()`-driven
        // loop a dead stream wedged the worker forever: `stop()` blocked on
        // its reply channel and `close()` hung joining this thread, so one
        // Bluetooth-mic dropout bricked dictation until a force-quit.
        match sample_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(raw) => {
                // ---------- spectrum processing -------------------------- //
                if let Some(buckets) = visualizer.feed(&raw) {
                    if let Some(cb) = &level_cb {
                        cb(buckets);
                    }
                }

                // ---------- existing pipeline ----------------------------- //
                if let Some(enhancer) = enhancer.as_mut() {
                    enhancer.push(&raw, &mut |frame: &[f32]| {
                        handle_frame(
                            frame,
                            recording,
                            &vad,
                            &mut processed_samples,
                            &mut vad_fallback_audio,
                        )
                    });
                } else {
                    frame_resampler.push(&raw, &mut |frame: &[f32]| {
                        handle_frame(
                            frame,
                            recording,
                            &vad,
                            &mut processed_samples,
                            &mut vad_fallback_audio,
                        )
                    });
                }

                // Hand the buffer back so the audio thread can refill it.
                // A closed channel just means we are shutting down.
                let mut raw = raw;
                raw.clear();
                let _ = recycled_tx.send(raw);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }

        // The capture callback cannot log (it runs on the audio thread), so
        // report its dropped-chunk count from here instead.
        let dropped = dropped_chunks.load(Ordering::Relaxed);
        if dropped > reported_dropped_chunks {
            log::error!(
                "Capture callback dropped {} audio chunk(s); the consumer channel is closed",
                dropped - reported_dropped_chunks
            );
            reported_dropped_chunks = dropped;
        }

        // Surface the first stream failure to the registered callback.
        if !stream_error_reported {
            if let Ok(error_message) = error_rx.try_recv() {
                stream_error_reported = true;
                if let Some(cb) = &error_cb {
                    cb(error_message);
                }
            }
        }

        // non-blocking check for a command
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                Cmd::Start => {
                    processed_samples.clear();
                    vad_fallback_audio.clear();
                    recording = true;
                    visualizer.reset(); // Reset visualization buffer
                    if let Some(v) = &vad {
                        v.lock().unwrap_or_else(|e| e.into_inner()).reset();
                    }
                }
                Cmd::Stop(reply_tx) => {
                    recording = false;

                    // Drain any audio chunks that were captured but not yet consumed
                    while let Ok(remaining) = sample_rx.try_recv() {
                        if let Some(enhancer) = enhancer.as_mut() {
                            enhancer.push(&remaining, &mut |frame: &[f32]| {
                                handle_frame(
                                    frame,
                                    true,
                                    &vad,
                                    &mut processed_samples,
                                    &mut vad_fallback_audio,
                                )
                            });
                        } else {
                            frame_resampler.push(&remaining, &mut |frame: &[f32]| {
                                handle_frame(
                                    frame,
                                    true,
                                    &vad,
                                    &mut processed_samples,
                                    &mut vad_fallback_audio,
                                )
                            });
                        }
                    }

                    if let Some(enhancer) = enhancer.as_mut() {
                        enhancer.finish(&mut |frame: &[f32]| {
                            handle_frame(
                                frame,
                                true,
                                &vad,
                                &mut processed_samples,
                                &mut vad_fallback_audio,
                            )
                        });
                    } else {
                        frame_resampler.finish(&mut |frame: &[f32]| {
                            handle_frame(
                                frame,
                                true,
                                &vad,
                                &mut processed_samples,
                                &mut vad_fallback_audio,
                            )
                        });
                    }

                    let finalized =
                        finalize_recording_samples(&mut processed_samples, &mut vad_fallback_audio);
                    if finalized.used_vad_fallback {
                        log::warn!(
                            "VAD rejected every frame; preserving audible enhanced audio for transcription"
                        );
                    }
                    let _ = reply_tx.send(finalized.samples);
                }
                Cmd::Snapshot(reply_tx, max_samples) => {
                    let snapshot = if recording {
                        let total_samples = processed_samples.len();
                        let samples = match max_samples {
                            Some(max) if total_samples > max => {
                                processed_samples[total_samples - max..].to_vec()
                            }
                            _ => processed_samples.clone(),
                        };
                        AudioSnapshot {
                            total_samples,
                            samples,
                        }
                    } else {
                        AudioSnapshot {
                            total_samples: 0,
                            samples: Vec::new(),
                        }
                    };
                    let _ = reply_tx.send(snapshot);
                }
                Cmd::Shutdown => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        finalize_recording_samples, VadFallbackAudio, VAD_FALLBACK_FRAME_SAMPLES,
        VAD_FALLBACK_SILENCE_COMPACT_SAMPLES,
    };

    fn voiced_frames(frame_count: usize) -> Vec<f32> {
        let sample_rate = 16_000.0f32;
        (0..frame_count * VAD_FALLBACK_FRAME_SAMPLES)
            .map(|index| {
                let phase = index as f32 * 2.0 * std::f32::consts::PI * 220.0 / sample_rate;
                phase.sin() * 0.035
            })
            .collect()
    }

    fn push_frames(fallback_audio: &mut VadFallbackAudio, samples: &[f32]) {
        for frame in samples.chunks(VAD_FALLBACK_FRAME_SAMPLES) {
            fallback_audio.push_frame(frame);
        }
    }

    #[test]
    fn audible_audio_survives_when_vad_rejects_every_frame() {
        let mut vad_samples = Vec::new();
        let expected = voiced_frames(4);
        let mut fallback_audio = VadFallbackAudio::new();
        push_frames(&mut fallback_audio, &expected);

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(finalized.used_vad_fallback);
        assert_eq!(finalized.samples, expected);
    }

    #[test]
    fn silence_is_not_sent_to_the_transcription_engine() {
        let mut vad_samples = Vec::new();
        let mut fallback_audio = VadFallbackAudio::new();
        push_frames(
            &mut fallback_audio,
            &vec![0.0; VAD_FALLBACK_FRAME_SAMPLES * 20],
        );

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(!finalized.used_vad_fallback);
        assert!(finalized.samples.is_empty());
        assert!(fallback_audio.samples.is_empty());
    }

    #[test]
    fn steady_low_level_noise_is_not_sent_to_the_transcription_engine() {
        let mut vad_samples = Vec::new();
        let mut fallback_audio = VadFallbackAudio::new();
        let low_noise = vec![0.01; VAD_FALLBACK_FRAME_SAMPLES * 20];
        push_frames(&mut fallback_audio, &low_noise);

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(!finalized.used_vad_fallback);
        assert!(finalized.samples.is_empty());
    }

    #[test]
    fn steady_loud_dc_offset_is_not_sent_to_the_transcription_engine() {
        let mut vad_samples = Vec::new();
        let mut fallback_audio = VadFallbackAudio::new();
        let dc_offset = vec![0.04; VAD_FALLBACK_FRAME_SAMPLES * 20];
        push_frames(&mut fallback_audio, &dc_offset);

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(!finalized.used_vad_fallback);
        assert!(finalized.samples.is_empty());
    }

    #[test]
    fn non_finite_frame_is_discarded_from_rescue_audio() {
        let mut vad_samples = Vec::new();
        let mut fallback_audio = VadFallbackAudio::new();
        let mut invalid = voiced_frames(4);
        invalid[VAD_FALLBACK_FRAME_SAMPLES] = f32::NAN;
        push_frames(&mut fallback_audio, &invalid);

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(finalized.used_vad_fallback);
        assert_eq!(finalized.samples, invalid[VAD_FALLBACK_FRAME_SAMPLES * 2..]);
        assert!(finalized.samples.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn one_isolated_loud_frame_is_treated_as_noise() {
        let mut vad_samples = Vec::new();
        let mut fallback_audio = VadFallbackAudio::new();
        for frame_index in 0..4 {
            let frame = if frame_index == 1 {
                voiced_frames(1)
            } else {
                vec![0.0; VAD_FALLBACK_FRAME_SAMPLES]
            };
            fallback_audio.push_frame(&frame);
        }

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(!finalized.used_vad_fallback);
        assert!(finalized.samples.is_empty());
    }

    #[test]
    fn separated_loud_frames_are_treated_as_noise() {
        let mut vad_samples = Vec::new();
        let mut fallback_audio = VadFallbackAudio::new();
        for frame_index in 0..5 {
            let frame = if matches!(frame_index, 1 | 3) {
                voiced_frames(1)
            } else {
                vec![0.0; VAD_FALLBACK_FRAME_SAMPLES]
            };
            fallback_audio.push_frame(&frame);
        }

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(!finalized.used_vad_fallback);
        assert!(finalized.samples.is_empty());
    }

    #[test]
    fn accepted_vad_audio_always_wins_over_the_fallback() {
        let expected = vec![0.1, -0.1, 0.2];
        let mut vad_samples = expected.clone();
        let mut fallback_audio = VadFallbackAudio::new();
        push_frames(&mut fallback_audio, &voiced_frames(4));

        let finalized = finalize_recording_samples(&mut vad_samples, &mut fallback_audio);

        assert!(!finalized.used_vad_fallback);
        assert_eq!(finalized.samples, expected);
        assert!(fallback_audio.samples.is_empty());
    }

    #[test]
    fn long_silence_keeps_the_rescue_buffer_bounded() {
        let mut fallback_audio = VadFallbackAudio::new();
        let silence = vec![0.0; VAD_FALLBACK_FRAME_SAMPLES];

        for _ in 0..1_000 {
            fallback_audio.push_frame(&silence);
        }

        assert!(fallback_audio.samples.len() <= VAD_FALLBACK_SILENCE_COMPACT_SAMPLES);
        assert!(!fallback_audio.signal_detected);
    }
}
