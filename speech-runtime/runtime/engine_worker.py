from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any
from urllib import request


def write_response(ok: bool, **payload: Any) -> None:
    print(json.dumps({"ok": ok, **payload}), flush=True)


def detect_device():
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if sys.platform == "darwin" and torch.backends.mps.is_available():
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        return "mps"
    return "cpu"


def write_wav(path: Path, samples, sample_rate: int) -> None:
    import numpy as np

    array = np.asarray(samples, dtype=np.float32).reshape(-1)
    pcm = np.clip(array, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


class EngineWorker:
    def __init__(self, provider_id: str, model_id: str, model_dir: Path, state_dir: Path, profiles_dir: Path | None):
        self.provider_id = provider_id
        self.model_id = model_id
        self.model_dir = model_dir
        self.state_dir = state_dir
        self.profiles_dir = profiles_dir
        self.device = None
        self.engine = None
        self.fish_url = None

    def warm(self) -> None:
        self._ensure_engine()

    def synthesize(self, payload: dict[str, Any]) -> Path:
        self._ensure_engine()
        output_path = Path(tempfile.gettempdir()) / f"vox-jot-{self.provider_id}-{os.getpid()}-{next(tempfile._get_candidate_names())}.wav"
        if self.provider_id == "kokoro":
            self._synthesize_kokoro(payload, output_path)
        elif self.provider_id == "chatterbox":
            self._synthesize_chatterbox(payload, output_path)
        elif self.provider_id == "xtts":
            self._synthesize_xtts(payload, output_path)
        elif self.provider_id == "openvoice":
            self._synthesize_openvoice(payload, output_path)
        elif self.provider_id == "fish_speech":
            self._synthesize_fish(payload, output_path)
        else:
            raise RuntimeError(f"Unsupported provider '{self.provider_id}'.")
        return output_path

    def _ensure_engine(self):
        if self.engine is not None or self.provider_id == "fish_speech":
            return
        self.device = detect_device()

        if self.provider_id == "kokoro":
            from kokoro.model import KModel

            checkpoints = self.model_dir / "checkpoints"
            model = KModel(
                config=str(checkpoints / "config.json"),
                model=str(checkpoints / "kokoro-v1_0.pth"),
            ).to(self.device).eval()
            self.engine = {"model": model, "pipelines": {}}
            return

        if self.provider_id == "chatterbox":
            checkpoints = self.model_dir / "checkpoints"
            if (checkpoints / "turbo").exists():
                from chatterbox.tts_turbo import ChatterboxTurboTTS

                self.engine = ChatterboxTurboTTS.from_local(checkpoints / "turbo", self.device)
            else:
                from chatterbox.tts import ChatterboxTTS

                self.engine = ChatterboxTTS.from_local(checkpoints / "base", self.device)
            return

        if self.provider_id == "xtts":
            from TTS.tts.models import xtts as xtts_module
            from TTS.utils.synthesizer import Synthesizer
            import TTS.utils.io as tts_io

            original_load_fsspec = tts_io.load_fsspec

            def trusted_load_fsspec(path, *args, **kwargs):
                kwargs.setdefault("weights_only", False)
                return original_load_fsspec(path, *args, **kwargs)

            tts_io.load_fsspec = trusted_load_fsspec
            xtts_module.load_fsspec = trusted_load_fsspec

            checkpoints = self._xtts_checkpoint_dir()
            self.engine = Synthesizer(
                model_dir=str(checkpoints),
                use_cuda=self.device == "cuda",
            )
            return

        if self.provider_id == "openvoice":
            import torch
            from melo.api import TTS as MeloTTS
            from openvoice.api import ToneColorConverter

            checkpoints = self._openvoice_checkpoint_root()
            converter_root = checkpoints / "converter"

            converter = ToneColorConverter(str(converter_root / "config.json"), device=self.device)
            converter.load_ckpt(str(converter_root / "checkpoint.pth"))

            self.engine = {
                "converter": converter,
                "melo_cls": MeloTTS,
                "melo_models": {},
                "torch": torch,
            }
            return

    def _kokoro_pipeline(self, locale: str | None):
        from kokoro.pipeline import KPipeline

        lang = self._kokoro_lang(locale)
        pipeline = self.engine["pipelines"].get(lang)
        if pipeline is None:
            pipeline = KPipeline(
                lang_code=lang,
                model=self.engine["model"],
                device=self.device,
            )
            self.engine["pipelines"][lang] = pipeline
        return pipeline

    def _kokoro_lang(self, locale: str | None) -> str:
        if not locale:
            return "a"
        prefix = locale.lower().split("-")[0]
        return {
            "en": "a",
            "es": "e",
            "fr": "f",
            "hi": "h",
            "it": "i",
            "pt": "p",
            "ja": "j",
            "zh": "z",
        }.get(prefix, "a")

    def _kokoro_voice_path(self, voice: str | None) -> str:
        voice_name = voice or "af_heart"
        candidate = self.model_dir / "checkpoints" / "voices" / f"{voice_name}.pt"
        if candidate.exists():
            return str(candidate)
        return str(self.model_dir / "checkpoints" / "voices" / "af_heart.pt")

    def _synthesize_kokoro(self, payload: dict[str, Any], output_path: Path) -> None:
        import numpy as np

        pipeline = self._kokoro_pipeline(payload.get("locale"))
        voice = self._kokoro_voice_path(payload.get("voice"))
        speed = float(payload.get("speed") or 1.0)
        chunks = []
        for result in pipeline(payload["text"], voice=voice, speed=speed, split_pattern=r"\n+"):
            if result.audio is None:
                continue
            chunks.append(result.audio.numpy())
        if not chunks:
            raise RuntimeError("Kokoro did not generate any audio.")
        audio = np.concatenate(chunks)
        write_wav(output_path, audio, 24000)

    def _synthesize_chatterbox(self, payload: dict[str, Any], output_path: Path) -> None:
        import numpy as np

        controls = payload.get("controls", {})
        audio_prompt = payload.get("reference_audio_path")
        wav = self.engine.generate(
            payload["text"],
            audio_prompt_path=audio_prompt,
            cfg_weight=float(controls.get("cfg_weight", 0.5)),
            temperature=float(controls.get("temperature", 0.8)),
            repetition_penalty=float(controls.get("repetition_penalty", 1.2)),
            top_p=float(controls.get("top_p", 0.95)),
            exaggeration=float(controls.get("expressiveness", 0.5)),
        )
        if hasattr(wav, "detach"):
            wav = wav.detach().cpu().numpy()
        write_wav(output_path, np.asarray(wav).reshape(-1), self.engine.sr)

    def _xtts_checkpoint_dir(self) -> Path:
        for candidate in (
            self.model_dir / "checkpoints" / "xtts-v2",
            self.model_dir / "xtts-v2",
            self.model_dir,
        ):
            if (candidate / "config.json").exists() and (candidate / "model.pth").exists():
                return candidate
        raise RuntimeError("XTTS checkpoints are missing.")

    def _default_xtts_reference(self, locale: str | None) -> str:
        checkpoints = self._xtts_checkpoint_dir()
        samples = checkpoints / "samples"
        language = (locale or "en").lower().split("-")[0]
        by_language = {
            "en": samples / "en_sample.wav",
            "es": samples / "es_sample.wav",
            "fr": samples / "fr_sample.wav",
            "de": samples / "de_sample.wav",
            "pt": samples / "pt_sample.wav",
            "zh": samples / "zh-cn-sample.wav",
            "ja": samples / "ja-sample.wav",
            "tr": samples / "tr_sample.wav",
        }
        chosen = by_language.get(language, samples / "en_sample.wav")
        return str(chosen if chosen.exists() else samples / "en_sample.wav")

    def _synthesize_xtts(self, payload: dict[str, Any], output_path: Path) -> None:
        controls = payload.get("controls", {})
        locale = (payload.get("locale") or "en").lower().split("-")[0]
        speaker_wav = payload.get("reference_audio_path") or self._default_xtts_reference(locale)
        wav = self.engine.tts(
            text=payload["text"],
            speaker_name=None,
            speaker_wav=speaker_wav,
            language_name=locale,
            speed=float(controls.get("speed", 1.0)),
            temperature=float(controls.get("temperature", 0.65)),
            repetition_penalty=float(controls.get("repetition_penalty", 2.0)),
            top_k=int(float(controls.get("top_k", 50))),
            top_p=float(controls.get("top_p", 0.8)),
        )
        self.engine.save_wav(wav, str(output_path))

    def _openvoice_checkpoint_root(self) -> Path:
        for candidate in (self.model_dir / "checkpoints_v2", self.model_dir / "checkpoints"):
            if (candidate / "base_speakers" / "ses").exists() and (candidate / "converter").exists():
                return candidate
        raise RuntimeError("OpenVoice checkpoints are missing.")

    def _openvoice_language(self, locale: str | None) -> str:
        prefix = (locale or "en").lower().split("-")[0]
        return {
            "en": "EN",
            "es": "ES",
            "fr": "FR",
            "zh": "ZH",
            "ja": "JP",
            "jp": "JP",
            "ko": "KR",
            "kr": "KR",
        }.get(prefix, "EN")

    def _openvoice_melo(self, language: str):
        model = self.engine["melo_models"].get(language)
        if model is None:
            model = self.engine["melo_cls"](language=language, device=self.device)
            self.engine["melo_models"][language] = model
        return model

    def _normalize_openvoice_voice(self, voice: str | None) -> str | None:
        if not voice:
            return None
        return voice.strip().lower().replace("_", "-")

    def _openvoice_speaker_key(self, model, voice: str | None, language: str) -> str:
        wanted = self._normalize_openvoice_voice(voice)
        speaker_keys = list(model.hps.data.spk2id.keys())
        normalized = {key.lower().replace("_", "-"): key for key in speaker_keys}
        if wanted and wanted in normalized:
            return normalized[wanted]

        if language == "EN":
            for candidate in ("en-default", "en-us", "en", "en-newest"):
                if candidate in normalized:
                    return normalized[candidate]

        for candidate in normalized:
            if candidate.startswith(language.lower()):
                return normalized[candidate]

        return speaker_keys[0]

    def _openvoice_source_se(self, checkpoints: Path, speaker_key: str):
        speaker_file = speaker_key.lower().replace("_", "-")
        source_path = checkpoints / "base_speakers" / "ses" / f"{speaker_file}.pth"
        if not source_path.exists():
            raise RuntimeError(f"OpenVoice speaker embedding is missing for '{speaker_key}'.")
        return self.engine["torch"].load(str(source_path), map_location=self.device)

    def _synthesize_openvoice(self, payload: dict[str, Any], output_path: Path) -> None:
        locale = payload.get("locale")
        language = self._openvoice_language(locale)
        speed = float(payload.get("controls", {}).get("speed", 1.0))
        checkpoints = self._openvoice_checkpoint_root()
        model = self._openvoice_melo(language)
        speaker_key = self._openvoice_speaker_key(model, payload.get("voice"), language)
        speaker_id = model.hps.data.spk2id[speaker_key]
        source_se = self._openvoice_source_se(checkpoints, speaker_key)
        converter = self.engine["converter"]

        with tempfile.TemporaryDirectory(prefix="vox-jot-openvoice-") as temp_dir:
            temp_dir_path = Path(temp_dir)
            raw_path = temp_dir_path / "raw.wav"
            model.tts_to_file(payload["text"], speaker_id, str(raw_path), speed=speed)
            reference_audio = payload.get("reference_audio_path")
            if reference_audio:
                target_se = converter.extract_se(
                    reference_audio,
                    se_save_path=str(temp_dir_path / "target_se.pth"),
                )
                converter.convert(
                    audio_src_path=str(raw_path),
                    src_se=source_se.to(self.device),
                    tgt_se=target_se,
                    output_path=str(output_path),
                    message="@VoxJot",
                )
            else:
                output_path.write_bytes(raw_path.read_bytes())

    def _ensure_fish_server(self) -> str:
        if self.fish_url is not None:
            return self.fish_url
        state_path = self.state_dir / "engines" / "fish_speech" / "fish_server.json"
        if state_path.exists():
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                self.fish_url = state["url"]
                return self.fish_url
            except Exception:
                pass
        raise RuntimeError("Fish Speech server is not running.")

    def _synthesize_fish(self, payload: dict[str, Any], output_path: Path) -> None:
        import base64

        fish_url = self._ensure_fish_server()
        controls = payload.get("controls", {})
        references = []
        if payload.get("reference_audio_path") and payload.get("reference_transcript"):
            references.append(
                {
                    "audio": base64.b64encode(Path(payload["reference_audio_path"]).read_bytes()).decode("ascii"),
                    "text": payload["reference_transcript"],
                }
            )
        body = json.dumps(
            {
                "text": payload["text"],
                "format": "wav",
                "references": references,
                "top_p": float(controls.get("top_p", 0.8)),
                "temperature": float(controls.get("temperature", 0.7)),
                "repetition_penalty": float(controls.get("repetition_penalty", 1.2)),
            }
        ).encode("utf-8")
        req = request.Request(
            f"{fish_url}/v1/tts",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with request.urlopen(req, timeout=240) as response:
            output_path.write_bytes(response.read())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider-id", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--profiles-dir", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    worker = EngineWorker(
        provider_id=args.provider_id,
        model_id=args.model_id,
        model_dir=Path(args.model_dir),
        state_dir=Path(args.state_dir),
        profiles_dir=Path(args.profiles_dir) if args.profiles_dir else None,
    )

    if worker.provider_id == "fish_speech":
        state_path = worker.state_dir / "engines" / "fish_speech" / "fish_server.json"
        if state_path.exists():
            try:
                worker.fish_url = json.loads(state_path.read_text(encoding="utf-8")).get("url")
            except Exception:
                worker.fish_url = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request_payload = json.loads(line)
            action = request_payload.get("action")
            if action == "warm":
                worker.warm()
                write_response(True)
                continue
            if action == "synthesize":
                output_path = worker.synthesize(request_payload["payload"])
                write_response(True, output_path=str(output_path))
                continue
            write_response(False, error=f"Unknown action '{action}'.")
        except Exception as exc:
            write_response(False, error=str(exc))


if __name__ == "__main__":
    main()
