"""Vox Jot neural OCR sidecar package.

The Rust side spawns ``python -m ocr_runtime`` per active neural model
and talks to it over line-delimited JSON. See ``server.py`` for the loop
and ``loaders/`` for per-family adapters.
"""

__version__ = "0.1.0"
