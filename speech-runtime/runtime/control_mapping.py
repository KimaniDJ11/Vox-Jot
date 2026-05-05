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
    advanced = controls.pop("advanced_overrides", None)
    if isinstance(advanced, dict):
        controls.update({key: unwrap_control_value(value) for key, value in advanced.items()})
    return {
        "tempo_rate": float(controls.get("tempo_rate", 1.0)),
        "expressiveness": float(controls.get("expressiveness", 0.5)),
        "exaggeration": float(controls.get("exaggeration", 0.5)),
        "randomness": float(controls.get("randomness", 0.7)),
        "guidance": float(controls.get("guidance", 0.5)),
        "stability": float(controls.get("stability", 0.5)),
        "repetition_penalty": float(controls.get("repetition_penalty", 1.2)),
        "cfg_weight": float(controls["cfg_weight"]) if controls.get("cfg_weight") is not None else None,
        "sdp_ratio": float(controls["sdp_ratio"]) if controls.get("sdp_ratio") is not None else None,
        "noise_scale": float(controls["noise_scale"]) if controls.get("noise_scale") is not None else None,
        "noise_scale_w": float(controls["noise_scale_w"]) if controls.get("noise_scale_w") is not None else None,
        "tau": float(controls["tau"]) if controls.get("tau") is not None else None,
        "top_p": float(controls.get("top_p", 0.0)) if controls.get("top_p") is not None else None,
        "top_k": int(float(controls["top_k"])) if controls.get("top_k") is not None else None,
        "min_p": float(controls.get("min_p", 0.0)) if controls.get("min_p") is not None else None,
        "max_tokens": int(float(controls["max_tokens"])) if controls.get("max_tokens") is not None else None,
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

    if provider_id == "openvoice":
        for key in ("sdp_ratio", "noise_scale", "noise_scale_w", "tau"):
            if controls.get(key) is not None:
                mapped[key] = float(controls[key])

    if provider_id == "chatterbox":
        mapped["cfg_weight"] = float(controls.get("guidance", 0.5))
        mapped["temperature"] = max(0.1, randomness)
        mapped["repetition_penalty"] = float(controls.get("repetition_penalty", 1.2))
        mapped["top_p"] = (
            float(controls["top_p"]) if controls.get("top_p") is not None else 0.95
        )
        if controls.get("min_p") is not None:
            mapped["min_p"] = float(controls["min_p"])
        mapped["exaggeration"] = max(
            float(controls.get("expressiveness", 0.5)),
            float(controls.get("exaggeration", 0.5)),
        )

    if provider_id == "xtts":
        mapped["speed"] = float(controls.get("tempo_rate", 1.0))
        mapped["temperature"] = max(0.1, randomness)
        mapped["repetition_penalty"] = float(controls.get("repetition_penalty", 2.0))
        mapped["top_p"] = (
            float(controls["top_p"]) if controls.get("top_p") is not None else top_p
        )
        mapped["top_k"] = (
            int(controls["top_k"])
            if controls.get("top_k") is not None
            else int(round(20 + (randomness * 80)))
        )

    return mapped
