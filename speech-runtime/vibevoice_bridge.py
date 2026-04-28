#!/usr/bin/env python3
"""VibeVoice TTS bridge.

Spawned by the Rust `vibevoice` module to synthesize a single utterance.
The model directory is the app-managed snapshot (NOT the original HuggingFace
cache). Voices are looked up from `--voices-dir` (defaults to the bundled
`vendor/VibeVoice/demo/voices/streaming_model/` directory).

Required Python packages (installed via `pip install -e ./vendor/VibeVoice[streamingtts]`):
    vibevoice, torch, transformers==4.51.3, accelerate, diffusers, librosa, soundfile,
    numpy, scipy.

Stdout reports a one-line JSON status so Rust can detect success deterministically;
warnings/progress go to stderr.
"""

from __future__ import annotations

import argparse
import copy
import glob
import json
import os
import sys
import traceback
from pathlib import Path


def fail(message: str, *, code: int = 1) -> None:
    sys.stderr.write(message.rstrip() + "\n")
    sys.stderr.flush()
    sys.exit(code)


def resolve_voice_path(voices_dir: Path, speaker: str) -> Path:
    candidates = sorted(glob.glob(str(voices_dir / "**" / "*.pt"), recursive=True))
    if not candidates:
        fail(f"No .pt voice files found under {voices_dir}")
    presets = {Path(p).stem.lower(): Path(p) for p in candidates}
    speaker_lower = speaker.lower()

    # 1. Exact stem match.
    if speaker_lower in presets:
        return presets[speaker_lower]
    # 2. Substring match (either direction). Same disambiguation rule as
    #    VibeVoice's demo VoiceMapper.
    matches = [
        path
        for stem, path in presets.items()
        if speaker_lower in stem or stem in speaker_lower
    ]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(sorted(p.name for p in matches))
        fail(
            f"Speaker '{speaker}' is ambiguous — matches {names}. "
            "Use the exact filename stem (e.g. 'en-Carter_man')."
        )
    # 3. Default: alphabetically-first preset.
    fallback = sorted(presets.values(), key=lambda p: p.stem.lower())[0]
    sys.stderr.write(
        f"VibeVoice: speaker '{speaker}' not found, falling back to {fallback.name}\n"
    )
    return fallback


def main() -> None:
    parser = argparse.ArgumentParser(description="VibeVoice TTS bridge")
    parser.add_argument(
        "--model-path",
        required=True,
        help="Path to the app-managed VibeVoice model directory.",
    )
    parser.add_argument("--text", required=True, help="UTF-8 text to synthesize.")
    parser.add_argument(
        "--output",
        required=True,
        help="Path to write the resulting WAV file to.",
    )
    parser.add_argument(
        "--speaker",
        default="Carter",
        help="Speaker name (matched against voice .pt stems).",
    )
    parser.add_argument(
        "--voices-dir",
        required=True,
        help="Directory containing voice .pt files (recursively scanned).",
    )
    parser.add_argument(
        "--cfg-scale",
        type=float,
        default=1.3,
        help="Classifier-free guidance scale.",
    )
    parser.add_argument(
        "--ddpm-steps",
        type=int,
        default=5,
        help="DDPM inference steps. Lower = faster, slightly lower quality.",
    )
    args = parser.parse_args()

    model_dir = Path(args.model_path).expanduser().resolve()
    if not model_dir.is_dir():
        fail(f"VibeVoice model directory not found: {model_dir}")
    if not (model_dir / "config.json").exists():
        fail(f"VibeVoice config.json missing in {model_dir}")
    if not (model_dir / "model.safetensors").exists():
        fail(f"VibeVoice model.safetensors missing in {model_dir}")

    voices_dir = Path(args.voices_dir).expanduser().resolve()
    if not voices_dir.is_dir():
        fail(f"Voices directory not found: {voices_dir}")

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        import torch
        from vibevoice.modular.modeling_vibevoice_streaming_inference import (
            VibeVoiceStreamingForConditionalGenerationInference,
        )
        from vibevoice.processor.vibevoice_streaming_processor import (
            VibeVoiceStreamingProcessor,
        )
    except Exception as exc:
        fail(
            "VibeVoice deps are not installed. From the repo root, run: "
            f"./speech-runtime/.venv/bin/python -m pip install -e "
            f"./speech-runtime/vendor/VibeVoice[streamingtts]. Import failed: {exc}"
        )

    # Device + dtype selection mirrors the upstream demo. Apple Silicon goes
    # through MPS in float32 (bf16 is not stable for VibeVoice on MPS); CUDA
    # uses bf16; CPU uses fp32 + sdpa.
    if torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float32
        attn_impl = "sdpa"
    elif torch.cuda.is_available():
        device = "cuda"
        dtype = torch.bfloat16
        attn_impl = "flash_attention_2"
    else:
        device = "cpu"
        dtype = torch.float32
        attn_impl = "sdpa"

    sys.stderr.write(
        f"VibeVoice: loading model on {device} (dtype={dtype}, attn={attn_impl})\n"
    )
    sys.stderr.flush()

    try:
        if device == "mps":
            model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                str(model_dir),
                torch_dtype=dtype,
                attn_implementation=attn_impl,
            )
            model = model.to(device)
        elif device == "cuda":
            try:
                model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                    str(model_dir),
                    torch_dtype=dtype,
                    device_map=device,
                    attn_implementation=attn_impl,
                )
            except Exception:
                sys.stderr.write(
                    "VibeVoice: flash_attention_2 unavailable, falling back to sdpa\n"
                )
                model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                    str(model_dir),
                    torch_dtype=dtype,
                    device_map=device,
                    attn_implementation="sdpa",
                )
        else:
            model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                str(model_dir),
                torch_dtype=dtype,
                device_map=device,
                attn_implementation=attn_impl,
            )

        model.eval()
        model.set_ddpm_inference_steps(num_steps=args.ddpm_steps)

        processor = VibeVoiceStreamingProcessor.from_pretrained(str(model_dir))

        voice_sample = resolve_voice_path(voices_dir, args.speaker)
        sys.stderr.write(f"VibeVoice: using voice {voice_sample.name}\n")
        sys.stderr.flush()

        all_prefilled_outputs = torch.load(
            str(voice_sample), map_location=device, weights_only=False
        )

        inputs = processor.process_input_with_cached_prompt(
            text=args.text,
            cached_prompt=all_prefilled_outputs,
            padding=True,
            return_tensors="pt",
            return_attention_mask=True,
        )

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=None,
                cfg_scale=args.cfg_scale,
                tokenizer=processor.tokenizer,
                generation_config={"do_sample": False},
                verbose=False,
                all_prefilled_outputs=copy.deepcopy(all_prefilled_outputs)
                if all_prefilled_outputs is not None
                else None,
            )

        processor.save_audio(outputs.speech_outputs[0], output_path=str(output_path))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        fail(f"VibeVoice generation failed: {exc}")

    if not output_path.exists():
        fail(f"VibeVoice completed but no output written to {output_path}")

    status = {
        "status": "ok",
        "path": str(output_path),
        "voice": voice_sample.name,
        "device": device,
    }
    sys.stdout.write(json.dumps(status))
    sys.stdout.flush()


if __name__ == "__main__":
    # Reduce MPS fragmentation for short utterances.
    os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")
    main()
