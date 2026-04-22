from __future__ import annotations

import tempfile
import threading
import time
import unittest
import json
from pathlib import Path
from unittest import mock
from urllib import error

from runtime.config import ENGINE_SPECS, RuntimeConfig
from runtime.engine_worker import EngineWorker
from runtime.worker_host import WorkerHost


def _fish_spec():
    return next(spec for spec in ENGINE_SPECS if spec.provider_id == "fish_speech")


class DummyProcess:
    def __init__(self, pid: int = 12345):
        self.pid = pid
        self.stdin = None
        self.stdout = None
        self._terminated = False
        self.terminate_calls = 0
        self.kill_calls = 0
        self.wait_calls = 0

    def poll(self):
        return 0 if self._terminated else None

    def terminate(self):
        self.terminate_calls += 1
        self._terminated = True

    def kill(self):
        self.kill_calls += 1
        self._terminated = True

    def wait(self, timeout=None):
        self.wait_calls += 1
        self._terminated = True
        return 0


class DummyPipe:
    def __init__(self):
        self.closed = False
        self.writes: list[str] = []

    def write(self, value: str):
        self.writes.append(value)

    def flush(self):
        return None

    def close(self):
        self.closed = True


class BlockingStdout(DummyPipe):
    def __init__(self, process: DummyProcess):
        super().__init__()
        self.process = process

    def readline(self):
        while not self.process._terminated:
            time.sleep(0.01)
        return ""


