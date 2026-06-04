#!/usr/bin/env python3
"""Capture additional Vox Jot Gumroad screenshots (Refine, Listen, Settings subsections)."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SCREENSHOT_SCRIPT = (
    Path.home() / ".codex" / "skills" / "screenshot" / "scripts" / "take_screenshot.py"
)
SCREENSHOT_SCRIPT = Path(
    os.environ.get("VOXJOT_SCREENSHOT_SCRIPT", str(DEFAULT_SCREENSHOT_SCRIPT))
).expanduser()
OUTPUT_DIR = Path(
    os.environ.get(
        "VOXJOT_GUMROAD_SCREENSHOT_OUTPUT",
        str(REPO_DIR / "output" / "gumroad-screenshots-additional"),
    )
).expanduser()
APP_PATH = os.environ.get("VOXJOT_APP_PATH", "/Applications/Vox Jot.app")
MAIN_SIZE = (1200, 1020)

APPLESCRIPT_HELPERS = '''
on clickMode(nameValue)
    tell application "System Events"
        tell process "vox_jot"
            set frontmost to true
            delay 0.8
            set w to window 1
            set uiDesc to entire contents of w
            repeat with i from 1 to count of uiDesc
                try
                    set el to item i of uiDesc
                    if (class of el as text) is "radio button" and (name of el as text) is nameValue then
                        click item i of uiDesc
                        exit repeat
                    end if
                end try
            end repeat
        end tell
    end tell
end clickMode

on clickSidebar(nameValue)
    tell application "System Events"
        tell process "vox_jot"
            set frontmost to true
            delay 0.8
            set w to window 1
            set uiDesc to entire contents of w
            set inNav to false
            repeat with i from 1 to count of uiDesc
                try
                    set el to item i of uiDesc
                    if (class of el as text) is "group" and (name of el as text) is "Section navigation" then
                        set inNav to true
                    else if inNav and (class of el as text) is "button" and (name of el as text) is nameValue then
                        click item i of uiDesc
                        exit repeat
                    end if
                end try
            end repeat
        end tell
    end tell
end clickSidebar

on openSettings()
    tell application "System Events"
        tell process "vox_jot"
            set frontmost to true
            delay 0.8
            set w to window 1
            set uiDesc to entire contents of w
            set navIndex to 0
            repeat with i from 1 to count of uiDesc
                try
                    set el to item i of uiDesc
                    if (class of el as text) is "group" and (name of el as text) is "Section navigation" then
                        set navIndex to i
                        exit repeat
                    end if
                end try
            end repeat
            if navIndex is 0 then return
            repeat with i from navIndex to count of uiDesc
                try
                    set el to item i of uiDesc
                    if (class of el as text) is "button" and (name of el as text) is "Settings" then
                        click item i of uiDesc
                        exit repeat
                    end if
                end try
            end repeat
        end tell
    end tell
end openSettings
'''


def run_cmd(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    print(f"Running: {' '.join(cmd)}")
    return subprocess.run(cmd, capture_output=True, text=True)


def run_applescript(body: str) -> None:
    run_cmd(["osascript", "-e", APPLESCRIPT_HELPERS, "-e", body])


def ensure_app_active() -> None:
    run_cmd(["/usr/bin/open", "-a", APP_PATH])
    time.sleep(1.5)


def close_extra_windows() -> None:
    run_applescript('''
tell application "System Events"
    tell process "vox_jot"
        set frontmost to true
        try
            repeat with w in every window
                try
                    set sz to size of w
                    if item 1 of sz is not 1200 then
                        click button 1 of w
                        delay 0.4
                    end if
                end try
            end repeat
        end try
    end tell
end tell
''')
    time.sleep(0.5)


def reset_to_dictate() -> None:
    run_applescript('clickMode("Dictate")')
    time.sleep(1.2)


def find_window_by_size(width: int, height: int) -> str | None:
    res = run_cmd(["python3", str(SCREENSHOT_SCRIPT), "--list-windows"])
    pattern = rf"(\d+)\s+Vox Jot\s+Vox Jot\s+{width}x{height}\+"
    for line in res.stdout.strip().split("\n"):
        match = re.match(pattern, line)
        if match:
            return match.group(1)
        if f"{width}x{height}" in line and "Vox Jot" in line:
            parts = line.split("\t")
            if parts:
                return parts[0]
    print(f"Window {width}x{height} not found:\n{res.stdout}")
    return None


def capture_window(window_id: str, output_path: str) -> bool:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    res = run_cmd(
        [
            "python3",
            str(SCREENSHOT_SCRIPT),
            "--window-id",
            window_id,
            "--path",
            output_path,
        ]
    )
    if res.returncode != 0:
        print(res.stderr or res.stdout)
    return os.path.exists(output_path)


def capture_view(view_name: str, setup: str) -> bool:
    print(f"\n=================== CAPTURING: {view_name} ===================")
    ensure_app_active()
    close_extra_windows()
    reset_to_dictate()
    run_applescript(setup)
    time.sleep(2.0)

    width, height = MAIN_SIZE
    window_id = find_window_by_size(width, height)
    if not window_id:
        return False

    output_path = str(OUTPUT_DIR / f"vox-jot-{view_name}.png")
    if capture_window(window_id, output_path):
        print(f"Saved {output_path}")
        return True
    return False


def main() -> int:
    if not SCREENSHOT_SCRIPT.exists():
        print(
            "Screenshot helper not found. Set VOXJOT_SCREENSHOT_SCRIPT to "
            "the local take_screenshot.py path.",
            file=sys.stderr,
        )
        return 2

    # Capture Refine + Listen before Settings so mode switching is not blocked.
    views: list[tuple[str, str]] = [
        (
            "home",
            'clickMode("Dictate")\ndelay 1.0\nclickSidebar("Home")',
        ),
        (
            "refine-dictation-modes",
            'clickMode("Refine")\ndelay 1.0\nclickSidebar("Dictation Modes")',
        ),
        (
            "phrase-keys",
            'clickMode("Refine")\ndelay 1.0\nclickSidebar("Phrase Keys")',
        ),
        (
            "translation",
            'clickMode("Refine")\ndelay 1.0\nclickSidebar("Translation")',
        ),
        (
            "listen-studio",
            'clickMode("Listen")\ndelay 1.0\nclickSidebar("Studio")',
        ),
        (
            "voice-design",
            'clickMode("Listen")\ndelay 1.0\nclickSidebar("Voice Design")',
        ),
        (
            "voice-cloning",
            'clickMode("Listen")\ndelay 1.0\nclickSidebar("Voice Cloning")',
        ),
        (
            "voice-changer",
            'clickMode("Listen")\ndelay 1.0\nclickSidebar("Voice Changer")',
        ),
        (
            "generated-audio",
            'clickMode("Listen")\ndelay 1.0\nclickSidebar("Generated Audio")',
        ),
        (
            "settings-shortcuts",
            'openSettings()\ndelay 1.2\nclickSidebar("Shortcuts")',
        ),
        (
            "settings-models-ai",
            'openSettings()\ndelay 1.2\nclickSidebar("Models & AI")',
        ),
        (
            "settings-privacy",
            'openSettings()\ndelay 1.2\nclickSidebar("Privacy & Storage")',
        ),
        (
            "settings-about",
            'openSettings()\ndelay 1.2\nclickSidebar("About Vox Jot")',
        ),
    ]

    success = 0
    for view_name, setup in views:
        if capture_view(view_name, setup):
            success += 1

    print(f"\nDone: {success}/{len(views)} additional screenshots saved to {OUTPUT_DIR}")
    return 0 if success == len(views) else 1


if __name__ == "__main__":
    sys.exit(main())
