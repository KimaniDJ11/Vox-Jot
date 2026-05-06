import tempfile
import unittest
from pathlib import Path
from unittest import mock

from runtime.config import RuntimeConfig
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


if __name__ == "__main__":
    unittest.main()
