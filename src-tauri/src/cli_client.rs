//! Standalone HTTP client used by `vox-jot <subcommand>`.
//!
//! ## In plain English
//!
//! When the user runs `vox-jot transcribe foo.wav`, `main.rs` sees a
//! subcommand was passed and calls into this module BEFORE the Tauri
//! GUI ever boots. We open an HTTP connection to the running app's
//! loopback API (`127.0.0.1:8978` by default), send the audio, print
//! the result to stdout, then exit. The GUI never opens.
//!
//! If the app isn't running (or the API toggle is off) we print a
//! friendly message telling the user where to enable it and exit
//! non-zero so scripts can detect failure.

use crate::cli::{CliCommand, CliOutputFormat};
use crate::helpers::subtitles::{to_srt, to_vtt, TimedSegment};
use serde::Deserialize;
use std::io::Read;

const DEFAULT_PORT: u16 = 8978;
const API_TOKEN_HEADER: &str = "x-vox-jot-api-token";

#[derive(Deserialize)]
struct TranscribeResponse {
    text: String,
    segments: Vec<TimedSegment>,
}

#[derive(Deserialize)]
struct HealthResponse {
    status: String,
    version: String,
}

#[derive(Deserialize)]
struct ModelsResponse {
    current: Option<String>,
    available: Vec<String>,
}

#[derive(Deserialize)]
struct ApiError {
    error: String,
}

/// Run the subcommand and return a process exit code.
pub fn run(cmd: CliCommand) -> i32 {
    let port = std::env::var("VOX_JOT_API_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    let base = format!("http://127.0.0.1:{}", port);
    let token = std::env::var("VOX_JOT_API_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| match crate::secret_store::get_http_api_token() {
            Ok(token) => token.map(|value| value.trim().to_string()),
            Err(error) => {
                eprintln!("warning: could not read Vox Jot local API token from keychain: {error}");
                None
            }
        })
        .filter(|value| !value.is_empty());

    match cmd {
        CliCommand::Health => run_health(&base),
        CliCommand::Models { json } => run_models(&base, json, token.as_deref()),
        CliCommand::Transcribe {
            path,
            format,
            language,
        } => run_transcribe(&base, &path, format, language.as_deref(), token.as_deref()),
    }
}

fn print_api_unreachable(err: &reqwest::Error) {
    eprintln!(
        "Could not reach the Vox Jot local API: {}\n\
         Open the app and enable Settings → Diagnostics → Enable local API.",
        err
    );
}

fn run_health(base: &str) -> i32 {
    let client = reqwest::blocking::Client::new();
    match client.get(format!("{}/v1/health", base)).send() {
        Ok(resp) => match resp.json::<HealthResponse>() {
            Ok(h) => {
                println!("status: {}\nversion: {}", h.status, h.version);
                0
            }
            Err(err) => {
                eprintln!("invalid response from API: {}", err);
                1
            }
        },
        Err(err) => {
            print_api_unreachable(&err);
            1
        }
    }
}

fn run_models(base: &str, json: bool, token: Option<&str>) -> i32 {
    let client = reqwest::blocking::Client::new();
    let mut request = client.get(format!("{}/v1/models", base));
    if let Some(token) = token {
        request = request.header(API_TOKEN_HEADER, token);
    }
    match request.send() {
        Ok(resp) => match resp.json::<ModelsResponse>() {
            Ok(m) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&serde_json::json!({
                            "current": m.current,
                            "available": m.available,
                        }))
                        .unwrap_or_default()
                    );
                } else {
                    if let Some(current) = &m.current {
                        println!("current: {}", current);
                    } else {
                        println!("current: (none loaded)");
                    }
                    println!("available:");
                    for id in &m.available {
                        println!("  {}", id);
                    }
                }
                0
            }
            Err(err) => {
                eprintln!("invalid response from API: {}", err);
                1
            }
        },
        Err(err) => {
            print_api_unreachable(&err);
            1
        }
    }
}

fn run_transcribe(
    base: &str,
    path: &str,
    format: CliOutputFormat,
    _language: Option<&str>,
    token: Option<&str>,
) -> i32 {
    // Read the audio bytes — `-` means stdin.
    let bytes: Vec<u8> = if path == "-" {
        let mut buf = Vec::new();
        if let Err(err) = std::io::stdin().read_to_end(&mut buf) {
            eprintln!("failed to read stdin: {}", err);
            return 1;
        }
        buf
    } else {
        match std::fs::read(path) {
            Ok(b) => b,
            Err(err) => {
                eprintln!("failed to read '{}': {}", path, err);
                return 1;
            }
        }
    };

    let part = match reqwest::blocking::multipart::Part::bytes(bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
    {
        Ok(p) => p,
        Err(err) => {
            eprintln!("failed to build upload: {}", err);
            return 1;
        }
    };
    let form = reqwest::blocking::multipart::Form::new().part("file", part);

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            eprintln!("HTTP client error: {}", err);
            return 1;
        }
    };

    let mut request = client
        .post(format!("{}/v1/transcribe", base))
        .multipart(form);
    if let Some(token) = token {
        request = request.header(API_TOKEN_HEADER, token);
    }
    let response = match request.send() {
        Ok(r) => r,
        Err(err) => {
            print_api_unreachable(&err);
            return 1;
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        match serde_json::from_str::<ApiError>(&body) {
            Ok(api_err) => eprintln!("API error ({}): {}", status, api_err.error),
            Err(_) => eprintln!("API error ({}): {}", status, body),
        }
        return 1;
    }

    let payload: TranscribeResponse = match response.json() {
        Ok(p) => p,
        Err(err) => {
            eprintln!("invalid transcription response: {}", err);
            return 1;
        }
    };

    match format {
        CliOutputFormat::Text => {
            println!("{}", payload.text);
        }
        CliOutputFormat::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "text": payload.text,
                    "segments": payload.segments,
                }))
                .unwrap_or_default()
            );
        }
        CliOutputFormat::Srt => {
            print!("{}", to_srt(&payload.segments));
        }
        CliOutputFormat::Vtt => {
            print!("{}", to_vtt(&payload.segments));
        }
    }
    0
}
