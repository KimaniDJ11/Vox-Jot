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
            if not os.path.exists(ref_audio_path):
                raise FileNotFoundError(
                    f"Reference audio file not found: {ref_audio_path}"
                )
            normalize = model_type == "spark"
            ref_audio = load_audio(
                ref_audio_path,
                sample_rate=model.sample_rate,
                volume_normalize=normalize,
            )

        raw_kwargs = {
            "voice": args.voice,
            "speed": args.speed,
            "lang_code": args.lang_code,
            "instruct": args.instruct,
            "ref_audio": ref_audio,
            "ref_text": ref_text,
            "temperature": args.temperature,
            "repetition_penalty": args.repetition_penalty,
            "max_tokens": args.max_tokens,
            "stream": False,
            "verbose": False,
        }
        signature = inspect.signature(model.generate)
        kwargs = {
            key: value
            for key, value in raw_kwargs.items()
            if value is not None and key in signature.parameters
        }

        audio_chunks = []
        sample_rate = None
        for result in normalize_generation_results(model.generate(args.text, **kwargs)):
            audio_chunks.append(np.array(result.audio))
            if sample_rate is None:
                sample_rate = result.sample_rate

        if not audio_chunks:
            raise ValueError("No audio generated")

        audio = np.concatenate(audio_chunks, axis=0)
        output_dir = os.path.dirname(args.output)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        audio_write(args.output, audio, sample_rate, format="wav")
        repair_wav_riff_header(args.output)
        print(args.output)
        return 0
    except Exception as exc:
        if (
            "[concatenate] No arrays provided for concatenation" in str(exc)
            and "outetts" in model_name
        ):
            print(
                "MLX bridge failed: OuteTTS generated no decodable audio tokens. "
                "This appears to be an upstream mlx-audio/OuteTTS compatibility issue.",
                file=sys.stderr,
            )
        else:
            print(f"MLX bridge failed: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
