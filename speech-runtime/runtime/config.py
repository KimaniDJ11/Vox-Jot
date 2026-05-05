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
    supports_inline_tags: bool
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
        supported_languages=("en", "es", "fr", "zh", "ja", "ko"),
        supports_voice_cloning=True,
        supports_instruction_prompt=False,
        supports_inline_tags=False,
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
                "default": 1.0,
            },
            {
                "id": "sdp_ratio",
                "group": "style",
                "label": "SDP Ratio",
                "description": "Balances deterministic and stochastic duration prediction in the base voice.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.2,
            },
            {
                "id": "noise_scale",
                "group": "sampler",
                "label": "Noise Scale",
                "description": "Controls base voice acoustic variation before tone conversion.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.6,
            },
            {
                "id": "noise_scale_w",
                "group": "sampler",
                "label": "Duration Noise",
                "description": "Controls stochastic duration variation in the base voice.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.8,
            },
            {
                "id": "tau",
                "group": "style",
                "label": "Tone Blend",
                "description": "Adjusts OpenVoice tone-color conversion strength for cloned voices.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.3,
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
        supports_inline_tags=False,
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
                "default": 0.5,
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
                "default": 0.8,
            },
            {
                "id": "exaggeration",
                "group": "style",
                "label": "Exaggeration",
                "description": "Pushes Chatterbox toward a more pronounced style.",
                "kind": "slider",
                "min": 0.25,
                "max": 2.0,
                "step": 0.05,
                "default": 0.5,
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
                "default": 1.2,
            },
            {
                "id": "top_p",
                "group": "sampler",
                "label": "Top P",
                "description": "Limits sampling to the most likely speech tokens.",
                "kind": "slider",
                "min": 0.5,
                "max": 1.0,
                "step": 0.05,
                "default": 0.95,
            },
            {
                "id": "min_p",
                "group": "sampler",
                "label": "Min P",
                "description": "Filters very unlikely speech tokens while keeping expressive options open.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.01,
                "default": 0.05,
            },
        ),
    ),
    EngineSpec(
        provider_id="chatterbox",
        model_id="chatterbox-turbo",
        label="Chatterbox Turbo",
        description="Lower-latency Chatterbox voice cloning with native paralinguistic tags.",
        engine_family="chatterbox",
        license_label="MIT",
        model_dirs=(
            "chatterbox-turbo/chatterbox-turbo",
            "chatterbox-turbo",
            "Chatterbox-Turbo",
        ),
        supported_languages=("en",),
        supports_voice_cloning=True,
        supports_instruction_prompt=False,
        supports_inline_tags=True,
        default_voice=None,
        style_controls=(
            {
                "id": "guidance",
                "group": "guidance",
                "label": "Guidance",
                "description": "Controls how strongly Chatterbox Turbo follows its conditioning signal.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.5,
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
                "default": 0.8,
            },
            {
                "id": "exaggeration",
                "group": "style",
                "label": "Exaggeration",
                "description": "Pushes Chatterbox Turbo toward a more pronounced style.",
                "kind": "slider",
                "min": 0.25,
                "max": 2.0,
                "step": 0.05,
                "default": 0.5,
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
                "default": 1.2,
            },
            {
                "id": "top_p",
                "group": "sampler",
                "label": "Top P",
                "description": "Limits sampling to the most likely speech tokens.",
                "kind": "slider",
                "min": 0.5,
                "max": 1.0,
                "step": 0.05,
                "default": 0.95,
            },
            {
                "id": "min_p",
                "group": "sampler",
                "label": "Min P",
                "description": "Filters very unlikely speech tokens while keeping expressive options open.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.01,
                "default": 0.05,
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
        supported_languages=("en", "es", "fr", "hi", "it", "pt", "ja", "zh"),
        supports_voice_cloning=False,
        supports_instruction_prompt=False,
        supports_inline_tags=False,
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
                "default": 1.0,
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
        supported_languages=(
            "en",
            "es",
            "fr",
            "de",
            "it",
            "pt",
            "pl",
            "tr",
            "ru",
            "nl",
            "cs",
            "ar",
            "zh-cn",
            "hu",
            "ko",
            "ja",
            "hi",
        ),
        supports_voice_cloning=True,
        supports_instruction_prompt=False,
        supports_inline_tags=False,
        default_voice=None,
        style_controls=(
            {
                "id": "tempo_rate",
                "group": "tempo",
                "label": "Tempo",
                "description": "Adjusts XTTS delivery speed for this preset.",
                "kind": "slider",
                "min": 0.5,
                "max": 2.0,
                "step": 0.05,
                "unit": "x",
                "default": 1.0,
            },
            {
                "id": "randomness",
                "group": "sampler",
                "label": "Randomness",
                "description": "Balances stable reads with more expressive sampling.",
                "kind": "slider",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.65,
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
                "default": 2.0,
            },
            {
                "id": "top_p",
                "group": "sampler",
                "label": "Top P",
                "description": "Keeps XTTS sampling inside the most likely token mass.",
                "kind": "slider",
                "min": 0.5,
                "max": 1.0,
                "step": 0.05,
                "default": 0.8,
            },
            {
                "id": "top_k",
                "group": "sampler",
                "label": "Top K",
                "description": "Caps how many candidate tokens XTTS can sample from.",
                "kind": "slider",
                "min": 1.0,
                "max": 100.0,
                "step": 1.0,
                "default": 50.0,
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
