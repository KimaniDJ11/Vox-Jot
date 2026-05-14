---
license: mit
library_name: vox-jot
tags:
  - vox-jot
  - ocr
  - runtime
  - macos
  - python
---

# Vox Jot OCR Runtime

This repository hosts app-managed OCR runtime archives for Vox Jot. The runtime
archive contains the `ocr_runtime` Python sidecar package and its Python
dependencies for neural Screen OCR backends.

The archive does not contain Vox Jot credentials, signing material, user data,
transcripts, or private app distribution secrets. It also does not contain OCR
model weights; Vox Jot downloads model weights through the app's OCR model
catalog.

## Files

- `ocr-runtime-macos-aarch64-all.tar.gz`: macOS Apple Silicon runtime bundle.
- `ocr-runtime-macos-aarch64-all.tar.gz.sha256`: SHA-256 checksum consumed by
  the app before extraction.

Future platform archives should follow the same filename shape:

- `ocr-runtime-macos-x64-all.tar.gz`
- `ocr-runtime-linux-x64-all.tar.gz`
- `ocr-runtime-windows-x64-all.tar.gz`

## App Contract

Vox Jot downloads concrete files from this repository, verifies the checksum,
extracts the archive under the app support runtime directory, and then marks
neural OCR models runnable only after the runtime entrypoint, Python
interpreter, and required modules are available.
