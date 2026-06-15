"""Best-effort OCR loaders used by the shipped sidecar.

The catalog mirrors contain several model families with different APIs. This
module keeps the IPC contract stable while letting each family use the best
available local dependency:

* Transformers VL models use ``transformers`` when installed and return one
  full-screen snippet containing the generated OCR text.
* Paddle detector/recognizer packs use ``paddleocr`` when installed and return
  line snippets with normalised boxes.

If an optional dependency is missing or a model-specific loader fails, the
loader returns no snippets. The Rust router treats that as a backend miss and
falls through to the existing system/Tesseract OCR policy within the capture
timeout.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Iterable, Optional

from .base import LoaderInfo, OcrLoader, Snippet

OCR_PROMPT = (
    "Read all visible text in this screenshot. Return only the text, preserving "
    "line breaks where useful. Do not describe the image."
)


def _word_clip(text: str, max_words: int) -> str:
    text = text.strip()
    if max_words <= 0:
        return text
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words])


def _image_from_pixels(
    *,
    bgra: bytes,
    width: int,
    height: int,
    stride: int,
    pixel_format: str,
):
    try:
        from PIL import Image
    except Exception:
        return None

    raw_mode = "RGBA" if pixel_format == "rgba8" else "BGRA"
    return Image.frombytes(
        "RGBA",
        (width, height),
        bgra,
        "raw",
        raw_mode,
        stride,
        1,
    ).convert("RGB")


class TransformersVlLoader(OcrLoader):
    catalog_id: str

    def __init__(self, *, model_root: Path | str, catalog_id: str, backend: str) -> None:
        self.catalog_id = catalog_id
        self._backend = backend
        self._model_root = Path(model_root)
        self._processor = None
        self._tokenizer = None
        self._model = None
        self._torch = None
        self._device = "cpu"
        self._load_error: Optional[str] = None

    def _ensure_loaded(self) -> bool:
        if self._model is not None:
            return True
        if self._load_error is not None:
            return False

        try:
            import torch
            from transformers import AutoProcessor, AutoTokenizer

            model_classes = []
            try:
                from transformers import AutoModelForImageTextToText

                model_classes.append(AutoModelForImageTextToText)
            except Exception:
                pass
            try:
                from transformers import AutoModelForVision2Seq

                model_classes.append(AutoModelForVision2Seq)
            except Exception:
                pass
            try:
                from transformers import AutoModelForCausalLM

                model_classes.append(AutoModelForCausalLM)
            except Exception:
                pass

            root = str(self._model_root)
            if self.catalog_id == "lighton-ocr-2-1b":
                from transformers import LightOnOcrForConditionalGeneration, LightOnOcrProcessor

                self._processor = LightOnOcrProcessor.from_pretrained(root)
                dtype = torch.float32 if self._device == "mps" else torch.float32
                self._model = LightOnOcrForConditionalGeneration.from_pretrained(
                    root,
                    torch_dtype=dtype,
                )
                self._model.eval()
                if self._device != "cpu":
                    self._model.to(self._device)
                self._torch = torch
                return True

            self._processor = AutoProcessor.from_pretrained(root, trust_remote_code=True)
            try:
                self._tokenizer = AutoTokenizer.from_pretrained(root, trust_remote_code=True)
            except Exception:
                self._tokenizer = None

            if torch.cuda.is_available():
                self._device = "cuda"
            elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
                self._device = "mps"
            else:
                self._device = "cpu"

            last_error: Optional[Exception] = None
            for model_cls in model_classes:
                try:
                    self._model = model_cls.from_pretrained(
                        root,
                        trust_remote_code=True,
                        torch_dtype="auto",
                        low_cpu_mem_usage=True,
                    )
                    break
                except TypeError:
                    try:
                        self._model = model_cls.from_pretrained(root, trust_remote_code=True)
                        break
                    except Exception as exc:  # noqa: BLE001
                        last_error = exc
                except Exception as exc:  # noqa: BLE001
                    last_error = exc

            if self._model is None:
                raise RuntimeError(f"no supported transformers model class loaded: {last_error}")

            self._model.eval()
            if self._device != "cpu":
                self._model.to(self._device)
            self._torch = torch
            return True
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            return False

    def run(
        self,
        bgra: bytes,
        width: int,
        height: int,
        stride: int,
        max_words: int,
        pixel_format: str = "bgra8",
    ) -> Iterable[Snippet]:
        image = _image_from_pixels(
            bgra=bgra,
            width=width,
            height=height,
            stride=stride,
            pixel_format=pixel_format,
        )
        if image is None or not self._ensure_loaded():
            return ()

        processor = self._processor
        assert processor is not None
        try:
            if self.catalog_id == "lighton-ocr-2-1b":
                messages = [
                    {
                        "role": "user",
                        "content": [{"type": "image", "image": image}],
                    }
                ]
                inputs = processor.apply_chat_template(
                    messages,
                    tokenize=True,
                    add_generation_prompt=True,
                    return_dict=True,
                    return_tensors="pt",
                )
            elif hasattr(processor, "apply_chat_template"):
                messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image", "image": image},
                            {"type": "text", "text": OCR_PROMPT},
                        ],
                    }
                ]
                text = processor.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
                inputs = processor(text=[text], images=[image], return_tensors="pt")
            else:
                inputs = processor(images=image, text=OCR_PROMPT, return_tensors="pt")

            inputs = {
                key: (
                    value.to(device=self._device, dtype=self._torch.float32)
                    if self.catalog_id == "lighton-ocr-2-1b"
                    and hasattr(value, "is_floating_point")
                    and value.is_floating_point()
                    else value.to(self._device)
                    if hasattr(value, "to")
                    else value
                )
                for key, value in inputs.items()
            }
            if self.catalog_id == "dots-ocr":
                inputs.pop("mm_token_type_ids", None)
            with self._torch.inference_mode():
                output_ids = self._model.generate(**inputs, max_new_tokens=768)

            input_ids = inputs.get("input_ids")
            if input_ids is not None and output_ids.shape[-1] > input_ids.shape[-1]:
                output_ids = output_ids[:, input_ids.shape[-1] :]

            decoder = processor
            if not hasattr(decoder, "batch_decode") and self._tokenizer is not None:
                decoder = self._tokenizer
            if self.catalog_id == "lighton-ocr-2-1b" and hasattr(processor, "decode"):
                text = processor.decode(output_ids[0], skip_special_tokens=True)
            else:
                text = decoder.batch_decode(output_ids, skip_special_tokens=True)[0]
            text = _word_clip(text.replace(OCR_PROMPT, "").strip(), max_words)
            if not text:
                return ()
            return (
                Snippet(
                    text=text,
                    confidence=0.65,
                    x=0.0,
                    y=0.0,
                    width=1.0,
                    height=1.0,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            return ()

    def info(self) -> dict:
        loaded = self._ensure_loaded()
        return LoaderInfo(
            catalog_id=self.catalog_id,
            backend=self._backend,
            loaded=loaded,
            detail=self._load_error or "transformers loader ready",
            model_root=str(self._model_root),
        ).to_json()


class MlxVlLoader(OcrLoader):
    """MLX-VLM loader for Apple Silicon OCR VLMs (dots.ocr, Nanonets-OCR2).

    These ship MLX-quantized weights that the ``transformers`` loader cannot
    read (its AutoProcessor/quantization config is MLX-specific), so they run
    through ``mlx_vlm`` instead. Returns one full-screen snippet with the
    generated OCR text, matching ``TransformersVlLoader``'s output shape.
    """

    catalog_id: str

    def __init__(self, *, model_root: Path | str, catalog_id: str, backend: str) -> None:
        self.catalog_id = catalog_id
        self._backend = backend
        self._model_root = Path(model_root)
        self._model = None
        self._processor = None
        self._config = None
        self._generate = None
        self._apply_chat_template = None
        self._load_error: Optional[str] = None

    def _ensure_loaded(self) -> bool:
        if self._model is not None:
            return True
        if self._load_error is not None:
            return False
        try:
            from mlx_vlm.generate import generate
            from mlx_vlm.prompt_utils import apply_chat_template
            from mlx_vlm.utils import load

            self._model, self._processor = load(str(self._model_root), trust_remote_code=True)
            self._config = self._model.config
            self._generate = generate
            self._apply_chat_template = apply_chat_template
            return True
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            return False

    def run(
        self,
        bgra: bytes,
        width: int,
        height: int,
        stride: int,
        max_words: int,
        pixel_format: str = "bgra8",
    ) -> Iterable[Snippet]:
        image = _image_from_pixels(
            bgra=bgra,
            width=width,
            height=height,
            stride=stride,
            pixel_format=pixel_format,
        )
        if image is None or not self._ensure_loaded():
            return ()

        tmp_path: Optional[str] = None
        try:
            # mlx-vlm's generate takes image file paths, so spill the captured
            # frame to a short-lived PNG.
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                image.save(tmp.name)
                tmp_path = tmp.name
            try:
                prompt = self._apply_chat_template(
                    self._processor,
                    self._config,
                    OCR_PROMPT,
                    num_images=1,
                    enable_thinking=False,
                )
            except TypeError:
                prompt = self._apply_chat_template(
                    self._processor,
                    self._config,
                    OCR_PROMPT,
                    num_images=1,
                )
            result = self._generate(
                self._model,
                self._processor,
                prompt,
                image=[tmp_path],
                max_tokens=1024,
                verbose=False,
            )
            text = getattr(result, "text", result)
            text = _word_clip(str(text).replace(OCR_PROMPT, "").strip(), max_words)
            if not text:
                return ()
            return (
                Snippet(
                    text=text,
                    confidence=0.7,
                    x=0.0,
                    y=0.0,
                    width=1.0,
                    height=1.0,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            return ()
        finally:
            if tmp_path is not None:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    def info(self) -> dict:
        loaded = self._ensure_loaded()
        return LoaderInfo(
            catalog_id=self.catalog_id,
            backend=self._backend,
            loaded=loaded,
            detail=self._load_error or "mlx-vlm loader ready",
            model_root=str(self._model_root),
        ).to_json()


class PaddleOcrLoader(OcrLoader):
    catalog_id: str

    def __init__(self, *, model_root: Path | str, catalog_id: str, backend: str) -> None:
        self.catalog_id = catalog_id
        self._backend = backend
        self._model_root = Path(model_root)
        self._ocr = None
        self._load_error: Optional[str] = None

    def _ensure_loaded(self) -> bool:
        if self._ocr is not None:
            return True
        if self._load_error is not None:
            return False
        try:
            from paddleocr import PaddleOCR

            kwargs = {
                "lang": "en",
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
            }
            if self._backend == "paddle_det_rec":
                det_dir = _first_dir(self._model_root, ("mobile_det", "server_det", "det"))
                rec_dir = _first_dir(self._model_root, ("mobile_rec", "server_rec", "rec"))
                if det_dir is not None:
                    kwargs["text_detection_model_dir"] = str(det_dir)
                    if det_dir.name == "mobile_det":
                        kwargs["text_detection_model_name"] = "PP-OCRv5_mobile_det"
                    elif det_dir.name == "server_det":
                        kwargs["text_detection_model_name"] = "PP-OCRv5_server_det"
                if rec_dir is not None:
                    kwargs["text_recognition_model_dir"] = str(rec_dir)
                    if rec_dir.name == "mobile_rec":
                        kwargs["text_recognition_model_name"] = "PP-OCRv5_mobile_rec"
                    elif rec_dir.name == "server_rec":
                        kwargs["text_recognition_model_name"] = "PP-OCRv5_server_rec"
            self._ocr = PaddleOCR(**kwargs)
            return True
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            return False

    def run(
        self,
        bgra: bytes,
        width: int,
        height: int,
        stride: int,
        max_words: int,
        pixel_format: str = "bgra8",
    ) -> Iterable[Snippet]:
        image = _image_from_pixels(
            bgra=bgra,
            width=width,
            height=height,
            stride=stride,
            pixel_format=pixel_format,
        )
        if image is None or not self._ensure_loaded():
            return ()

        try:
            with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
                image.save(tmp.name)
                result = self._ocr.ocr(tmp.name)
            snippets = _snippets_from_paddle_result(result, width, height)
            if max_words > 0:
                clipped = []
                remaining = max_words
                for snippet in snippets:
                    text = _word_clip(snippet.text, remaining)
                    if not text:
                        break
                    remaining -= len(text.split())
                    clipped.append(
                        Snippet(
                            text=text,
                            confidence=snippet.confidence,
                            x=snippet.x,
                            y=snippet.y,
                            width=snippet.width,
                            height=snippet.height,
                        )
                    )
                    if remaining <= 0:
                        break
                return tuple(clipped)
            return tuple(snippets)
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            return ()

    def info(self) -> dict:
        loaded = self._ensure_loaded()
        return LoaderInfo(
            catalog_id=self.catalog_id,
            backend=self._backend,
            loaded=loaded,
            detail=self._load_error or "paddleocr loader ready",
            model_root=str(self._model_root),
        ).to_json()


def _first_dir(root: Path, names: tuple[str, ...]) -> Optional[Path]:
    for name in names:
        candidate = root / name
        if candidate.is_dir():
            return candidate
    return None


def _snippets_from_paddle_result(result, image_width: int, image_height: int) -> list[Snippet]:
    snippets: list[Snippet] = []
    pages = result or []
    for page in pages:
        if isinstance(page, dict):
            texts = page.get("rec_texts") or []
            scores = page.get("rec_scores") or []
            boxes = page.get("rec_boxes")
            if boxes is None:
                boxes = page.get("rec_polys")
            if boxes is None:
                boxes = []
            for idx, text in enumerate(texts):
                text = str(text).strip()
                if not text:
                    continue
                confidence = float(scores[idx]) if idx < len(scores) else 0.0
                try:
                    box = boxes[idx]
                    if hasattr(box, "tolist"):
                        box = box.tolist()
                    if len(box) == 4 and all(not isinstance(v, (list, tuple)) for v in box):
                        left, top, right, bottom = [float(v) for v in box]
                    else:
                        xs = [float(p[0]) for p in box]
                        ys = [float(p[1]) for p in box]
                        left, right = max(0.0, min(xs)), min(float(image_width), max(xs))
                        top, bottom = max(0.0, min(ys)), min(float(image_height), max(ys))
                except Exception:
                    left, top, right, bottom = 0.0, 0.0, float(image_width), float(image_height)
                snippets.append(
                    Snippet(
                        text=text,
                        confidence=confidence,
                        x=max(0.0, min(1.0, left / image_width)),
                        y=max(0.0, min(1.0, (image_height - bottom) / image_height)),
                        width=max(0.0, min(1.0, (right - left) / image_width)),
                        height=max(0.0, min(1.0, (bottom - top) / image_height)),
                    )
                )
            continue
        for item in page or []:
            try:
                box, payload = item
                text, confidence = payload
                text = str(text).strip()
                if not text:
                    continue
                xs = [float(p[0]) for p in box]
                ys = [float(p[1]) for p in box]
                left = max(0.0, min(xs))
                right = min(float(image_width), max(xs))
                top = max(0.0, min(ys))
                bottom = min(float(image_height), max(ys))
                if right <= left or bottom <= top:
                    continue
                snippets.append(
                    Snippet(
                        text=text,
                        confidence=float(confidence),
                        x=left / image_width,
                        y=(image_height - bottom) / image_height,
                        width=(right - left) / image_width,
                        height=(bottom - top) / image_height,
                    )
                )
            except Exception:
                continue
    return snippets
