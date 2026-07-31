#!/usr/bin/env python3
"""Collect upstream license and notice material from a staged Python runtime."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import re
import sys
from collections.abc import Iterable
from email.message import Message
from pathlib import Path
from typing import Protocol, cast

NOTICE_FILE_PATTERN = re.compile(
    r"^(?:licen[cs]e|copying|notice|copyright|authors)(?:[._-].*)?$",
    re.IGNORECASE,
)
IGNORED_DIRECTORIES = {"__pycache__", ".git", ".hg", ".svn"}


def read_text(path: Path) -> str:
    content = path.read_bytes()
    if b"\0" in content:
        raise ValueError(f"Notice file is not UTF-8 text: {path}")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("windows-1252")
    return text.replace("\r\n", "\n").rstrip()


def find_notice_files(root: Path) -> list[Path]:
    notices: list[Path] = []
    for directory, directory_names, file_names in os.walk(root):
        directory_names[:] = sorted(
            name for name in directory_names if name not in IGNORED_DIRECTORIES
        )
        base = Path(directory)
        for name in sorted(file_names):
            if NOTICE_FILE_PATTERN.fullmatch(name):
                notices.append(base / name)
    return notices


def distribution_metadata(distribution: importlib.metadata.Distribution) -> Message:
    return cast(Message, cast(object, distribution.metadata))


def metadata_value(metadata: Message, key: str) -> str:
    value = metadata.get(key)
    return value.strip() if value else ""


def project_urls(metadata: Message) -> list[str]:
    urls: list[str] = []
    home_page = metadata_value(metadata, "Home-page")
    if home_page:
        urls.append(home_page)
    for value in metadata.get_all("Project-URL") or []:
        if value.strip():
            urls.append(value.strip())
    return sorted(set(urls))


def distribution_notice_files(
    distribution: importlib.metadata.Distribution,
) -> list[tuple[str, str]]:
    documents: list[tuple[str, str]] = []
    seen: set[Path] = set()
    for relative_file in distribution.files or []:
        relative_path = Path(str(relative_file))
        if not NOTICE_FILE_PATTERN.fullmatch(relative_path.name):
            continue
        absolute_path = Path(str(distribution.locate_file(relative_file))).resolve()
        if absolute_path in seen or not absolute_path.is_file():
            continue
        seen.add(absolute_path)
        documents.append((relative_path.as_posix(), read_text(absolute_path)))
    return sorted(documents)


def render_distribution(distribution: importlib.metadata.Distribution) -> str:
    metadata = distribution_metadata(distribution)
    name = metadata_value(metadata, "Name") or "unknown-package"
    version = distribution.version or "unknown"
    license_value = (
        metadata_value(metadata, "License-Expression")
        or metadata_value(metadata, "License")
    )
    author = (
        metadata_value(metadata, "Author")
        or metadata_value(metadata, "Author-email")
        or "Not specified in package metadata"
    )
    urls = project_urls(metadata)
    documents = distribution_notice_files(distribution)

    if not license_value and not documents:
        classifiers = metadata.get_all("Classifier") or []
        license_classifiers = [
            classifier
            for classifier in classifiers
            if classifier.startswith("License ::")
        ]
        license_value = "; ".join(license_classifiers)
    if not license_value and not documents:
        raise ValueError(
            f"Python package {name}@{version} has no license metadata or notice files"
        )

    heading = f"{name} {version}"
    lines = [
        heading,
        "-" * len(heading),
        f"Declared license: {license_value or 'See preserved upstream notice files below'}",
        f"Upstream attribution: {author}",
        f"Upstream source: {'; '.join(urls) if urls else 'Not specified in package metadata'}",
    ]
    if not documents:
        lines.append(
            "Preserved notice files: none published in the installed distribution; metadata above is reproduced verbatim."
        )
    for relative_path, content in documents:
        lines.extend(
            [
                "",
                f"----- BEGIN UPSTREAM FILE: {relative_path} -----",
                content,
                f"----- END UPSTREAM FILE: {relative_path} -----",
            ]
        )
    return "\n".join(lines)


def unique_distributions() -> Iterable[importlib.metadata.Distribution]:
    seen: set[tuple[str, str, str]] = set()
    distributions = sorted(
        importlib.metadata.distributions(),
        key=lambda distribution: (
            metadata_value(distribution_metadata(distribution), "Name").lower(),
            distribution.version,
            str(distribution.locate_file("")),
        ),
    )
    for distribution in distributions:
        key = (
            metadata_value(distribution_metadata(distribution), "Name").lower(),
            distribution.version,
            str(distribution.locate_file("")),
        )
        if key not in seen:
            seen.add(key)
            yield distribution


class Arguments(Protocol):
    runtime_root: Path
    output: str


def main() -> None:
    parser = argparse.ArgumentParser()
    _ = parser.add_argument("runtime_root", type=Path)
    _ = parser.add_argument(
        "--output",
        default="THIRD_PARTY_NOTICES.txt",
        help="Output path relative to runtime_root",
    )
    args = cast(Arguments, cast(object, parser.parse_args()))

    runtime_root = args.runtime_root.resolve()
    python_root = runtime_root / ".python"
    if not python_root.is_dir():
        raise SystemExit(f"Staged Python root is missing: {python_root}")

    output_path = runtime_root / args.output
    output_path.unlink(missing_ok=True)

    runtime_documents: list[tuple[str, str]] = []
    for notice_path in find_notice_files(python_root):
        relative_path = notice_path.relative_to(runtime_root).as_posix()
        runtime_documents.append((relative_path, read_text(notice_path)))

    distribution_sections = [
        render_distribution(distribution) for distribution in unique_distributions()
    ]

    lines = [
        "VOX JOT PYTHON RUNTIME THIRD-PARTY NOTICES",
        "==========================================",
        "",
        "This file is generated by scripts/collect-python-runtime-notices.py.",
        "It preserves the license, copyright, attribution, and NOTICE files",
        "published inside the staged CPython runtime and installed distributions.",
        "",
        f"Runtime Python: {sys.version}",
        f"Runtime implementation: {json.dumps(sys.implementation.name)}",
        "Runtime source: https://github.com/astral-sh/python-build-standalone",
        "",
        "STAGED RUNTIME NOTICE FILES",
        "===========================",
    ]

    if not runtime_documents:
        raise SystemExit(
            "The staged standalone Python runtime contains no license or notice files"
        )

    for relative_path, content in runtime_documents:
        lines.extend(
            [
                "",
                f"----- BEGIN UPSTREAM FILE: {relative_path} -----",
                content,
                f"----- END UPSTREAM FILE: {relative_path} -----",
            ]
        )

    lines.extend(
        [
            "",
            "INSTALLED PYTHON DISTRIBUTION NOTICES",
            "=====================================",
            "",
            "\n\n".join(distribution_sections),
            "",
        ]
    )
    _ = output_path.write_text("\n".join(lines), encoding="utf-8")
    message = f"Generated {output_path} ({len(runtime_documents)} runtime files, "
    message += f"{len(distribution_sections)} Python distributions)."
    _ = print(message)


if __name__ == "__main__":
    main()
