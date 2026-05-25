# Open Source Speech System Research, May 2026

This audit looked at popular and current speech systems that overlap with Vox Jot's dictation, model catalog, text refinement, voice, and screen-context direction.

## Systems Reviewed

- `whisper.cpp`: strong local C/C++ baseline with CLI, WASM, HTTP server, benchmark tooling, command mode, and `whisper-stream` for real-time microphone capture.
- `faster-whisper`: CTranslate2-backed Whisper runtime with batched inference and integrated Silero VAD filtering.
- `WhisperX`: fast Whisper pipeline with batched inference, word alignment, VAD, and optional speaker diarization. It is strongest for long-form transcription, but its own docs still caveat imperfect diarization and overlapping speech.
- `sherpa-onnx`: broad offline speech stack for ASR, streaming ASR, TTS, VAD, speaker diarization, enhancement, separation, many platforms, and app-managed model examples.
- `WhisperLiveKit`: self-hosted simultaneous transcription with backend choices, diarization extras, benchmarks, Docker profiles, and Hugging Face cache/token handling.
- `WhisperStreaming` / `SimulStreaming`: streaming Whisper research line; WhisperStreaming now points new work toward SimulStreaming for faster and higher-quality streaming.
- Apple SpeechAnalyzer: system speech API for live transcription, model ensuring, volatile results, audio time ranges, and async result delivery.

## Product Lessons

- Separate the dictation hot path from lab features. Dictation needs predictable start, stop, transcription, and paste latency; model testing, diarization, voice cloning, OCR, and automation should not run synchronously inside that path.
- Treat model and runtime downloads as one artifact system. Current open-source systems converge on resumable downloads, cache locations, manifest/checksum checks, and clear progress events.
- Prefer provider contracts over feature-specific branches. STT, TTS, OCR, and speech analysis need different engines, but they share installation, cancellation, progress, and readiness semantics.
- Use streaming results as UI feedback, not as a reason to slow final paste. Apple SpeechAnalyzer and streaming Whisper projects show the value of volatile/partial results that later finalize.
- Keep lab features opt-in. Automation agents, model testing, and experimental speech-analysis views should stay discoverable for development but hidden for normal use until they are benchmarked and production-packaged.

## Vox Jot Architecture Conclusions

- Latency guardrails and hot-path instrumentation protect dictation.
- Shared artifact download code handles HF repos and standalone runtime archives.
- Runtime/provider contracts define artifact domain, execution mode, and whether the provider can run on the dictation path.
- Product module boundaries keep frontend navigation deterministic.
- Lab gating, docs, and tests keep experiments out of default UX until they are benchmarked and production-packaged.

## Sources

- https://github.com/ggml-org/whisper.cpp
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/m-bain/whisperX
- https://github.com/k2-fsa/sherpa-onnx
- https://github.com/QuentinFuxa/WhisperLiveKit
- https://github.com/ufal/whisper_streaming
- https://developer.apple.com/videos/play/wwdc2025/277/
