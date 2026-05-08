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

KOKORO_VOICE_PREFIX_LOCALES = {
    "af": "en-US",
    "am": "en-US",
    "bf": "en-GB",
    "bm": "en-GB",
    "jf": "ja",
    "jm": "ja",
    "zf": "zh",
    "zm": "zh",
    "ef": "es",
    "em": "es",
    "ff": "fr",
    "hf": "hi",
    "hm": "hi",
    "if": "it",
    "im": "it",
    "pf": "pt-BR",
    "pm": "pt-BR",
}

OPENVOICE_LANGUAGE_LOCALES = {
    "EN": "en-US",
    "ES": "es",
    "FR": "fr",
    "ZH": "zh",
    "JP": "ja",
    "KR": "ko",
}

XTTS_SAMPLE_VOICES = (
    ("sample:en", "English Sample", "en", "en_sample.wav"),
    ("sample:es", "Spanish Sample", "es", "es_sample.wav"),
    ("sample:fr", "French Sample", "fr", "fr_sample.wav"),
    ("sample:de", "German Sample", "de", "de_sample.wav"),
    ("sample:pt", "Portuguese Sample", "pt", "pt_sample.wav"),
    ("sample:zh-cn", "Chinese Sample", "zh-CN", "zh-cn-sample.wav"),
    ("sample:ja", "Japanese Sample", "ja", "ja-sample.wav"),
    ("sample:tr", "Turkish Sample", "tr", "tr_sample.wav"),
)


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


def bundled_reference_audio() -> str | None:
    candidates: list[Path] = []
    env_path = os.environ.get("VOX_JOT_TTS_FALLBACK_PROMPT")
    if env_path:
        candidates.append(Path(env_path))

    current = Path(__file__).resolve()
    for parent in current.parents:
        candidates.append(parent / "mlx_csm_default_prompt.wav")
        candidates.append(parent / "resources" / "python" / "mlx_csm_default_prompt.wav")
        candidates.append(parent / "src-tauri" / "resources" / "python" / "mlx_csm_default_prompt.wav")

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


