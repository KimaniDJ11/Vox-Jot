//! Linux screen capture for the screen-context worker.
//!
//! Linux has no first-party OCR API, so we always send the captured frame to
//! the cross-platform Tesseract backup engine.
//!
//! Capture strategy (Phase 1, no portal/PipeWire dependency):
//!   1. **Wayland (`WAYLAND_DISPLAY` set)**: prefer `grim` (wlroots-style
//!      compositors). If `grim` is missing we surface an actionable error so
//!      the user knows what to install.
//!   2. **X11**: try `import -window root png:-` (ImageMagick), then
//!      `gnome-screenshot -f /tmp/...png` as a fallback. If none are present
//!      we surface the missing-tool error.
//!
//! Both paths produce PNG bytes that we decode in-process via the `png`
//! crate, then hand to the backup OCR module as RGBA.

#![cfg(target_os = "linux")]

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use log::{debug, warn};

use crate::screen_context::{NativeScreenContextPayload, NativeScreenContextSnippet};
use crate::screen_context_ocr_backup::{self, OcrFrame, PixelFormat};
use crate::settings::{OcrQualityMode, ScreenContextOcrEngine};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionKind {
    Wayland,
    X11,
}

fn detect_session() -> SessionKind {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        SessionKind::Wayland
    } else {
        SessionKind::X11
    }
}

fn which(bin: &str) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(bin);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

struct CapturedFrame {
    width: u32,
    height: u32,
    /// RGBA8 packed.
    pixels: Vec<u8>,
}

pub(crate) fn native_capture_screen_context(
    engine: ScreenContextOcrEngine,
    quality: OcrQualityMode,
    max_words: usize,
    timeout_ms: u32,
    neural_route: Option<crate::ocr_backend::NeuralRoute>,
) -> Result<NativeScreenContextPayload, String> {
    let frame = capture_screen()?;
    let captured_at_ms = current_time_millis();

    let backup_timeout = Duration::from_millis(timeout_ms.max(150) as u64);
    let ocr_frame =
        OcrFrame::new_packed(frame.width, frame.height, &frame.pixels, PixelFormat::Rgba8);

    // Phase 0 router — same shape as Windows. Tessdata-best is the only
    // wired backend today; everything else falls through.
    if let Some(route) = neural_route.as_ref() {
        let req = crate::ocr_backend::NeuralOcrRequest {
            route,
            frame: &ocr_frame,
            quality,
            timeout: backup_timeout,
        };
        match crate::ocr_backend::run(req) {
            Ok(snippets) if !snippets.is_empty() => {
                let clipped = clip_snippets_by_word_budget(snippets, max_words);
                return Ok(NativeScreenContextPayload {
                    display_id: 0,
                    captured_at_ms,
                    snippets: clipped,
                });
            }
            Ok(_) => {
                debug!(
                    "Neural OCR backend ({}) returned no snippets — falling back to backup",
                    route.catalog_id
                );
            }
            Err(crate::ocr_backend::OcrError::NotImplemented(_)) => {
                debug!(
                    "Neural OCR backend not yet wired for {} — using backup",
                    route.catalog_id
                );
            }
            Err(err) => {
                warn!(
                    "Neural OCR ({}) failed: {}; falling back to backup",
                    route.catalog_id, err
                );
            }
        }
    }

    // The engine setting is honoured even though Linux only has the backup
    // engine today. `NativeOnly` therefore returns an explanatory error so
    // the user understands why fallback could not run.
    if matches!(engine, ScreenContextOcrEngine::NativeOnly) {
        return Err(
            "Native OCR is not available on Linux. Pick \"Auto\" or \"Backup only\" in Screen Context settings."
                .to_string(),
        );
    }

    let snippets =
        screen_context_ocr_backup::run_tesseract_ocr(&ocr_frame, quality, backup_timeout)?;

    let clipped = clip_snippets_by_word_budget(snippets, max_words);

    Ok(NativeScreenContextPayload {
        display_id: 0,
        captured_at_ms,
        snippets: clipped,
    })
}

fn current_time_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn clip_snippets_by_word_budget(
    snippets: Vec<NativeScreenContextSnippet>,
    max_words: usize,
) -> Vec<NativeScreenContextSnippet> {
    if max_words == 0 {
        return snippets;
    }
    let mut budget = max_words;
    let mut out = Vec::with_capacity(snippets.len());
    for snippet in snippets {
        if budget == 0 {
            break;
        }
        let words = snippet
            .text
            .split_whitespace()
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>();
        if words.is_empty() {
            continue;
        }
        if words.len() <= budget {
            budget -= words.len();
            out.push(snippet);
        } else {
            let truncated = words.into_iter().take(budget).collect::<Vec<_>>().join(" ");
            out.push(NativeScreenContextSnippet {
                text: truncated,
                ..snippet
            });
            break;
        }
    }
    out
}

fn capture_screen() -> Result<CapturedFrame, String> {
    let session = detect_session();

    let png_bytes = match session {
        SessionKind::Wayland => capture_wayland()?,
        SessionKind::X11 => capture_x11()?,
    };

    decode_png_to_rgba(&png_bytes)
}

