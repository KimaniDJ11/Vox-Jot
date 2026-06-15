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
  VOX_JOT_API_URL=http://127.0.0.1:8978 python3 scripts/test-local-api.py
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

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
        print(f"  [{flag}] POST /v1/settings/command                {str(code):>4} {ms:>6}ms  {detail[:64]}")

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
