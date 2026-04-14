import argparse
import dataclasses
import inspect
import json
import math
import os
import sys
import traceback
from pathlib import Path

import numpy as np

from mlx_audio.audio_io import write as audio_write
from mlx_audio.tts.generate import load_audio
from mlx_audio.utils import load_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate local MLX audio without the HTTP sidecar."
    )
    parser.add_argument("--model", required=True, help="Local model path or repo id")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--output", required=True, help="Output wav path")
    parser.add_argument("--voice", default=None)
    parser.add_argument("--instruct", default=None)
    parser.add_argument("--lang-code", default="en")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--repetition-penalty", type=float, default=1.0)
    parser.add_argument("--ref-audio", default=None)
    parser.add_argument("--ref-text", default=None)
    parser.add_argument("--max-tokens", type=int, default=1200)
    return parser.parse_args()


def load_model_config(model_source: str) -> dict:
    config_path = Path(model_source).expanduser() / "config.json"
    if not config_path.exists():
        return {}
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def detect_model_type(model, model_source: str) -> str | None:
    model_type = getattr(model, "model_type", None)
    if callable(model_type):
        try:
            model_type = model_type()
        except Exception:
            model_type = None
    if isinstance(model_type, str) and model_type.strip():
        return model_type

    config = load_model_config(model_source)
    config_model_type = config.get("model_type")
    if isinstance(config_model_type, str) and config_model_type.strip():
        return config_model_type

    return None


def bundled_csm_prompt() -> tuple[str, str] | None:
    base_dir = Path(__file__).resolve().parent
    prompt_audio = base_dir / "mlx_csm_default_prompt.wav"
    prompt_text = base_dir / "mlx_csm_default_prompt.txt"
    if not prompt_audio.exists() or not prompt_text.exists():
        return None
    return str(prompt_audio), prompt_text.read_text(encoding="utf-8").strip()


def normalize_generation_results(result):
    if hasattr(result, "audio") and hasattr(result, "sample_rate"):
        return [result]
    return result


def display_model_name(model_name: str) -> str:
    if "bark" in model_name:
        return "Bark"
    if "fish-audio-s2-pro" in model_name:
        return "Fish Audio S2 Pro"
    if "lfm2.5-audio" in model_name or "lfm2-5-audio" in model_name:
        return "LFM2.5 Audio"
    if "pocket-tts" in model_name:
        return "Pocket TTS"
    if "outetts" in model_name:
        return "OuteTTS"
    if "spark" in model_name:
        return "Spark TTS"
    if "chatterbox" in model_name:
        return "MLX Chatterbox"
    if "voxcpm2" in model_name:
        return "VoxCPM2"
    if "qwen3-tts-12hz-1.7b-base" in model_name or "qwen3-tts-1.7b-base" in model_name:
        return "Qwen3 TTS 1.7B Base"
    if "qwen3-tts-1.7b" in model_name:
        return "Qwen3 TTS 1.7B"
    if "qwen3-tts-12hz-0.6b-base-4bit" in model_name or "qwen3-tts-0.6b-base-4bit" in model_name:
        return "Qwen3 TTS 0.6B 4-bit"
    if "qwen3-tts-0.6b" in model_name:
        return "Qwen3 TTS 0.6B"
    return Path(model_name).name or "the selected MLX model"


def load_reference_audio(model, model_type: str | None, ref_audio_path: str):
    if not os.path.exists(ref_audio_path):
        raise FileNotFoundError(f"Reference audio file not found: {ref_audio_path}")
    return load_audio(
        ref_audio_path,
        sample_rate=model.sample_rate,
        volume_normalize=model_type == "spark",
    )


def _model_wants_ref_audio_path(model) -> bool:
    """Spark's generate() expects ref_audio as a file Path, not a loaded array."""
    sig = inspect.signature(model.generate)
    param = sig.parameters.get("ref_audio")
    if param is None:
        return False
    ann = param.annotation
    if ann is inspect.Parameter.empty:
        return False
    ann_str = str(ann) if not isinstance(ann, str) else ann
    return "Path" in ann_str


