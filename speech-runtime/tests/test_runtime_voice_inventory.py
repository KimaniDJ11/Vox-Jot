import tempfile
import unittest
from pathlib import Path
from unittest import mock

from runtime.config import ENGINE_SPECS, RuntimeConfig
from runtime.engine_worker import EngineWorker
from runtime.worker_host import WorkerHost


class RuntimeVoiceInventoryTest(unittest.TestCase):
    def make_worker(self, provider_id: str, model_id: str = "test-model") -> EngineWorker:
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-runtime-voices-"))
        return EngineWorker(
            provider_id=provider_id,
            model_id=model_id,
            model_dir=temp_root,
            state_dir=temp_root / "state",
            profiles_dir=None,
        )

    def test_kokoro_voice_inventory_maps_prefixes_and_sorts(self):
        worker = self.make_worker("kokoro", "kokoro-82m-v1.0")
        voices_dir = worker.model_dir / "checkpoints" / "voices"
        voices_dir.mkdir(parents=True, exist_ok=True)
        for voice_name in ("bf_isabella", "af_heart", "zf_xiaobei"):
            (voices_dir / f"{voice_name}.pt").write_text("", encoding="utf-8")

        voices = worker.list_voices()

        self.assertEqual([voice["id"] for voice in voices], ["af_heart", "bf_isabella", "zf_xiaobei"])
        self.assertEqual(voices[0]["locale"], "en-US")
        self.assertEqual(voices[1]["locale"], "en-GB")
        self.assertEqual(voices[2]["locale"], "zh")
        self.assertEqual(voices[0]["label"], "Af Heart")

    def test_kokoro_prefers_nested_archive_layout(self):
        spec = next(spec for spec in ENGINE_SPECS if spec.model_id == "kokoro-82m-v1.0")

        self.assertEqual(spec.model_dirs[0], "Kokoro/kokoro")
        self.assertIn("kokoro/kokoro", spec.model_dirs)

    def test_openvoice_voice_inventory_normalizes_speakers_and_locales(self):
        worker = self.make_worker("openvoice", "openvoice")
        worker._ensure_engine = lambda: None

        class DummyModel:
            def __init__(self, speakers):
                self.hps = type(
                    "HPS",
                    (),
                    {"data": type("Data", (), {"spk2id": speakers})()},
                )()

        models = {
            "EN": DummyModel({"EN_Default": 0, "EN_GB_Alice": 1}),
            "ES": DummyModel({"ES": 0}),
            "FR": DummyModel({}),
            "ZH": DummyModel({"ZH": 0}),
            "JP": DummyModel({"JP": 0}),
            "KR": DummyModel({"KR": 0}),
        }
        worker._openvoice_melo = lambda language: models[language]

        voices = worker.list_voices()
        by_id = {voice["id"]: voice for voice in voices}

        self.assertIn("en-default", by_id)
        self.assertIn("en-gb-alice", by_id)
        self.assertEqual(by_id["en-default"]["locale"], "en-US")
        self.assertEqual(by_id["en-gb-alice"]["locale"], "en-GB")
        self.assertEqual(by_id["es"]["locale"], "es")
        self.assertEqual(by_id["zh"]["locale"], "zh")

    def test_openvoice_voice_conversion_uses_source_and_target_embeddings(self):
        worker = self.make_worker("openvoice", "openvoice")
        worker._ensure_engine = lambda: None
        source = worker.model_dir / "source.wav"
        target = worker.model_dir / "target.wav"
        source.write_bytes(b"source")
        target.write_bytes(b"target")

        class DummyConverter:
            def __init__(self):
                self.extracted = []
                self.convert_kwargs = None

            def extract_se(self, audio_path, se_save_path):
                self.extracted.append((audio_path, se_save_path))
                return f"se:{Path(audio_path).stem}"

            def convert(self, **kwargs):
                self.convert_kwargs = kwargs
                Path(kwargs["output_path"]).write_bytes(b"converted")

        converter = DummyConverter()
        worker.engine = {"converter": converter}

        output = worker.convert_voice(
            {
                "source_audio_path": str(source),
                "target_audio_path": str(target),
                "controls": {"tau": 0.45},
            }
        )

        self.assertEqual(output.read_bytes(), b"converted")
        self.assertEqual(
            [Path(audio_path).name for audio_path, _ in converter.extracted],
            ["source.wav", "target.wav"],
        )
        self.assertEqual(converter.convert_kwargs["audio_src_path"], str(source))
        self.assertEqual(converter.convert_kwargs["src_se"], "se:source")
        self.assertEqual(converter.convert_kwargs["tgt_se"], "se:target")
        self.assertEqual(converter.convert_kwargs["tau"], 0.45)

    def test_openvoice_accepts_nested_download_layout(self):
        worker = self.make_worker("openvoice", "openvoice")
        nested = worker.model_dir / "OpenVoice"
        checkpoints = nested / "checkpoints_v2"
        (checkpoints / "base_speakers" / "ses").mkdir(parents=True)
        (checkpoints / "converter").mkdir(parents=True)

        self.assertEqual(worker._openvoice_checkpoint_root(), checkpoints)

    def test_openvoice_package_source_accepts_nested_download_layout(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-runtime-openvoice-"))
        config = RuntimeConfig(
            listen_host="127.0.0.1",
            listen_port=0,
            model_store=temp_root / "store",
            state_dir=temp_root / "state",
            profiles_dir=None,
        )
        outer = config.model_store / "OpenVoice"
        nested = outer / "OpenVoice"
        nested.mkdir(parents=True)
        (nested / "setup.py").write_text("from setuptools import setup\nsetup(name='openvoice')\n", encoding="utf-8")

        host = WorkerHost(config)

        self.assertEqual(host._openvoice_package_source(outer), nested)

    def test_xtts_voice_inventory_uses_sample_pseudo_voices(self):
        worker = self.make_worker("xtts", "xtts-v2")
        checkpoints = worker.model_dir / "xtts-v2"
        samples = checkpoints / "samples"
        samples.mkdir(parents=True, exist_ok=True)
        (checkpoints / "config.json").write_text("{}", encoding="utf-8")
        (checkpoints / "model.pth").write_text("", encoding="utf-8")
        for filename in ("en_sample.wav", "zh-cn-sample.wav", "ja-sample.wav"):
            (samples / filename).write_text("", encoding="utf-8")

        voices = worker.list_voices()
        voice_ids = [voice["id"] for voice in voices]

        self.assertEqual(voice_ids, ["sample:en", "sample:zh-cn", "sample:ja"])
        self.assertEqual(worker._xtts_reference_for_voice("sample:zh-cn", "en"), str(samples / "zh-cn-sample.wav"))
        self.assertEqual(worker._xtts_reference_for_voice(None, "zh"), str(samples / "zh-cn-sample.wav"))

    def test_chatterbox_turbo_accepts_official_hf_snapshot_layout(self):
        worker = self.make_worker("chatterbox", "chatterbox-turbo")
        (worker.model_dir / "t3_turbo_v1.safetensors").write_text("", encoding="utf-8")
        (worker.model_dir / "s3gen_meanflow.safetensors").write_text("", encoding="utf-8")

        self.assertEqual(worker._chatterbox_checkpoint_root(), worker.model_dir)

    def test_chatterbox_base_accepts_legacy_checkpoint_layout(self):
        worker = self.make_worker("chatterbox", "chatterbox")
        base = worker.model_dir / "checkpoints" / "base"
        base.mkdir(parents=True, exist_ok=True)
        (base / "t3_cfg.safetensors").write_text("", encoding="utf-8")

        self.assertEqual(worker._chatterbox_checkpoint_root(), base)

    def test_chatterbox_base_prefers_base_when_combined_pack_contains_turbo(self):
        worker = self.make_worker("chatterbox", "chatterbox")
        base = worker.model_dir / "checkpoints" / "base"
        turbo = worker.model_dir / "checkpoints" / "turbo"
        base.mkdir(parents=True, exist_ok=True)
        turbo.mkdir(parents=True, exist_ok=True)
        (base / "t3_cfg.safetensors").write_text("", encoding="utf-8")
        (turbo / "t3_turbo_v1.safetensors").write_text("", encoding="utf-8")

        self.assertEqual(worker._chatterbox_checkpoint_root(), base)

    def test_chatterbox_multilingual_accepts_official_hf_snapshot_layout(self):
        worker = self.make_worker("chatterbox", "chatterbox-multilingual")
        (worker.model_dir / "t3_mtl23ls_v2.safetensors").write_text("", encoding="utf-8")
        (worker.model_dir / "grapheme_mtl_merged_expanded_v1.json").write_text("{}", encoding="utf-8")
        (worker.model_dir / "t3_cfg.safetensors").write_text("", encoding="utf-8")

        self.assertEqual(worker._chatterbox_checkpoint_root(), worker.model_dir)

    def test_chatterbox_turbo_installs_package_from_base_source(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-runtime-install-"))
        config = RuntimeConfig(
            listen_host="127.0.0.1",
            listen_port=0,
            model_store=temp_root / "store",
            state_dir=temp_root / "state",
            profiles_dir=None,
        )
        turbo_dir = config.model_store / "chatterbox-turbo" / "chatterbox-turbo"
        source_dir = config.model_store / "chatterbox"
        turbo_dir.mkdir(parents=True)
        source_dir.mkdir(parents=True)
        (source_dir / "pyproject.toml").write_text("[project]\nname='chatterbox'\n", encoding="utf-8")

        host = WorkerHost(config)

        self.assertEqual(host._chatterbox_package_source(turbo_dir), source_dir)

    def test_managed_runtime_readiness_checks_imported_synthesis_modules(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-runtime-ready-"))
        config = RuntimeConfig(
            listen_host="127.0.0.1",
            listen_port=0,
            model_store=temp_root / "store",
            state_dir=temp_root / "state",
            profiles_dir=None,
        )
        host = WorkerHost(config)
        kokoro = next(spec for spec in ENGINE_SPECS if spec.model_id == "kokoro-82m-v1.0")
        xtts = next(spec for spec in ENGINE_SPECS if spec.model_id == "xtts-v2")

        with mock.patch.object(host, "_env_has_module") as has_module:
            has_module.side_effect = lambda _python, module: module in {
                "kokoro",
                "en_core_web_sm",
            }
            self.assertFalse(host._provider_env_ready(kokoro, Path("python")))
            self.assertIn(mock.call(Path("python"), "kokoro.model"), has_module.mock_calls)

        with mock.patch.object(host, "_env_has_module") as has_module:
            has_module.side_effect = lambda _python, module: module == "TTS"
            self.assertFalse(host._provider_env_ready(xtts, Path("python")))
            has_module.assert_called_with(Path("python"), "TTS.tts.models.xtts")

    def test_xtts_runtime_installs_coqui_package_not_weights_folder(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-runtime-xtts-install-"))
        config = RuntimeConfig(
            listen_host="127.0.0.1",
            listen_port=0,
            model_store=temp_root / "store",
            state_dir=temp_root / "state",
            profiles_dir=None,
        )
        host = WorkerHost(config)
        spec = next(spec for spec in ENGINE_SPECS if spec.model_id == "xtts-v2")
        calls = []

        with mock.patch.object(host, "_pip_install", side_effect=lambda _python, *args: calls.append(args)):
            host._install_provider_runtime(spec, Path("python"), temp_root / "Coqui" / "XTTS")

        self.assertEqual(calls[0], ("--force-reinstall", "TTS==0.22.0"))
        self.assertNotIn("-e", calls[0])
        self.assertIn(("transformers==4.46.3", "torchcodec"), calls)

    def test_chatterbox_turbo_synthesis_only_passes_supported_controls(self):
        worker = self.make_worker("chatterbox", "chatterbox-turbo")

        class DummyEngine:
            sr = 24000

            def __init__(self):
                self.kwargs = None

            def generate(self, text, **kwargs):
                self.kwargs = kwargs
                return [0.0, 0.0, 0.0]

        engine = DummyEngine()
        worker.engine = engine
        output = worker.model_dir / "out.wav"

        worker._synthesize_chatterbox(
            {
                "text": "hello",
                "reference_audio_path": None,
                "controls": {
                    "temperature": 0.4,
                    "repetition_penalty": 1.6,
                    "top_p": 0.85,
                    "top_k": 250,
                    "cfg_weight": 0.9,
                    "min_p": 0.2,
                    "exaggeration": 1.5,
                },
            },
            output,
        )

        self.assertEqual(
            engine.kwargs,
            {
                "audio_prompt_path": None,
                "temperature": 0.4,
                "repetition_penalty": 1.6,
                "top_p": 0.85,
                "top_k": 250,
            },
        )
        self.assertTrue(output.exists())

    def test_chatterbox_multilingual_synthesis_passes_language_and_verified_controls(self):
        worker = self.make_worker("chatterbox", "chatterbox-multilingual")

        class DummyEngine:
            sr = 24000

            def __init__(self):
                self.kwargs = None

            def generate(self, text, **kwargs):
                self.kwargs = kwargs
                return [0.0, 0.0, 0.0]

        engine = DummyEngine()
        worker.engine = engine
        output = worker.model_dir / "out.wav"

        worker._synthesize_chatterbox(
            {
                "text": "bonjour",
                "locale": "fr-FR",
                "reference_audio_path": "/tmp/reference.wav",
                "controls": {
                    "cfg_weight": 0.4,
                    "temperature": 0.7,
                    "repetition_penalty": 2.0,
                    "top_p": 1.0,
                    "min_p": 0.05,
                    "exaggeration": 0.6,
                },
            },
            output,
        )

        self.assertEqual(
            engine.kwargs,
            {
                "language_id": "fr",
                "audio_prompt_path": "/tmp/reference.wav",
                "cfg_weight": 0.4,
                "temperature": 0.7,
                "repetition_penalty": 2.0,
                "min_p": 0.05,
                "top_p": 1.0,
                "exaggeration": 0.6,
            },
        )
        self.assertTrue(output.exists())

    def test_supertonic_voice_inventory_uses_installed_style_files(self):
        worker = self.make_worker("supertonic", "supertonic-3")
        styles = worker.model_dir / "voice_styles"
        styles.mkdir(parents=True, exist_ok=True)
        for voice_id in ("F2", "M1", "M5"):
            (styles / f"{voice_id}.json").write_text("{}", encoding="utf-8")

        voices = worker.list_voices()

        self.assertEqual([voice["id"] for voice in voices], ["M1", "M5", "F2"])
        self.assertEqual(voices[0]["label"], "Male 1")
        self.assertTrue(all(voice["installed"] for voice in voices))

    def test_supertonic_locale_and_voice_fallbacks_match_model_support(self):
        worker = self.make_worker("supertonic", "supertonic-3")

        self.assertEqual(worker._supertonic_lang("en-US"), "en")
        self.assertEqual(worker._supertonic_lang("ko-KR"), "ko")
        self.assertEqual(worker._supertonic_lang("zh-CN"), "na")
        self.assertEqual(worker._supertonic_lang("unknown"), "na")
        self.assertEqual(worker._supertonic_voice("F4"), "F4")
        self.assertEqual(worker._supertonic_voice("missing"), "M1")

    def test_supertonic_synthesis_clamps_steps_speed_and_language(self):
        worker = self.make_worker("supertonic", "supertonic-3")

        class DummyEngine:
            def __init__(self):
                self.kwargs = None

            def get_voice_style(self, voice_id):
                return {"voice": voice_id}

            def synthesize(self, text, **kwargs):
                self.kwargs = {"text": text, **kwargs}
                return [0.0, 0.0], 0.1

            def save_audio(self, wav, output_path):
                Path(output_path).write_bytes(b"wav")

        engine = DummyEngine()
        worker.engine = engine
        output = worker.model_dir / "out.wav"

        worker._synthesize_supertonic(
            {
                "text": "hello",
                "voice": "F4",
                "locale": "zh-CN",
                "controls": {"speed": 9.0, "quality_steps": 20},
            },
            output,
        )

        self.assertEqual(
            engine.kwargs,
            {
                "text": "hello",
                "voice_style": {"voice": "F4"},
                "total_steps": 12,
                "speed": 2.0,
                "lang": "na",
            },
        )
        self.assertEqual(output.read_bytes(), b"wav")


if __name__ == "__main__":
    unittest.main()
