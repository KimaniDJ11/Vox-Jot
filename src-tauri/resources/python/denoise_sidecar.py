#!/usr/bin/env python3
"""DeepFilterNet denoise sidecar for Vox Jot's Enhance Audio.

Reads a mono WAV, runs DeepFilterNet (full-band 48 kHz speech enhancement), and
writes the enhanced WAV. Invoked by the Rust `denoise` runtime, which guarantees
the venv has `deepfilternet` + `soundfile` installed. Errors are written to
stderr with a non-zero exit so the Rust side surfaces a clean message.
"""

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="DeepFilterNet denoise sidecar")
    parser.add_argument("--input", required=True, help="Input WAV path")
    parser.add_argument("--output", required=True, help="Output WAV path")
    args = parser.parse_args()

    # Imported lazily so --help / arg errors don't pay the heavy import cost.
    import numpy as np
    import soundfile as sf
    from df.enhance import enhance, init_df, load_audio
    from df.model import ModelParams

    # init_df() loads the DeepFilterNet3 model (downloaded + cached on first run).
    model, df_state, _ = init_df(log_level="ERROR", log_file=None)
    sample_rate = ModelParams().sr

    # load_audio resamples to the model's 48 kHz rate and returns (channels, time).
    audio, _ = load_audio(args.input, sr=sample_rate)
    enhanced = enhance(model, df_state, audio)

    data = enhanced.detach().cpu().numpy() if hasattr(enhanced, "detach") else np.asarray(enhanced)
    # Collapse to mono 1-D for a clean WAV write.
    data = np.asarray(data, dtype=np.float32)
    if data.ndim > 1:
        data = data.mean(axis=0)
    data = data.reshape(-1)

    sf.write(args.output, data, sample_rate, subtype="PCM_16")

    sys.stdout.write(
        json.dumps({"ok": True, "sample_rate": int(sample_rate), "frames": int(data.shape[0])})
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - surface any failure to the Rust caller
        sys.stderr.write(f"{type(exc).__name__}: {exc}")
        sys.exit(1)
