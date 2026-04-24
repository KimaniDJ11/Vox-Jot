# External binaries (sidecars)

Tauri bundles these as sidecars via `bundle.externalBin` in [tauri.conf.json](../tauri.conf.json).
Each binary must be provided per **target triple** using the exact filename:
`vox-jot-ffmpeg-<target-triple>` (e.g. `vox-jot-ffmpeg-x86_64-apple-darwin`).
Find your triple with `rustc -vV | sed -n 's|host: ||p'`.

## FFmpeg (`vox-jot-ffmpeg-*`)

Used by the **File Transcription** feature (Dictate → File Transcription) to decode
non-WAV audio/video into mono `f32le` at 16 kHz. If this sidecar is missing at
runtime, the backend falls back to `ffmpeg` on the user's `PATH`.

### Obtaining the binary

Download a static FFmpeg build from a trusted source and rename it to the triple
suffix above. Recommended sources:

- macOS / Linux: https://ffmpeg.org/download.html (or `https://evermeet.cx/ffmpeg/` for macOS)
- Windows: https://www.gyan.dev/ffmpeg/builds/ (use `ffmpeg.exe`; append `.exe` only on Windows)

Place the file here:

```
src-tauri/binaries/vox-jot-ffmpeg-<target-triple>[.exe]
chmod +x src-tauri/binaries/vox-jot-ffmpeg-<target-triple>   # unix
```

### Licensing / attribution

FFmpeg is distributed under the LGPL (or GPL depending on the build). If you
bundle an FFmpeg binary you **must** comply with its license — ship the
corresponding source or a pointer to it, and include the license text in your
third-party notices. See https://ffmpeg.org/legal.html.

Binaries are intentionally excluded from git via this directory's `.gitignore`.
CI or release tooling is expected to drop the correct file(s) here before
running `tauri build`.

### Enabling the bundled sidecar at release time

After dropping the triple-suffixed binary into `src-tauri/binaries/`, add the
`externalBin` entry to [tauri.conf.json](../tauri.conf.json) under `bundle`:

```json
"externalBin": ["binaries/vox-jot-ffmpeg"]
```

It is intentionally omitted from the committed config so that `cargo check`
and `tauri dev` remain green for contributors who do not have an FFmpeg sidecar
available locally. At runtime, the backend falls back to `ffmpeg` on `PATH`
when no sidecar is present, so File Transcription still works in development.
