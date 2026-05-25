# Model Porting Rubric — Vox Jot on Apple Silicon

Use this document to evaluate any new model for Vox Jot integration in under
two minutes. Fill out the **triage manifest** (JSON template below), then run
the **scoring rubric** to get a numeric Go / Maybe / Skip verdict.

---

## 1 — Triage Manifest Template

Copy this JSON, fill in the fields, and save it as
`docs/model-evals/<model-id>.json`. The field names mirror Vox Jot's existing
`ProviderDescriptor` / `CatalogModelDescriptor` / `CapabilityFlags` shapes in
`model_platform.rs` so the manifest can later be consumed programmatically.

```json
{
  "$schema": "model-porting-rubric",
  "evaluated_at": "2026-04-12",
  "evaluator": "",

  "source": {
    "url": "",
    "repo_url": "",
    "paper_url": "",
    "license": "",
    "license_allows_commercial": null,
    "license_allows_redistribution": null
  },

  "identity": {
    "model_id": "",
    "label": "",
    "description": "",
    "domain": "stt | tts | llm",
    "parameter_count": "",
    "model_format": "pytorch | safetensors | gguf | onnx | coreml | mlx | other",
    "dtype": "float32 | float16 | bfloat16 | int8 | int4"
  },

  "mac_readiness": {
    "mlx_version_exists": null,
    "mlx_community_repo": "",
    "gguf_or_metal_support": null,
    "onnx_export_available": null,
    "coreml_conversion_tested": null,
    "mps_backend_works": null,
    "cuda_only": null,
    "tensorrt_required": null,
    "known_mac_forks": [],
    "community_discussion_links": []
  },

  "runtime_fit": {
    "lane": "mlx | metal_gguf | coreml | sidecar | reject",
    "can_run_as_local_process": null,
    "api_surface": [],
    "output_format": "text | tokens | wav | pcm",
    "supports_streaming": null,
    "cold_start_estimate_sec": null,
    "vram_estimate_gb": null,
    "disk_size_mb": null
  },

  "capabilities": {
    "downloadable": true,
    "loadable": null,
    "local_only": true,
    "supports_translation": null,
    "supports_streaming": null,
    "supports_voice_cloning": null,
    "supports_instruction_prompt": null,
    "supports_inline_tags": null
  },

  "languages": [],

  "packaging": {
    "can_use_archive_plus_runtime": null,
    "archive_format": "tar.gz | zip | hf_snapshot",
    "estimated_download_mb": null,
    "requires_python_sidecar": null,
    "requires_custom_runtime": null
  },

  "benchmark": {
    "tested_on_hardware": "",
    "cold_start_sec": null,
    "warm_start_sec": null,
    "peak_memory_gb": null,
    "sample_rtf": null,
    "output_quality_notes": ""
  },

  "verdict": {
    "score": null,
    "decision": "ship | ship_experimental | prototype | skip",
    "blockers": [],
    "notes": ""
  }
}
```

---

## 2 — Scoring Rubric

Score each dimension 0–3, multiply by the weight, and sum. The total tells you
the decision lane.

| #   | Dimension             | Weight | 0 (Blocker)                    | 1 (Weak)                         | 2 (Workable)                             | 3 (Ideal)                               |
| --- | --------------------- | ------ | ------------------------------ | -------------------------------- | ---------------------------------------- | --------------------------------------- |
| 1   | **License**           | ×4     | Non-commercial or unknown      | Copyleft (GPL, AGPL)             | Permissive with conditions (CC-BY, LGPL) | Fully permissive (Apache-2.0, MIT, BSD) |
| 2   | **Mac runtime lane**  | ×4     | CUDA-only, no Mac path         | PyTorch + MPS hacks only         | GGUF / Metal or ONNX available           | MLX version or native Core ML           |
| 3   | **Domain fit**        | ×3     | Unrelated to STT / TTS / LLM   | Adjacent (e.g. audio classifier) | Covers a domain gap Vox Jot has          | Direct drop-in for existing domain      |
| 4   | **Resource budget**   | ×3     | >16 GB VRAM or >30s cold start | 8–16 GB, 10–30s cold start       | 4–8 GB, 3–10s cold start                 | <4 GB, <3s cold start                   |
| 5   | **Packaging ease**    | ×2     | Requires embedded CUDA runtime | Needs custom sidecar build       | Runtime archive + model archive          | Single downloadable asset               |
| 6   | **Streaming support** | ×1     | No streaming, batch only       | Chunk-level streaming            | Token/frame streaming                    | Real-time streaming with low RTF        |
| 7   | **Language coverage** | ×1     | Single language, not en        | English only                     | 5–15 languages                           | 15+ languages or fills a gap            |
| 8   | **Community health**  | ×1     | Abandoned / no issues          | Low activity, few contributors   | Active repo, some Mac discussion         | Active Mac community + MLX ports        |
| 9   | **Voice cloning**     | ×1     | N/A or unsupported             | Basic cloning, poor quality      | Good zero-shot cloning                   | Cloning + style control                 |

