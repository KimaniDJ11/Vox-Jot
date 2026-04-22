from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import EngineSpec, RuntimeConfig

KOKORO_SPACY_MODEL_URL = (
    "https://github.com/explosion/spacy-models/releases/download/"
    "en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
)
MELOTTS_GIT_URL = "git+https://github.com/myshell-ai/MeloTTS.git"
OPENVOICE_RUNTIME_DEPENDENCIES = (
    "numpy==1.26.4",
    "torch",
    "torchaudio",
    "soundfile",
    "librosa==0.10.2.post1",
    "wavmark==0.0.3",
    "eng_to_ipa==0.0.2",
    "inflect==7.0.0",
    "unidecode==1.3.7",
    "pypinyin==0.50.0",
    "cn2an==0.5.22",
    "jieba==0.42.1",
)
XTTS_TRANSFORMERS_PIN = "transformers==4.46.3"
XTTS_RUNTIME_DEPENDENCIES = (
    XTTS_TRANSFORMERS_PIN,
    "torchcodec",
)
WORKER_RESPONSE_TIMEOUT_SECS = 120
PROCESS_SHUTDOWN_TIMEOUT_SECS = 5


def _bin_dir(env_dir: Path) -> Path:
    if os.name == "nt":
        return env_dir / "Scripts"
    return env_dir / "bin"


def _python_path(env_dir: Path) -> Path:
    if os.name == "nt":
        return _bin_dir(env_dir) / "python.exe"
    return _bin_dir(env_dir) / "python"


@dataclass
class WorkerProcess:
    process: subprocess.Popen[str]
    lock: threading.Lock
    engine: str
    stderr_path: Path | None = None


