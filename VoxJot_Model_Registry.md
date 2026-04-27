# Vox Jot Model Registry

This registry tracks models evaluated for integration into Vox Jot, according to the `docs/model-porting-rubric.md`.

| Model Name | Score | Verdict | Domain | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **VibeVoice Realtime 0.5B** | 40/60 | `ship_experimental` | TTS | MPS supported but requires a Python sidecar until native MLX/ONNX/GGUF ports are published. Fast inference, standard PyTorch stack. |
| **Liquid LFM2-1.2B-Tool-GGUF** | 43/60 | `ship_experimental` | LLM | Lightweight (1.2B) model optimized for tool calling. Native GGUF via llama.cpp. Very fast, small VRAM footprint. |
| **Liquid LFM2.5-Audio-1.5B-GGUF** | 43/60 | `ship_experimental` | STT / TTS | Native GGUF file available, but current execution requires a custom fork of llama.cpp (PR #18641) for audio runners. |
