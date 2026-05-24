# Creative Audio Model Roadmap

Evaluated: 2026-05-24

This tracks how the researched open music-generation models fit Vox Jot Studio Sound Design. Only Stable Audio 3 is currently connected to a working app-managed runtime. All other entries are intentionally catalog-only until Vox Jot has a dedicated runtime, resumable downloads, cancellation, export validation, and a creative-audio benchmark suite.

| Model                                 | Studio lane     | Current app state         | Why                                                                                                          |
| ------------------------------------- | --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Stable Audio 3 Small SFX              | SFX, Ambience   | Downloadable and runnable | Existing Apple Silicon MLX runtime and generation path.                                                      |
| Stable Audio 3 Small Music            | Music           | Downloadable and runnable | Existing Apple Silicon MLX runtime and generation path.                                                      |
| ACE-Step 1.5                          | Music, Song     | Future / experimental     | Best next candidate, MIT, Apple Silicon MLX support, but needs its own runtime and benchmark pass.           |
| YuE                                   | Song            | Future / experimental     | Apache-2.0 full-song generator with vocals/accompaniment; runtime is separate and heavyweight.               |
| DiffRhythm                            | Song            | Future / experimental     | Apache-2.0 full-song diffusion model; needs dedicated runtime and Mac validation.                            |
| AudioCraft / MusicGen                 | Music, Ambience | Blocked                   | Code is MIT, but practical MusicGen weights are non-commercial; do not expose as a general product download. |
| SongGeneration / LeVo 2               | Song            | Blocked                   | Published license limits use to academic, research, and education and excludes commercial/production use.    |
| Music Transformer / Piano Transformer | Composition     | Future / experimental     | Archived symbolic/MIDI project; needs a MIDI runtime and preview renderer.                                   |
| FIGARO                                | Composition     | Future / experimental     | Strongest symbolic candidate; needs MIDI export/preview workflow.                                            |
| Symbolic Music Diffusion              | Composition     | Future / experimental     | Archived symbolic diffusion project; useful reference but not a direct rendered-audio engine.                |
| Rule-Guided Music                     | Composition     | Future / experimental     | Advanced controllable symbolic generation; needs rule editor and maintained runtime.                         |

Policy:

- Do not mark a model downloadable until its complete runtime and required weights are installed through app-managed locations.
- Do not rank creative-audio models in Testing until the full Creative Audio benchmark exists.
- Do not load creative-audio runtimes during dictation, transcription, paste, overlay updates, or app startup.
- Do not expose non-commercial or research-only weights as production downloads.
