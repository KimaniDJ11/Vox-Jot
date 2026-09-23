import importlib
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from runtime.selection import RuntimeSelection


_runtime_root = tempfile.TemporaryDirectory(prefix="vox-jot-runtime-api-tests-")
with mock.patch.dict(
    os.environ,
    {
        "SPEECH_MODEL_STORE": str(Path(_runtime_root.name) / "models"),
        "SPEECH_RUNTIME_STATE_DIR": str(Path(_runtime_root.name) / "state"),
        "SPEECH_VOICE_PROFILES_DIR": "",
        "SPEECH_RUNTIME_PORT": "0",
    },
):
    runtime_app = importlib.import_module("runtime.app")


def tearDownModule():
    _runtime_root.cleanup()


class ProfileRequestTest(unittest.TestCase):
    def test_selection_rejects_invalid_profile_id_without_persisting_it(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            selection_path = Path(temporary_dir) / "selection.json"
            original = '{"provider_id":"existing","profile_id":null}'
            selection_path.write_text(original, encoding="utf-8")

            with mock.patch.object(runtime_app, "selection_file", selection_path):
                client = TestClient(runtime_app.app)
                for invalid_profile_id in (
                    "../outside",
                    " 550e8400-e29b-41d4-a716-446655440000 ",
                ):
                    with self.subTest(profile_id=invalid_profile_id):
                        response = client.post(
                            "/listen/selection",
                            json={"profile_id": invalid_profile_id},
                        )
                        self.assertEqual(response.status_code, 400)
                        self.assertIn("canonical UUID", response.json()["detail"])

            self.assertEqual(selection_path.read_text(encoding="utf-8"), original)

    def test_selection_rejects_mismatched_provider_model_without_persisting_it(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            selection_path = Path(temporary_dir) / "selection.json"
            original = '{"provider_id":"existing","model_id":"existing"}'
            selection_path.write_text(original, encoding="utf-8")

            with mock.patch.object(runtime_app, "selection_file", selection_path):
                response = TestClient(runtime_app.app).post(
                    "/listen/selection",
                    json={"provider_id": "openvoice", "model_id": "chatterbox"},
                )

            self.assertEqual(response.status_code, 400)
            self.assertIn("mismatched", response.json()["detail"])
            self.assertEqual(selection_path.read_text(encoding="utf-8"), original)

    def test_catalog_ignores_model_candidate_that_is_a_file(self):
        spec = next(
            spec for spec in runtime_app.ENGINE_SPECS if spec.provider_id == "openvoice"
        )
        with tempfile.TemporaryDirectory() as temporary_dir:
            model_store = Path(temporary_dir)
            malformed_candidate = model_store / spec.model_dirs[-1]
            malformed_candidate.parent.mkdir(parents=True, exist_ok=True)
            malformed_candidate.write_bytes(b"partial download")
            test_config = replace(runtime_app.config, model_store=model_store)

            with mock.patch.object(runtime_app, "config", test_config):
                payload = runtime_app.catalog_payload()

            self.assertFalse(
                any(model["id"] == spec.model_id for model in payload["models"])
            )

    def test_speech_rejects_invalid_profile_id_before_synthesis(self):
        spec = runtime_app.ENGINE_SPECS[0]
        with tempfile.TemporaryDirectory() as temporary_dir:
            resolved = (spec, Path(temporary_dir), RuntimeSelection())
            with (
                mock.patch.object(runtime_app, "resolve_target", return_value=resolved),
                mock.patch.object(runtime_app.host, "synthesize") as synthesize,
            ):
                response = TestClient(runtime_app.app).post(
                    "/v1/audio/speech",
                    json={"input": "hello", "profile_id": "/tmp/outside"},
                )

            self.assertEqual(response.status_code, 400)
            self.assertIn("canonical UUID", response.json()["detail"])
            synthesize.assert_not_called()

    def test_voice_conversion_rejects_invalid_profile_id_before_conversion(self):
        spec = next(
            spec for spec in runtime_app.ENGINE_SPECS if spec.provider_id == "openvoice"
        )
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source_audio = root / "source.wav"
            source_audio.write_bytes(b"wave fixture")
            with (
                mock.patch.object(runtime_app, "engine_for_request", return_value=spec),
                mock.patch.object(runtime_app, "discover_model", return_value=root),
                mock.patch.object(runtime_app.host, "convert_voice") as convert_voice,
            ):
                response = TestClient(runtime_app.app).post(
                    "/v1/audio/voice-conversion",
                    json={
                        "source_audio_path": str(source_audio),
                        "profile_id": "../outside",
                    },
                )

            self.assertEqual(response.status_code, 400)
            self.assertIn("canonical UUID", response.json()["detail"])
            convert_voice.assert_not_called()


if __name__ == "__main__":
    unittest.main()
