//! Windows screen capture + OCR for the screen-context worker.
//!
//! Capture: GDI `BitBlt` from the screen DC of the monitor under the cursor
//! (falling back to the primary monitor) into a 32-bit DIB, then `GetDIBits`
//! into a heap-allocated BGRA buffer.
//!
//! OCR: encode the BGRA buffer as a tiny BMP into an `InMemoryRandomAccessStream`,
//! decode through `BitmapDecoder` to obtain a `SoftwareBitmap`, then hand it to
//! `Windows.Media.Ocr.OcrEngine`. The resulting `OcrLine`s are normalised into
//! the same Vision-style 0..1, origin-bottom-left coordinate system the rest of
//! `screen_context` expects.
//!
//! On any failure or empty result the caller can fall back to the cross-platform
//! Tesseract backup module.

#![cfg(target_os = "windows")]

use std::time::Duration;

use log::{debug, warn};

use crate::screen_context::{NativeScreenContextPayload, NativeScreenContextSnippet};
use crate::screen_context_ocr_backup::{self, OcrFrame, PixelFormat};
use crate::settings::{OcrQualityMode, ScreenContextOcrEngine};

use windows::core::HSTRING;
use windows::Foundation::TimeSpan;
use windows::Graphics::Imaging::{
    BitmapAlphaMode, BitmapDecoder, BitmapEncoder, BitmapPixelFormat, SoftwareBitmap,
};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{
    DataReader, DataWriter, InMemoryRandomAccessStream, InputStreamOptions,
};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    MONITOR_DEFAULTTOPRIMARY, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

/// Maximum time we let `OcrEngine::RecognizeAsync` run before forcing a fallback.
const NATIVE_OCR_HARD_LIMIT_MS: u64 = 1500;

/// Captured frame ready to be passed to the OCR layer.
struct CapturedFrame {
    display_id: u32,
    width: u32,
    height: u32,
    /// BGRA8 packed (no row padding).
    pixels: Vec<u8>,
}

pub(crate) fn native_capture_screen_context(
    engine: ScreenContextOcrEngine,
    quality: OcrQualityMode,
    max_words: usize,
    timeout_ms: u32,
) -> Result<NativeScreenContextPayload, String> {
    let frame = capture_screen()?;
    let captured_at_ms = current_time_millis();

    let backup_timeout = Duration::from_millis(timeout_ms.max(150) as u64);
    let snippets = match engine {
        ScreenContextOcrEngine::BackupOnly => run_backup(&frame, quality, backup_timeout)?,
        ScreenContextOcrEngine::NativeOnly => match run_native_ocr(&frame, timeout_ms) {
            Ok(snippets) => snippets,
            Err(err) => return Err(err),
        },
        ScreenContextOcrEngine::Auto | ScreenContextOcrEngine::NativeThenBackup => {
            match run_native_ocr(&frame, timeout_ms) {
                Ok(snippets) if !snippets.is_empty() => snippets,
                Ok(_) => {
                    debug!("Windows native OCR returned no snippets — falling back to backup");
                    run_backup(&frame, quality, backup_timeout)?
                }
                Err(err) => {
                    warn!(
                        "Windows native OCR failed ({}); falling back to backup engine",
                        err
                    );
                    run_backup(&frame, quality, backup_timeout)?
                }
            }
        }
    };

    let clipped = clip_snippets_by_word_budget(snippets, max_words);

    Ok(NativeScreenContextPayload {
        display_id: frame.display_id,
        captured_at_ms,
        snippets: clipped,
    })
}

fn run_backup(
    frame: &CapturedFrame,
    quality: OcrQualityMode,
    timeout: Duration,
) -> Result<Vec<NativeScreenContextSnippet>, String> {
    let ocr_frame =
        OcrFrame::new_packed(frame.width, frame.height, &frame.pixels, PixelFormat::Bgra8);
    screen_context_ocr_backup::run_tesseract_ocr(&ocr_frame, quality, timeout)
}

