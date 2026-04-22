from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import request

from .config import EngineSpec, RuntimeConfig

KOKORO_SPACY_MODEL_URL = (
    "https://github.com/explosion/spacy-models/releases/download/"
    "en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
)
FISH_SPEECH_S2_CODEC_URL = "https://huggingface.co/fishaudio/s2-pro/resolve/main/codec.pth"
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
FISH_SPEECH_RUNTIME_DEPENDENCIES = (
    "numpy",
    "torch==2.8.0",
    "torchaudio==2.8.0",
    "transformers<=4.57.3",
    "lightning>=2.1.0",
    "hydra-core>=1.3.2",
    "natsort>=8.4.0",
    "einops>=0.7.0",
    "librosa>=0.10.1",
    "rich>=13.5.3",
    "kui>=1.6.0",
    "uvicorn>=0.30.0",
    "loguru>=0.6.0",
    "loralib>=0.1.2",
    "pyrootutils>=1.0.4",
    "resampy>=0.4.3",
    "einx[torch]==0.2.2",
    "ormsgpack",
    "tiktoken>=0.8.0",
    "pydantic==2.9.2",
    "cachetools==6.2.0",
    "safetensors",
    "protobuf>=3.20.0,<6.0.0",
    "click",
    "soundfile",
    "tqdm",
)
FISH_SPEECH_CODEC_SUPPORT_DEPENDENCIES = (
    "argbind==0.3.9",
    "ffmpy",
    "flatten-dict",
    "importlib-resources",
    "ipython",
    "julius",
    "markdown2",
    "matplotlib",
    "pyloudnorm",
    "pystoi",
    "randomname",
    "tensorboard>=2.14.1",
    "torch-stoi",
)
FISH_SPEECH_CODEC_PACKAGES = (
    "descript-audiotools==0.7.2",
    "descript-audio-codec==1.0.0",
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


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


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
        self._fish_sidecar_lock = threading.Lock()

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
        if spec.provider_id == "fish_speech":
            return self._env_has_module(env_python, "fish_speech")
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

    def _download_file(self, url: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_path = destination.with_suffix(f"{destination.suffix}.part")
        with request.urlopen(url, timeout=60) as response, temp_path.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
        temp_path.replace(destination)

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

        if spec.provider_id == "fish_speech":
            self._pip_install(env_python, *FISH_SPEECH_RUNTIME_DEPENDENCIES)
            self._pip_install(env_python, *FISH_SPEECH_CODEC_SUPPORT_DEPENDENCIES)
            self._pip_install(env_python, "--no-deps", *FISH_SPEECH_CODEC_PACKAGES)
            self._pip_install(env_python, "--no-deps", "-e", str(model_dir))
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
            response = self._send(worker, {"action": "synthesize", "payload": payload})
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

    def _send(self, worker: WorkerProcess, message: dict[str, Any]) -> dict[str, Any]:
        if worker.process.stdin is None or worker.process.stdout is None:
            raise RuntimeError("Speech worker pipes are not available.")
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
            line = self._readline_with_timeout(worker, WORKER_RESPONSE_TIMEOUT_SECS)
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

    def ensure_fish_sidecar(
        self,
        spec: EngineSpec,
        model_dir: Path,
    ) -> str:
        with self._fish_sidecar_lock:
            runtime_dir = self.engines_dir / spec.provider_id
            runtime_dir.mkdir(parents=True, exist_ok=True)
            state_path = runtime_dir / "fish_server.json"
            cached_url = self._load_fish_sidecar_url(state_path)
            if cached_url and self._url_healthy(cached_url):
                return cached_url

            env_python = self.prepare(spec, model_dir)
            port = _free_port()
            url = f"http://127.0.0.1:{port}"
            checkpoint_dir = self._fish_checkpoint_dir(model_dir)
            decoder_path = self._fish_decoder_checkpoint_path(checkpoint_dir)
            log_path = runtime_dir / "fish_server.log"
            log_handle = log_path.open("w", encoding="utf-8")
            process: subprocess.Popen[str] | None = None
            try:
                process = subprocess.Popen(
                    [
                        str(env_python),
                        str(model_dir / "tools" / "api_server.py"),
                        "--listen",
                        f"127.0.0.1:{port}",
                        "--llama-checkpoint-path",
                        str(checkpoint_dir),
                        "--decoder-checkpoint-path",
                        str(decoder_path),
                        "--decoder-config-name",
                        "modded_dac_vq",
                        "--device",
                        "cpu",
                    ],
                    cwd=str(model_dir),
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env=self._child_env(),
                )
            finally:
                log_handle.close()

            for _ in range(60):
                if self._url_healthy(url):
                    state_path.write_text(
                        json.dumps({"url": url, "pid": process.pid}, indent=2),
                        encoding="utf-8",
                    )
                    return url
                if process.poll() is not None:
                    break
                time.sleep(1)

            detail = ""
            if log_path.exists():
                try:
                    detail = log_path.read_text(encoding="utf-8")[-4000:].strip()
                except Exception:
                    detail = ""
            state_path.unlink(missing_ok=True)
            self._terminate_process(process)
            raise RuntimeError(detail or "Fish Speech server did not become healthy.")

    def _load_fish_sidecar_url(self, state_path: Path) -> str | None:
        if not state_path.exists():
            return None
        try:
            data = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            return None

        url = data.get("url")
        if isinstance(url, str):
            url = url.strip()
            if url:
                return url
        return None

    def _fish_checkpoint_dir(self, model_dir: Path) -> Path:
        for candidate in (
            model_dir / "checkpoints" / "s2-pro",
            model_dir / "checkpoints" / "openaudio-s1-mini",
            model_dir / "checkpoints" / "fish-speech-1.5",
        ):
            if candidate.exists() and (
                (candidate / "model.pth").exists()
                or (candidate / "model.safetensors.index.json").exists()
            ):
                return candidate
        raise RuntimeError("Fish Speech checkpoints are missing.")

    def _fish_decoder_checkpoint_path(self, checkpoint_dir: Path) -> Path:
        codec_path = checkpoint_dir / "codec.pth"
        if codec_path.exists():
            return codec_path

        if checkpoint_dir.name == "fish-speech-1.5":
            self._download_file(FISH_SPEECH_S2_CODEC_URL, codec_path)
            return codec_path

        raise RuntimeError(
            "Fish Speech codec.pth is missing from the checkpoint bundle."
        )

    def _url_healthy(self, url: str) -> bool:
        try:
            with request.urlopen(f"{url}/v1/health", timeout=3) as response:
                return int(response.status) < 400
        except Exception:
            return False
