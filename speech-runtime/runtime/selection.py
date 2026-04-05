from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class RuntimeSelection:
    provider_id: str | None = None
    model_id: str | None = None
    profile_id: str | None = None


def load_selection(path: Path) -> RuntimeSelection:
    if not path.exists():
        return RuntimeSelection()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return RuntimeSelection()
    return RuntimeSelection(
        provider_id=data.get("provider_id"),
        model_id=data.get("model_id"),
        profile_id=data.get("profile_id"),
    )


def save_selection(path: Path, selection: RuntimeSelection) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(selection), indent=2), encoding="utf-8")
