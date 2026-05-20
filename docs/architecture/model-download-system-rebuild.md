# Model Download System Rebuild

## Research Inputs

The rebuild follows patterns from mature open-source download and package systems:

- Hugging Face Hub: snapshot-style repo acquisition, cache reuse, resumable downloads, and current `hf_xet` chunk deduplication for large files.
- aria2: resumable downloads, segmented transfers, Metalink checksums, and RPC-style job control.
- OCI/Docker: immutable descriptors, digest-addressed blobs, layer reuse, and bounded concurrent pulls.
- The Update Framework: signed metadata with hashes, versions, expiry, and rollback/freeze protection.
- Flatpak/OSTree: content-addressed objects and optional static deltas for efficient artifact updates.

Sources:

- https://huggingface.co/docs/huggingface_hub/en/guides/download
- https://aria2.github.io/manual/en/html/README.html
- https://github.com/opencontainers/image-spec/blob/main/descriptor.md
- https://docs.docker.com/reference/cli/docker/image/pull/
- https://theupdateframework.io/docs/overview/
- https://docs.flatpak.org/en/latest/hosting-a-repository.html

## Vox Jot Requirements

Vox Jot downloads large model and runtime artifacts across STT, TTS, OCR, speech analysis, and LLM refinement. Downloads must not touch dictation hot paths: recording start, stop capture, transcription, paste, overlay responsiveness, or settings responsiveness.

The shared downloader therefore owns acquisition concerns only:

- file discovery
- resumable partial files
- resumable staging directories
- safe relative paths
- cancellation hooks
- progress events
- size validation
- optional SHA-256 validation
- atomic staging-to-final installs

Runtime loading and dictation execution stay in their existing managers.

## Implemented Core

`src-tauri/src/artifact_download.rs` is the shared acquisition layer.

It exposes:

- `download_hf_repo`: downloads a Hugging Face repo into a staging directory, resumes existing staged files, validates known sizes, and atomically renames into place.
- `download_file`: downloads a standalone URL/archive to a stable `.partial` file, resumes with Range requests, supports GitHub private release fallback, validates expected size and optional SHA-256, then renames into place.
- `artifact-download-progress`: a unified event stream with domain, artifact id, phase, file index, bytes, percent, and error.

Existing domain events are still emitted as compatibility bridges while frontend surfaces migrate:

- `model-download-progress`
- `tts-hf-download-progress`
- `ocr-download-progress`
- `speech-analysis-download-progress`
- `refine-download-progress`

## Migrated Domains

- STT single-file/archive progress now also emits unified artifact progress.
- STT Hugging Face snapshots use the shared HF repo downloader.
- TTS Hugging Face repos use the shared HF repo downloader.
- TTS pack/runtime archives use the shared file downloader.
- OCR model repos use the shared HF repo downloader.
- OCR runtime archives use the shared file downloader with SHA-256 validation.
- Speech-analysis model downloads emit unified artifact progress.
- Refine/LLM GGUF imports use the shared file downloader.

## Next Steps

The next durable improvement is a manifest layer:

- pin Hugging Face downloads to immutable revisions
- store per-file SHA-256 or source digest metadata
- persist job state across app restarts
- add bounded parallelism by file size and domain
- introduce a content-addressed blob cache so equivalent STT/TTS/speech-analysis MLX assets deduplicate on disk
- eventually sign manifests using a TUF-like metadata model

Those are additive on top of the new core and do not need to block the current rebuild.
