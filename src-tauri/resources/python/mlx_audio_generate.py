import argparse
import dataclasses
import inspect
import json
import math
import os
import sys
import traceback
import types
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
    parser.add_argument("--top-p", type=float, default=None)
    parser.add_argument("--top-k", type=int, default=None)
    parser.add_argument("--min-p", type=float, default=None)
    parser.add_argument("--cfg-weight", type=float, default=None)
    parser.add_argument("--exaggeration", type=float, default=None)
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


def voxcpm2_output_sample_rate_from_config(model_source: str) -> int | None:
    """
    VoxCPM2 uses AudioVAE v2: encode at 16kHz, decode to ``out_sample_rate`` (typically 48kHz).
    mlx-audio 0.4.x still reports ``GenerationResult.sample_rate`` from the encoder rate; writing
    WAVs with that value makes playback sound garbled. Prefer ``out_sample_rate`` from config.
    """
    av = (load_model_config(model_source) or {}).get("audio_vae_config") or {}
    out_sr = av.get("out_sample_rate")
    if out_sr is not None:
        try:
            return int(out_sr)
        except (TypeError, ValueError):
            pass
    return None


def detect_model_type(model, model_source: str) -> str | None:
    """Best-effort ``model_type`` from the loaded module, else ``config.json``."""
    model_type = getattr(model, "model_type", None)
    if callable(model_type):
        try:
            model_type = model_type()
        except Exception:
            model_type = None
    if isinstance(model_type, str) and model_type.strip():
        return model_type.strip()

    config = load_model_config(model_source)
    config_model_type = config.get("model_type")
    if isinstance(config_model_type, str) and config_model_type.strip():
        return config_model_type.strip()

    return None


# VoiceDesign (e.g. Qwen3-TTS-*-VoiceDesign) requires non-empty ``instruct`` in mlx-audio.
VOICE_DESIGN_DEFAULT_INSTRUCT = (
    "A clear, natural adult voice with neutral tone and moderate pacing."
)


def effective_instruct_for_model(model, args: argparse.Namespace) -> str | None:
    """Return generation instruct, supplying a safe default for VoiceDesign when omitted."""
    raw = args.instruct
    if raw is not None and str(raw).strip():
        return str(raw).strip()
    config = getattr(model, "config", None)
    tts_model_type = getattr(config, "tts_model_type", None) if config is not None else None
    if tts_model_type == "voice_design":
        return VOICE_DESIGN_DEFAULT_INSTRUCT
    return None


def bundled_csm_prompt() -> tuple[str, str] | None:
    base_dir = Path(__file__).resolve().parent
    prompt_audio = base_dir / "mlx_csm_default_prompt.wav"
    prompt_text = base_dir / "mlx_csm_default_prompt.txt"
    if not prompt_audio.exists() or not prompt_text.exists():
        return None
    return str(prompt_audio), prompt_text.read_text(encoding="utf-8").strip()


def needs_bundled_conditioning_prompt(model_type: str | None, model_name: str) -> bool:
    model_type_normalized = (model_type or "").lower()
    return (
        model_type_normalized in {"sesame", "csm", "moss_tts_nano", "moss_tts", "indextts"}
        or "csm-1b" in model_name
        or "moss-tts" in model_name
        or "indextts" in model_name
        or "index-tts" in model_name
    )


def normalize_generation_results(result):
    if hasattr(result, "audio") and hasattr(result, "sample_rate"):
        return [result]
    return result


def patch_mlx_audio_load_config_for_indextts() -> None:
    """Inject ``tokenizer_name`` into IndexTTS configs at load time.

    The upstream IndexTTS ``ModelArgs`` dataclass requires ``tokenizer_name``,
    but the official ``mlx-community/IndexTTS-1.5`` snapshot omits this field
    from ``config.json``. Without the field, ``base_load_model`` fails with
    ``ModelArgs.__init__() missing 1 required positional argument: 'tokenizer_name'``.

    The Model constructor accepts either a HF repo id or a local directory
    containing ``tokenizer.model``; the snapshot ships ``tokenizer.model``
    alongside ``config.json``, so we default to the model_path.
    """
    from mlx_audio import utils as mlx_audio_utils

    original_load_config = mlx_audio_utils.load_config
    if getattr(original_load_config, "_vox_jot_indextts_patched", False):
        return

    def patched_load_config(model_path, **kwargs):
        config = original_load_config(model_path, **kwargs)
        try:
            model_type = (config.get("model_type") or "").lower()
        except AttributeError:
            return config
        if model_type == "indextts" and "tokenizer_name" not in config:
            config["tokenizer_name"] = str(model_path)
        return config

    patched_load_config._vox_jot_indextts_patched = True  # type: ignore[attr-defined]
    mlx_audio_utils.load_config = patched_load_config


