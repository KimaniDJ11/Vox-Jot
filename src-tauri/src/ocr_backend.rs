//! Phase 0 of the neural OCR runtime.
//!
//! `screen_context::capture_now` resolves a `NeuralRoute` from settings +
//! catalog and hands it to the platform capture function alongside the
//! captured frame. That platform function calls `run` here; on empty result
//! or any backend failure it falls through to the existing
//! `ScreenContextOcrEngine` policy, so today's behaviour is preserved when no
//! neural model is selected.
//!
//! macOS uses a capture-only Swift bridge when a selected OCR backend needs
//! pixels. If that backend returns nothing or fails, the fused Vision path
//! remains the fallback.
#![cfg_attr(target_os = "macos", allow(dead_code))]

use std::path::PathBuf;
use std::time::Duration;

use crate::ocr_models::OcrBackendKind;
use crate::screen_context::NativeScreenContextSnippet;
use crate::screen_context_ocr_backup::{run_tesseract_ocr_with_tessdata, OcrFrame};
use crate::settings::OcrQualityMode;

/// What the screen-context worker decided to try first this capture.
/// Resolved once per capture in `capture_now` and passed to the platform
/// `native_capture_screen_context` so the capture-then-OCR path stays
/// in one place per OS.
#[derive(Debug, Clone)]
pub struct NeuralRoute {
    pub backend: OcrBackendKind,
    pub install_dir: PathBuf,
    pub catalog_id: String,
}

#[derive(Debug)]
pub enum OcrError {
    /// Backend not yet wired in this build. Caller should fall through to
    /// the existing native/backup path. Phase 1+ removes most of these.
    NotImplemented(OcrBackendKind),
    /// Backend ran but failed (timeout, missing files, malformed output).
    Backend(String),
}

impl std::fmt::Display for OcrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OcrError::NotImplemented(kind) => {
                write!(f, "neural OCR backend not yet wired: {:?}", kind)
            }
            OcrError::Backend(msg) => write!(f, "{}", msg),
        }
    }
}

pub struct NeuralOcrRequest<'a> {
    pub route: &'a NeuralRoute,
    pub frame: &'a OcrFrame<'a>,
    pub quality: OcrQualityMode,
    pub timeout: Duration,
}

/// Run a neural backend over the captured frame. Returns the snippet shape
/// the rest of the screen-context pipeline already understands so callers
/// drop straight into `clip_snippets_by_word_budget`.
pub fn run(req: NeuralOcrRequest) -> Result<Vec<NativeScreenContextSnippet>, OcrError> {
    match req.route.backend {
        OcrBackendKind::TessdataPack => run_tesseract_ocr_with_tessdata(
            req.frame,
            req.quality,
            req.timeout,
            Some(&req.route.install_dir),
        )
        .map_err(OcrError::Backend),
        OcrBackendKind::TransformersVl
        | OcrBackendKind::PaddleDetRec
        | OcrBackendKind::PaddleVl => crate::ocr_runtime::shared()
            .run_ocr(
                &req.route.catalog_id,
                req.route.backend,
                &req.route.install_dir,
                req.frame,
                0,
                req.timeout,
            )
            .map_err(OcrError::Backend),
    }
}