class EngineWorker:
    def __init__(self, provider_id: str, model_id: str, model_dir: Path, state_dir: Path, profiles_dir: Path | None):
        self.provider_id = provider_id
        self.model_id = model_id
        self.model_dir = model_dir
        self.state_dir = state_dir
        self.profiles_dir = profiles_dir
        self.device = None
        self.engine = None

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
        else:
            raise RuntimeError(f"Unsupported provider '{self.provider_id}'.")
        return output_path

    def list_voices(self) -> list[dict[str, Any]]:
        if self.provider_id == "kokoro":
            return self._list_kokoro_voices()
        if self.provider_id == "openvoice":
            self._ensure_engine()
            return self._list_openvoice_voices()
        if self.provider_id == "xtts":
            return self._list_xtts_voices()
        return []

    def _ensure_engine(self):
        if self.engine is not None:
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
            checkpoints = self._chatterbox_checkpoint_root()
            if self.model_id == "chatterbox-multilingual":
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS

                self.engine = ChatterboxMultilingualTTS.from_local(checkpoints, self.device)
            elif self.model_id == "chatterbox-turbo" or self._is_chatterbox_turbo_root(checkpoints):
                from chatterbox.tts_turbo import ChatterboxTurboTTS

                self.engine = ChatterboxTurboTTS.from_local(checkpoints, self.device)
            else:
                from chatterbox.tts import ChatterboxTTS

                self.engine = ChatterboxTTS.from_local(checkpoints, self.device)
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

    def _voice_entry(self, voice_id: str, label: str, locale: str | None) -> dict[str, Any]:
        return {
            "id": voice_id,
            "label": label,
            "locale": locale,
            "installed": True,
            "available": True,
        }

    def _humanize_voice_label(self, voice_name: str) -> str:
        return voice_name.replace("-", " ").replace("_", " ").title()

    def _kokoro_voice_locale(self, voice_name: str) -> str | None:
        normalized = voice_name.strip().lower()
        for prefix, locale in KOKORO_VOICE_PREFIX_LOCALES.items():
            if normalized == prefix or normalized.startswith(f"{prefix}_"):
                return locale
        return None

    def _list_kokoro_voices(self) -> list[dict[str, Any]]:
        voices_dir = self.model_dir / "checkpoints" / "voices"
        if not voices_dir.exists():
            return []

        voices = []
        for candidate in sorted(voices_dir.glob("*.pt")):
            voice_name = candidate.stem
            voices.append(
                self._voice_entry(
                    voice_name,
                    self._humanize_voice_label(voice_name),
                    self._kokoro_voice_locale(voice_name),
                )
            )
        return voices

    def _is_chatterbox_turbo_root(self, candidate: Path) -> bool:
        return (candidate / "t3_turbo_v1.safetensors").exists() or (
            candidate / "t3_turbo_v1.yaml"
        ).exists()

    def _is_chatterbox_base_root(self, candidate: Path) -> bool:
        return (
            (candidate / "t3_cfg.safetensors").exists()
            or (candidate / "t3_cfg.pt").exists()
            or (candidate / "t3_cfg.yaml").exists()
        )

    def _is_chatterbox_multilingual_root(self, candidate: Path) -> bool:
        return (candidate / "t3_mtl23ls_v2.safetensors").exists() and (
            candidate / "grapheme_mtl_merged_expanded_v1.json"
        ).exists()

    def _chatterbox_checkpoint_root(self) -> Path:
        candidates = (
            self.model_dir / "checkpoints" / "turbo",
            self.model_dir / "checkpoints" / "base",
            self.model_dir / "checkpoints" / "multilingual",
            self.model_dir / "chatterbox-turbo",
            self.model_dir / "chatterbox-multilingual",
            self.model_dir / "chatterbox",
            self.model_dir,
        )
        for candidate in candidates:
            if self.model_id == "chatterbox-multilingual":
                if self._is_chatterbox_multilingual_root(candidate):
                    return candidate
                continue
            if self.model_id == "chatterbox-turbo":
                if self._is_chatterbox_turbo_root(candidate):
                    return candidate
                continue
            if self.model_id == "chatterbox":
                if self._is_chatterbox_base_root(candidate):
                    return candidate
                continue
            if self._is_chatterbox_turbo_root(candidate) or self._is_chatterbox_base_root(candidate):
                return candidate
        raise RuntimeError("Chatterbox checkpoints are missing.")

    def _chatterbox_language_id(self, locale: str | None) -> str:
        language = (locale or "en").strip().lower().replace("_", "-")
        if not language:
            return "en"
        if language in ("zh-cn", "zh-hans", "zh-hant", "zh-tw", "zh-hk"):
            return "zh"
        return language.split("-")[0]

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
        if not audio_prompt and self.model_id in ("chatterbox", "chatterbox-multilingual"):
            audio_prompt = bundled_reference_audio()
        if self.model_id == "chatterbox-multilingual":
            wav = self.engine.generate(
                payload["text"],
                language_id=self._chatterbox_language_id(payload.get("locale")),
                audio_prompt_path=audio_prompt,
                cfg_weight=float(controls.get("cfg_weight", 0.5)),
                temperature=float(controls.get("temperature", 0.8)),
                repetition_penalty=float(controls.get("repetition_penalty", 2.0)),
                min_p=float(controls.get("min_p", 0.05)),
                top_p=float(controls.get("top_p", 1.0)),
                exaggeration=float(
                    controls.get("exaggeration", controls.get("expressiveness", 0.5))
                ),
            )
        elif self.model_id == "chatterbox-turbo":
            wav = self.engine.generate(
                payload["text"],
                audio_prompt_path=audio_prompt,
                temperature=float(controls.get("temperature", 0.8)),
                repetition_penalty=float(controls.get("repetition_penalty", 1.2)),
                top_p=float(controls.get("top_p", 0.95)),
                top_k=int(controls.get("top_k", 1000)),
            )
        else:
            wav = self.engine.generate(
                payload["text"],
                audio_prompt_path=audio_prompt,
                cfg_weight=float(controls.get("cfg_weight", 0.5)),
                temperature=float(controls.get("temperature", 0.8)),
                repetition_penalty=float(controls.get("repetition_penalty", 1.2)),
                top_p=float(controls.get("top_p", 0.95)),
                min_p=float(controls.get("min_p", 0.05)),
                exaggeration=float(
                    controls.get("exaggeration", controls.get("expressiveness", 0.5))
                ),
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
        return self._xtts_reference_for_voice(None, locale)

    def _xtts_sample_reference_paths(self) -> dict[str, Path]:
        checkpoints = self._xtts_checkpoint_dir()
        samples = checkpoints / "samples"
        references: dict[str, Path] = {}
        for voice_id, _label, _locale, filename in XTTS_SAMPLE_VOICES:
            candidate = samples / filename
            if candidate.exists():
                references[voice_id] = candidate
        return references

    def _xtts_default_sample_voice_id(self, locale: str | None) -> str:
        language = (locale or "en").strip().lower().replace("_", "-")
        if language in ("zh", "zh-hans", "zh-hant"):
            return "sample:zh-cn"
        base = language.split("-")[0]
        candidate = f"sample:{base}"
        references = self._xtts_sample_reference_paths()
        if candidate in references:
            return candidate
        return "sample:en"

    def _xtts_reference_for_voice(self, voice: str | None, locale: str | None) -> str:
        references = self._xtts_sample_reference_paths()
        if voice and voice in references:
            return str(references[voice])

        default_voice_id = self._xtts_default_sample_voice_id(locale)
        chosen = references.get(default_voice_id) or references.get("sample:en")
        if chosen is None:
            raise RuntimeError("XTTS sample references are missing.")
        return str(chosen)

    def _list_xtts_voices(self) -> list[dict[str, Any]]:
        references = self._xtts_sample_reference_paths()
        voices = []
        for voice_id, label, locale, _filename in XTTS_SAMPLE_VOICES:
            if voice_id not in references:
                continue
            voices.append(self._voice_entry(voice_id, label, locale))
        return voices

    def _synthesize_xtts(self, payload: dict[str, Any], output_path: Path) -> None:
        controls = payload.get("controls", {})
        locale = (payload.get("locale") or "en").lower().split("-")[0]
        speaker_wav = payload.get("reference_audio_path") or self._xtts_reference_for_voice(
            payload.get("voice"),
            locale,
        )
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

    def _openvoice_label(self, voice_id: str) -> str:
        return voice_id.replace("-", " ").replace("_", " ").title()

    def _openvoice_voice_locale(self, voice_id: str, language: str) -> str | None:
        normalized = voice_id.lower()
        if normalized.startswith("en-gb") or normalized.startswith("en-uk"):
            return "en-GB"
        if normalized.startswith("en"):
            return "en-US"
        return OPENVOICE_LANGUAGE_LOCALES.get(language)

    def _list_openvoice_voices(self) -> list[dict[str, Any]]:
        voices: list[dict[str, Any]] = []
        seen: set[str] = set()

        for language in ("EN", "ES", "FR", "ZH", "JP", "KR"):
            model = self._openvoice_melo(language)
            speaker_keys = sorted(model.hps.data.spk2id.keys())
            for speaker_key in speaker_keys:
                voice_id = self._normalize_openvoice_voice(speaker_key)
                if not voice_id or voice_id in seen:
                    continue
                seen.add(voice_id)
                voices.append(
                    self._voice_entry(
                        voice_id,
                        self._openvoice_label(voice_id),
                        self._openvoice_voice_locale(voice_id, language),
                    )
                )

        voices.sort(key=lambda item: ((item.get("locale") or ""), item["label"], item["id"]))
        return voices

    def _synthesize_openvoice(self, payload: dict[str, Any], output_path: Path) -> None:
        import inspect

        locale = payload.get("locale")
        language = self._openvoice_language(locale)
        controls = payload.get("controls", {})
        speed = float(controls.get("speed", 1.0))
        checkpoints = self._openvoice_checkpoint_root()
        model = self._openvoice_melo(language)
        speaker_key = self._openvoice_speaker_key(model, payload.get("voice"), language)
        speaker_id = model.hps.data.spk2id[speaker_key]
        source_se = self._openvoice_source_se(checkpoints, speaker_key)
        converter = self.engine["converter"]

        with tempfile.TemporaryDirectory(prefix="vox-jot-openvoice-") as temp_dir:
            temp_dir_path = Path(temp_dir)
            raw_path = temp_dir_path / "raw.wav"
            tts_kwargs = {
                "speed": speed,
                "sdp_ratio": float(controls.get("sdp_ratio", 0.2)),
                "noise_scale": float(controls.get("noise_scale", 0.6)),
                "noise_scale_w": float(controls.get("noise_scale_w", 0.8)),
            }
            tts_signature = inspect.signature(model.tts_to_file)
            supported_tts_kwargs = {
                key: value
                for key, value in tts_kwargs.items()
                if key in tts_signature.parameters
            }
            model.tts_to_file(
                payload["text"],
                speaker_id,
                str(raw_path),
                **supported_tts_kwargs,
            )
            reference_audio = payload.get("reference_audio_path")
            if reference_audio:
                target_se = converter.extract_se(
                    reference_audio,
                    se_save_path=str(temp_dir_path / "target_se.pth"),
                )
                convert_kwargs = {
                    "audio_src_path": str(raw_path),
                    "src_se": source_se.to(self.device),
                    "tgt_se": target_se,
                    "output_path": str(output_path),
                    "tau": float(controls.get("tau", 0.3)),
                    "message": "@VoxJot",
                }
                convert_signature = inspect.signature(converter.convert)
                converter.convert(
                    **{
                        key: value
                        for key, value in convert_kwargs.items()
                        if key in convert_signature.parameters
                    }
                )
            else:
                output_path.write_bytes(raw_path.read_bytes())


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
            if action == "list_voices":
                write_response(True, voices=worker.list_voices())
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
