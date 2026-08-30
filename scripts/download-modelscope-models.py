#!/usr/bin/env python3
"""
Download curated, unique ModelScope & HF models directly to external storage:
/Volumes/AI Storage/Apps/Models/VoxJot/app-support/models/
"""

import os
import sys
import time
import shutil
from pathlib import Path
from modelscope import snapshot_download as ms_snapshot_download
import huggingface_hub as hf_hub

TARGET_BASE = Path("/Volumes/AI Storage/Apps/Models/VoxJot/app-support/models")

MODELS = [
    {
        "domain": "speech-analysis",
        "name": "fsmn-vad",
        "source": "modelscope",
        "repo": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        "target": TARGET_BASE / "speech-analysis" / "fsmn-vad"
    },
    {
        "domain": "speech-analysis",
        "name": "punc-ct-transformer",
        "source": "modelscope",
        "repo": "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        "target": TARGET_BASE / "speech-analysis" / "punc-ct-transformer"
    },
    {
        "domain": "speech-analysis",
        "name": "eres2netv2",
        "source": "modelscope",
        "repo": "iic/speech_eres2netv2_sv_zh-cn_16k-common",
        "target": TARGET_BASE / "speech-analysis" / "eres2netv2"
    },
    {
        "domain": "audio-cleanup",
        "name": "frcrn-ans",
        "source": "modelscope",
        "repo": "iic/speech_frcrn_ans_cirm_16k",
        "target": TARGET_BASE / "audio-cleanup" / "frcrn-ans"
    },
    {
        "domain": "stt",
        "name": "sense-voice-small",
        "source": "huggingface_snapshot",
        "repo": "FunAudioLLM/SenseVoiceSmall",
        "target": TARGET_BASE / "stt" / "sense-voice-small"
    },
    {
        "domain": "tts",
        "name": "cosyvoice2-0.5b",
        "source": "huggingface_snapshot",
        "repo": "FunAudioLLM/CosyVoice2-0.5B",
        "target": TARGET_BASE / "tts" / "store" / "cosyvoice2-0.5b"
    },
    {
        "domain": "tts",
        "name": "chat-tts",
        "source": "huggingface_snapshot",
        "repo": "2noise/ChatTTS",
        "target": TARGET_BASE / "tts" / "store" / "chat-tts"
    },
    {
        "domain": "llm",
        "name": "qwen2.5-7b-instruct-gguf",
        "source": "huggingface_file",
        "repo": "bartowski/Qwen2.5-7B-Instruct-GGUF",
        "filename": "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        "target": TARGET_BASE / "llm" / "qwen2.5-7b-instruct"
    },
    {
        "domain": "stt",
        "name": "seaco-paraformer-large",
        "source": "modelscope",
        "repo": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "target": TARGET_BASE / "stt" / "seaco-paraformer-large"
    },
    {
        "domain": "stt",
        "name": "paraformer-large-vad-punc",
        "source": "modelscope",
        "repo": "iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "target": TARGET_BASE / "stt" / "paraformer-large-vad-punc"
    }
]

def format_size(bytes_val):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_val < 1024:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f} TB"

def get_dir_size(path: Path):
    total = 0
    file_count = 0
    if not path.exists():
        return 0, 0
    if path.is_file():
        return path.stat().st_size, 1
    for f in path.rglob('*'):
        if f.is_file() and not f.name.startswith('.'):
            total += f.stat().st_size
            file_count += 1
    return total, file_count

def is_model_complete(item):
    target = item["target"]
    if not target.exists():
        return False
    size, count = get_dir_size(target)
    if count >= 3 and size > 1_000_000:
        if item["source"] == "huggingface_file":
            main_file = target / item["filename"]
            return main_file.exists() and main_file.stat().st_size > 100_000_000
        for ext in ['.pt', '.bin', '.safetensors', '.ckpt', '.onnx']:
            if list(target.rglob(f'*{ext}')):
                return True
    return False

def clean_metadata_files(path: Path):
    if not path.exists():
        return
    for item in path.rglob('._*'):
        try:
            if item.is_file():
                item.unlink()
        except Exception:
            pass
    for item in path.rglob('__MACOSX'):
        try:
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
        except Exception:
            pass

def main():
    print(f"=== Starting ModelScope & HF Model Downloads ===")
    print(f"Target Destination: {TARGET_BASE}\n")

    if not TARGET_BASE.exists():
        print(f"Error: Target directory {TARGET_BASE} does not exist. Is the drive mounted?")
        sys.exit(1)

    results = []

    for idx, item in enumerate(MODELS, 1):
        name = item["name"]
        source = item["source"]
        repo = item["repo"]
        target = item["target"]

        if is_model_complete(item):
            size, count = get_dir_size(target)
            print(f"[{idx}/{len(MODELS)}] {name} already complete -> Size: {format_size(size)} | Files: {count} (SKIPPING)\n")
            sys.stdout.flush()
            results.append({"name": name, "status": "ALREADY_COMPLETE", "size": size, "files": count, "time": 0})
            continue

        print(f"[{idx}/{len(MODELS)}] Downloading {name} ({source}: {repo})...")
        print(f"       -> Target: {target}")
        start_time = time.time()

        target.mkdir(parents=True, exist_ok=True)

        success = False
        last_error = None
        for attempt in range(1, 4):
            try:
                if attempt > 1:
                    print(f"       [Retry {attempt}/3 for {name}]...")
                if source == "modelscope":
                    ms_snapshot_download(
                        model_id=repo,
                        local_dir=str(target)
                    )
                elif source == "huggingface_snapshot":
                    hf_hub.snapshot_download(
                        repo_id=repo,
                        local_dir=str(target),
                        max_workers=8
                    )
                elif source == "huggingface_file":
                    filename = item["filename"]
                    hf_hub.hf_hub_download(
                        repo_id=repo,
                        filename=filename,
                        local_dir=str(target)
                    )
                success = True
                break
            except Exception as e:
                last_error = e
                print(f"       [Attempt {attempt} error: {e}]")
                time.sleep(3)

        if success:
            clean_metadata_files(target)
            size, count = get_dir_size(target)
            elapsed = time.time() - start_time
            print(f"       ✓ SUCCESS in {elapsed:.1f}s | Size: {format_size(size)} | Files: {count}\n")
            sys.stdout.flush()
            results.append({"name": name, "status": "SUCCESS", "size": size, "files": count, "time": elapsed})
        else:
            elapsed = time.time() - start_time
            print(f"       ✗ FAILED in {elapsed:.1f}s: {last_error}\n")
            sys.stdout.flush()
            results.append({"name": name, "status": f"FAILED: {last_error}", "size": 0, "files": 0, "time": elapsed})

    print("=== Final Download Summary ===")
    for r in results:
        status_str = f"OK ({format_size(r['size'])}, {r['files']} files)" if r["status"] in ["SUCCESS", "ALREADY_COMPLETE"] else r["status"]
        print(f"- {r['name']}: {status_str}")

if __name__ == "__main__":
    main()