def build_generation_kwargs(
    model,
    args: argparse.Namespace,
    ref_audio,
    ref_text: str | None,
    ref_audio_path: str | None = None,
) -> dict[str, object]:
    # Some models (e.g. Spark) expect ref_audio as a file path rather than a
    # pre-loaded audio array.  Use the raw path when the signature type hint
    # includes ``Path``.
    effective_ref_audio = ref_audio
    if ref_audio is not None and ref_audio_path and _model_wants_ref_audio_path(model):
        effective_ref_audio = ref_audio_path

    raw_kwargs = {
        "voice": args.voice,
        "speed": args.speed,
        "lang_code": args.lang_code,
        "instruct": args.instruct,
        "ref_audio": effective_ref_audio,
        "ref_text": ref_text,
        "temperature": args.temperature,
        "repetition_penalty": args.repetition_penalty,
        "max_tokens": args.max_tokens,
        "stream": False,
        "verbose": False,
    }
    signature = inspect.signature(model.generate)
    return {
        key: value
        for key, value in raw_kwargs.items()
        if value is not None and key in signature.parameters
    }


def generate_audio(model, text: str, kwargs: dict[str, object]):
    audio_chunks = []
    sample_rate = None
    for result in normalize_generation_results(model.generate(text, **kwargs)):
        audio_chunks.append(np.array(result.audio))
        if sample_rate is None:
            sample_rate = result.sample_rate
    if not audio_chunks:
        raise ValueError("No audio generated")
    return np.concatenate(audio_chunks, axis=0), sample_rate


def is_empty_generation_error(exc: BaseException) -> bool:
    text = str(exc)
    return "No audio generated" in text or "[concatenate] No arrays provided" in text


def supports_conditioning_retry(model_type: str | None, model_name: str) -> bool:
    return model_type == "spark" or "spark" in model_name or "chatterbox" in model_name


def conditioning_retry_message(model_name: str) -> str:
    label = display_model_name(model_name)
    return (
        f"{label} still returned no audio after applying a bundled conditioning prompt. "
        "Try selecting a voice clone reference, a different voice, or a different MLX model."
    )


def describe_bridge_error(
    exc: BaseException,
    model_name: str,
    used_conditioning_retry: bool,
) -> str:
    lower = str(exc).lower()
    label = display_model_name(model_name)

    if "outetts" in model_name and is_empty_generation_error(exc):
        return (
            "OuteTTS generated no decodable audio tokens. "
            "This is a known upstream mlx-audio compatibility issue for this checkpoint."
        )

    if "qwen3-tts-1.7b" in model_name:
        if "out of memory" in lower or "insufficient memory" in lower:
            return (
                "Qwen3 TTS 1.7B likely ran out of memory while generating audio. "
                "Close other apps, try a shorter preview, or switch to Qwen3 TTS 0.6B."
            )
        if is_empty_generation_error(exc):
            return (
                "Qwen3 TTS 1.7B returned no audio. "
                "This VoiceDesign checkpoint is more demanding than 0.6B; "
                "try a shorter preview or switch models."
            )

    if supports_conditioning_retry(None, model_name) and is_empty_generation_error(exc):
        if used_conditioning_retry:
            return conditioning_retry_message(model_name)
        return (
            f"{label} returned no audio. "
            "This checkpoint may need conditioning audio or a different voice selection."
        )

    if is_empty_generation_error(exc):
        return f"{label} returned no audio."

    return str(exc)


def _filter_dataclass_kwargs(values: dict, data_class):
    allowed = {field.name for field in dataclasses.fields(data_class)}
    return {key: value for key, value in values.items() if key in allowed}


