#!/usr/bin/env python3
"""Batch-score creative-audio prompt adherence with LAION CLAP embeddings."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "laion/clap-htsat-unfused"
DEFAULT_REVISION = "8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="JSON file containing an items array")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    return parser.parse_args()


def load_audio(path: Path, target_rate: int = 48_000) -> Any:
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if sample_rate != target_rate:
        from math import gcd

        divisor = gcd(sample_rate, target_rate)
        mono = resample_poly(mono, target_rate // divisor, sample_rate // divisor)
    return np.asarray(mono, dtype=np.float32)


def main() -> int:
    args = parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    items = payload.get("items") or []
    if not items:
        raise SystemExit("CLAP input contains no items")

    import torch
    from transformers import ClapModel, ClapProcessor

    processor = ClapProcessor.from_pretrained(args.model, revision=args.revision)
    model = ClapModel.from_pretrained(args.model, revision=args.revision)
    model.eval()

    results = []
    for item in items:
        audio = load_audio(Path(item["audio_path"]))
        inputs = processor(
            text=[str(item["prompt"])],
            audios=[audio],
            sampling_rate=48_000,
            return_tensors="pt",
            padding=True,
        )
        with torch.inference_mode():
            audio_features = model.get_audio_features(
                input_features=inputs["input_features"],
                is_longer=inputs.get("is_longer"),
            )
            text_features = model.get_text_features(
                input_ids=inputs["input_ids"],
                attention_mask=inputs.get("attention_mask"),
            )
            score = torch.nn.functional.cosine_similarity(
                audio_features,
                text_features,
            ).item()
        results.append(
            {
                "id": item["id"],
                "score": round(max(-1.0, min(1.0, float(score))), 6),
            }
        )

    print(
        json.dumps(
            {
                "method": "clap_prompt_adherence_v1",
                "model_id": args.model,
                "model_revision": args.revision,
                "results": results,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
