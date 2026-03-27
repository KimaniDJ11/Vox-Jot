from __future__ import annotations

import os
import platform
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class EngineSpec:
    provider_id: str
    model_id: str
    label: str
    description: str
    engine_family: str
    license_label: str | None
    model_dirs: tuple[str, ...]
    supported_languages: tuple[str, ...]
    supports_voice_cloning: bool
    supports_instruction_prompt: bool
    default_voice: str | None
    style_controls: tuple[dict, ...]


ENGINE_SPECS: tuple[EngineSpec, ...] = (
    EngineSpec(
        provider_id="openvoice",
        model_id="openvoice",
        label="OpenVoice",
        description="Flexible local voice cloning and multilingual speech generation.",
        engine_family="openvoice",
        license_label="MIT",
        model_dirs=("OpenVoice", "openvoice"),
        supported_languages=("mul",),
        supports_voice_cloning=True,
        supports_instruction_prompt=False,
        default_voice="default",
        style_controls=(
            {
                "id": "tempo_rate",
                "group": "tempo",
                "label": "Tempo",
                "description": "Speeds OpenVoice up or down for a tighter delivery fit.",
                "kind": "slider",
                "min": 0.5,
                "max": 2.0,
                "step": 0.05,
                "unit": "x",
            },
        ),
    ),
    EngineSpec(
        provider_id="chatterbox",
        model_id="chatterbox",
        label="Chatterbox",
        description="Expressive local neural voice model with conditioning controls.",
        engine_family="chatterbox",
        license_label="Apache-2.0",
        model_dirs=("chatterbox", "Chatterbox"),
        supported_languages=("en",),
        supports_voice_cloning=False,
        supports_instruction_prompt=False,
        default_voice=None,
        style_controls=(
            {
                "id": "guidance",
                "group": "guidance",
                "label": "Guidance",
                "description": "Controls how strongly Chatterbox follows its conditioning signal.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
            },
            {
                "id": "randomness",
                "group": "sampler",
                "label": "Randomness",
                "description": "Balances predictable versus more varied delivery.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
            },
            {
                "id": "exaggeration",
                "group": "style",
                "label": "Exaggeration",
                "description": "Pushes Chatterbox toward a more pronounced style.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
            },
            {
                "id": "repetition_penalty",
                "group": "guidance",
                "label": "Repetition Penalty",
                "description": "Discourages repeated words in longer reads.",
                "kind": "slider",
                "min": 1.0,
                "max": 3.0,
                "step": 0.1,
            },
        ),
    ),
    EngineSpec(
        provider_id="kokoro",
        model_id="kokoro-82m-v1.0",
        label="Kokoro 82M",
        description="Fast local speech model tuned for lightweight high-quality playback.",
        engine_family="kokoro",
        license_label="Apache-2.0",
        model_dirs=("Kokoro", "kokoro"),
        supported_languages=("mul",),
        supports_voice_cloning=False,
        supports_instruction_prompt=False,
        default_voice="af_heart",
        style_controls=(
            {
                "id": "tempo_rate",
                "group": "tempo",
                "label": "Tempo",
                "description": "Adjusts Kokoro playback speed for this preset.",
                "kind": "slider",
                "min": 0.5,
                "max": 2.0,
                "step": 0.05,
                "unit": "x",
            },
        ),
    ),
    EngineSpec(
        provider_id="xtts",
        model_id="xtts-v2",
        label="XTTS v2",
        description="Coqui XTTS multilingual local synthesis with voice cloning.",
        engine_family="xtts",
        license_label="Coqui Public Model License",
        model_dirs=("Coqui/XTTS", "coqui-tts", "XTTS"),
        supported_languages=("mul",),
        supports_voice_cloning=True,
        supports_instruction_prompt=False,
        default_voice=None,
        style_controls=(
            {
                "id": "randomness",
                "group": "sampler",
                "label": "Randomness",
                "description": "Balances stable reads with more expressive sampling.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
            },
            {
                "id": "repetition_penalty",
                "group": "guidance",
                "label": "Repetition Penalty",
                "description": "Discourages repeated tokens in longer generations.",
                "kind": "slider",
                "min": 1.0,
                "max": 3.0,
                "step": 0.1,
            },
        ),
    ),
    EngineSpec(
        provider_id="fish_speech",
        model_id="fish-speech-1.5",
        label="Fish Speech 1.5",
        description="Multilingual expressive local speech generation with voice cloning.",
        engine_family="fish_speech",
        license_label="Fish Audio Research License",
        model_dirs=("Fish Speech", "fish-speech"),
        supported_languages=("mul",),
        supports_voice_cloning=True,
        supports_instruction_prompt=False,
        default_voice=None,
        style_controls=(
            {
                "id": "randomness",
                "group": "sampler",
                "label": "Randomness",
                "description": "Controls how stable or adventurous Fish Speech sounds.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
            },
            {
                "id": "repetition_penalty",
                "group": "guidance",
                "label": "Repetition Penalty",
                "description": "Helps reduce repeated words or loops in longer reads.",
                "kind": "slider",
                "min": 1.0,
                "max": 2.0,
                "step": 0.05,
            },
        ),
    ),
)


def current_platform() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "darwin"
    if system == "windows":
        return "windows"
    if system == "linux":
        return "linux"
    return system


@dataclass(frozen=True)
class RuntimeConfig:
    model_store: Path
    state_dir: Path
    profiles_dir: Path | None
    listen_host: str
    listen_port: int


def load_runtime_config() -> RuntimeConfig:
    model_store = Path(
        os.environ.get(
            "SPEECH_MODEL_STORE",
            str(Path.home() / "Apps" / "Models" / "TTS"),
        )
    ).expanduser()
    state_dir = Path(
        os.environ.get(
            "SPEECH_RUNTIME_STATE_DIR",
            str(model_store / ".vox-jot-runtime"),
        )
    ).expanduser()
    profiles_env = os.environ.get("SPEECH_VOICE_PROFILES_DIR")
    profiles_dir = Path(profiles_env).expanduser() if profiles_env else None
    listen_port = int(os.environ.get("SPEECH_RUNTIME_PORT", "8008"))
    return RuntimeConfig(
        model_store=model_store,
        state_dir=state_dir,
        profiles_dir=profiles_dir,
        listen_host="127.0.0.1",
        listen_port=listen_port,
    )
