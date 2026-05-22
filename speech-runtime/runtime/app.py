from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from .config import ENGINE_SPECS, EngineSpec, current_platform, load_runtime_config
from .control_mapping import map_controls_for_engine, normalize_controls
from .selection import RuntimeSelection, load_selection, save_selection
from .worker_host import WorkerHost


class PrepareRequest(BaseModel):
    provider_id: str | None = None
    model_id: str | None = None


class SelectionRequest(BaseModel):
    provider_id: str | None = None
    model_id: str | None = None
    profile_id: str | None = None


class SpeechRequest(BaseModel):
    input: str | None = None
    text: str | None = None
    model: str | None = None
    voice: str | None = None
    locale: str | None = None
    language: str | None = None
    format: str = "wav"
    profile_id: str | None = None
    extra_controls: dict[str, Any] | None = None


class VoiceConversionRequest(BaseModel):
    source_audio_path: str
    model: str | None = "openvoice"
    provider_id: str | None = "openvoice"
    profile_id: str
    tau: float = 0.3


config = load_runtime_config()
config.state_dir.mkdir(parents=True, exist_ok=True)
host = WorkerHost(config)
selection_file = config.state_dir / "selection.json"

app = FastAPI(title="Vox Jot Speech Runtime", version="0.1.0")


def discover_model(spec: EngineSpec) -> Path | None:
    for relative in spec.model_dirs:
        candidate = config.model_store / relative
        if candidate.exists():
            return candidate
    return None


def engine_for_provider(provider_id: str) -> EngineSpec | None:
    for spec in ENGINE_SPECS:
        if spec.provider_id == provider_id:
            return spec
    return None


def engine_for_model(model_id: str) -> EngineSpec | None:
    for spec in ENGINE_SPECS:
        if spec.model_id == model_id:
            return spec
    return None


def engine_for_request(provider_id: str | None = None, model_id: str | None = None) -> EngineSpec | None:
    if provider_id and model_id:
        for spec in ENGINE_SPECS:
            if spec.provider_id == provider_id and spec.model_id == model_id:
                return spec
    if model_id:
        spec = engine_for_model(model_id)
        if spec is not None:
            return spec
    if provider_id:
        return engine_for_provider(provider_id)
    return None


def engine_supports_voice_conversion(spec: EngineSpec) -> bool:
    return (spec.provider_id, spec.model_id) in {
        ("openvoice", "openvoice"),
        ("chatterbox", "chatterbox"),
        ("chatterbox", "chatterbox-turbo"),
        ("chatterbox", "chatterbox-multilingual"),
    }


def load_profile(profile_id: str | None) -> tuple[str | None, str | None]:
    if not profile_id or not config.profiles_dir:
        return None, None
    profile_dir = config.profiles_dir / profile_id
    reference_audio = profile_dir / "reference.wav"
    metadata_path = profile_dir / "profile.json"
    transcript = None
    if metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            transcript = metadata.get("transcript")
        except Exception:
            transcript = None
    if reference_audio.exists():
        return str(reference_audio), transcript
    return None, transcript


def selection_payload(selection: RuntimeSelection) -> dict[str, Any]:
    return {
        "selected_provider_id": selection.provider_id,
        "selected_model_id": selection.model_id,
        "selected_profile_id": selection.profile_id,
    }


def model_readiness(spec: EngineSpec, model_dir: Path) -> tuple[str, list[str]]:
    if host.worker_ready(spec, model_dir):
        return "ready", []
    return (
        "downloaded",
        [f"{spec.label} is installed. Vox Jot will finish preparing its runtime automatically on first use."],
    )


