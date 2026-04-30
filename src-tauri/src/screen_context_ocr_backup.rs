// On macOS, the backup engine is only consumed when the user explicitly opts
// into `BackupOnly` (a future macOS path) and through tests. Cargo otherwise
// flags every helper as dead code on this target — silence that here so the
// module compiles cleanly without sprinkling cfg gates on every fn.
#![cfg_attr(target_os = "macos", allow(dead_code))]

//! Cross-platform backup OCR engine for screen context capture.
//!
//! This module wraps the Tesseract OCR binary as a subprocess and converts
//! its TSV output into the same `NativeScreenContextSnippet` shape that the
//! macOS Vision path produces. It is consumed by the Windows and Linux
//! capture paths (always or as a fallback), and is also usable on macOS for
//! parity testing via the `BackupOnly` engine setting.
//!
//! Design choices:
//!   - The image is delivered to `tesseract` over stdin as a P6 PNM blob — no
//!     tempfile, no extra encoder dependency.
//!   - A nearest-neighbour downscale caps the longest edge so screen
//!     captures stay within latency budgets even on 5K displays.
//!   - The subprocess is killed if it overruns `timeout`, so a stuck
//!     Tesseract never blocks the worker thread.

use crate::screen_context::NativeScreenContextSnippet;
use crate::settings::OcrQualityMode;
use log::{debug, info, warn};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Bgra8,
    Rgba8,
}

/// A captured frame ready to be handed to OCR.
///
/// `stride_bytes` defaults to `width * 4` for tightly packed buffers but
/// callers MAY pass a larger stride if the platform produced row-padded
/// output (Windows D3D11 textures do this for alignment).
pub struct OcrFrame<'a> {
    pub width: u32,
    pub height: u32,
    pub stride_bytes: u32,
    pub pixels: &'a [u8],
    pub format: PixelFormat,
}

impl<'a> OcrFrame<'a> {
    pub fn new_packed(width: u32, height: u32, pixels: &'a [u8], format: PixelFormat) -> Self {
        Self {
            width,
            height,
            stride_bytes: width.saturating_mul(4),
            pixels,
            format,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct DownscaleTarget {
    longest_edge: u32,
}

fn target_for_quality(quality: OcrQualityMode) -> DownscaleTarget {
    let longest_edge = match quality {
        OcrQualityMode::Fast => 1280,
        OcrQualityMode::Balanced => 1920,
        OcrQualityMode::Accurate => 2560,
    };
    DownscaleTarget { longest_edge }
}

fn compute_downscale(w: u32, h: u32, target: DownscaleTarget) -> (u32, u32) {
    let longest = w.max(h).max(1);
    if longest <= target.longest_edge {
        return (w.max(1), h.max(1));
    }
    let scale = target.longest_edge as f64 / longest as f64;
    let new_w = ((w as f64 * scale).round().max(1.0) as u32).min(target.longest_edge);
    let new_h = ((h as f64 * scale).round().max(1.0) as u32).min(target.longest_edge);
    (new_w, new_h)
}

fn downscale_to_rgb(frame: &OcrFrame, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let stride = frame.stride_bytes as usize;
    let (rs, gs, bs) = match frame.format {
        PixelFormat::Bgra8 => (2usize, 1, 0),
        PixelFormat::Rgba8 => (0usize, 1, 2),
    };

    let mut out = vec![0u8; (dst_w as usize) * (dst_h as usize) * 3];
    let src_w = frame.width as usize;
    let src_h = frame.height as usize;
    let dst_w_us = dst_w as usize;
    let dst_h_us = dst_h as usize;
    if src_w == 0 || src_h == 0 || dst_w_us == 0 || dst_h_us == 0 {
        return out;
    }

    for y in 0..dst_h_us {
        let src_y = ((y as u64 * src_h as u64) / dst_h_us as u64) as usize;
        let src_y = src_y.min(src_h - 1);
        let row_start = src_y * stride;
        if row_start + src_w * 4 > frame.pixels.len() {
            // Defensive: malformed buffer; bail with whatever we filled.
            break;
        }
        for x in 0..dst_w_us {
            let src_x = ((x as u64 * src_w as u64) / dst_w_us as u64) as usize;
            let src_x = src_x.min(src_w - 1);
            let p = &frame.pixels[row_start + src_x * 4..row_start + src_x * 4 + 4];
            let dst_idx = (y * dst_w_us + x) * 3;
            out[dst_idx] = p[rs];
            out[dst_idx + 1] = p[gs];
            out[dst_idx + 2] = p[bs];
        }
    }
    out
}

/// Paths to a tesseract binary + tessdata directory bundled with the app
/// (under `resources/tesseract/...`). Registered once at startup via
/// `set_bundled_paths` so the hot-path lookup never touches the filesystem.
#[derive(Debug, Clone)]
pub(crate) struct BundledPaths {
    pub tesseract: PathBuf,
    pub tessdata_dir: PathBuf,
}

static BUNDLED: OnceLock<Option<BundledPaths>> = OnceLock::new();

/// Register bundled tesseract resources for this process. Called once at app
/// startup with paths resolved through `portable::resolve_resource`.
///
/// The runtime accepts a `Some(_)` even if the files do not yet exist on disk —
/// the executable check happens lazily so a partial dev tree (e.g. tessdata
/// fetched but binary still missing) does not panic the app.
pub(crate) fn set_bundled_paths(paths: Option<BundledPaths>) {
    let _ = BUNDLED.set(paths);
}

fn bundled_paths() -> Option<&'static BundledPaths> {
    BUNDLED.get().and_then(|opt| opt.as_ref())
}

fn tesseract_executable() -> Option<PathBuf> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            // 1) Bundled binary registered at startup
            if let Some(bundle) = bundled_paths() {
                if bundle.tesseract.is_file() {
                    return Some(bundle.tesseract.clone());
                }
            }
            // 2) Explicit override for tests / packaging
            if let Ok(custom) = std::env::var("VOX_JOT_TESSERACT") {
                let p = PathBuf::from(custom);
                if p.is_file() {
                    return Some(p);
                }
            }
            // 3) PATH lookup
            let bin = if cfg!(windows) {
                "tesseract.exe"
            } else {
                "tesseract"
            };
            if let Ok(path) = std::env::var("PATH") {
                for dir in std::env::split_paths(&path) {
                    let candidate = dir.join(bin);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
            None
        })
        .clone()
}

fn bundled_tessdata_dir() -> Option<&'static Path> {
    bundled_paths()
        .map(|b| b.tessdata_dir.as_path())
        .filter(|p| p.is_dir())
}

