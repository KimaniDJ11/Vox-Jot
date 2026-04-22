from __future__ import annotations

from typing import Any


def unwrap_control_value(value: Any) -> Any:
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value


def normalize_controls(extra_controls: dict[str, Any] | None) -> dict[str, Any]:
    raw = extra_controls or {}
    tuning = raw.get("tuning")
    source = tuning if isinstance(tuning, dict) else raw
    controls = {key: unwrap_control_value(value) for key, value in source.items()}
    return {
        "tempo_rate": float(controls.get("tempo_rate", 1.0)),
        "expressiveness": float(controls.get("expressiveness", 0.5)),
        "exaggeration": float(controls.get("exaggeration", 0.5)),
        "randomness": float(controls.get("randomness", 0.7)),
        "guidance": float(controls.get("guidance", 0.5)),
        "stability": float(controls.get("stability", 0.5)),
        "repetition_penalty": float(controls.get("repetition_penalty", 1.2)),
        "style_instructions": (
            str(controls["style_instructions"]).strip()
            if controls.get("style_instructions")
            else None
        ),
    }


def map_controls_for_engine(provider_id: str, controls: dict[str, Any]) -> dict[str, Any]:
    randomness = max(0.0, min(1.0, float(controls.get("randomness", 0.7))))
    top_p = 0.5 + (randomness * 0.5)
    mapped: dict[str, Any] = {}

    if provider_id in {"kokoro", "openvoice"}:
        mapped["speed"] = float(controls.get("tempo_rate", 1.0))

    if provider_id == "chatterbox":
        mapped["cfg_weight"] = float(controls.get("guidance", 0.5))
        mapped["temperature"] = max(0.1, randomness)
        mapped["repetition_penalty"] = float(controls.get("repetition_penalty", 1.2))
        mapped["exaggeration"] = max(
            float(controls.get("expressiveness", 0.5)),
            float(controls.get("exaggeration", 0.5)),
        )

    if provider_id == "xtts":
        mapped["speed"] = float(controls.get("tempo_rate", 1.0))
        mapped["temperature"] = max(0.1, randomness)
        mapped["repetition_penalty"] = float(controls.get("repetition_penalty", 2.0))
        mapped["top_p"] = top_p
        mapped["top_k"] = int(round(20 + (randomness * 80)))

    return mapped
