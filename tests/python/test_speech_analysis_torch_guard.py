#!/usr/bin/env python3
"""Regression tests for speech-analysis PyTorch security hardening."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


def load_sidecar_module() -> types.ModuleType:
    root = Path(__file__).resolve().parents[2]
    sidecar_path = root / "scripts" / "speech_analysis_sidecar.py"
    spec = importlib.util.spec_from_file_location("speech_analysis_sidecar", sidecar_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {sidecar_path}")

    previous_soundfile = sys.modules.get("soundfile")
    sys.modules["soundfile"] = types.SimpleNamespace()
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        if previous_soundfile is None:
            sys.modules.pop("soundfile", None)
        else:
            sys.modules["soundfile"] = previous_soundfile
    return module


class TorchJitGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sidecar = load_sidecar_module()

    def test_disable_torch_jit_script_fails_closed(self) -> None:
        fake_torch = types.SimpleNamespace(
            jit=types.SimpleNamespace(script=lambda value: value)
        )

        self.sidecar.disable_torch_jit_script(fake_torch)

        self.assertTrue(fake_torch.jit._vox_jot_script_disabled)
        with self.assertRaisesRegex(RuntimeError, "CVE-2025-3000"):
            fake_torch.jit.script(lambda value: value)

    def test_disable_torch_jit_script_is_idempotent(self) -> None:
        fake_torch = types.SimpleNamespace(
            jit=types.SimpleNamespace(script=lambda value: value)
        )

        self.sidecar.disable_torch_jit_script(fake_torch)
        blocked_script = fake_torch.jit.script
        self.sidecar.disable_torch_jit_script(fake_torch)

        self.assertIs(fake_torch.jit.script, blocked_script)

    def test_import_guarded_torch_patches_imported_module(self) -> None:
        fake_torch = types.SimpleNamespace(
            jit=types.SimpleNamespace(script=lambda value: value)
        )
        previous_torch = sys.modules.get("torch")
        sys.modules["torch"] = fake_torch
        try:
            imported_torch = self.sidecar.import_guarded_torch()
        finally:
            if previous_torch is None:
                sys.modules.pop("torch", None)
            else:
                sys.modules["torch"] = previous_torch

        self.assertIs(imported_torch, fake_torch)
        with self.assertRaisesRegex(RuntimeError, "CVE-2025-3000"):
            imported_torch.jit.script(lambda value: value)


if __name__ == "__main__":
    unittest.main()
