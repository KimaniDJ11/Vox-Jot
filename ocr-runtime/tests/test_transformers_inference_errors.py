"""RC2: TransformersVlLoader must raise on inference exceptions, not return ()."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from ocr_runtime.loaders.generic import TransformersVlLoader


def _loader() -> TransformersVlLoader:
    # Match TransformersVlLoader.__init__ signature on this branch.
    loader = TransformersVlLoader.__new__(TransformersVlLoader)
    loader.catalog_id = "jina-ocr-v1"
    loader._backend = "transformers-vl"
    loader._model_root = "/tmp/fake-jina"
    loader._device = "cpu"
    loader._processor = MagicMock()
    loader._model = MagicMock()
    loader._tokenizer = None
    loader._torch = MagicMock()
    loader._load_error = None
    loader._torch.no_grad.return_value.__enter__ = lambda s: None
    loader._torch.no_grad.return_value.__exit__ = lambda *a: None
    return loader


def test_inference_exception_raises_runtime_error_with_catalog_id():
    loader = _loader()
    loader._processor.prepare_ocr_inputs.side_effect = RuntimeError("boom")

    with patch.object(loader, "_ensure_loaded", return_value=True), patch(
        "ocr_runtime.loaders.generic._image_from_pixels",
        return_value=object(),
    ):
        with pytest.raises(RuntimeError, match="jina-ocr-v1 inference failed"):
            list(
                loader.run(
                    bgra=b"\x00" * 16,
                    width=2,
                    height=2,
                    stride=8,
                    max_words=32,
                    pixel_format="bgra8",
                )
            )

    info = loader.info()
    assert "jina-ocr-v1" in info["detail"]
    assert "cpu" in info["detail"] or "device=cpu" in info["detail"]


def test_empty_ocr_text_still_returns_empty_tuple():
    loader = _loader()
    loader._processor.prepare_ocr_inputs.return_value = {"input_ids": object()}
    loader._model.generate.return_value = object()
    loader._processor.decode_ocr.return_value = "   "

    with patch.object(loader, "_ensure_loaded", return_value=True), patch(
        "ocr_runtime.loaders.generic._image_from_pixels",
        return_value=object(),
    ), patch("ocr_runtime.loaders.generic._word_clip", return_value=""):
        result = list(
            loader.run(
                bgra=b"\x00" * 16,
                width=2,
                height=2,
                stride=8,
                max_words=32,
                pixel_format="bgra8",
            )
        )
    assert result == []