pub fn is_tesseract_available() -> bool {
    tesseract_executable().is_some()
}

/// Eagerly resolve the tesseract path so the worker thread does not pay
/// filesystem-walk cost on its first capture. Safe to call multiple times.
pub(crate) fn prewarm() {
    let resolved = tesseract_executable();
    match (&resolved, bundled_tessdata_dir()) {
        (Some(path), Some(tessdata)) => {
            info!(
                "Backup OCR ready: tesseract={} tessdata={}",
                path.display(),
                tessdata.display()
            );
        }
        (Some(path), None) => {
            info!("Backup OCR ready (system tessdata): tesseract={}", path.display());
        }
        (None, _) => {
            debug!("Backup OCR not yet available — tesseract binary not found");
        }
    }
}

/// Run Tesseract over the supplied frame and return snippets in the same
/// normalized-bottom-left coordinate system that Vision uses.
pub fn run_tesseract_ocr(
    frame: &OcrFrame,
    quality: OcrQualityMode,
    timeout: Duration,
) -> Result<Vec<NativeScreenContextSnippet>, String> {
    let tess = tesseract_executable().ok_or_else(|| {
        "Tesseract not found. Install via your package manager or set the VOX_JOT_TESSERACT env var to the binary path.".to_string()
    })?;

    let (dst_w, dst_h) = compute_downscale(frame.width, frame.height, target_for_quality(quality));
    let rgb = downscale_to_rgb(frame, dst_w, dst_h);

    let mut command = Command::new(&tess);
    command
        .arg("-")
        .arg("stdout")
        .arg("--psm")
        .arg("11")
        .arg("tsv")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // When we ship a bundled tessdata directory next to the binary, point
    // tesseract at it explicitly so it does not hunt the system for language
    // packs. Tesseract requires the parent of `tessdata/` for TESSDATA_PREFIX,
    // not the directory itself.
    if let Some(tessdata) = bundled_tessdata_dir() {
        if let Some(parent) = tessdata.parent() {
            command.env("TESSDATA_PREFIX", parent);
        } else {
            command.env("TESSDATA_PREFIX", tessdata);
        }
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to spawn tesseract: {}", err))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to acquire tesseract stdin".to_string())?;
    let header = format!("P6\n{} {}\n255\n", dst_w, dst_h);
    let pid = child.id();
    let writer = std::thread::spawn(move || -> std::io::Result<()> {
        stdin.write_all(header.as_bytes())?;
        stdin.write_all(&rgb)?;
        stdin.flush()?;
        drop(stdin);
        Ok(())
    });

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    warn!("Tesseract timed out after {:?}; killing pid {}", timeout, pid);
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = writer.join();
                    return Err("Tesseract timed out".to_string());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(err) => {
                let _ = child.kill();
                let _ = writer.join();
                return Err(format!("Failed to poll tesseract: {}", err));
            }
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed to read tesseract output: {}", err))?;
    let _ = writer.join();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Tesseract exited with non-zero status: {}",
            stderr.trim()
        ));
    }

    let tsv = String::from_utf8_lossy(&output.stdout).into_owned();
    let snippets = parse_tesseract_tsv(&tsv, dst_w, dst_h);
    debug!(
        "Backup OCR produced {} snippet(s) from {}x{} frame",
        snippets.len(),
        dst_w,
        dst_h
    );
    Ok(snippets)
}