### Maximum possible score: 60

| Score range | Decision              | Meaning                                                                 |
| ----------- | --------------------- | ----------------------------------------------------------------------- |
| **45–60**   | **Ship**              | MLX/Metal ready, good fit. Add as a first-class provider.               |
| **30–44**   | **Ship experimental** | Usable via sidecar or community port. Ship behind Labs toggle.          |
| **18–29**   | **Prototype**         | Interesting but needs conversion work. Build a spike, don't ship.       |
| **0–17**    | **Skip**              | Blocked on license, runtime, or relevance. Revisit when status changes. |

---

## 3 — Quick-pass checklist (2-minute version)

Run this in order. Stop at the first **STOP** result.

```
1. License?
   □ Apache-2.0 / MIT / BSD        → continue
   □ Unknown or non-commercial     → STOP: skip

2. Domain?
   □ STT, TTS, or LLM              → continue
   □ Unrelated                     → STOP: skip

3. MLX or GGUF version exists?
   □ Yes, on HF or GitHub          → fast-track to scoring
   □ No, but ONNX / CoreML viable  → continue
   □ No, CUDA-only                 → STOP: skip (revisit quarterly)

4. Fits in ≤8 GB memory?
   □ Yes                           → continue
   □ No, but quantized version <8  → continue with quantized
   □ No path to <8 GB              → STOP: skip

5. Can output text / wav / PCM via simple API?
   □ Yes                           → continue
   □ Needs deep engine embedding   → STOP: prototype only
```

If all five pass → fill out the full manifest and score it.

---

## 4 — Vox Jot integration lanes

Once a model scores ≥30, slot it into the right integration pattern:

### Lane A — MLX native (best case)

Matches: `TtsEngineKind::MlxNative`, `EngineType::MlxAudioStt`

- Model runs inside the shared mlx-audio sidecar
- No custom runtime packaging — mlx-audio handles download + caching
- Provider registration via the runtime catalog API
- Voice cloning and style controls via `MlxAudioContext`

### Lane B — Metal / GGUF / ONNX (native Rust)

Matches: `EngineType::Whisper`, `EngineType::Parakeet`, `EngineType::Moonshine`, etc.

- Model ships as a downloadable archive (`.tar.gz` or `.bin`)
- Loaded directly in Rust via whisper-rs, ort, or similar binding
- Registered in `ModelManager::new()` with full `ModelInfo` definition
- Best for STT models with GGML/ONNX export

### Lane C — Sidecar process

Matches: `TtsEngineKind::Sidecar`, `SidecarBackend::LegacyPythonRuntime`

- Python or binary sidecar managed by `SidecarManager`
- Communicates over `http://127.0.0.1:8008` (health / warmup / synthesize)
- Runtime + model packaged as separate downloadable archives
- Good fallback when no native Rust binding exists

### Lane D — Experimental / Labs

- Behind the Labs feature toggle
- May require manual setup steps during local development only
- Must not be exposed as usable catalog functionality until the provider and model path are implemented, app-managed, and validated
- If validation fails, mark the model blocked/failed and keep it out of runnable surfaces instead of exposing a promise-only catalog row

---

## 5 — Example: VoxCPM2 scored

| #   | Dimension       | Raw | × Weight | Notes                                                                                               |
| --- | --------------- | --- | -------- | --------------------------------------------------------------------------------------------------- |
| 1   | License         | 3   | 12       | Apache-2.0                                                                                          |
| 2   | Mac runtime     | 0   | 0        | CUDA 12 required, no MLX/Metal/ONNX path                                                            |
| 3   | Domain fit      | 3   | 9        | TTS — direct fit for Listen section                                                                 |
| 4   | Resource budget | 1   | 3        | ~8 GB VRAM, unknown cold start on Mac                                                               |
| 5   | Packaging       | 1   | 2        | Would need custom Python sidecar                                                                    |
| 6   | Streaming       | 2   | 2        | Has streaming API                                                                                   |
| 7   | Languages       | 3   | 3        | 30 languages                                                                                        |
| 8   | Community       | 2   | 2        | Active repo, no Mac discussion yet                                                                  |
| 9   | Voice cloning   | 3   | 3        | Cloning + style + voice design                                                                      |
|     | **Total**       |     | **36**   | **Ship experimental** — but blocked on Mac runtime (score 0). Revisit when MLX or MPS port appears. |

**Effective verdict: Prototype / wait.** The score of 36 says "ship
experimental," but the runtime dimension scoring 0 is a hard blocker. If
dimension 2 reaches ≥2, the total jumps to 44+ and it becomes a clear ship.

---

## 6 — File organization

```
docs/
└── model-evals/
    ├── voxcpm2.json          ← filled manifest
    ├── kokoro-mlx.json
    ├── parakeet-v3.json
    └── ...
```

Keep one JSON per model. The manifest doubles as documentation and can be
parsed by a future `scripts/score-model.ts` automation script.
