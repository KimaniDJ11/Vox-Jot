import argparse
import inspect
import json
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


def detect_model_type(model, model_source: str) -> str | None:
    model_type = getattr(model, "model_type", None)
    if callable(model_type):
        try:
            model_type = model_type()
        except Exception:
            model_type = None
    if isinstance(model_type, str) and model_type.strip():
        return model_type

    config_path = Path(model_source).expanduser() / "config.json"
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config_model_type = config.get("model_type")
            if isinstance(config_model_type, str) and config_model_type.strip():
                return config_model_type
        except Exception:
            pass

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
    if "outetts" in model_name:
        return "OuteTTS"
    if "spark" in model_name:
        return "Spark TTS"
    if "chatterbox" in model_name:
        return "MLX Chatterbox"
    if "qwen3-tts-1.7b" in model_name:
        return "Qwen3 TTS 1.7B"
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
        model = load_model(args.model)
        model_type = detect_model_type(model, args.model)
        model_name = Path(args.model).name.lower()
        used_conditioning_retry = False

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
            retry_kwargs = build_generation_kwargs(model, args, retry_audio, retry_text, retry_audio_path)
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
