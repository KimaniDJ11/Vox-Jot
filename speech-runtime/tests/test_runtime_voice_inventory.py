import tempfile
import unittest
from pathlib import Path

from runtime.engine_worker import EngineWorker


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


if __name__ == "__main__":
    unittest.main()
