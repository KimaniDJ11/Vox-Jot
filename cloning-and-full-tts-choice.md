# Voice Cloning and Full TTS Choice

*Note: This document previously contained a misconception regarding "repository cloning." It has been corrected to refer entirely to "Voice Cloning" (the AI generation of audio matching a user's voice profile).*

This document outlines the in-depth architectural breakdown and implementation plan for bringing comprehensive Text-to-Speech (TTS) capabilities to Vox Jot. Modeled after our STT and LLM selections, Vox Jot will support plug-and-play TTS engines, native Voice Cloning, and extensive Voice Profile management, heavily inspired by platforms like Jamie Pine's [Voicebox](https://github.com/jamiepine/voicebox).

## 1. Core Architecture: `manager/tts.rs`

Similar to the existing `manager/model.rs` and `manager/audio.rs`, we need a dedicated `TTSManager` in Rust.

**The `TTSEngine` Trait:**
To support multiple backends flawlessly, we will introduce a common trait that all engines must implement:
```rust
#[async_trait]
pub trait TTSEngine: Send + Sync {
    async fn synthesize(&self, text: &str, voice_profile: Option<&VoiceProfile>) -> Result<Vec<f32>, TTSError>;
    fn get_engine_info(&self) -> EngineMetadata;
    fn supports_cloning(&self) -> bool;
}
```

**Manager Integration:**
The `TTSManager` will maintain the active `Box<dyn TTSEngine>` and handle state swapping. When the user changes their TTS selection in the React frontend, an event (`set_tts_engine`) updates the backend state instantly without requiring a restart.

## 2. TTS Backend Candidates & Analysis

Based on our extensive research of the provided target repositories, we have structured the integrations as follows:

### A. Qwen3 TTS (Rust Native - Native & Default Choice)
**Repo:** [second-state/qwen3_tts_rs](https://github.com/second-state/qwen3_tts_rs)
- **Why it's critical:** It is a 100% Rust implementation. This means no Python environment overhead. It uses MLX on macOS and libtorch on Linux/Windows.
- **Voice Cloning:** The `0.6B-Base` model supports high-quality Voice Cloning. We can extract X-vectors and use In-Context Learning (ICL) directly in Rust (`SpeakerEncoder::extract_embedding`, `AudioEncoder::encode`).
- **Instruction Support:** The `1.7B-CustomVoice` natively supports emotional instructions. We can pass string commands from the user like `"Speak in an urgent and excited voice"`.

### B. Fish Speech (SOTA HTTP Server)
**Repo:** [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech)
- **Why it's critical:** It provides bleeding-edge Dual-AR architecture and requires zero fine-tuning for voice cloning (just 10-30 seconds of audio).
- **Integration:** Handled via HTTP calls to a background SGLang streaming server or a remote endpoint.
- **Paralinguistics:** Follows syntax like `[laughing]`, `[sigh]`, or `[whisper in small voice]` seamlessly.

### C. Hugging Face Speech-to-Speech & TADA
**Repos:** [huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech), [HumeAI/tada](https://huggingface.co/collections/HumeAI/tada)
- **Why it's critical:** Standardizes conversational local agents (using Whisper + LLM + TTS like Parler-TTS/MeloTTS or HumeAI's TADA text-acoustic alignment).
- **Integration:** Vox Jot can connect via WebSocket `ws://localhost:8765` for continuous stream-in, stream-out pipeline execution, bypassing typical generation latency limitations.

### D. Inspiration: Voicebox Features
From [jamiepine/voicebox](https://github.com/jamiepine/voicebox), we pull critical UX requirements:
- **Async Queueing:** Real-time generation chunking (e.g., streaming playback sentence by sentence so the user doesn't wait for massive texts).
- **Post-Processing:** Applying EQ/Reverb dynamically using Rust audio toolkits on the generated `Vec<f32>`.

## 3. Voice Cloning Workflow Details

To implement proper zero-shot Voice Cloning natively:

1. **Profile Creation (Frontend):** 
   A new UI view `Voice Profiles` allows the user to record directly in Vox Jot (managed via `managers/audio.rs`) or drop a `.wav`/`.m4a` file.
2. **Preprocessing (Backend):**
   Vox Jot will use `ffmpeg` or `rubato` to automatically resample the user's reference file to exactly **24kHz, 16-bit Mono** to satisfy structural rules of models like Qwen3.
3. **Embedding Extraction (Backend):**
   Using `qwen3_tts_rs`, the app preemptively extracts the `speaker_embedding` tensor. This tensor is saved to disk in the app's standard `AppData` directory (`vox-jot/voice_profiles/<id>.vec`).
4. **Synthesis (Runtime):**
   When TTS is requested, `TTSManager` loads the cached tensor, feeding it into X-Vector + ICL to yield a perfectly cloned voice with less runtime overhead latency.

## 4. Frontend Implementation Breakdown

In `src/components/settings/tts/`:
- **`TTSModelSelector.tsx`:** Similar to `<STTModelSelector />`. Shows local vs remote options (Qwen3, System Native Voice, Fish Speech URL, etc.).
- **`VoiceProfileGrid.tsx`:** Displays custom voices. Cards for different extracted/saved speakers.
- **Emotion Tags:** We will add hint popovers showing the user that typing `[laugh]` or `/instruction "speaking urgently"` directly interacts with the model if the engine supports it.

## 5. Implementation Roadmap

1. **Phase 1: Foundation.** Add `TTSManager`. Create a fallback system TTS engine (using macOS `say` or `NSSpeechSynthesizer` bindings). Build frontend selector UI.
2. **Phase 2: Rust Qwen3 Native Integration.** Bring in `qwen3_tts_rs` via `Cargo.toml`. Manage downloading of the `Qwen3-TTS-12Hz-0.6B-Base` model using the existing `managers/model.rs` infrastructure. Test standard synthesis.
3. **Phase 3: Voice Cloning UI/UX.** Add the Voice Profile uploader. Setup backend upsampling/resampling code explicitly for the 24kHz target. Compute and store embeddings.
4. **Phase 4: Remote Bridges.** Add integration bridges for Fish Speech local servers and HuggingFace pipelines via WebSockets.
5. **Phase 5: Refinement.** Implement sentence-chunking queued playback (as seen in Voicebox) to achieve endless generation length efficiently.

---
*Status: Research complete. Verified structural fit with Tauri and Qwen3 native Rust dependencies.*
