#!/usr/bin/env python3
"""Copy any keys present in en/translation.json but missing from other locales.

This is a quick one-off used after large additions to the English source. The
copies retain the English text — translators replace them in follow-up passes.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "src" / "i18n" / "locales"
EN_PATH = LOCALES / "en" / "translation.json"


def load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def merge_missing(reference, target):
    """Recursively add keys from reference into target if absent."""
    if isinstance(reference, dict) and isinstance(target, dict):
        for key, ref_value in reference.items():
            if key not in target:
                target[key] = ref_value
            else:
                target[key] = merge_missing(ref_value, target[key])
        return target
    if isinstance(reference, dict) and not isinstance(target, dict):
        # Target had a scalar where reference has a tree — keep the structure.
        return reference
    return target


def main() -> None:
    reference = load(EN_PATH)
    for locale_dir in sorted(LOCALES.iterdir()):
        if not locale_dir.is_dir() or locale_dir.name == "en":
            continue
        translation_path = locale_dir / "translation.json"
        if not translation_path.exists():
            continue
        existing = load(translation_path)
        merged = merge_missing(reference, existing)
        translation_path.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"synced {locale_dir.name}")


if __name__ == "__main__":
    main()