def catalog_payload() -> dict[str, Any]:
    selection = load_selection(selection_file)
    providers = []
    models = []
    platform_id = current_platform()

    for spec in ENGINE_SPECS:
        model_dir = discover_model(spec)
        if model_dir is None:
            continue
        status, issues = model_readiness(spec, model_dir)
        providers.append(
            {
                "id": spec.provider_id,
                "label": spec.label,
                "description": spec.description,
                "source_label": "Vox Jot managed runtime",
                "provider": {
                    "id": spec.provider_id,
                    "label": spec.label,
                    "engine_family": spec.engine_family,
                    "runtime_kind": "managed_sidecar",
                    "supported_platforms": [platform_id],
                    "license_label": spec.license_label,
                },
            }
        )
        models.append(
            {
                "id": spec.model_id,
                "provider_id": spec.provider_id,
                "label": spec.label,
                "description": spec.description,
                "source_label": "Local Vox Jot model store",
                "local_path": str(model_dir),
                "supported_languages": list(spec.supported_languages),
                "capabilities": {
                    "supports_basic_tts": True,
                    "supports_voice_cloning": spec.supports_voice_cloning,
                    "supports_reference_transcript": spec.supports_voice_cloning,
                    "supports_instruction_prompt": spec.supports_instruction_prompt,
                    "supports_inline_tags": spec.supports_inline_tags,
                    "supports_preset_speakers": bool(spec.default_voice),
                    "supports_voice_design": False,
                    "supports_multilingual": len(spec.supported_languages) > 1
                    or "mul" in spec.supported_languages,
                    "supports_multi_speaker": True,
                    "supports_streaming": False,
                    "supports_audio_editing": False,
                },
                "readiness": {
                    "status": status,
                    "runtime_label": "Speech runtime",
                    "issues": issues,
                    "local_path": str(model_dir),
                },
                "style_controls": list(spec.style_controls),
            }
        )

    return {
        "providers": providers,
        "models": models,
        "selection": selection_payload(selection),
    }


def resolve_target(request_body: SpeechRequest) -> tuple[EngineSpec, Path, RuntimeSelection]:
    selection = load_selection(selection_file)
    spec = None
    if request_body.extra_controls and request_body.extra_controls.get("provider_id"):
        spec = engine_for_request(
            str(request_body.extra_controls.get("provider_id") or ""),
            str(request_body.extra_controls.get("model_id") or ""),
        )
    if spec is None and request_body.model:
        spec = engine_for_model(request_body.model)
    if spec is None and selection.model_id:
        spec = engine_for_model(selection.model_id)
    if spec is None and selection.provider_id:
        spec = engine_for_provider(selection.provider_id)
    if spec is None:
        raise HTTPException(status_code=400, detail="No managed speech model is selected.")
    model_dir = discover_model(spec)
    if model_dir is None:
        raise HTTPException(status_code=404, detail=f"{spec.label} is not installed in the model store.")
    return spec, model_dir, selection


@app.get("/health")
async def health() -> dict[str, Any]:
    payload = catalog_payload()
    return {
        "status": "ok",
        "providers": len(payload["providers"]),
        "models": len(payload["models"]),
    }


@app.get("/listen/catalog")
async def listen_catalog() -> JSONResponse:
    return JSONResponse(catalog_payload())


@app.get("/listen/voices")
async def listen_voices(
    provider_id: str = Query(...),
    model_id: str | None = Query(default=None),
) -> JSONResponse:
    spec = engine_for_request(provider_id, model_id)
    if spec is None:
        raise HTTPException(status_code=400, detail="Unknown provider or model.")

    model_dir = discover_model(spec)
    if model_dir is None:
        raise HTTPException(status_code=404, detail=f"{spec.label} is not installed in the model store.")

    try:
        voices = await asyncio.to_thread(host.list_voices, spec, model_dir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return JSONResponse(voices)


@app.post("/listen/prepare")
async def listen_prepare(body: PrepareRequest) -> JSONResponse:
    spec = engine_for_request(body.provider_id, body.model_id)
    if spec is None:
        raise HTTPException(status_code=400, detail="Unknown provider or model.")
    model_dir = discover_model(spec)
    if model_dir is None:
        raise HTTPException(status_code=404, detail=f"{spec.label} is not installed in the model store.")

    if host.worker_ready(spec, model_dir):
        return JSONResponse({"status": "ready", "provider_id": spec.provider_id})

    try:
        await asyncio.to_thread(host.warm_model, spec, model_dir)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to prepare {spec.provider_id}/{spec.model_id}: {exc}",
        ) from exc

    return JSONResponse({"status": "ready", "provider_id": spec.provider_id})