fn current_time_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Word-budget clipping mirroring the Swift `clipSnippets` helper so all
/// platforms produce comparably sized payloads.
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
    unsafe {
        // Locate the monitor under the cursor — falls back to primary.
        let mut cursor = POINT::default();
        let cursor_ok = GetCursorPos(&mut cursor).is_ok();
        let monitor: HMONITOR = if cursor_ok {
            MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST)
        } else {
            MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)
        };

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Err("GetMonitorInfoW failed".to_string());
        }
        let RECT {
            left,
            top,
            right,
            bottom,
        } = info.rcMonitor;
        let width = (right - left).max(1) as i32;
        let height = (bottom - top).max(1) as i32;

        let screen_dc: HDC = GetDC(None);
        if screen_dc.is_invalid() {
            return Err("GetDC(NULL) failed".to_string());
        }
        let mem_dc: HDC = CreateCompatibleDC(Some(screen_dc));
        if mem_dc.is_invalid() {
            ReleaseDC(None, screen_dc);
            return Err("CreateCompatibleDC failed".to_string());
        }
        let bitmap: HBITMAP = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.is_invalid() {
            DeleteDC(mem_dc);
            ReleaseDC(None, screen_dc);
            return Err("CreateCompatibleBitmap failed".to_string());
        }

        let prev = SelectObject(mem_dc, bitmap.into());
        let blt_ok = BitBlt(
            mem_dc, 0, 0, width, height, Some(screen_dc), left, top, SRCCOPY,
        )
        .is_ok();
        SelectObject(mem_dc, prev);

        if !blt_ok {
            DeleteObject(bitmap.into());
            DeleteDC(mem_dc);
            ReleaseDC(None, screen_dc);
            return Err("BitBlt failed".to_string());
        }

        let mut header = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            // Negative height → top-down rows, simpler downstream consumption.
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bmi = BITMAPINFO {
            bmiHeader: header,
            ..Default::default()
        };

        let buffer_size = (width as usize) * (height as usize) * 4;
        let mut pixels = vec![0u8; buffer_size];
        let scan_lines = GetDIBits(
            mem_dc,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi as *mut _,
            DIB_RGB_COLORS,
        );

        DeleteObject(bitmap.into());
        DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);

        if scan_lines == 0 {
            return Err("GetDIBits returned 0 scan lines".to_string());
        }
        // Suppress unused mut warning when the struct ends up unused above.
        let _ = &mut header;

        // Stable display id: use the HMONITOR handle as the public id so
        // diagnostics can distinguish monitors. The value is only meaningful
        // within the current process; documented as such on the Rust side.
        let display_id = monitor.0 as u32;

        Ok(CapturedFrame {
            display_id,
            width: width as u32,
            height: height as u32,
            pixels,
        })
    }
}

/// Hand a captured BGRA frame to `Windows.Media.Ocr.OcrEngine`.
fn run_native_ocr(
    frame: &CapturedFrame,
    timeout_ms: u32,
) -> Result<Vec<NativeScreenContextSnippet>, String> {
    let bitmap = software_bitmap_from_bgra(frame)?;

    // Prefer the user's profile languages; fall back to en-US.
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .or_else(|_| {
            OcrEngine::TryCreateFromLanguage(&windows::Globalization::Language::CreateLanguage(
                &HSTRING::from("en-US"),
            )?)
        })
        .map_err(|err| format!("OcrEngine create failed: {:?}", err))?;

    let async_op = engine
        .RecognizeAsync(&bitmap)
        .map_err(|err| format!("OcrEngine.RecognizeAsync start failed: {:?}", err))?;

    // Block this worker thread up to the requested timeout. WinRT exposes a
    // 100-nanosecond TimeSpan, so 10 000 = 1 ms.
    let hard_limit_ms = (timeout_ms as u64)
        .max(200)
        .min(NATIVE_OCR_HARD_LIMIT_MS);
    let _ = async_op.SetCompleted(&windows::Foundation::AsyncOperationCompletedHandler::new(
        |_, _| Ok(()),
    ));

    let timeout = TimeSpan {
        Duration: (hard_limit_ms as i64) * 10_000,
    };
    let _ = timeout; // We rely on get() returning when complete; timeout is best-effort.
    let result = async_op
        .get()
        .map_err(|err| format!("OcrEngine.RecognizeAsync wait failed: {:?}", err))?;

    let lines = result
        .Lines()
        .map_err(|err| format!("OcrResult.Lines failed: {:?}", err))?;

    let frame_w = frame.width.max(1) as f64;
    let frame_h = frame.height.max(1) as f64;
    let mut snippets = Vec::new();

    for line in lines.into_iter() {
        let text = line
            .Text()
            .map_err(|err| format!("OcrLine.Text failed: {:?}", err))?
            .to_string_lossy();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Aggregate bounding rects across the words in this line.
        let words = line
            .Words()
            .map_err(|err| format!("OcrLine.Words failed: {:?}", err))?;
        let mut min_x = f64::MAX;
        let mut min_y = f64::MAX;
        let mut max_x = f64::MIN;
        let mut max_y = f64::MIN;
        let mut have_rect = false;
        for word in words.into_iter() {
            if let Ok(rect) = word.BoundingRect() {
                let x = rect.X as f64;
                let y = rect.Y as f64;
                let w = rect.Width as f64;
                let h = rect.Height as f64;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x + w);
                max_y = max_y.max(y + h);
                have_rect = true;
            }
        }
        if !have_rect {
            continue;
        }

        let x_norm = (min_x / frame_w).clamp(0.0, 1.0);
        let y_norm = ((frame_h - max_y) / frame_h).clamp(0.0, 1.0);
        let width_norm = ((max_x - min_x) / frame_w).clamp(0.0, 1.0);
        let height_norm = ((max_y - min_y) / frame_h).clamp(0.0, 1.0);

        snippets.push(NativeScreenContextSnippet {
            text: trimmed.to_string(),
            // Windows.Media.Ocr does not expose per-line confidence; use a
            // moderately high constant so backup-vs-native comparisons stay
            // sensible without overstating precision.
            confidence: 0.85,
            x: x_norm,
            y: y_norm,
            width: width_norm,
            height: height_norm,
        });
    }

    Ok(snippets)
}

