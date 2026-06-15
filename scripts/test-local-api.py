#!/usr/bin/env python3
"""Smoke-test the Vox Jot local HTTP API + UI-automation controls.

This is the repeatable harness for the build loop: after a
`bun run mac:update-installed-app:notarized` rebuild, run this against the
running app to confirm existing endpoints still work and newly added controls
respond. Endpoints are declared in ENDPOINTS / WRITE_ENDPOINTS below — add a row
when a new control comes online.

Auth: the loopback API expects header `x-vox-jot-api-token`. The token is read
from $VOX_JOT_API_TOKEN, else from the macOS keychain item the app writes
(service `com.voxjot.post_process_api_keys`, account `http_api:loopback_token`),
so it stays correct across rebuilds without hardcoding a secret.

Usage:
  python3 scripts/test-local-api.py                 # read-only GET smoke test
  python3 scripts/test-local-api.py --write         # also exercise benign POSTs
  python3 scripts/test-local-api.py --transcribe-fixture
  VOX_JOT_API_URL=http://127.0.0.1:8978 python3 scripts/test-local-api.py
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import wave

DEFAULT_BASE = os.environ.get("VOX_JOT_API_URL", "http://127.0.0.1:8978")
TOKEN_HEADER = "x-vox-jot-api-token"
KEYCHAIN_SERVICE = "com.voxjot.post_process_api_keys"
KEYCHAIN_ACCOUNT = "http_api:loopback_token"

# (method, path, body, allowed_status_codes)
# allowed codes are intentionally a little lenient where a clean install may
# legitimately not have data yet (e.g. no history) or a subsystem is optional.
ENDPOINTS = [
    ("GET", "/v1/health", None, {200}),
    ("GET", "/v1/readiness", None, {200, 503}),
    ("GET", "/v1/app/settings", None, {200}),
    ("GET", "/v1/settings", None, {200}),
    ("GET", "/v1/settings/schema", None, {200}),
    ("GET", "/v1/dictation/status", None, {200}),
    ("GET", "/v1/model-platform", None, {200}),
    ("GET", "/v1/audio/devices", None, {200}),
    ("GET", "/v1/models", None, {200}),
    ("GET", "/v1/voices", None, {200}),
    ("GET", "/v1/ocr/models", None, {200}),
    ("GET", "/v1/ocr/downloads", None, {200}),
    ("GET", "/v1/tts/profiles", None, {200}),
    ("GET", "/v1/creative-audio/models", None, {200}),
    ("GET", "/v1/history", None, {200}),
    ("GET", "/v1/history/latest", None, {200, 404}),
    ("GET", "/v1/stats/dictation", None, {200}),
    ("GET", "/v1/screen-context/diagnostics", None, {200}),
]

# Benign side effects only (no recording, no downloads, no model loads).
WRITE_ENDPOINTS = [
    ("POST", "/v1/app/show", {}, {200}),
    ("POST", "/v1/app/cancel", {}, {200}),
]


def get_token() -> str:
    tok = os.environ.get("VOX_JOT_API_TOKEN", "").strip()
    if tok:
        return tok
    try:
        out = subprocess.run(
            [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                KEYCHAIN_SERVICE,
                "-a",
                KEYCHAIN_ACCOUNT,
                "-w",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if out.returncode == 0:
            return out.stdout.strip()
    except Exception as exc:  # pragma: no cover - diagnostic only
        print(f"  (keychain token fetch failed: {exc})")
    return ""


def call(method, path, base, token, body=None, timeout=25):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header(TOKEN_HEADER, token)
    if data is not None:
        req.add_header("content-type", "application/json")
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), int((time.time() - started) * 1000), None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), int((time.time() - started) * 1000), None
    except Exception as exc:
        return None, b"", int((time.time() - started) * 1000), str(exc)


def call_multipart_file(path, base, token, file_path, timeout=60):
    boundary = f"----vox-jot-api-{int(time.time() * 1000)}"
    filename = os.path.basename(file_path)
    with open(file_path, "rb") as handle:
        file_bytes = handle.read()
    body = b"".join(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            (
                'Content-Disposition: form-data; name="file"; '
                f'filename="{filename}"\r\n'
            ).encode("utf-8"),
            b"Content-Type: audio/wav\r\n\r\n",
            file_bytes,
            f"\r\n--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, data=body, method="POST")
    if token:
        req.add_header(TOKEN_HEADER, token)
    req.add_header("content-type", f"multipart/form-data; boundary={boundary}")
    req.add_header("content-length", str(len(body)))
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), int((time.time() - started) * 1000), None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), int((time.time() - started) * 1000), None
    except Exception as exc:
        return None, b"", int((time.time() - started) * 1000), str(exc)


def write_tiny_wav_fixture() -> str:
    tmp = tempfile.NamedTemporaryFile(
        prefix="vox-jot-api-transcribe-", suffix=".wav", delete=False
    )
    tmp.close()
    sample_rate = 16000
    duration_seconds = 0.35
    sample_count = int(sample_rate * duration_seconds)
    with wave.open(tmp.name, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00" * sample_count)
    return tmp.name


def summarize(raw: bytes) -> str:
    try:
        parsed = json.loads(raw)
    except Exception:
        return "(non-JSON body)"
    if isinstance(parsed, dict):
        return "keys: " + ", ".join(list(parsed.keys())[:6])
    if isinstance(parsed, list):
        return f"list[{len(parsed)}]"
    return str(parsed)[:60]


def run_case(method, path, body, allowed, base, token):
    code, raw, ms, err = call(method, path, base, token, body)
    detail = ""
    ok = False
    if err is not None:
        detail = f"ERROR {err}"
    elif code in allowed:
        if code == 200:
            try:
                json.loads(raw)
                ok = True
                detail = summarize(raw)
            except Exception:
                detail = "200 but body is not JSON"
        else:
            ok = True
            detail = f"(allowed {code})"
    else:
        detail = raw[:90].decode("utf-8", "replace").replace("\n", " ")
    return ok, code, ms, detail


def should_attempt_transcribe_fixture(base, token):
    code, raw, _, err = call("GET", "/v1/readiness", base, token)
    if err is not None:
        return False, f"readiness error: {err}"
    if code != 200:
        return False, f"readiness HTTP {code}"
    try:
        readiness = json.loads(raw)
    except Exception:
        return False, "readiness body is not JSON"
    if readiness.get("overall") == "blocked":
        return False, "STT readiness is blocked"

    code, raw, _, err = call("GET", "/v1/models", base, token)
    if err is not None:
        return False, f"models error: {err}"
    if code != 200:
        return False, f"models HTTP {code}"
    try:
        models = json.loads(raw)
    except Exception:
        return False, "models body is not JSON"
    if not isinstance(models.get("available"), list) or not models["available"]:
        return False, "no STT models are available"
    return True, "ready"


def run_transcribe_fixture(base, token):
    can_attempt, reason = should_attempt_transcribe_fixture(base, token)
    if not can_attempt:
        print(f"  [SKIP] POST /v1/transcribe fixture - {reason}")
        return None

    wav_path = write_tiny_wav_fixture()
    try:
        code, raw, ms, err = call_multipart_file(
            "/v1/transcribe", base, token, wav_path, timeout=60
        )
    finally:
        try:
            os.unlink(wav_path)
        except OSError:
            pass

    ok = False
    if err is not None:
        detail = f"ERROR {err}"
    elif code == 200:
        try:
            parsed = json.loads(raw)
            ok = isinstance(parsed.get("text"), str)
            detail = "keys: " + ", ".join(list(parsed.keys())[:6])
        except Exception:
            detail = "200 but body is not JSON"
    else:
        detail = raw[:90].decode("utf-8", "replace").replace("\n", " ")

    flag = "PASS" if ok else "FAIL"
    print(
        f"  [{flag}] POST /v1/transcribe fixture          "
        f"{str(code):>4} {ms:>6}ms  {detail[:64]}"
    )
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument(
        "--write",
        action="store_true",
        help="also exercise benign POST controls (app/show, app/cancel)",
    )
    parser.add_argument(
        "--no-auth-check",
        action="store_true",
        help="skip the no-token 401 enforcement check",
    )
    parser.add_argument(
        "--transcribe-fixture",
        action="store_true",
        help="also POST a generated silence WAV to /v1/transcribe when STT is ready",
    )
    args = parser.parse_args()

    token = get_token()
    print(f"Base URL : {args.base}")
    print(
        "Token    : "
        + (f"<resolved, len={len(token)}>" if token else "<NONE — most calls will 401>")
    )
    print()

    cases = list(ENDPOINTS) + (list(WRITE_ENDPOINTS) if args.write else [])
    results = []
    for method, path, body, allowed in cases:
        ok, code, ms, detail = run_case(method, path, body, allowed, args.base, token)
        results.append(ok)
        flag = "PASS" if ok else "FAIL"
        print(f"  [{flag}] {method:4} {path:38} {str(code):>4} {ms:>6}ms  {detail[:64]}")

    if args.write:
        code, raw, ms, err = call("GET", "/v1/app/settings", args.base, token)
        tts_volume = 1.0
        if err is None and code == 200:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed.get("tts_volume"), (int, float)):
                    tts_volume = parsed["tts_volume"]
            except Exception:
                pass
        body = {"key": "tts_volume", "value": tts_volume}
        ok, code, ms, detail = run_case(
            "POST",
            "/v1/settings/command",
            body,
            {200},
            args.base,
            token,
        )
        results.append(ok)
        flag = "PASS" if ok else "FAIL"
        print(
            f"  [{flag}] POST /v1/settings/command                "
            f"{str(code):>4} {ms:>6}ms  {detail[:64]}"
        )

        # /v1/settings/patch accepts a partial settings object, but only fields
        # NOT listed in the schema's protected_fields. Pick a non-protected
        # scalar field and round-trip it to its current value (a true no-op) to
        # exercise the patch happy path without changing any setting.
        patch_field = patch_value = None
        cc, craw, _, cerr = call("GET", "/v1/settings", args.base, token)
        sc, sraw, _, serr = call("GET", "/v1/settings/schema", args.base, token)
        if cerr is None and cc == 200 and serr is None and sc == 200:
            try:
                current = json.loads(craw)
                protected = set(json.loads(sraw).get("protected_fields", []))
                # Prefer pure-preference fields whose patch is a cheap no-op.
                # Hardware/model/mic-backed fields (e.g. always_on_microphone)
                # can block the request for many seconds when re-applied.
                for name in (
                    "audio_feedback",
                    "append_trailing_space",
                    "auto_submit",
                    "auto_submit_key",
                ):
                    if name not in protected and isinstance(
                        current.get(name), (bool, int, float, str)
                    ):
                        patch_field, patch_value = name, current[name]
                        break
            except Exception:
                pass
        if patch_field is not None:
            for patch_path in ("/v1/settings/patch", "/v1/settings"):
                ok, code, ms, detail = run_case(
                    "POST",
                    patch_path,
                    {patch_field: patch_value},
                    {200},
                    args.base,
                    token,
                )
                results.append(ok)
                flag = "PASS" if ok else "FAIL"
                print(
                    f"  [{flag}] POST {patch_path} ({patch_field}) "
                    f"{str(code):>4} {ms:>6}ms  {detail[:48]}"
                )
        else:
            results.append(False)
            print("  [FAIL] POST /v1/settings/patch - no non-protected scalar field found")

    if args.transcribe_fixture:
        result = run_transcribe_fixture(args.base, token)
        if result is not None:
            results.append(result)

    if not args.no_auth_check:
        code, _, ms, err = call("GET", "/v1/app/settings", args.base, "")
        ok = err is None and code in (401, 403)
        results.append(ok)
        flag = "PASS" if ok else "FAIL"
        print(
            f"  [{flag}] AUTH no-token /v1/app/settings -> {code} "
            f"(expect 401/403){'  ' + err if err else ''}"
        )

    passed = sum(1 for ok in results if ok)
    total = len(results)
    print()
    print(f"  {passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
