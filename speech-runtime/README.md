## Vox Jot Speech Runtime

This bundle is the managed local runtime used by Vox Jot for Python-based TTS
engines such as OpenVoice, Chatterbox, Kokoro, and XTTS.

The runtime exposes:

- `GET /health`
- `GET /listen/catalog`
- `POST /listen/selection`
- `POST /v1/audio/speech`

Model weights and source repos are discovered from `SPEECH_MODEL_STORE`.
Runtime state is stored under `SPEECH_RUNTIME_STATE_DIR`.

The runtime is intentionally split into:

- a lightweight coordinator environment shipped with the app bundle
- per-engine environments created automatically on first use

That keeps the base runtime asset small while still allowing Vox Jot to install
and run heavyweight Python TTS engines without extra user setup.
