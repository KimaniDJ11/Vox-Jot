#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

import numpy as np
import soundfile as sf
import torch


def resolve_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def normalize_audio(audio: np.ndarray) -> np.ndarray:
    audio = np.asarray(audio, dtype=np.float32)
    audio = np.squeeze(audio)
    if audio.ndim == 1:
        return audio
    if audio.ndim == 2 and audio.shape[0] <= 2:
        return audio.T
    if audio.ndim == 2:
        return audio
    raise ValueError(f"Unsupported generated audio shape: {audio.shape}")


def write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    audio = normalize_audio(audio)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    sf.write(path, audio, sample_rate)


def run_musicgen(args: argparse.Namespace) -> None:
    from transformers import pipeline

    device = resolve_device()
    generator = pipeline("text-to-audio", model=args.model_dir, device=device)
    # MusicGen produces roughly 50 audio tokens per second, capped by the
    # model's 30 second positional limit.
    max_new_tokens = max(32, min(1503, int(args.seconds * 50)))
    output = generator(
        args.prompt,
        generate_kwargs={
            "do_sample": True,
            "temperature": 0.8,
            "max_new_tokens": max_new_tokens,
        },
    )
    write_wav(Path(args.out), output["audio"], int(output["sampling_rate"]))


def run_audioldm2(args: argparse.Namespace) -> None:
    from diffusers import AudioLDM2Pipeline

    device = resolve_device()
    pipe = AudioLDM2Pipeline.from_pretrained(args.model_dir, torch_dtype=torch.float32)
    pipe = pipe.to(device)
    generator = torch.Generator(device=device).manual_seed(args.seed)
    steps = int(os.environ.get("VOX_JOT_CREATIVE_AUDIO_STEPS", "6"))
    output = pipe(
        args.prompt,
        num_inference_steps=max(1, steps),
        audio_length_in_s=float(args.seconds),
        generator=generator,
    )
    write_wav(Path(args.out), output.audios[0], 16000)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Vox Jot HF creative audio bridge")
    parser.add_argument("--backend", choices=["musicgen", "audioldm2"], required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--seconds", type=float, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    if args.backend == "musicgen":
        run_musicgen(args)
    elif args.backend == "audioldm2":
        run_audioldm2(args)
    else:
        raise ValueError(f"Unsupported backend: {args.backend}")


if __name__ == "__main__":
    main()