fn capture_wayland() -> Result<Vec<u8>, String> {
    let grim = which("grim").ok_or_else(|| {
        "Wayland screen capture requires the `grim` utility. Install it via your package manager (apt/dnf/pacman install grim)."
            .to_string()
    })?;

    debug!("Linux capture: invoking grim ({})", grim.display());
    let output = Command::new(&grim)
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("Failed to invoke grim: {}", err))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "grim failed (status {:?}): {}",
            output.status,
            stderr.trim()
        ));
    }
    Ok(output.stdout)
}

fn capture_x11() -> Result<Vec<u8>, String> {
    if let Some(import) = which("import") {
        debug!("Linux capture: invoking ImageMagick import");
        let output = Command::new(&import)
            .arg("-window")
            .arg("root")
            .arg("-silent")
            .arg("png:-")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|err| format!("Failed to invoke import: {}", err))?;
        if output.status.success() && !output.stdout.is_empty() {
            return Ok(output.stdout);
        }
        warn!(
            "import failed (status {:?}); trying gnome-screenshot",
            output.status
        );
    }

    if let Some(gnome_screenshot) = which("gnome-screenshot") {
        debug!("Linux capture: invoking gnome-screenshot");
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join(format!("vox-jot-screen-{}.png", std::process::id()));
        let temp_str = temp_path
            .to_str()
            .ok_or_else(|| "Temp path is not valid UTF-8".to_string())?;
        let status = Command::new(&gnome_screenshot)
            .arg("-f")
            .arg(temp_str)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|err| format!("Failed to invoke gnome-screenshot: {}", err))?;
        if status.success() {
            let bytes = std::fs::read(&temp_path)
                .map_err(|err| format!("Failed to read screenshot file: {}", err))?;
            let _ = std::fs::remove_file(&temp_path);
            if !bytes.is_empty() {
                return Ok(bytes);
            }
        }
    }

    Err(
        "X11 screen capture requires `import` (ImageMagick) or `gnome-screenshot`. Install one of them via your package manager."
            .to_string(),
    )
}

fn decode_png_to_rgba(bytes: &[u8]) -> Result<CapturedFrame, String> {
    let decoder = png::Decoder::new(bytes);
    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("PNG decode failed: {}", err))?;
    let info = reader.info().clone();
    let mut buffer = vec![0u8; reader.output_buffer_size()];
    let frame = reader
        .next_frame(&mut buffer)
        .map_err(|err| format!("PNG decode frame failed: {}", err))?;
    buffer.truncate(frame.buffer_size());

    let width = info.width;
    let height = info.height;
    let rgba = match (info.color_type, info.bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => buffer,
        (png::ColorType::Rgb, png::BitDepth::Eight) => expand_rgb_to_rgba(&buffer),
        (png::ColorType::GrayscaleAlpha, png::BitDepth::Eight) => {
            expand_gray_alpha_to_rgba(&buffer)
        }
        (png::ColorType::Grayscale, png::BitDepth::Eight) => expand_gray_to_rgba(&buffer),
        (color, depth) => {
            return Err(format!(
                "Unsupported PNG color type {:?} / bit depth {:?}",
                color, depth
            ));
        }
    };

    Ok(CapturedFrame {
        width,
        height,
        pixels: rgba,
    })
}

fn expand_rgb_to_rgba(rgb: &[u8]) -> Vec<u8> {
    let pixels = rgb.len() / 3;
    let mut out = Vec::with_capacity(pixels * 4);
    for chunk in rgb.chunks_exact(3) {
        out.extend_from_slice(chunk);
        out.push(255);
    }
    out
}

fn expand_gray_alpha_to_rgba(ga: &[u8]) -> Vec<u8> {
    let pixels = ga.len() / 2;
    let mut out = Vec::with_capacity(pixels * 4);
    for chunk in ga.chunks_exact(2) {
        let (g, a) = (chunk[0], chunk[1]);
        out.extend_from_slice(&[g, g, g, a]);
    }
    out
}

fn expand_gray_to_rgba(g: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(g.len() * 4);
    for px in g {
        out.extend_from_slice(&[*px, *px, *px, 255]);
    }
    out
}

/// Whether the current environment looks capable of capturing the screen.
/// Used by `ScreenContextDiagnostics::has_screen_permission` so the settings
/// UI can highlight a missing tool.
pub(crate) fn check_capture_permission() -> bool {
    match detect_session() {
        SessionKind::Wayland => which("grim").is_some(),
        SessionKind::X11 => which("import").is_some() || which("gnome-screenshot").is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb_expands_to_rgba_with_full_alpha() {
        let rgb = vec![10, 20, 30, 40, 50, 60];
        let rgba = expand_rgb_to_rgba(&rgb);
        assert_eq!(rgba, vec![10, 20, 30, 255, 40, 50, 60, 255]);
    }

    #[test]
    fn gray_expands_to_rgba_replicating_channel() {
        let gray = vec![5, 200];
        let rgba = expand_gray_to_rgba(&gray);
        assert_eq!(rgba, vec![5, 5, 5, 255, 200, 200, 200, 255]);
    }
}
