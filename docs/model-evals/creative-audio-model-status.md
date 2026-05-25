# Creative Audio Model Status

Evaluated: 2026-05-25

This tracks the current implementation status for researched open music-generation models in Vox Jot Studio Sound Design. Every model kept in the production-facing Creative Audio catalog must be wired as an app-managed download: model selection downloads the model snapshot and its matching Hugging Face-hosted runtime.

This is an implementation status record, not a plan for unfinished user-visible work. Models that are not fully app-managed stay out of the production catalog.

| Model                      | Studio lane   | Current app state               | Why                                                                                                                                                                                                  |
| -------------------------- | ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable Audio 3 Small SFX   | SFX, Ambience | Downloaded, runnable, ranked #2 | Existing Apple Silicon MLX runtime and generation path. Full installed-app suite passed 2/2 cases: score 99.6, p50 1229 ms, p50 RTF 0.271.                                                           |
| Stable Audio 3 Small Music | Music         | Downloaded, runnable, ranked #1 | Existing Apple Silicon MLX runtime and generation path. Full installed-app suite passed 2/2 cases: score 99.8, p50 1387 ms, p50 RTF 0.102.                                                           |
| ACE-Step 1.5               | Music, Song   | Blocked                         | Public weights are reachable, but no app-managed macOS runtime archive is published/validated. The public PyPI package fails to build because its source distribution is missing `requirements.txt`. |
| YuE                        | Song          | Blocked                         | Upstream inference path requires CUDA/flash-attn; no app-managed Apple Silicon runtime has validated.                                                                                                |
| DiffRhythm                 | Song          | Blocked                         | Public weights are reachable and upstream has MPS handling, but Vox Jot's configured app-managed runtime artifact is not available.                                                                  |
| FIGARO                     | Composition   | Blocked                         | The configured Hugging Face checkpoint mirror is unavailable, and MIDI-to-WAV preview runtime packaging has not validated.                                                                           |

Excluded from the production-facing catalog:

- AudioCraft / MusicGen: code is MIT, but practical MusicGen weights are non-commercial.
- SongGeneration / LeVo 2: published license limits use to academic, research, and education.
- Music Transformer / Piano Transformer, Symbolic Music Diffusion, and Rule-Guided Music: useful references, but too archival or workflow-specific for the current Sound Design model hub.

Policy:

- Do not mark a model downloadable until its complete runtime and required weights are installed through app-managed locations.
- Rank creative-audio models in Testing only after the full installed-app Creative Audio benchmark completes through `/v1/creative-audio/generate`.
- Do not load creative-audio runtimes during dictation, transcription, paste, overlay updates, or app startup.
- Do not expose non-commercial or research-only weights as production downloads.