@app.post("/listen/selection")
async def listen_selection(body: SelectionRequest) -> JSONResponse:
    selection = RuntimeSelection(
        provider_id=(body.provider_id or "").strip() or None,
        model_id=(body.model_id or "").strip() or None,
        profile_id=(body.profile_id or "").strip() or None,
    )
    save_selection(selection_file, selection)

    spec = engine_for_request(selection.provider_id, selection.model_id)
    model_dir = discover_model(spec) if spec else None
    if spec and model_dir:
        asyncio.create_task(asyncio.to_thread(host.warm_model, spec, model_dir))

    return JSONResponse(selection_payload(selection))


@app.post("/v1/audio/speech")
async def audio_speech(body: SpeechRequest) -> Response:
    text = (body.input or body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Speech input is empty.")
    if body.format.lower() != "wav":
        raise HTTPException(status_code=400, detail="Only WAV output is supported by the managed runtime.")

    spec, model_dir, selection = resolve_target(body)
    selected_voice = body.voice
    profile_id = body.profile_id or selection.profile_id
    reference_audio_path, reference_transcript = load_profile(profile_id)
    controls = normalize_controls(body.extra_controls)
    engine_controls = map_controls_for_engine(spec.provider_id, controls, spec.model_id)

    try:
        audio = await asyncio.to_thread(
            host.synthesize,
            spec,
            model_dir,
            {
                "text": text,
                "voice": selected_voice or spec.default_voice,
                "locale": body.locale or body.language,
                "speed": float(controls.get("tempo_rate", 1.0)),
                "controls": engine_controls,
                "normalized_controls": controls,
                "reference_audio_path": reference_audio_path,
                "reference_transcript": reference_transcript,
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Synthesis failed for {spec.provider_id}/{spec.model_id}: {exc}",
        ) from exc

    return Response(content=audio, media_type="audio/wav")


@app.post("/v1/audio/voice-conversion")
async def audio_voice_conversion(body: VoiceConversionRequest) -> Response:
    source_audio_path = Path(body.source_audio_path).expanduser()
    if not source_audio_path.exists():
        raise HTTPException(status_code=404, detail="Source audio file was not found.")

    spec = engine_for_request(body.provider_id, body.model)
    if spec is None:
        raise HTTPException(status_code=400, detail="No voice changer model is selected.")
    if not engine_supports_voice_conversion(spec):
        raise HTTPException(status_code=400, detail=f"{spec.label} does not support voice changing.")

    model_dir = discover_model(spec)
    if model_dir is None:
        raise HTTPException(status_code=404, detail=f"{spec.label} is not installed in the model store.")

    target_audio_path, _target_transcript = load_profile(body.profile_id)
    if not target_audio_path:
        raise HTTPException(status_code=400, detail="Target voice profile needs reference audio first.")

    try:
        audio = await asyncio.to_thread(
            host.convert_voice,
            spec,
            model_dir,
            {
                "source_audio_path": str(source_audio_path),
                "target_audio_path": target_audio_path,
                "controls": {
                    "tau": max(0.0, min(1.0, float(body.tau))),
                },
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Voice conversion failed for {spec.provider_id}/{spec.model_id}: {exc}",
        ) from exc

    return Response(content=audio, media_type="audio/wav")


def main() -> None:
    import uvicorn

    uvicorn.run(
        "runtime.app:app",
        host=config.listen_host,
        port=config.listen_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