class WorkerHost:
    def __init__(self, config: RuntimeConfig):
        self.config = config
        self.runtime_root = Path(__file__).resolve().parents[1]
        self.selection_path = self.config.state_dir / "selection.json"
        self.envs_dir = self.config.state_dir / "envs"
        self.engines_dir = self.config.state_dir / "engines"
        self._workers: dict[str, WorkerProcess] = {}
        self._global_lock = threading.Lock()

    def _child_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.pop("VIRTUAL_ENV", None)
        env.pop("UV_ACTIVE", None)
        return env

    def _env_has_module(self, env_python: Path, module_name: str) -> bool:
        result = subprocess.run(
            [
                str(env_python),
                "-c",
                (
                    "import importlib.util, sys;"
                    f"sys.exit(0 if importlib.util.find_spec('{module_name}') else 1)"
                ),
            ],
            env=self._child_env(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return result.returncode == 0

    def _provider_env_ready(self, spec: EngineSpec, env_python: Path) -> bool:
        if spec.provider_id == "kokoro":
            return self._env_has_module(env_python, "kokoro") and self._env_has_module(
                env_python,
                "en_core_web_sm",
            )
        if spec.provider_id == "openvoice":
            return self._env_has_module(env_python, "openvoice") and self._env_has_module(
                env_python,
                "melo",
            )
        if spec.provider_id == "chatterbox":
            return self._env_has_module(env_python, "chatterbox")
        if spec.provider_id == "xtts":
            return self._env_has_module(env_python, "TTS")
        return True

    def _pip_install(self, env_python: Path, *args: str) -> None:
        subprocess.check_call(
            [str(env_python), "-m", "pip", "install", *args],
            env=self._child_env(),
        )

    def _run_module(self, env_python: Path, module_name: str, *args: str) -> None:
        subprocess.check_call(
            [str(env_python), "-m", module_name, *args],
            env=self._child_env(),
        )

    def _run_python(self, env_python: Path, code: str) -> None:
        subprocess.check_call(
            [str(env_python), "-c", code],
            env=self._child_env(),
        )

    def _bootstrap_unidic(self, env_python: Path) -> None:
        script = """
from pathlib import Path
import shutil

import unidic
import unidic_lite

target = Path(unidic.DICDIR)
lite = Path(unidic_lite.DICDIR)
if (target / "mecabrc").exists():
    raise SystemExit(0)
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists() and not target.is_symlink():
    shutil.rmtree(target)
elif target.is_symlink():
    target.unlink()
try:
    target.symlink_to(lite, target_is_directory=True)
except Exception:
    shutil.copytree(lite, target)
"""
        try:
            self._run_python(env_python, script)
        except subprocess.CalledProcessError:
            self._run_module(env_python, "unidic", "download")

    def _install_provider_runtime(
        self,
        spec: EngineSpec,
        env_python: Path,
        model_dir: Path,
    ) -> None:
        if spec.provider_id == "openvoice":
            self._pip_install(env_python, *OPENVOICE_RUNTIME_DEPENDENCIES)
            self._pip_install(env_python, "--no-deps", "-e", str(model_dir))
            self._pip_install(env_python, MELOTTS_GIT_URL)
            self._bootstrap_unidic(env_python)
            return

        if spec.provider_id == "xtts":
            self._pip_install(env_python, "-e", str(model_dir))
            self._pip_install(env_python, *XTTS_RUNTIME_DEPENDENCIES)
            return

        self._pip_install(env_python, "-e", str(model_dir))

        if spec.provider_id == "kokoro" and not self._env_has_module(env_python, "en_core_web_sm"):
            self._pip_install(
                env_python,
                "--upgrade",
                "--no-deps",
                KOKORO_SPACY_MODEL_URL,
            )

    def env_python_for(self, spec: EngineSpec, model_dir: Path) -> Path | None:
        for candidate in (
            self.envs_dir / spec.provider_id,
            model_dir / ".venv",
        ):
            python = _python_path(candidate)
            if python.exists():
                return python
        return None

    def worker_ready(self, spec: EngineSpec, model_dir: Path) -> bool:
        env_python = self.env_python_for(spec, model_dir)
        if env_python is None:
            return False
        return self._provider_env_ready(spec, env_python)

    def prepare(self, spec: EngineSpec, model_dir: Path) -> Path:
        env_dir = self.envs_dir / spec.provider_id
        env_dir.parent.mkdir(parents=True, exist_ok=True)
        env_python = _python_path(env_dir)
        if not env_python.exists():
            subprocess.check_call(
                [sys.executable, "-m", "venv", str(env_dir)],
                env=self._child_env(),
            )
            self._pip_install(env_python, "--upgrade", "pip", "setuptools", "wheel")

        if not self._provider_env_ready(spec, env_python):
            self._install_provider_runtime(spec, env_python, model_dir)

        if not self._provider_env_ready(spec, env_python):
            raise RuntimeError(
                f"Runtime environment for provider '{spec.provider_id}' is missing required dependencies."
            )
        return env_python

    def _worker_key(self, spec: EngineSpec) -> str:
        return f"{spec.provider_id}:{spec.model_id}"

    def ensure_worker(self, spec: EngineSpec, model_dir: Path) -> WorkerProcess:
        key = self._worker_key(spec)
        with self._global_lock:
            worker = self._workers.get(key)
            if worker and worker.process.poll() is None:
                return worker

            env_python = self.prepare(spec, model_dir)
            worker_logs_dir = self.engines_dir / "worker-logs"
            worker_logs_dir.mkdir(parents=True, exist_ok=True)
            stderr_path = worker_logs_dir / f"{key.replace(':', '_')}.stderr.log"
            stderr_handle = stderr_path.open("a", encoding="utf-8")
            process = subprocess.Popen(
                [
                    str(env_python),
                    str(self.runtime_root / "runtime" / "engine_worker.py"),
                    "--provider-id",
                    spec.provider_id,
                    "--model-id",
                    spec.model_id,
                    "--model-dir",
                    str(model_dir),
                    "--state-dir",
                    str(self.config.state_dir),
                    "--profiles-dir",
                    str(self.config.profiles_dir or ""),
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=stderr_handle,
                text=True,
                bufsize=1,
                env=self._child_env(),
            )
            stderr_handle.close()
            worker = WorkerProcess(
                process=process,
                lock=threading.Lock(),
                engine=key,
                stderr_path=stderr_path,
            )
            self._workers[key] = worker
            return worker

    def warm_model(self, spec: EngineSpec, model_dir: Path) -> None:
        worker = self.ensure_worker(spec, model_dir)
        with worker.lock:
            self._send(worker, {"action": "warm"})

    def synthesize(
        self,
        spec: EngineSpec,
        model_dir: Path,
        payload: dict[str, Any],
    ) -> bytes:
        worker = self.ensure_worker(spec, model_dir)
        with worker.lock:
            response = self._send(
                worker,
                {"action": "synthesize", "payload": payload},
                response_timeout_secs=WORKER_RESPONSE_TIMEOUT_SECS,
            )
        output_path = Path(response["output_path"])
        try:
            return output_path.read_bytes()
        finally:
            output_path.unlink(missing_ok=True)

    def list_voices(
        self,
        spec: EngineSpec,
        model_dir: Path,
    ) -> list[dict[str, Any]]:
        worker = self.ensure_worker(spec, model_dir)
        with worker.lock:
            response = self._send(worker, {"action": "list_voices"})
        return list(response.get("voices") or [])

    def _collect_worker_detail(
        self,
        worker: WorkerProcess,
        ignored_lines: list[str] | None = None,
    ) -> str:
        stderr = ""
        if worker.stderr_path is not None and worker.stderr_path.exists():
            try:
                stderr = worker.stderr_path.read_text(encoding="utf-8")[-4000:].strip()
            except Exception:
                stderr = ""
        ignored = "\n".join(ignored_lines or []).strip()
        return stderr or ignored

    def _terminate_process(self, process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        try:
            process.terminate()
            process.wait(timeout=PROCESS_SHUTDOWN_TIMEOUT_SECS)
        except Exception:
            try:
                process.kill()
                process.wait(timeout=PROCESS_SHUTDOWN_TIMEOUT_SECS)
            except Exception:
                pass

    def _drop_worker(self, worker: WorkerProcess) -> None:
        with self._global_lock:
            current = self._workers.get(worker.engine)
            if current is worker:
                self._workers.pop(worker.engine, None)

        try:
            if worker.process.stdin is not None:
                worker.process.stdin.close()
        except Exception:
            pass
        try:
            if worker.process.stdout is not None:
                worker.process.stdout.close()
        except Exception:
            pass

        self._terminate_process(worker.process)

    def _readline_with_timeout(
        self,
        worker: WorkerProcess,
        timeout_secs: float,
    ) -> str | None:
        if worker.process.stdout is None:
            raise RuntimeError("Speech worker stdout pipe is not available.")

        result: dict[str, str] = {}
        error_holder: dict[str, BaseException] = {}

        def read_line() -> None:
            try:
                result["line"] = worker.process.stdout.readline()
            except BaseException as exc:  # pragma: no cover - pipe failure path
                error_holder["error"] = exc

        reader = threading.Thread(target=read_line, daemon=True)
        reader.start()
        reader.join(timeout_secs)
        if reader.is_alive():
            return None
        if "error" in error_holder:
            raise RuntimeError(str(error_holder["error"]))
        return result.get("line", "")

    def _send(
        self,
        worker: WorkerProcess,
        message: dict[str, Any],
        *,
        response_timeout_secs: float | None = None,
    ) -> dict[str, Any]:
        if worker.process.stdin is None or worker.process.stdout is None:
            raise RuntimeError("Speech worker pipes are not available.")
        deadline = float(
            response_timeout_secs
            if response_timeout_secs is not None
            else WORKER_RESPONSE_TIMEOUT_SECS
        )
        try:
            worker.process.stdin.write(json.dumps(message) + "\n")
            worker.process.stdin.flush()
        except Exception as exc:
            self._drop_worker(worker)
            raise RuntimeError(
                f"Failed to send request to speech worker '{worker.engine}': {exc}"
            ) from exc

        ignored_lines: list[str] = []
        while True:
            line = self._readline_with_timeout(worker, deadline)
            if line is None:
                detail = self._collect_worker_detail(worker, ignored_lines)
                self._drop_worker(worker)
                raise RuntimeError(
                    detail
                    or f"Speech worker '{worker.engine}' timed out waiting for a response."
                )
            if not line:
                detail = self._collect_worker_detail(worker, ignored_lines)
                self._drop_worker(worker)
                raise RuntimeError(
                    detail or f"Speech worker '{worker.engine}' exited unexpectedly."
                )

            stripped = line.strip()
            if not stripped:
                continue

            try:
                response = json.loads(stripped)
            except json.JSONDecodeError:
                ignored_lines.append(stripped)
                continue

            if not response.get("ok"):
                self._drop_worker(worker)
                raise RuntimeError(response.get("error") or "Speech worker failed.")
            return response