/// Parse Tesseract `tsv` output into normalized snippets.
///
/// Tesseract emits hierarchical rows (level 1 = page, 2 = block, 3 = paragraph,
/// 4 = textline, 5 = word). We aggregate all level-5 (word) rows by their
/// `(block, par, line)` tuple, concatenate the words to form line text, union
/// the bounding boxes, and average the confidences. The resulting box is
/// converted from Tesseract's pixel-based top-left origin to Vision's
/// normalized 0..1 bottom-left origin.
pub(crate) fn parse_tesseract_tsv(tsv: &str, w: u32, h: u32) -> Vec<NativeScreenContextSnippet> {
    if tsv.is_empty() || w == 0 || h == 0 {
        return Vec::new();
    }

    use std::collections::BTreeMap;

    #[derive(Default)]
    struct LineAggregate {
        words: Vec<String>,
        confs: Vec<f32>,
        min_x: i32,
        min_y: i32,
        max_x: i32,
        max_y: i32,
        seen: bool,
    }

    let mut lines: BTreeMap<(i32, i32, i32), LineAggregate> = BTreeMap::new();
    let mut order: Vec<(i32, i32, i32)> = Vec::new();

    let mut iter = tsv.lines();
    let header = match iter.next() {
        Some(line) => line,
        None => return Vec::new(),
    };

    // Column indices according to Tesseract TSV header:
    // level page_num block_num par_num line_num word_num left top width height conf text
    let cols: Vec<&str> = header.split('\t').collect();
    let idx = |name: &str| cols.iter().position(|c| c.eq_ignore_ascii_case(name));
    let level_i = idx("level").unwrap_or(0);
    let block_i = idx("block_num").unwrap_or(2);
    let par_i = idx("par_num").unwrap_or(3);
    let line_i = idx("line_num").unwrap_or(4);
    let left_i = idx("left").unwrap_or(6);
    let top_i = idx("top").unwrap_or(7);
    let width_i = idx("width").unwrap_or(8);
    let height_i = idx("height").unwrap_or(9);
    let conf_i = idx("conf").unwrap_or(10);
    let text_i = idx("text").unwrap_or(11);

    for row in iter {
        let cols: Vec<&str> = row.split('\t').collect();
        let max_index = [
            level_i, block_i, par_i, line_i, left_i, top_i, width_i, height_i, conf_i, text_i,
        ]
        .into_iter()
        .max()
        .unwrap_or(0);
        if cols.len() <= max_index {
            continue;
        }
        let level: i32 = cols[level_i].trim().parse().unwrap_or(-1);
        if level != 5 {
            continue;
        }
        let conf: f32 = cols[conf_i].trim().parse().unwrap_or(-1.0);
        if conf < 0.0 {
            continue;
        }
        let word = cols[text_i].trim();
        if word.is_empty() {
            continue;
        }
        let block: i32 = cols[block_i].trim().parse().unwrap_or(0);
        let par: i32 = cols[par_i].trim().parse().unwrap_or(0);
        let line_num: i32 = cols[line_i].trim().parse().unwrap_or(0);
        let left: i32 = cols[left_i].trim().parse().unwrap_or(0);
        let top: i32 = cols[top_i].trim().parse().unwrap_or(0);
        let width_px: i32 = cols[width_i].trim().parse().unwrap_or(0);
        let height_px: i32 = cols[height_i].trim().parse().unwrap_or(0);

        let key = (block, par, line_num);
        let entry = lines.entry(key).or_default();
        if !entry.seen {
            entry.min_x = left;
            entry.min_y = top;
            entry.max_x = left + width_px;
            entry.max_y = top + height_px;
            entry.seen = true;
            order.push(key);
        } else {
            entry.min_x = entry.min_x.min(left);
            entry.min_y = entry.min_y.min(top);
            entry.max_x = entry.max_x.max(left + width_px);
            entry.max_y = entry.max_y.max(top + height_px);
        }
        entry.words.push(word.to_string());
        entry.confs.push(conf);
    }

    let w_f = w as f64;
    let h_f = h as f64;
    let mut result = Vec::with_capacity(order.len());
    for key in order {
        if let Some(line) = lines.remove(&key) {
            if line.words.is_empty() {
                continue;
            }
            let text = line.words.join(" ");
            let mean_conf = if line.confs.is_empty() {
                0.0
            } else {
                line.confs.iter().sum::<f32>() / line.confs.len() as f32
            };
            // Tesseract conf is 0..100; normalise to 0..1.
            let confidence = (mean_conf / 100.0).clamp(0.0, 1.0);

            let left = line.min_x.max(0) as f64;
            let top = line.min_y.max(0) as f64;
            let right = line.max_x.max(line.min_x) as f64;
            let bottom = line.max_y.max(line.min_y) as f64;
            let width_f = (right - left).max(0.0);
            let height_f = (bottom - top).max(0.0);

            let x_norm = (left / w_f).clamp(0.0, 1.0);
            // Convert top-left origin → bottom-left origin.
            let y_norm = ((h_f - bottom) / h_f).clamp(0.0, 1.0);
            let width_norm = (width_f / w_f).clamp(0.0, 1.0);
            let height_norm = (height_f / h_f).clamp(0.0, 1.0);

            result.push(NativeScreenContextSnippet {
                text,
                confidence,
                x: x_norm,
                y: y_norm,
                width: width_norm,
                height: height_norm,
            });
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscale_keeps_small_images_unchanged() {
        let target = target_for_quality(OcrQualityMode::Balanced);
        assert_eq!(compute_downscale(800, 600, target), (800, 600));
        assert_eq!(compute_downscale(1, 1, target), (1, 1));
    }

    #[test]
    fn downscale_caps_longest_edge() {
        let target = target_for_quality(OcrQualityMode::Balanced);
        let (w, h) = compute_downscale(5120, 2880, target);
        assert_eq!(w.max(h), target.longest_edge);
        assert!(w > 0 && h > 0);
    }

    #[test]
    fn parse_tsv_groups_words_by_line_and_normalises_bbox() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
                   1\t1\t0\t0\t0\t0\t0\t0\t1000\t500\t-1\t\n\
                   5\t1\t1\t1\t1\t1\t10\t20\t40\t30\t90\tHello\n\
                   5\t1\t1\t1\t1\t2\t60\t20\t60\t30\t80\tWorld\n\
                   5\t1\t2\t1\t1\t1\t10\t100\t30\t30\t70\tBye";

        let snippets = parse_tesseract_tsv(tsv, 1000, 500);
        assert_eq!(snippets.len(), 2, "expected two grouped lines");

        let hello = &snippets[0];
        assert_eq!(hello.text, "Hello World");
        assert!((hello.confidence - 0.85).abs() < 0.01);
        assert!((hello.x - 0.01).abs() < 0.001);
        assert!((hello.width - 0.11).abs() < 0.001);
        assert!((hello.height - 0.06).abs() < 0.001);
        // bottom-left y for top=20 height=30 is (500 - 50) / 500 = 0.9
        assert!((hello.y - 0.9).abs() < 0.001);

        let bye = &snippets[1];
        assert_eq!(bye.text, "Bye");
    }

    #[test]
    fn parse_tsv_skips_empty_or_low_conf_rows() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
                   5\t1\t1\t1\t1\t1\t10\t20\t40\t30\t-1\t\n\
                   5\t1\t1\t1\t1\t2\t10\t20\t40\t30\t50\t\n";
        assert!(parse_tesseract_tsv(tsv, 100, 100).is_empty());
    }

    #[test]
    fn downscale_preserves_pixel_components() {
        let pixels: Vec<u8> = vec![
            // 2x1 BGRA (red, blue):
            0, 0, 255, 255, 255, 0, 0, 255,
        ];
        let frame = OcrFrame::new_packed(2, 1, &pixels, PixelFormat::Bgra8);
        let rgb = downscale_to_rgb(&frame, 2, 1);
        assert_eq!(rgb, vec![255, 0, 0, 0, 0, 255]);
    }
}
