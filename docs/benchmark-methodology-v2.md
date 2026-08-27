# Vox Jot Benchmark Methodology v2

Status: implemented methodology and ranked-result gate. Existing Testing rows remain legacy evidence until the corresponding models complete a v2 full-suite run.

Machine-readable specification: `benchmarks/methodology-v2.json`

## Purpose

Vox Jot benchmarks the experience delivered by the installed, on-device app. A model card, a cloud API result, a raw Python demo, and an installed Vox Jot result are different evidence. Only the installed-app path can produce a v2 ranked row.

The v2 design borrows useful practices from Artificial Analysis, MLPerf Client, NIST SCTK, ICDAR, pyannote, 3D-Speaker, and reproducible LLM harnesses, then adapts them to local Apple Silicon:

- multi-domain accuracy instead of a single clean corpus;
- end-to-end app endpoints instead of isolated model calls;
- one warm-up followed by three measured runs;
- p50 and p95 latency, real-time factor, speed factor, and peak process-tree RSS;
- exact suite, model, runtime, hardware, and source revisions in every report;
- separate quality, speed, memory, and external context instead of a single opaque score;
- full-suite gates that keep smoke, extended, experimental, failed, or incomplete evidence out of rankings.

## Evidence tiers

| Tier                 | Meaning                                                                                                  | Can rank?                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ranked`             | Complete v2 base suite through the installed app, all required metrics and provenance present            | Yes                                                              |
| `extended`           | Optional v2 stress, language, long-context, or hardware experiment                                       | No; publish separately                                           |
| `diagnostic`         | Smoke test, case-limited run, direct runtime invocation, reused output, missing judge, or partial corpus | No                                                               |
| `legacy`             | Historical result from the pre-v2 methodology                                                            | Preserve its original rank and limitations; do not compare as v2 |
| `blocked` / `failed` | Runtime, artifact, license, case, or scoring gate did not complete                                       | No                                                               |

Every report must state its tier. A model is never given v2 fields by inference from an older report.

## Reproducible run envelope

Every v2 report records:

- methodology version and suite manifest checksum;
- UTC timestamp and repository commit;
- installed Vox Jot version and bundle path;
- canonical provider ID, model ID, model revision/checksum, precision, and runtime revision;
- macOS version, Mac model, Apple chip, physical memory, power source, and thermal state;
- declared hardware path: ANE, Metal GPU, CPU, mixed, or unknown;
- warm-up count, measured-run count, cache state, concurrency, random seeds, and timeout;
- raw per-case output and error state, plus aggregate metrics;
- peak resident memory for the app process tree, labeled as RSS rather than GPU/ANE allocation.

Do not claim ANE use from low CPU utilization or a Core ML model name. Record ANE, Metal, or CPU only when runtime instrumentation or the selected compute-unit configuration establishes it. “ANE offload percentage” is not a v2 metric until Apple exposes or Vox Jot implements a trustworthy measurement.

## Performance protocol

The default is one warm-up and three measured runs, matching the practical client-benchmark pattern of separating warm-up from reported performance. Accuracy is scored from deterministic temperature-zero output where the model permits it. When a model is stochastic, all outputs and seeds are retained and variability is reported.

Report:

- cold load separately from warm inference;
- p50 and p95 end-to-end latency;
- real-time factor: `processing seconds / media seconds`;
- speed factor: `1 / real-time factor`, displayed as “20× real time”;
- peak app-process-tree RSS and the pre-run baseline;
- time to first token for a streaming LLM when the endpoint exposes it;
- time to first audio only for an endpoint that actually streams audio bytes.

Do not rename time-to-complete as TTFA. Vox Jot's current `/v1/tts/synthesize` endpoint returns a completed artifact, so it can measure end-to-end generation time but not true time to first audio.

## Ranking policy

Rank within a suite and methodology version only. The Testing view must keep the underlying metrics visible.

- Accuracy or task success is the primary ordering signal.
- Latency breaks ties only after the required quality gate is met.
- A composite score may summarize one suite but must publish its formula and all components.
- Missing required metrics, missing base domains, case limits, reused generated audio, failed required cases, or direct-runtime-only execution make the row unranked.
- Hardware, language, and capability-specific models still receive a numeric rank after completing the applicable full suite; caveats belong in notes.
- External Elo, vendor latency, price, or cloud WER is context only. It never changes a Vox Jot local score or rank.

## Live STT

### Base domains

1. Clean human read speech.
2. Casual short dictation and self-corrections.
3. Noise, far-field, and competing-speaker stress.
4. Dates, currencies, phone/ID strings, proper names, technical terms, paths, URLs, code, and punctuation cues.
5. Accent and language coverage appropriate to the model's advertised capability.

Post-processing stays disabled. Score both strict raw WER and task-normalized WER. Normalization rules are versioned, symmetric between reference and hypothesis, and never remove content errors merely to improve the result.

Publish per-domain micro WER, aggregate micro WER, declared domain-weighted WER, normalized match rate, p50/p95 latency, RTF, speed factor, failure rate, and memory. Long clips are aggregated back to the parent recording before WER so arbitrary chunk boundaries do not change accuracy.

The previous 35-clip Mini LibriSpeech run is retained as `legacy`; it cannot become v2-ranked without the other domains.

## File ASR

Use a committed manifest with a distinct reference per recording. Five container formats containing the same sentence test decoding compatibility, not transcription breadth.

The base suite includes short format coverage plus real long-form meetings, technical speech, and multilingual material. Publish micro WER, long-form WER, format success, empty/truncated output failures, timecode/segment coverage when available, p50 latency, RTF, speed factor, and peak RSS. Chunked results are reassembled and scored against the parent transcript.

## Speaker isolation and diarization

Use multiple fixtures spanning two and four speakers, natural meetings, overlap, noise, far-field speech, similar voices, and speaker-count changes. Do not provide oracle speaker count.

The primary metric is diarization error rate: missed speech plus false alarm plus speaker confusion, divided by reference speech duration. Predicted and reference speakers use a one-to-one optimal mapping. Also publish Jaccard error rate, speaker-count error, turn over/under-segmentation, RTF, and speaker-attributed WER when the ASR path is evaluated.

The old single synthetic fixture remains `legacy` even after correcting the scorer.

## Screen OCR

Exact rendered reference text is the accuracy source. Required-phrase recall remains useful for product-critical strings but cannot rank by itself because it ignores insertions, partial-word errors, and reading order.

The base suite includes app UI, documents, code, dense tables, low contrast, rotation/scaling, multilingual text, and prompt-looking untrusted content. Publish character error rate, word error rate, required-phrase recall, reading-order score, per-domain results, latency, and confidence only when the engine's confidence is calibrated and meaningful.

## Refine LLMs

The corpus covers corrections, filler removal, formatting, lists, names/numbers, code/symbols, passthrough text, non-speech, prompt artifacts, and adversarial drift. Temperature is zero and the exact system prompt, prompt profile, tokenizer/model revision, and maximum output length are recorded.

Publish pass rate, exact match, similarity, safety fallback rate, p50/p95 end-to-end latency, output tokens per second, and zero-drift purity. Zero-drift is measured on the direct sanitized model candidate before Vox Jot fallback, so a safety fallback cannot make a drifting model look pure. The report retains the added content tokens that triggered the failure. Effective final-output safety is reported separately.

TTFT is reported only when the provider exposes a streamed first token. For non-streaming endpoints, report full response latency and tokens per second without inventing TTFT.

## TTS

The installed app synthesizes every hard-suite prompt through canonical provider/model IDs. The base domains remain casual, long readback, code/symbols, numbers/dates, and multilingual text. Models with provider voices use a balanced representative voice set when available; clone-capable models also use the controlled reference set.

Publish synthesis success, ASR round-trip WER, WAV health, duration, p50/p95 generation latency, RTF, speed factor, and memory. The ASR judge ID and revision are fixed for the full comparison. Human listening results are separate evidence; published external Speech Arena Elo can be linked with source/date/methodology but does not enter the local score.

## TTS style

Automatic rate, energy, and pause heuristics are diagnostic proxies. A v2-ranked style result requires randomized, blind listener ratings across the locked neutral, warm, excited, calm, urgent, and empathetic prompts. Publish automatic prosody features and listener preference separately so the proxy cannot masquerade as human judgment.

## Voice cloning

Use the same consented reference voices across models. The automatic speaker metric is cosine similarity between versioned speaker-verification embeddings. Vox Jot v2 defaults to the bilingual CAM++ speaker-verification model at ModelScope revision `v1.0.0`; a different encoder or revision creates different evidence and must be recorded.

The old RMS/peak/silence/zero-crossing “acoustic fingerprint” is retained only as a diagnostic audio-profile comparison. It is not speaker identity and cannot contribute to a v2 rank.

Publish embedding cosine, ASR round-trip WER, blind speaker-match preference, synthesis success, latency, and reference/candidate provenance. Never upload private reference voices to a hosted judge without explicit consent and acceptable terms.

## Creative audio

Every supported Story Studio mode runs through the installed app. Success, duration, WAV health, and speed do not establish prompt adherence. V2 adds a CLAP audio-text cosine score using `laion/clap-htsat-unfused` pinned to commit `8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a`, and retains blind listening as separate evidence.

Publish prompt adherence, success, duration accuracy, audio health, p50 latency, RTF, and seed. Sound effects, ambience, music, song, and symbolic composition are reported by domain because models do not necessarily support the same modes. A model ranks only within the applicable full capability suite.

## External benchmark context

An external metric entry must record its source, direct URL, retrieval date, published methodology version, metric, and coverage caveat. It must never be silently merged into local measurements.

The Testing view keeps the currently verified Artificial Analysis provider-voice snapshot in `src/lib/ttsExternalBenchmarkContext.ts`. Only exact upstream model-family matches receive a value. Local ports and quantizations retain an explicit caveat, and unmatched Vox Jot models receive no inferred value.

Examples:

- Artificial Analysis TTS Quality Elo: blind relative preference for cloud/provider or controlled voices, not local availability, privacy, license, memory, or Vox Jot latency.
- Artificial Analysis STT WER: useful evidence for multi-domain and duration-weighted design, not a substitute for the installed app.
- Vendor tokens/s or latency: product claims until independently measured on Vox Jot's hardware and app path.

Respect provider terms. A prohibition on competitive benchmarking is a hard stop, regardless of public leaderboard strength.

## Migration

1. Keep every existing row and report unchanged as legacy evidence.
2. Run `bun run eval:methodology:validate` before a benchmark session.
3. Build/freeze the full suite manifest and its checksum.
4. Run the installed-app benchmark with the v2 ranked gate.
5. Review per-case failures, provenance, and system profile.
6. Update the corresponding `src/lib/*EvaluationResults.ts` row only from the completed report.
7. Recompute ranks among v2-complete rows. Do not mix legacy and v2 ranks.
8. Keep diagnostic and extended outputs available in reports but out of the ranked table.

## Primary references

- Artificial Analysis, Speech-to-Text methodology: <https://artificialanalysis.ai/speech-to-text/methodology>
- Artificial Analysis, Text-to-Speech methodology: <https://artificialanalysis.ai/text-to-speech/methodology>
- MLCommons, MLPerf Client: <https://mlcommons.org/benchmarks/client/>
- NIST SCTK / sclite: <https://github.com/usnistgov/SCTK/blob/master/doc/sclite.htm>
- EleutherAI LM Evaluation Harness task configuration: <https://github.com/EleutherAI/lm-evaluation-harness/blob/main/docs/task_guide.md>
- ICDAR 2024 RDTAG metrics: <https://ilocr.iiit.ac.in/icdar_2024_rdtag/task.html>
- pyannote diarization benchmark and metrics: <https://www.pyannote.ai/benchmark>
- 3D-Speaker / CAM++: <https://github.com/modelscope/3D-Speaker>
- SpeechBrain ECAPA-TDNN speaker verification: <https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb>
- LAION CLAP: <https://github.com/LAION-AI/CLAP>
