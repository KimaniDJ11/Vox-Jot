from __future__ import annotations

import json
import stat
from pathlib import Path
from uuid import UUID


PROFILE_METADATA_FILE_NAME = "profile.json"
REFERENCE_AUDIO_FILE_NAME = "reference.wav"


class ProfileStoreError(ValueError):
    """Raised when a voice-profile path is unsafe or malformed."""


def validate_profile_id(profile_id: str) -> None:
    try:
        parsed = UUID(profile_id)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ProfileStoreError("Voice profile ID must be a canonical UUID.") from exc

    if str(parsed) != profile_id:
        raise ProfileStoreError("Voice profile ID must be a canonical UUID.")


def _validate_directory(path: Path, label: str) -> bool:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise ProfileStoreError(f"Failed to inspect {label}: {exc}") from exc

    if stat.S_ISLNK(mode):
        raise ProfileStoreError(f"{label} cannot be a symbolic link.")
    if not stat.S_ISDIR(mode):
        raise ProfileStoreError(f"{label} is not a directory.")
    return True


def _validate_regular_file(path: Path, label: str) -> bool:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise ProfileStoreError(f"Failed to inspect {label}: {exc}") from exc

    if stat.S_ISLNK(mode):
        raise ProfileStoreError(f"{label} cannot be a symbolic link.")
    if not stat.S_ISREG(mode):
        raise ProfileStoreError(f"{label} is not a file.")
    return True


def load_profile_from_store(
    profiles_dir: Path | None,
    profile_id: str | None,
) -> tuple[str | None, str | None]:
    if not profile_id:
        return None, None

    # Validate before consulting the configured store so malformed direct API
    # input is rejected even when profile storage is unavailable.
    validate_profile_id(profile_id)
    if profiles_dir is None:
        return None, None

    profiles_root = Path(profiles_dir)
    if not _validate_directory(profiles_root.parent, "TTS storage directory"):
        return None, None
    if not _validate_directory(profiles_root, "TTS profile storage directory"):
        return None, None

    profile_dir = profiles_root / profile_id
    if not _validate_directory(profile_dir, "Voice profile directory"):
        return None, None

    metadata_path = profile_dir / PROFILE_METADATA_FILE_NAME
    reference_audio = profile_dir / REFERENCE_AUDIO_FILE_NAME
    metadata_exists = _validate_regular_file(metadata_path, "Voice profile metadata")
    reference_exists = _validate_regular_file(
        reference_audio,
        "Voice profile reference audio",
    )

    transcript = None
    if metadata_exists:
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ProfileStoreError("Voice profile metadata is unreadable.") from exc

        if not isinstance(metadata, dict) or metadata.get("id") != profile_id:
            raise ProfileStoreError(
                "Voice profile metadata ID does not match its directory."
            )
        metadata_transcript = metadata.get("transcript")
        if metadata_transcript is not None and not isinstance(metadata_transcript, str):
            raise ProfileStoreError("Voice profile transcript is invalid.")
        transcript = metadata_transcript

    if reference_exists:
        return str(reference_audio), transcript
    return None, transcript
