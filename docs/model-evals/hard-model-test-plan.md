# Hard Model Test Plan

This is the research-backed gate Vox Jot models should pass before being
treated as reliable in the app. It covers the app's five model surfaces:

- live STT dictation
- LLM post-processing
- file ASR
- voice cloning / TTS
- speaker isolation / diarization

The plan is intentionally harder than the everyday smoke tests. It uses public
benchmarks where they map to Vox Jot behavior, and local app-specific tests
where the product has unique risk.

## Current App Baseline

Computer Use confirmed the installed app is running with these active models:

| Surface            | Active model                            |
| ------------------ | --------------------------------------- |
| Speech (STT)       | Whisper Turbo                           |
| Speech Analysis    | PyAnnote 3.1 + current dictation engine |
| Post-process (LLM) | `nemotron-3-nano-4b-q4_k_m:latest`      |
| Voices (TTS)       | `chatterbox-turbo`                      |
| Screen OCR         | Nemotron OCR v2                         |

## Evaluation Principles

- Track quality and latency together. A model that wins WER but misses the
  app's responsiveness targets should not be the default.
- Keep local, repeatable suites small enough to run often; use full public
  benchmarks for model promotion, not every commit.
- Score by domain-specific failure modes, not just aggregate accuracy.
- Separate model quality from pipeline quality: decode, chunking, formatting,
  post-processing, diarization, and paste/output should have their own metrics.

## 1. Live STT Dictation

### Required hard cases

| Tier                 | Dataset / source                                | Why it matters                                                         | Metric                                              |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Local smoke          | Mini LibriSpeech regression pack                | Already wired locally; catches basic WER and latency regressions.      | WER, exact match, STT latency p50/p95, RTF          |
| Hard clean/read      | LibriSpeech `test-other`                        | Standard harder read-speech set.                                       | WER, RTF                                            |
| Accent/diversity     | Common Voice validated clips                    | Crowdsourced multilingual and accented speech coverage.                | WER by language/accent, failure buckets             |
| Noisy far-field      | CHiME-6 excerpts                                | Real homes, distant microphones, natural conversation, domestic noise. | WER, VAD miss/false alarm, RTF                      |
| Domain vocabulary    | PriMock57                                       | Medical dialogue, names, drugs, disfluency, long turns.                | WER, medical-term WER, hallucination rate           |
| Vox Jot product bank | `test-data/audio-test-bank` and spelling corpus | Code tokens, names, numbers, corrections, dictated commands.           | exact match, substitution count, final paste safety |

### Promotion gate

- No catastrophic hallucinations on any local hard case.
- p95 stop-to-transcript latency does not regress by more than 10%.
- RTF remains below 1.0 for models offered as live dictation defaults.
- Domain WER must be reported separately; do not hide medical/accent failures in
  an average.

### Existing commands

```bash
bun run regression:download
bun run regression:run -- --limit 25 --skip-post-process
bun run eval:test-bank:sanity
```

## 2. LLM Post-Processing

### Required hard cases

| Tier                   | Dataset / source                                    | Why it matters                                                         | Metric                             |
| ---------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| Local deterministic    | `test-data/audio-test-bank/post-process-cases.json` | App-specific dictation cleanup and route selection.                    | exact match, similarity, route     |
| Spelling and names     | `test-data/spelling-corpus/cases.json`              | Dictation assistants fail trust fastest on names and homophones.       | exact match, substitution count    |
| Verifiable constraints | IFEval-inspired cases                               | Checks instruction following without relying on an LLM judge.          | rule pass/fail                     |
| Conservative rewrite   | Custom no-hallucination bank                        | Ensures the model does not answer questions or add facts.              | blocked candidate rate, drift gate |
| Long context           | LongBench-style app-context prompts                 | Tests write rules and active-app context without losing the user text. | answer faithfulness, latency       |

### Promotion gate

- 100% pass on destructive-safety cases: no prompt leaks, no JSON wrappers, no
  unrelated answers, no markdown code fences unless requested.
- 95%+ pass on sanity bank before enabling as a recommended local LLM.
- Any live API evaluation must log provider/model/version and temperature.

### Existing commands

```bash
bun run eval:test-bank:sanity
bun run eval:spelling:dry
bun run eval:test-bank:live -- --provider ollama --model <model>
```

## 3. File ASR

File transcription has different risks from live dictation: decode failures,
long-form chunking, subtitle export, progress/cancel behavior, memory pressure,
and diarization alignment.

### Required hard cases