def display_model_name(model_name: str) -> str:
    if "bark" in model_name:
        return "Bark"
    if "fish-audio-s2-pro" in model_name:
        return "Fish Audio S2 Pro"
    if "longcat-audiodit" in model_name:
        return "LongCat AudioDiT"
    if "soprano" in model_name:
        return "Soprano"
    if "melotts" in model_name or "melo-tts" in model_name:
        return "MeloTTS"
    if "higgs-audio" in model_name:
        return "Higgs Audio v2"
    if "moss-tts" in model_name:
        return "MOSS-TTS"
    if "irodori-tts" in model_name:
        return "Irodori TTS"
    if "indextts" in model_name or "index-tts" in model_name:
        return "IndexTTS"
    if "omnivoice" in model_name:
        return "OmniVoice"
    if "vibevoice" in model_name:
        return "VibeVoice"
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
    if "kugelaudio" in model_name or "kugel-audio" in model_name:
        return "KugelAudio"
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
        "instruct": effective_instruct_for_model(model, args),
        "ref_audio": effective_ref_audio,
        "ref_text": ref_text,
        "temperature": args.temperature,
        "repetition_penalty": args.repetition_penalty,
        "top_p": args.top_p,
        "top_k": args.top_k,
        "min_p": args.min_p,
        "cfg_weight": args.cfg_weight,
        "exaggeration": args.exaggeration,
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


