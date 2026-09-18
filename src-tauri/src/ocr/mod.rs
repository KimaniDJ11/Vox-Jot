//! Dedicated OCR Subsystem for Vox Jot.
//!
//! Provides a modular, extensible provider abstraction (`OcrProvider`) and
//! centralized manager (`OcrManager`) for document recognition and screen
//! intelligence, featuring request-ticket cancellation, non-activating
//! overlay status reporting, and isolated runtime execution.

pub mod jina;
pub mod manager;
pub mod runtime;

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub use jina::JinaOcrProvider;
pub use manager::OcrManager;
pub use runtime::OcrRuntime;

/// Distinct OCR engines supported or targeted by Vox Jot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OcrEngine {
    /// Native Apple Vision OCR (`VNRecognizeTextRequest`). Built into macOS CoreML.
    AppleVision,
    /// Experimental local Jina-OCR-v1 document parsing provider.
    JinaOcr,
}

impl OcrEngine {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AppleVision => "apple_vision",
            Self::JinaOcr => "jina-ocr-v1",
        }
    }
}

/// Lifecycle status phases for active OCR operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OcrPhase {
    Capturing,
    Recognizing,
    Complete,
    Failed,
    Stopped,
}

impl OcrPhase {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Complete | Self::Failed | Self::Stopped)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Capturing => "capturing",
            Self::Recognizing => "recognizing",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }
}

/// Active request ticket for thread-safe cooperative cancellation.
/// Modeled after Vox Jot's TTS playback ticket pattern.
#[derive(Clone, Debug)]
pub struct OcrTicket {
    pub request_id: u64,
    pub stop_flag: Arc<AtomicBool>,
}

impl OcrTicket {
    pub fn is_cancelled(&self) -> bool {
        self.stop_flag.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn cancel(&self) {
        self.stop_flag
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Descriptor surfaced to UI and API clients for available OCR providers.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OcrProviderDescriptor {
    pub id: String,
    pub label: String,
    pub vendor: String,
    pub description: String,
    pub license: String,
    pub is_experimental: bool,
    pub is_installed: bool,
    pub is_available: bool,
    pub storage_location: Option<String>,
    pub backend: String,
    pub status_detail: Option<String>,
}

/// Output payload from a completed OCR recognition run.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OcrResult {
    pub text: String,
    pub engine: String,
    pub elapsed_ms: u64,
    pub device: String,
    pub peak_rss_mb: Option<f64>,
    pub mps_allocated_mb: Option<f64>,
    pub mps_driver_allocated_mb: Option<f64>,
}

/// RAII guard for temporary image files used in OCR operations.
/// Guarantees that temporary files are deleted upon drop, whether the operation
/// succeeded, encountered an error, or was cooperatively cancelled.
pub struct TempImageGuard {
    path: PathBuf,
    active: bool,
}

impl TempImageGuard {
    pub fn new(path: PathBuf) -> Self {
        Self { path, active: true }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for TempImageGuard {
    fn drop(&mut self) {
        if self.active && self.path.is_file() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Trait implemented by all OCR providers in the Vox Jot subsystem.
pub trait OcrProvider: Send + Sync {
    /// Canonical provider identifier (e.g. `"jina-ocr-v1"`, `"apple-vision"`).
    fn id(&self) -> &'static str;

    /// User-facing descriptor of provider capabilities and availability.
    fn descriptor(&self) -> OcrProviderDescriptor;

    /// Whether this provider is currently runnable on this system.
    fn is_available(&self) -> bool;

    /// Resolves the absolute path to the local model assets, if applicable.
    fn resolve_model_path(&self) -> Option<PathBuf>;

    /// Executes OCR against an image file, respecting cooperative cancellation via `ticket`.
    fn recognize(&self, image_path: &Path, ticket: &OcrTicket) -> Result<OcrResult, String>;
}