class FakeLogHandle:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FishSpeechRuntimeTest(unittest.TestCase):
    def make_config(self) -> RuntimeConfig:
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-fish-runtime-"))
        return RuntimeConfig(
            model_store=temp_root / "models",
            state_dir=temp_root / "state",
            profiles_dir=None,
            listen_host="127.0.0.1",
            listen_port=8008,
        )

    def make_model_dir(self) -> Path:
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-fish-model-"))
        model_dir = temp_root / "Fish Speech"
        checkpoint_dir = model_dir / "checkpoints" / "fish-speech-1.5"
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        (checkpoint_dir / "model.pth").write_text("", encoding="utf-8")
        (checkpoint_dir / "codec.pth").write_text("", encoding="utf-8")
        (model_dir / "tools").mkdir(parents=True, exist_ok=True)
        return model_dir

    def test_worker_host_serializes_fish_sidecar_startup(self):
        host = WorkerHost(self.make_config())
        spec = _fish_spec()
        model_dir = self.make_model_dir()

        prepare_started = threading.Event()
        release_prepare = threading.Event()
        prepare_calls: list[int] = []

        def fake_prepare(_spec, _model_dir):
            prepare_calls.append(threading.get_ident())
            prepare_started.set()
            release_prepare.wait(timeout=5)
            return Path("/usr/bin/python3")

        results: list[str] = []
        errors: list[BaseException] = []

        def run_startup():
            try:
                results.append(host.ensure_fish_sidecar(spec, model_dir))
            except BaseException as exc:  # pragma: no cover - failure path
                errors.append(exc)

        with mock.patch.object(host, "prepare", side_effect=fake_prepare), mock.patch.object(
            host,
            "_url_healthy",
            return_value=True,
        ), mock.patch("runtime.worker_host.subprocess.Popen", return_value=DummyProcess()):
            thread_one = threading.Thread(target=run_startup)
            thread_one.start()
            self.assertTrue(prepare_started.wait(timeout=2))

            thread_two = threading.Thread(target=run_startup)
            thread_two.start()
            try:
                time.sleep(0.2)
                self.assertEqual(len(prepare_calls), 1)
            finally:
                release_prepare.set()
                thread_one.join(timeout=5)
                thread_two.join(timeout=5)

        self.assertFalse(errors)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0], results[1])

    def test_engine_worker_reloads_fish_server_url_when_cache_goes_stale(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-fish-worker-"))
        state_dir = temp_root / "state"
        model_dir = temp_root / "model"
        model_dir.mkdir(parents=True, exist_ok=True)
        worker = EngineWorker(
            provider_id="fish_speech",
            model_id="fish-speech-1.5",
            model_dir=model_dir,
            state_dir=state_dir,
            profiles_dir=None,
        )

        cached_url = "http://127.0.0.1:9123"
        refreshed_url = "http://127.0.0.1:9124"
        state_path = worker._fish_state_path()
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(
            f'{{"url": "{refreshed_url}"}}',
            encoding="utf-8",
        )
        worker.fish_url = cached_url

        with mock.patch.object(
            worker,
            "_url_healthy",
            side_effect=lambda url: url == refreshed_url,
        ):
            resolved_url = worker._ensure_fish_server()

        self.assertEqual(resolved_url, refreshed_url)
        self.assertEqual(worker.fish_url, refreshed_url)

    def test_send_timeout_drops_stuck_worker(self):
        host = WorkerHost(self.make_config())
        process = DummyProcess()
        process.stdin = DummyPipe()
        process.stdout = BlockingStdout(process)
        worker = type("WorkerRecord", (), {})()
        worker.process = process
        worker.lock = threading.Lock()
        worker.engine = "fish_speech:test-model"
        worker.stderr_path = None
        host._workers[worker.engine] = worker

        with self.assertRaisesRegex(RuntimeError, "timed out waiting for a response"):
            with mock.patch("runtime.worker_host.WORKER_RESPONSE_TIMEOUT_SECS", 0.05):
                host._send(worker, {"action": "warm"})

        self.assertGreaterEqual(process.terminate_calls, 1)
        self.assertTrue(process.stdin.closed)
        self.assertTrue(process.stdout.closed)
        self.assertNotIn(worker.engine, host._workers)

    def test_engine_worker_surfaces_fish_http_detail(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-fish-http-error-"))
        state_dir = temp_root / "state"
        model_dir = temp_root / "model"
        model_dir.mkdir(parents=True, exist_ok=True)
        worker = EngineWorker(
            provider_id="fish_speech",
            model_id="fish-speech-1.5",
            model_dir=model_dir,
            state_dir=state_dir,
            profiles_dir=None,
        )
        http_error = error.HTTPError(
            "http://127.0.0.1:9123/v1/tts",
            422,
            "Unprocessable Entity",
            hdrs=None,
            fp=DummyHttpBody(
                b'{"detail":"Fish Speech 1.5 requires at least 24 characters of input text. Got 8."}'
            ),
        )

        with mock.patch.object(
            worker,
            "_ensure_fish_server",
            return_value="http://127.0.0.1:9123",
        ), mock.patch(
            "runtime.engine_worker.request.urlopen",
            side_effect=http_error,
        ):
            with self.assertRaisesRegex(RuntimeError, "requires at least 24 characters"):
                worker._synthesize_fish({"text": "Too short", "controls": {}}, temp_root / "out.wav")

    def test_engine_worker_surfaces_fish_validation_arrays(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-fish-http-array-error-"))
        state_dir = temp_root / "state"
        model_dir = temp_root / "model"
        model_dir.mkdir(parents=True, exist_ok=True)
        worker = EngineWorker(
            provider_id="fish_speech",
            model_id="fish-speech-1.5",
            model_dir=model_dir,
            state_dir=state_dir,
            profiles_dir=None,
        )
        http_error = error.HTTPError(
            "http://127.0.0.1:9123/v1/tts",
            422,
            "Unprocessable Entity",
            hdrs=None,
            fp=DummyHttpBody(
                b'[{"type":"less_than_equal","loc":["repetition_penalty"],"msg":"Input should be less than or equal to 2","input":3.0}]'
            ),
        )

        with mock.patch.object(
            worker,
            "_ensure_fish_server",
            return_value="http://127.0.0.1:9123",
        ), mock.patch(
            "runtime.engine_worker.request.urlopen",
            side_effect=http_error,
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "repetition_penalty: Input should be less than or equal to 2",
            ):
                worker._synthesize_fish(
                    {"text": "Long enough fish speech text input.", "controls": {"repetition_penalty": 3.0}},
                    temp_root / "out.wav",
                )

    def test_engine_worker_uploads_clone_profile_and_uses_reference_id(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-fish-upload-ref-"))
        state_dir = temp_root / "state"
        model_dir = temp_root / "model"
        model_dir.mkdir(parents=True, exist_ok=True)
        worker = EngineWorker(
            provider_id="fish_speech",
            model_id="fish-speech-1.5",
            model_dir=model_dir,
            state_dir=state_dir,
            profiles_dir=None,
        )

        reference_audio_path = temp_root / "reference.wav"
        reference_audio_path.write_bytes(b"RIFFdummy")

        class DummyResponse:
            def __init__(self, data: bytes):
                self._data = data
            def __enter__(self):
                return self
            def __exit__(self, exc_type, exc, tb):
                return False
            def read(self):
                return self._data

        captured_requests: list[dict[str, Any]] = []

        def fake_urlopen(req, timeout=0):
            del timeout
            url = req.full_url
            if "/v1/references/list" in url:
                return DummyResponse(b'{"reference_ids": []}')
            elif "/v1/references/add" in url:
                return DummyResponse(b'{"success": true}')
            elif "/v1/tts" in url:
                captured_requests.append(json.loads(req.data.decode("utf-8")))
                return DummyResponse(b"RIFFok")
            return DummyResponse(b"")

        with mock.patch.object(
            worker,
            "_ensure_fish_server",
            return_value="http://127.0.0.1:9123",
        ), mock.patch(
            "runtime.engine_worker.request.urlopen",
            side_effect=fake_urlopen,
        ):
            worker._synthesize_fish(
                {
                    "text": "Long enough fish speech text input.",
                    "voice": "some_reference_id",
                    "reference_audio_path": str(reference_audio_path),
                    "reference_transcript": "This is a reference transcript.",
                    "controls": {},
                },
                temp_root / "out.wav",
            )

        self.assertEqual(len(captured_requests), 1)
        captured_body = captured_requests[0]
        # Should now use a deterministically generated clone profile ID rather than inline references
        self.assertTrue(captured_body.get("reference_id", "").startswith("clone_"))
        self.assertEqual(captured_body.get("references"), [])

    def test_engine_worker_rebuilds_reference_after_shape_mismatch(self):
        temp_root = Path(tempfile.mkdtemp(prefix="vox-jot-fish-refresh-ref-"))
        state_dir = temp_root / "state"
        model_dir = temp_root / "model"
        model_dir.mkdir(parents=True, exist_ok=True)
        worker = EngineWorker(
            provider_id="fish_speech",
            model_id="fish-speech-1.5",
            model_dir=model_dir,
            state_dir=state_dir,
            profiles_dir=None,
        )

        reference_audio_path = temp_root / "reference.wav"
        reference_audio_path.write_bytes(b"RIFFdummy")

        class DummyResponse:
            def __init__(self, data: bytes):
                self._data = data

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self._data

        events: list[str] = []
        tts_calls = 0

        def fake_urlopen(req, timeout=0):
            del timeout
            nonlocal tts_calls
            url = req.full_url
            if "/v1/references/list" in url:
                events.append("list")
                return DummyResponse(b'{"reference_ids": ["clone_existing"]}')
            if "/v1/references/delete" in url:
                events.append("delete")
                return DummyResponse(b'{"success": true}')
            if "/v1/references/add" in url:
                events.append("add")
                return DummyResponse(b'{"success": true}')
            if "/v1/tts" in url:
                tts_calls += 1
                events.append(f"tts-{tts_calls}")
                if tts_calls == 1:
                    raise error.HTTPError(
                        url,
                        500,
                        "Internal Server Error",
                        hdrs=None,
                        fp=DummyHttpBody(b"shape mismatch: [10,1292] vs [8,1292]"),
                    )
                return DummyResponse(b"RIFFok")
            return DummyResponse(b"")

        with mock.patch.object(
            worker,
            "_ensure_fish_server",
            return_value="http://127.0.0.1:9123",
        ), mock.patch(
            "runtime.engine_worker.request.urlopen",
            side_effect=fake_urlopen,
        ):
            worker._synthesize_fish(
                {
                    "text": "Long enough fish speech text input.",
                    "voice": "clone_existing",
                    "reference_audio_path": str(reference_audio_path),
                    "reference_transcript": "Reference transcript.",
                    "controls": {},
                },
                temp_root / "out.wav",
            )

        self.assertGreaterEqual(tts_calls, 2)
        self.assertIn("delete", events)
        self.assertIn("add", events)

    def test_failed_fish_sidecar_startup_cleans_up_process_and_log_handle(self):
        host = WorkerHost(self.make_config())
        spec = _fish_spec()
        model_dir = self.make_model_dir()
        process = DummyProcess()
        log_handle = FakeLogHandle()

        with mock.patch.object(host, "prepare", return_value=Path("/usr/bin/python3")), mock.patch.object(
            host,
            "_url_healthy",
            return_value=False,
        ), mock.patch("runtime.worker_host.subprocess.Popen", return_value=process), mock.patch(
            "runtime.worker_host.time.sleep",
            return_value=None,
        ), mock.patch.object(Path, "open", return_value=log_handle):
            with self.assertRaisesRegex(RuntimeError, "did not become healthy"):
                host.ensure_fish_sidecar(spec, model_dir)

        self.assertTrue(log_handle.closed)
        self.assertGreaterEqual(process.terminate_calls, 1)
        self.assertGreaterEqual(process.wait_calls, 1)


class DummyHttpBody:
    def __init__(self, payload: bytes):
        self.payload = payload
        self._read = False

    def read(self, *_args, **_kwargs):
        if self._read:
            return b""
        self._read = True
        return self.payload

    def close(self):
        return None


if __name__ == "__main__":
    unittest.main()
