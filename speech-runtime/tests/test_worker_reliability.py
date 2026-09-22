import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from runtime.config import RuntimeConfig
from runtime.engine_worker import EngineWorker
from runtime.worker_host import WorkerHost, WorkerProcess


class WorkerReliabilityTest(unittest.TestCase):
    def make_host(self, root: Path) -> WorkerHost:
        return WorkerHost(
            RuntimeConfig(
                listen_host="127.0.0.1",
                listen_port=0,
                model_store=root / "models",
                state_dir=root / "state",
                profiles_dir=None,
            )
        )

    def test_worker_noise_cannot_reset_response_timeout(self):
        script = """
import json
import sys
import time

sys.stdin.readline()
for _ in range(8):
    print("worker noise", flush=True)
    time.sleep(0.03)
print(json.dumps({"ok": True}), flush=True)
"""
        with tempfile.TemporaryDirectory() as temporary_dir:
            host = self.make_host(Path(temporary_dir))
            process = subprocess.Popen(
                [sys.executable, "-c", script],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )
            worker = WorkerProcess(
                process=process,
                lock=threading.Lock(),
                engine="test:noise",
            )
            host._workers[worker.engine] = worker

            try:
                with self.assertRaises(RuntimeError):
                    host._send(worker, {"action": "test"}, response_timeout_secs=0.1)
                self.assertIsNotNone(process.poll())
            finally:
                host._terminate_process(process)

    def test_failed_synthesis_removes_partial_output(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            worker = EngineWorker("kokoro", "test", root, root / "state", None)
            worker._ensure_engine = lambda: None

            def write_then_fail(_payload, output_path):
                output_path.write_bytes(b"partial")
                raise RuntimeError("synthesis failed")

            worker._synthesize_kokoro = write_then_fail

            with (
                mock.patch(
                    "runtime.engine_worker.tempfile.gettempdir",
                    return_value=temporary_dir,
                ),
                self.assertRaisesRegex(RuntimeError, "synthesis failed"),
            ):
                worker.synthesize({"text": "hello"})
            self.assertEqual(list(root.glob("vox-jot-*.wav")), [])

    def test_failed_voice_conversion_removes_partial_output(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            worker = EngineWorker("openvoice", "test", root, root / "state", None)
            worker._ensure_engine = lambda: None

            def write_then_fail(_payload, output_path):
                output_path.write_bytes(b"partial")
                raise RuntimeError("conversion failed")

            worker._convert_openvoice = write_then_fail

            with (
                mock.patch(
                    "runtime.engine_worker.tempfile.gettempdir",
                    return_value=temporary_dir,
                ),
                self.assertRaisesRegex(RuntimeError, "conversion failed"),
            ):
                worker.convert_voice({})
            self.assertEqual(list(root.glob("vox-jot-voice-converter-*.wav")), [])


if __name__ == "__main__":
    unittest.main()