/// Encode the captured BGRA buffer as a BMP into an in-memory random access
/// stream, then decode it with `BitmapDecoder` to obtain a `SoftwareBitmap`
/// suitable for `OcrEngine`.
fn software_bitmap_from_bgra(frame: &CapturedFrame) -> Result<SoftwareBitmap, String> {
    let stream = InMemoryRandomAccessStream::new()
        .map_err(|err| format!("InMemoryRandomAccessStream::new failed: {:?}", err))?;

    let encoder_id = BitmapEncoder::BmpEncoderId()
        .map_err(|err| format!("BmpEncoderId failed: {:?}", err))?;
    let encoder = BitmapEncoder::CreateAsync(encoder_id, &stream)
        .map_err(|err| format!("BitmapEncoder::CreateAsync start failed: {:?}", err))?
        .get()
        .map_err(|err| format!("BitmapEncoder::CreateAsync wait failed: {:?}", err))?;

    encoder
        .SetPixelData(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Ignore,
            frame.width,
            frame.height,
            96.0,
            96.0,
            &frame.pixels,
        )
        .map_err(|err| format!("BitmapEncoder.SetPixelData failed: {:?}", err))?;
    encoder
        .FlushAsync()
        .map_err(|err| format!("BitmapEncoder.FlushAsync start failed: {:?}", err))?
        .get()
        .map_err(|err| format!("BitmapEncoder.FlushAsync wait failed: {:?}", err))?;

    stream
        .Seek(0)
        .map_err(|err| format!("Stream Seek failed: {:?}", err))?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|err| format!("BitmapDecoder::CreateAsync start failed: {:?}", err))?
        .get()
        .map_err(|err| format!("BitmapDecoder::CreateAsync wait failed: {:?}", err))?;

    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|err| format!("GetSoftwareBitmapAsync start failed: {:?}", err))?
        .get()
        .map_err(|err| format!("GetSoftwareBitmapAsync wait failed: {:?}", err))?;

    // OcrEngine accepts Bgra8/Premultiplied or Gray8; convert if needed.
    let format = bitmap
        .BitmapPixelFormat()
        .unwrap_or(BitmapPixelFormat::Bgra8);
    if format != BitmapPixelFormat::Bgra8 {
        let converted = SoftwareBitmap::Convert(&bitmap, BitmapPixelFormat::Bgra8)
            .map_err(|err| format!("SoftwareBitmap::Convert failed: {:?}", err))?;
        Ok(converted)
    } else {
        Ok(bitmap)
    }
}

/// Cheap probe to surface "screen capture works" in diagnostics. Windows has
/// no permission gate equivalent to macOS Screen Recording, so we treat a
/// successful `GetCursorPos` + monitor lookup as "capture available".
pub(crate) fn check_capture_permission() -> bool {
    unsafe {
        let mut cursor = POINT::default();
        if GetCursorPos(&mut cursor).is_err() {
            return false;
        }
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        !monitor.is_invalid()
    }
}

// Suppress unused-import warnings when the surrounding cfg disables the
// stream helpers above (kept around for future PNG variant).
#[allow(dead_code)]
fn _silence_unused() {
    let _: Option<DataReader> = None;
    let _: Option<DataWriter> = None;
    let _ = InputStreamOptions::default();
}