def load_voxcpm2_model(model_source: str):
    import mlx.core as mx
    import mlx.nn as nn
    import mlx_audio.tts.models.voxcpm.config as cfgmod
    import mlx_audio.tts.models.voxcpm.minicpm as minicpm
    import mlx_audio.tts.models.voxcpm.voxcpm as voxcpm_mod
    from mlx_audio.tts.models.voxcpm import Model, ModelArgs
    from mlx_audio.tts.models.voxcpm.config import (
        AudioVAEConfig,
        CFMConfig,
        DiTConfig,
        EncoderConfig,
    )
    from mlx_audio.utils import apply_quantization, load_weights

    class CompatibleLMConfig(cfgmod.LMConfig):
        def __init__(self, kv_channels=None, **kwargs):
            super().__init__(**kwargs)
            self.kv_channels = kv_channels or (
                self.hidden_size // self.num_attention_heads
            )

    def patched_attention_init(self, config):
        nn.Module.__init__(self)
        self.num_heads = config.num_attention_heads
        self.num_kv_heads = config.num_key_value_heads
        self.head_dim = getattr(
            config,
            "kv_channels",
            config.hidden_size // self.num_heads,
        )
        self.q_proj = nn.Linear(
            config.hidden_size, self.num_heads * self.head_dim, bias=False
        )
        self.k_proj = nn.Linear(
            config.hidden_size, self.num_kv_heads * self.head_dim, bias=False
        )
        self.v_proj = nn.Linear(
            config.hidden_size, self.num_kv_heads * self.head_dim, bias=False
        )
        self.o_proj = nn.Linear(
            self.num_heads * self.head_dim, config.hidden_size, bias=False
        )

    def patched_rope_init(self, config):
        nn.Module.__init__(self)
        self.config = config
        self.dim = getattr(
            config,
            "kv_channels",
            config.hidden_size // config.num_attention_heads,
        )
        self.base = config.rope_theta
        self.max_position_embeddings = config.max_position_embeddings
        self.original_max_position_embeddings = config.original_max_position_embeddings
        self.short_factor = mx.array(config.rope_short_factor)
        self.long_factor = mx.array(config.rope_long_factor)
        scale = self.max_position_embeddings / self.original_max_position_embeddings
        self.scaling_factor = math.sqrt(
            1
            + math.log(max(scale, 1.0))
            / math.log(self.original_max_position_embeddings)
        )
        half_dim = self.dim // 2
        exponents = mx.arange(0, half_dim, dtype=mx.float32) / half_dim
        self.inv_freq = 1.0 / (self.base**exponents)

    cfgmod.LMConfig = CompatibleLMConfig
    voxcpm_mod.LMConfig = CompatibleLMConfig
    minicpm.LMConfig = CompatibleLMConfig
    minicpm.Attention.__init__ = patched_attention_init
    minicpm.MiniCPMLongRoPE.__init__ = patched_rope_init

    config = load_model_config(model_source)
    lm_config = config.get("lm_config", {}).copy()
    if "rope_scaling" in lm_config:
        rope_scaling = lm_config.pop("rope_scaling")
        lm_config["rope_scaling_type"] = rope_scaling.get("type", "longrope")
        lm_config["rope_long_factor"] = rope_scaling.get("long_factor", [])
        lm_config["rope_short_factor"] = rope_scaling.get("short_factor", [])
        lm_config["original_max_position_embeddings"] = rope_scaling.get(
            "original_max_position_embeddings",
            32768,
        )

    dit_config = config.get("dit_config", {}).copy()
    dit_config["cfm_config"] = CFMConfig(
        **_filter_dataclass_kwargs(dit_config.get("cfm_config", {}), CFMConfig)
    )

    model_path = Path(model_source).expanduser()
    args = ModelArgs(
        lm_config=CompatibleLMConfig(**lm_config),
        encoder_config=EncoderConfig(
            **_filter_dataclass_kwargs(config.get("encoder_config", {}), EncoderConfig)
        ),
        dit_config=DiTConfig(**_filter_dataclass_kwargs(dit_config, DiTConfig)),
        audio_vae_config=AudioVAEConfig(
            **_filter_dataclass_kwargs(config.get("audio_vae_config", {}), AudioVAEConfig)
        ),
        patch_size=config.get("patch_size", 4),
        feat_dim=config.get("feat_dim", 64),
        scalar_quantization_latent_dim=config.get(
            "scalar_quantization_latent_dim", 256
        ),
        scalar_quantization_scale=config.get("scalar_quantization_scale", 9),
        residual_lm_num_layers=config.get("residual_lm_num_layers", 8),
        max_length=config.get("max_length", 8192),
        model_path=str(model_path),
    )

    model = Model(args)
    weights = load_weights(model_path)
    if hasattr(model, "sanitize"):
        weights = model.sanitize(weights)
    apply_quantization(model, config, weights, getattr(model, "model_quant_predicate", None))
    model.load_weights(list(weights.items()), strict=False)
    mx.eval(model.parameters())
    model.eval()
    return Model.post_load_hook(model, model_path)


def generate_voxcpm2_audio(args: argparse.Namespace):
    if args.ref_audio and not args.ref_text:
        raise ValueError("VoxCPM2 voice cloning needs both reference audio and reference text.")

    model = load_voxcpm2_model(args.model)
    kwargs = {
        "max_tokens": args.max_tokens,
        "ref_audio": args.ref_audio,
        "ref_text": args.ref_text,
    }
    audio, sample_rate = generate_audio(model, args.text, kwargs)
    return audio, sample_rate


