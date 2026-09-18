#!/usr/bin/env python3
"""Standalone runner for Jina-OCR-v1 inference in Vox Jot.

Executes local vision-language document recognition using PyTorch/Transformers on
Apple Silicon Metal (MPS) or CPU. All caches are restricted to external storage
and weights are loaded strictly from the local model directory with
`local_files_only=True` and `TRANSFORMERS_OFFLINE=1`.

Security & Remote Code Notice:
Jina-OCR-v1 uses custom modeling code from the DeepSeek-OCR / DeepSeek-V2 MoE
architecture defined directly in the downloaded repository. Setting
`trust_remote_code=True` allows Transformers to execute these local Python files.
Because `local_files_only=True` is strictly set, no code or weights can ever be
fetched from remote sources at runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path


def get_process_rss_mb() -> float:
    """Returns max Resident Set Size (RSS) in MB for this process.

    On macOS Darwin, ru_maxrss is returned in bytes.
    On Linux, ru_maxrss is returned in kilobytes.
    """
    ru = resource.getrusage(resource.RUSAGE_SELF)
    if sys.platform == "darwin":
        return round(ru.ru_maxrss / (1024 * 1024), 2)
    return round(ru.ru_maxrss / 1024, 2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Vox Jot Jina-OCR-v1 Runner")
    parser.add_argument("--model-dir", type=Path, required=True, help="Path to local jina-ocr-v1 directory")
    parser.add_argument("--image", type=Path, required=True, help="Path to image file for OCR")
    parser.add_argument("--device", type=str, default="auto", choices=["auto", "mps", "cpu", "cuda"])
    parser.add_argument("--max-new-tokens", type=int, default=2048)
    parser.add_argument("--max-image-dimension", type=int, default=4096, help="Maximum image width/height before proportional downscaling")
    args = parser.parse_args()

    model_dir = args.model_dir.resolve()
    if not model_dir.is_dir():
        print(json.dumps({"status": "error", "message": f"Model directory not found: {model_dir}"}))
        sys.exit(1)

    image_path = args.image.resolve()
    if not image_path.is_file():
        print(json.dumps({"status": "error", "message": f"Image file not found: {image_path}"}))
        sys.exit(1)

    # Route Hugging Face home/cache to parent directory of model if on external drive
    parent_dir = model_dir.parent
    os.environ["HF_HOME"] = str(parent_dir / ".hf_home")
    os.environ["HF_HUB_CACHE"] = str(parent_dir / ".hf_cache")
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    try:
        from PIL import Image
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor
    except ImportError as err:
        print(json.dumps({"status": "error", "message": f"Required python packages missing: {err}"}))
        sys.exit(1)

    # Device selection
    if args.device == "auto":
        device_name = "mps" if torch.backends.mps.is_available() else "cpu"
    else:
        device_name = args.device

    device = torch.device(device_name)

    t_start = time.perf_counter()

    # Load processor and model with strict local isolation
    try:
        processor = AutoProcessor.from_pretrained(
            str(model_dir),
            trust_remote_code=True,
            local_files_only=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            str(model_dir),
            torch_dtype=torch.bfloat16,
            trust_remote_code=True,
            local_files_only=True,
        ).to(device)
    except Exception as exc:
        print(json.dumps({"status": "error", "message": f"Failed to load model: {exc}"}))
        sys.exit(1)

    t_loaded = time.perf_counter()
    load_duration_ms = int((t_loaded - t_start) * 1000)

    # Pre-process image with bounds protection
    try:
        image = Image.open(image_path).convert("RGB")
        w, h = image.size
        max_dim = args.max_image_dimension
        if w > max_dim or h > max_dim:
            scale = max_dim / max(w, h)
            new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
            image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

        inputs = processor.prepare_ocr_inputs(image, device=device)
        with torch.no_grad():
            output = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
            )
        recognized_text = processor.decode_ocr(output, inputs["input_ids"])
    except Exception as exc:
        print(json.dumps({"status": "error", "message": f"Inference failed: {exc}"}))
        sys.exit(1)

    t_done = time.perf_counter()
    inference_duration_ms = int((t_done - t_loaded) * 1000)

    peak_rss_mb = get_process_rss_mb()
    mps_allocated_mb: float | None = None
    mps_driver_allocated_mb: float | None = None
    if device_name == "mps" and torch.backends.mps.is_available():
        mps_allocated_mb = round(torch.mps.current_allocated_memory() / (1024 * 1024), 2)
        mps_driver_allocated_mb = round(torch.mps.driver_allocated_memory() / (1024 * 1024), 2)

    response = {
        "status": "success",
        "text": recognized_text,
        "device": device_name,
        "load_duration_ms": load_duration_ms,
        "inference_duration_ms": inference_duration_ms,
        "peak_rss_mb": peak_rss_mb,
        "mps_allocated_mb": mps_allocated_mb,
        "mps_driver_allocated_mb": mps_driver_allocated_mb,
    }
    print(json.dumps(response))


if __name__ == "__main__":
    main()