| Tier               | Dataset / source                       | Why it matters                                              | Metric                           |
| ------------------ | -------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| Decode smoke       | `test-data/file-transcription-samples` | WAV mono/stereo, MP3, M4A, MP4 audio path coverage.         | command success, text similarity |
| Long-form accented | Earnings-22                            | Real-world earnings calls with accents and long recordings. | WER, RTF, memory peak            |
| Talks              | TED-LIUM 3                             | Long prepared speech with lecture vocabulary.               | WER, timestamp drift             |
| Medical dialogue   | PriMock57                              | Conversational turns, role labels, disfluencies.            | WER, speaker-role preservation   |
| Chunk boundary     | Synthetic joined clips                 | Ensures no repeated/dropped words at chunk seams.           | seam duplication/drop count      |

### Promotion gate

- All committed sample formats decode and finish.
- Long-form runs must report RTF, max memory, and cancellation response time.
- Subtitle exports must remain monotonic and non-overlapping.
- Chunked output must not duplicate or drop more than one word around seams.

## 4. Voice Cloning / TTS

### Required hard cases

| Tier                 | Dataset / source                      | Why it matters                                                     | Metric                             |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| Multi-speaker/accent | VCTK                                  | 110 English speakers with varied accents; standard cloning source. | speaker similarity, WER, MOS proxy |
| Audiobook/reference  | LibriTTS                              | Clean TTS-oriented reference material from LibriSpeech.            | WER, naturalness proxy             |
| Short prompt cloning | 5s, 10s, 30s reference clips          | Checks how much reference audio each model really needs.           | similarity delta, failure rate     |
| Cross-language clone | English reference -> non-English text | Exposes language/identity tradeoffs.                               | intelligibility, similarity        |
| Expressiveness       | emotion/style prompts and inline tags | Validates model-specific style controls.                           | control adherence, artifacts       |

### Promotion gate

- Generated speech must be intelligible under ASR WER checks.
- Report cold start, time-to-first-audio, RTF, peak memory, and output duration
  drift for every TTS/clone model.
- For cloning, collect both objective speaker similarity and a small human
  review before recommending the model.
- Use only consented reference voices in product tests.

## 5. Speaker Isolation / Diarization

### Required hard cases

| Tier                | Dataset / source                                              | Why it matters                                                                                        | Metric                               |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Readiness           | `.venv/bin/python scripts/validate_speech_analysis_models.py` | Verifies adapters, dependencies, auth, and downloads using the dedicated speech-analysis environment. | ready/download_required/blocked      |
| Meeting speech      | AMI                                                           | Standard meeting-style diarization and ASR stress.                                                    | DER, JER, speaker count error        |
| Wild video          | VoxConverse                                                   | Overlap, varied speakers, broadcast conditions.                                                       | DER, JER                             |
| Noisy dinner-party  | CHiME-6                                                       | Distant microphones, natural overlap, domestic noise.                                                 | DER, WER, cpWER                      |
| Robustness          | DIHARD-style subsets                                          | Designed to stress domain variability.                                                                | DER with no collar, overlap included |
| Synthetic isolation | two/three-speaker mixtures                                    | Repeatable local checks for overlap and similar voices.                                               | leakage, missed speech, confusion    |

### Promotion gate

- Report DER and JER with the scoring setup stated.
- Run a strict mode with no forgiveness collar and overlapped speech included.
- Any speaker-attributed transcript must report word-level speaker confusion or
  cpWER, not just diarization timing.
- Models that require Hugging Face auth or GPU should remain marked as such in
  the model hub.

## Source Notes

- CHiME-6 targets distant conversational speech recognition in real homes and
  includes diarization+ASR tracks with speaker labels and timing annotations:
  https://chimechallenge.github.io/chime6/overview.html
- Common Voice is Mozilla's crowdsourced multilingual speech dataset and is
  released repeatedly by the project:
  https://www.mozillafoundation.org/en/common-voice/platform-and-dataset/
- VCTK contains speech from 110 English speakers with varied accents and is a
  standard voice-cloning/TTS reference:
  https://tensorflow.google.cn/datasets/catalog/vctk
- PriMock57 provides public mocked primary-care consultations and is explicitly
  usable as a conversational medical ASR benchmark:
  https://aclanthology.org/2022.acl-short.65/
- IFEval uses verifiable instruction-following constraints, which fits Vox
  Jot's post-processing safety checks:
  https://arxiv.org/abs/2311.07911
- `pyannote.metrics` defines DER as false alarm + missed detection + speaker
  confusion divided by total reference speaker duration:
  https://pyannote.github.io/pyannote-metrics/reference.html