def generate_lfm_audio(args: argparse.Namespace):
    import mlx.core as mx
    from mlx_audio.sts.models.lfm_audio import (
        ChatState,
        LFM2AudioModel,
        LFM2AudioProcessor,
        LFMModality,
    )
    from mlx_audio.sts.models.lfm_audio.model import AUDIO_EOS_TOKEN

    model = LFM2AudioModel.from_pretrained(args.model)
    processor = LFM2AudioProcessor.from_pretrained(args.model)

    system_prompt = "Perform TTS."
    if args.instruct and args.instruct.strip():
        system_prompt = f"{system_prompt} {args.instruct.strip()}"

    chat = ChatState(processor)
    chat.new_turn("system")
    chat.add_text(system_prompt)
    chat.end_turn()
    chat.new_turn("user")
    chat.add_text(args.text)
    chat.end_turn()
    chat.new_turn("assistant")

    audio_codes = []
    for token, modality in model.generate_sequential(
        **dict(chat),
        max_new_tokens=args.max_tokens,
        temperature=args.temperature,
    ):
        mx.eval(token)
        if modality != LFMModality.AUDIO_OUT:
            continue
        if token[0].item() == AUDIO_EOS_TOKEN:
            break
        audio_codes.append(token)

    if not audio_codes:
        raise ValueError("LFM2.5 Audio returned no audio frames.")

    audio_codes = mx.stack(audio_codes, axis=0)[None, :].transpose(0, 2, 1)
    waveform = processor.decode_audio(audio_codes)
    return np.array(waveform[0]), model.sample_rate


def repair_wav_riff_header(path: str) -> None:
    with open(path, "r+b") as handle:
        handle.seek(0, os.SEEK_END)
        file_size = handle.tell()
        if file_size < 8:
            return
        handle.seek(0)
        if handle.read(4) != b"RIFF":
            return
        expected_riff_size = file_size - 8
        handle.write(expected_riff_size.to_bytes(4, "little"))


def main() -> int:
    args = parse_args()

    try:
        model_name = Path(args.model).name.lower()
        config = load_model_config(args.model)
        model_type = config.get("model_type")
        used_conditioning_retry = False

        if model_type == "lfm_audio":
            audio, sample_rate = generate_lfm_audio(args)
        elif model_type == "voxcpm2":
            audio, sample_rate = generate_voxcpm2_audio(args)
        else:
            model = load_model(args.model)
            model_type = detect_model_type(model, args.model)

            ref_audio = None
            ref_text = args.ref_text
            ref_audio_path = args.ref_audio
            if model_type == "sesame" and not ref_audio_path:
                fallback_prompt = bundled_csm_prompt()
                if fallback_prompt is None:
                    raise RuntimeError(
                        "CSM requires a reference prompt, and the bundled Vox Jot fallback prompt is missing."
                    )
                ref_audio_path, ref_text = fallback_prompt

            if args.ref_audio:
                if not os.path.exists(args.ref_audio):
                    raise FileNotFoundError(
                        f"Reference audio file not found: {args.ref_audio}"
                    )
            if ref_audio_path:
                ref_audio = load_reference_audio(model, model_type, ref_audio_path)

            kwargs = build_generation_kwargs(model, args, ref_audio, ref_text, ref_audio_path)
            try:
                audio, sample_rate = generate_audio(model, args.text, kwargs)
            except Exception as exc:
                should_retry = (
                    not ref_audio_path
                    and is_empty_generation_error(exc)
                    and supports_conditioning_retry(model_type, model_name)
                )
                if not should_retry:
                    raise

                fallback_prompt = bundled_csm_prompt()
                if fallback_prompt is None:
                    raise RuntimeError(
                        f"{display_model_name(model_name)} needs conditioning audio, and the bundled fallback prompt is missing."
                    ) from exc

                used_conditioning_retry = True
                retry_audio_path, retry_text = fallback_prompt
                retry_audio = load_reference_audio(model, model_type, retry_audio_path)
                retry_kwargs = build_generation_kwargs(
                    model,
                    args,
                    retry_audio,
                    retry_text,
                    retry_audio_path,
                )
                try:
                    audio, sample_rate = generate_audio(model, args.text, retry_kwargs)
                except Exception as retry_exc:
                    raise RuntimeError(conditioning_retry_message(model_name)) from retry_exc

        output_dir = os.path.dirname(args.output)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        audio_write(args.output, audio, sample_rate, format="wav")
        repair_wav_riff_header(args.output)
        print(args.output)
        return 0
    except Exception as exc:
        model_name = Path(args.model).name.lower()
        detail = describe_bridge_error(exc, model_name, locals().get("used_conditioning_retry", False))
        print(f"MLX bridge failed: {detail}", file=sys.stderr)
        if os.environ.get("VOX_JOT_DEBUG_MLX_AUDIO") == "1":
            traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