def is_numeric_only_error(exc: BaseException) -> bool:
    text = str(exc).strip()
    if not text:
        return False
    try:
        float(text)
        return True
    except ValueError:
        return False


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

    if "spark" in model_name and is_numeric_only_error(exc):
        return (
            "Spark TTS surfaced an opaque sampler error from mlx-audio. "
            "This checkpoint is not usable with the current bridge/runtime build; "
            "switch to another MLX voice model for now."
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
    # Tokenizer load triggers a harmless HF "wrong architecture" warning for voxcpm2.
    try:
        from transformers import logging as hf_logging

        hf_logging.set_verbosity_error()
    except Exception:
        pass
    import mlx.core as mx
    import mlx.nn as nn
    import mlx_audio.tts.models.voxcpm.config as cfgmod
    import mlx_audio.tts.models.voxcpm.minicpm as minicpm
    import mlx_audio.tts.models.voxcpm.voxcpm as voxcpm_mod
    from mlx_audio.tts.models.voxcpm import Model, ModelArgs
    from mlx_audio.tts.models.voxcpm.config import CFMConfig
    from mlx_audio.utils import apply_quantization, load_weights

    class CompatibleLMConfig(cfgmod.LMConfig):
        def __init__(self, kv_channels=None, **kwargs):
            super().__init__(**kwargs)
            self.kv_channels = kv_channels or (
                self.hidden_size // self.num_attention_heads
            )

    @dataclasses.dataclass
    class CompatibleEncoderConfig:
        hidden_dim: int = 1024
        ffn_dim: int = 4096
        num_heads: int = 16
        num_layers: int = 8
        kv_channels: int | None = None

    @dataclasses.dataclass
    class CompatibleDiTConfig:
        hidden_dim: int = 1024
        ffn_dim: int = 4096
        num_heads: int = 16
        num_layers: int = 8
        kv_channels: int | None = None
        mean_mode: bool = False
        cfm_config: CFMConfig = dataclasses.field(default_factory=CFMConfig)

    @dataclasses.dataclass
    class CompatibleAudioVAEConfig:
        encoder_dim: int = 64
        encoder_rates: list[int] = dataclasses.field(
            default_factory=lambda: [2, 3, 6, 7, 7]
        )
        latent_dim: int = 64
        decoder_dim: int = 2048
        decoder_rates: list[int] = dataclasses.field(
            default_factory=lambda: [7, 7, 6, 3, 2]
        )
        sample_rate: int = 44100
        out_sample_rate: int | None = None
        sr_bin_boundaries: list[int] | None = None
        cond_type: str = "scale_bias"
        cond_dim: int = 128
        cond_out_layer: bool = False
        depthwise: bool = True
        use_noise_block: bool = False

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
        encoder_config=CompatibleEncoderConfig(
            **_filter_dataclass_kwargs(
                config.get("encoder_config", {}), CompatibleEncoderConfig
            )
        ),
        dit_config=CompatibleDiTConfig(
            **_filter_dataclass_kwargs(dit_config, CompatibleDiTConfig)
        ),
        audio_vae_config=CompatibleAudioVAEConfig(
            **_filter_dataclass_kwargs(
                config.get("audio_vae_config", {}), CompatibleAudioVAEConfig
            )
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
    if not hasattr(model, "fusion_concat_proj"):
        model.fusion_concat_proj = nn.Linear(
            args.lm_config.hidden_size * 2,
            args.lm_config.hidden_size,
        )
    weights = load_weights(model_path)
    if hasattr(model, "sanitize"):
        weights = model.sanitize(weights)
    apply_quantization(model, config, weights, getattr(model, "model_quant_predicate", None))
    model.load_weights(list(weights.items()), strict=False)
    mx.eval(model.parameters())
    model.eval()
    model = Model.post_load_hook(model, model_path)
    model.audio_start_token = 101
    model.audio_end_token = 102
    model.ref_audio_start_token = 103
    model.ref_audio_end_token = 104
    model._multichar_chinese_tokens = {
        token
        for token in getattr(model.tokenizer, "vocab", {}).keys()
        if len(token) >= 2 and all("\u4e00" <= ch <= "\u9fff" for ch in token)
    }
    model._encode_sample_rate = getattr(model.audio_vae, "sample_rate", args.audio_vae_config.sample_rate)
    model._decode_sample_rate = (
        args.audio_vae_config.out_sample_rate or model._encode_sample_rate
    )
    model._voxcpm2_mean_mode = bool(getattr(args.dit_config, "mean_mode", False))
    model._voxcpm2_residual_no_rope = bool(config.get("residual_lm_no_rope", False))
    return model


def voxcpm2_embed_text_instruction(text: str, instruct: str | None) -> str:
    if instruct is None:
        return text
    clean = instruct.strip()
    if not clean:
        return text
    clean = clean.replace("(", "").replace(")", "")
    return f"({clean}){text}"


def voxcpm2_tokenize(model, text: str) -> list[int]:
    tokens = model.tokenizer.tokenize(text)
    processed = []
    multichar_tokens = getattr(model, "_multichar_chinese_tokens", set())
    for token in tokens:
        clean = token.replace("▁", "")
        if clean in multichar_tokens:
            processed.extend(list(clean))
        else:
            processed.append(token)
    return model.tokenizer.convert_tokens_to_ids(processed)


def voxcpm2_patch_len(model) -> int:
    chunk = getattr(model, "chunk_size", None) or getattr(model.audio_vae, "chunk_size", None)
    if chunk is None:
        chunk = getattr(model.audio_vae, "hop_length")
    return int(model.patch_size) * int(chunk)


def voxcpm2_encode_audio_with_padding(model, audio, padding_mode: str):
    import mlx.core as mx

    patch_len = voxcpm2_patch_len(model)
    remainder = int(audio.shape[0]) % patch_len
    if remainder:
        padding = patch_len - remainder
        if padding_mode == "left":
            audio = mx.pad(audio, [(padding, 0)])
        else:
            audio = mx.pad(audio, [(0, padding)])

    audio_input = audio[None, None, :]
    sample_rate = getattr(model, "_encode_sample_rate", model.sample_rate)
    audio_feat = model.audio_vae.encode(audio_input, sample_rate).squeeze(0)
    audio_length = int(audio_feat.shape[0]) // int(model.patch_size)
    audio_feat = audio_feat[: audio_length * int(model.patch_size), :]
    return audio_feat.reshape(audio_length, int(model.patch_size), -1)


def voxcpm2_make_ref_prefix(model, ref_audio_feat):
    import mlx.core as mx

    ref_len = int(ref_audio_feat.shape[0])
    zeros_patch = mx.zeros((1, model.patch_size, model.feat_dim), dtype=mx.float32)
    tokens = mx.concatenate(
        [
            mx.array([model.ref_audio_start_token], dtype=mx.int32),
            mx.zeros(ref_len, dtype=mx.int32),
            mx.array([model.ref_audio_end_token], dtype=mx.int32),
        ]
    )
    feats = mx.concatenate([zeros_patch, ref_audio_feat, zeros_patch], axis=0)
    text_mask = mx.concatenate(
        [
            mx.array([1], dtype=mx.float32),
            mx.zeros(ref_len, dtype=mx.float32),
            mx.array([1], dtype=mx.float32),
        ]
    )
    audio_mask = mx.concatenate(
        [
            mx.array([0], dtype=mx.float32),
            mx.ones(ref_len, dtype=mx.float32),
            mx.array([0], dtype=mx.float32),
        ]
    )
    return tokens, feats, text_mask, audio_mask


def voxcpm2_run_minicpm(module, inputs_embeds, *, cache=None, is_causal=True, use_rope=True):
    import mlx.core as mx

    batch_size, seq_len, _ = inputs_embeds.shape
    offset = 0
    if cache is not None:
        offset = int(cache[0][0].shape[1])

    if use_rope:
        position_ids = mx.arange(offset, offset + seq_len).astype(mx.int32)
        cos, sin = module.rope(position_ids)
        cos = cos[None, :, :]
        sin = sin[None, :, :]
    else:
        head_dim = module.layers[0].self_attn.head_dim
        cos = mx.ones((1, seq_len, head_dim), dtype=inputs_embeds.dtype)
        sin = mx.zeros((1, seq_len, head_dim), dtype=inputs_embeds.dtype)

    mask = None
    if is_causal and seq_len > 1:
        causal_mask = mx.triu(mx.full((seq_len, seq_len), float("-inf")), k=1)
        mask = causal_mask[None, None, :, :]

    hidden = inputs_embeds
    new_caches = []
    for index, layer in enumerate(module.layers):
        layer_cache = cache[index] if cache is not None else None
        hidden, next_cache = layer(hidden, cos, sin, mask=mask, cache=layer_cache)
        new_caches.append(next_cache)

    return module.norm(hidden), new_caches


def voxcpm2_estimator_v2(estimator, x, mu, t, cond, dt):
    import mlx.core as mx

    x = estimator.in_proj(x.transpose(0, 2, 1))
    cond = estimator.cond_proj(cond.transpose(0, 2, 1))
    prefix = int(cond.shape[1])

    t_embed = estimator.time_mlp(estimator.time_embeddings(t))
    dt_embed = estimator.delta_time_mlp(estimator.time_embeddings(dt))
    time_token = (t_embed + dt_embed)[:, None, :]

    mu_tokens = mu.reshape(mu.shape[0], -1, x.shape[-1])
    hidden = mx.concatenate([mu_tokens, time_token, cond, x], axis=1)
    hidden, _ = estimator.decoder(inputs_embeds=hidden, is_causal=False)
    hidden = hidden[:, prefix + int(mu_tokens.shape[1]) + 1 :, :]
    hidden = estimator.out_proj(hidden)
    return hidden.transpose(0, 2, 1)


def voxcpm2_sample(model, mu, cond, *, inference_timesteps: int, cfg_value: float):
    import mlx.core as mx

    feat_decoder = model.feat_decoder
    batch = int(mu.shape[0])
    z = mx.random.normal((batch, feat_decoder.in_channels, model.patch_size))

    t_span = mx.linspace(1, 0, inference_timesteps + 1)
    sway_coef = 1.0
    t_span = t_span + sway_coef * (mx.cos(math.pi / 2 * t_span) - 1 + t_span)
    current = z
    timestep = t_span[0]
    delta = t_span[0] - t_span[1]
    zero_init_steps = max(1, int(len(t_span) * 0.04))
    mean_mode = bool(getattr(model, "_voxcpm2_mean_mode", False))

    for step in range(1, len(t_span)):
        if step <= zero_init_steps:
            derivative = mx.zeros_like(current)
        else:
            x_in = mx.concatenate([current, current], axis=0)
            mu_in = mx.concatenate([mu, mx.zeros_like(mu)], axis=0)
            t_val = mx.full((x_in.shape[0],), timestep)
            if mean_mode:
                dt_val = mx.full((x_in.shape[0],), delta)
            else:
                dt_val = mx.zeros((x_in.shape[0],))
            cond_in = mx.concatenate([cond, cond], axis=0)
            estimate = voxcpm2_estimator_v2(
                feat_decoder.estimator,
                x_in,
                mu_in,
                t_val,
                cond_in,
                dt_val,
            )
            chunk = int(current.shape[0])
            derivative = estimate[:chunk]
            unguided = estimate[chunk:]
            positive = derivative.reshape(chunk, -1)
            negative = unguided.reshape(chunk, -1)
            dot = mx.sum(positive * negative, axis=1, keepdims=True)
            norm = mx.sum(negative**2, axis=1, keepdims=True) + 1e-8
            scale = (dot / norm).reshape(chunk, 1, 1)
            derivative = unguided * scale + cfg_value * (derivative - unguided * scale)

        current = current - delta * derivative
        timestep = timestep - delta
        if step < len(t_span) - 1:
            delta = timestep - t_span[step + 1]

    return current


def generate_voxcpm2_official(
    model,
    *,
    target_text: str,
    reference_audio=None,
    prompt_audio=None,
    prompt_text: str | None = None,
    inference_timesteps: int = 10,
    cfg_value: float = 2.0,
    min_len: int = 2,
    max_len: int = 2000,
):
    import mlx.core as mx
    import mlx.nn as nn

    if prompt_audio is not None and prompt_text is None:
        raise ValueError("VoxCPM2 prompt audio needs prompt text.")

    if reference_audio is not None and prompt_audio is not None:
        text = f"{prompt_text or ''}{target_text}"
        text_token = mx.array(voxcpm2_tokenize(model, text), dtype=mx.int32)
        text_token = mx.concatenate([text_token, mx.array([model.audio_start_token], dtype=mx.int32)])
        text_length = int(text_token.shape[0])

        ref_feat = voxcpm2_encode_audio_with_padding(model, reference_audio, "right")
        prompt_feat = voxcpm2_encode_audio_with_padding(model, prompt_audio, "left")
        prompt_audio_length = int(prompt_feat.shape[0])

        ref_tokens, ref_feats, ref_text_mask, ref_audio_mask = voxcpm2_make_ref_prefix(
            model,
            ref_feat,
        )

        prompt_pad_token = mx.zeros(prompt_audio_length, dtype=mx.int32)
        text_pad_feat = mx.zeros(
            (text_length, model.patch_size, model.feat_dim),
            dtype=mx.float32,
        )
        text_token = mx.concatenate([ref_tokens, text_token, prompt_pad_token], axis=0)
        audio_feat = mx.concatenate([ref_feats, text_pad_feat, prompt_feat], axis=0)
        text_mask = mx.concatenate(
            [
                ref_text_mask,
                mx.ones(text_length, dtype=mx.float32),
                mx.zeros(prompt_audio_length, dtype=mx.float32),
            ],
            axis=0,
        )
        audio_mask = mx.concatenate(
            [
                ref_audio_mask,
                mx.zeros(text_length, dtype=mx.float32),
                mx.ones(prompt_audio_length, dtype=mx.float32),
            ],
            axis=0,
        )
    elif reference_audio is not None:
        text_token = mx.array(voxcpm2_tokenize(model, target_text), dtype=mx.int32)
        text_token = mx.concatenate([text_token, mx.array([model.audio_start_token], dtype=mx.int32)])
        text_length = int(text_token.shape[0])

        ref_feat = voxcpm2_encode_audio_with_padding(model, reference_audio, "right")
        ref_tokens, ref_feats, ref_text_mask, ref_audio_mask = voxcpm2_make_ref_prefix(
            model,
            ref_feat,
        )

        text_pad_feat = mx.zeros(
            (text_length, model.patch_size, model.feat_dim),
            dtype=mx.float32,
        )
        text_token = mx.concatenate([ref_tokens, text_token], axis=0)
        audio_feat = mx.concatenate([ref_feats, text_pad_feat], axis=0)
        text_mask = mx.concatenate(
            [ref_text_mask, mx.ones(text_length, dtype=mx.float32)],
            axis=0,
        )
        audio_mask = mx.concatenate(
            [ref_audio_mask, mx.zeros(text_length, dtype=mx.float32)],
            axis=0,
        )
    elif prompt_audio is not None:
        text = f"{prompt_text or ''}{target_text}"
        text_token = mx.array(voxcpm2_tokenize(model, text), dtype=mx.int32)
        text_token = mx.concatenate([text_token, mx.array([model.audio_start_token], dtype=mx.int32)])
        text_length = int(text_token.shape[0])

        prompt_feat = voxcpm2_encode_audio_with_padding(model, prompt_audio, "left")
        prompt_audio_length = int(prompt_feat.shape[0])
        prompt_pad_token = mx.zeros(prompt_audio_length, dtype=mx.int32)
        text_pad_feat = mx.zeros(
            (text_length, model.patch_size, model.feat_dim),
            dtype=mx.float32,
        )
        text_token = mx.concatenate([text_token, prompt_pad_token], axis=0)
        audio_feat = mx.concatenate([text_pad_feat, prompt_feat], axis=0)
        text_mask = mx.concatenate(
            [
                mx.ones(text_length, dtype=mx.float32),
                mx.zeros(prompt_audio_length, dtype=mx.float32),
            ],
            axis=0,
        )
        audio_mask = mx.concatenate(
            [
                mx.zeros(text_length, dtype=mx.float32),
                mx.ones(prompt_audio_length, dtype=mx.float32),
            ],
            axis=0,
        )
    else:
        text_token = mx.array(voxcpm2_tokenize(model, target_text), dtype=mx.int32)
        text_token = mx.concatenate([text_token, mx.array([model.audio_start_token], dtype=mx.int32)])
        text_length = int(text_token.shape[0])
        audio_feat = mx.zeros(
            (text_length, model.patch_size, model.feat_dim),
            dtype=mx.float32,
        )
        text_mask = mx.ones(text_length, dtype=mx.float32)
        audio_mask = mx.zeros(text_length, dtype=mx.float32)

    text_token = text_token[None, :]
    text_mask = text_mask[None, :]
    audio_feat = audio_feat[None, :, :, :]
    audio_mask = audio_mask[None, :]

    feat_embed = model.feat_encoder(audio_feat)
    feat_embed = model.enc_to_lm_proj(feat_embed)

    if getattr(model.args.lm_config, "use_mup", False):
        scale_emb = model.args.lm_config.scale_emb
    else:
        scale_emb = 1.0
    text_embed = model.base_lm.embed_tokens(text_token) * scale_emb
    combined_embed = text_mask[:, :, None] * text_embed + audio_mask[:, :, None] * feat_embed

    prefix_feat_cond = audio_feat[:, -1, :, :]
    target_token_count = len(voxcpm2_tokenize(model, target_text))
    max_steps = min(int(target_token_count * 6.0 + 10), max_len, max_tokens if (max_tokens := 4096) else max_len)
    context_len = 0
    pred_feat_seq = []
    if int(audio_mask[0, -1].item()) == 1:
        audio_indices = np.flatnonzero(np.array(audio_mask[0]))
        context_len = min(3, int(audio_indices.shape[0]))
        if context_len > 0:
            pred_feat_seq = [
                audio_feat[:, int(index), :, :] for index in audio_indices[-context_len:]
            ]

    enc_outputs, lm_cache = voxcpm2_run_minicpm(
        model.base_lm,
        combined_embed,
        is_causal=True,
        use_rope=True,
    )
    enc_outputs = model.fsq_layer(enc_outputs) * audio_mask[:, :, None] + enc_outputs * text_mask[:, :, None]
    lm_hidden = enc_outputs[:, -1, :]

    residual_inputs = model.fusion_concat_proj(
        mx.concatenate([enc_outputs, audio_mask[:, :, None] * feat_embed], axis=-1)
    )
    residual_outputs, res_cache = voxcpm2_run_minicpm(
        model.residual_lm,
        residual_inputs,
        is_causal=True,
        use_rope=not getattr(model, "_voxcpm2_residual_no_rope", False),
    )
    residual_hidden = residual_outputs[:, -1, :]

    for step in range(max_steps):
        dit_hidden = mx.concatenate(
            [
                model.lm_to_dit_proj(lm_hidden),
                model.res_to_dit_proj(residual_hidden),
            ],
            axis=-1,
        )
        pred_feat = voxcpm2_sample(
            model,
            dit_hidden,
            prefix_feat_cond.transpose(0, 2, 1),
            inference_timesteps=inference_timesteps,
            cfg_value=cfg_value,
        ).transpose(0, 2, 1)
        pred_feat_seq.append(pred_feat)

        curr_embed = model.feat_encoder(pred_feat[:, None, :, :])
        curr_embed = model.enc_to_lm_proj(curr_embed)

        stop_logits = model.stop_head(nn.silu(model.stop_proj(lm_hidden)))
        stop_flag = int(mx.argmax(stop_logits, axis=-1).item())
        if step > min_len and stop_flag == 1:
            break

        lm_out, lm_cache = voxcpm2_run_minicpm(
            model.base_lm,
            curr_embed,
            cache=lm_cache,
            is_causal=True,
            use_rope=True,
        )
        lm_hidden = model.fsq_layer(lm_out[:, -1, :])

        residual_step = model.fusion_concat_proj(
            mx.concatenate([lm_hidden, curr_embed[:, 0, :]], axis=-1)
        )[:, None, :]
        res_out, res_cache = voxcpm2_run_minicpm(
            model.residual_lm,
            residual_step,
            cache=res_cache,
            is_causal=True,
            use_rope=not getattr(model, "_voxcpm2_residual_no_rope", False),
        )
        residual_hidden = res_out[:, -1, :]
        prefix_feat_cond = pred_feat

    if not pred_feat_seq:
        raise ValueError("VoxCPM2 returned no audio.")

    all_feats = mx.concatenate(pred_feat_seq, axis=1)
    if context_len > 0:
        all_feats = all_feats[:, context_len:, :]
    audio = model.audio_vae.decode(all_feats).flatten()
    sample_rate = getattr(model, "_decode_sample_rate", model.sample_rate)
    return np.array(audio), int(sample_rate)


def generate_voxcpm2_audio(args: argparse.Namespace):
    model = load_voxcpm2_model(args.model)
    reference_audio = None
    prompt_audio = None
    if args.ref_audio:
        reference_audio = load_reference_audio(model, "voxcpm2", args.ref_audio)
        if args.ref_text and args.ref_text.strip():
            prompt_audio = reference_audio

    final_text = voxcpm2_embed_text_instruction(args.text, args.instruct)
    audio, sample_rate = generate_voxcpm2_official(
        model,
        target_text=final_text,
        reference_audio=reference_audio,
        prompt_audio=prompt_audio,
        prompt_text=args.ref_text.strip() if args.ref_text else None,
        inference_timesteps=10,
        cfg_value=args.cfg_weight if args.cfg_weight is not None else 2.0,
    )
    out_sr = voxcpm2_output_sample_rate_from_config(args.model)
    if out_sr is not None and out_sr > 0:
        sample_rate = out_sr
    return audio, int(sample_rate)


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
    used_conditioning_retry = False

    try:
        patch_mlx_audio_load_config_for_indextts()
        model_name = Path(args.model).name.lower()
        config = load_model_config(args.model)
        model_type = config.get("model_type") or config.get("architecture")

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
            if needs_bundled_conditioning_prompt(model_type, model_name) and not ref_audio_path:
                fallback_prompt = bundled_csm_prompt()
                if fallback_prompt is None:
                    raise RuntimeError(
                        f"{display_model_name(model_name)} requires a reference prompt, and the bundled Vox Jot fallback prompt is missing."
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
        detail = describe_bridge_error(exc, model_name, used_conditioning_retry)
        print(f"MLX bridge failed: {detail}", file=sys.stderr)
        if os.environ.get("VOX_JOT_DEBUG_MLX_AUDIO") == "1":
            traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
