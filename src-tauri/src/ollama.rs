use log::{debug, info};
use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

pub const OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
pub const OLLAMA_PROVIDER_ID: &str = "ollama";
pub const OLLAMA_DEFAULT_MODEL: &str = "llama3.2:1b";

/// The recommended tiny LLM models to surface in the UI
pub const RECOMMENDED_OLLAMA_MODELS: &[(&str, &str, &str)] = &[
    ("qwen2.5:0.5b", "Qwen 2.5 0.5B", "~0.4 GB — ultra-tiny"),
    (
        "smollm2:135m",
        "SmolLM2 135M",
        "~0.2 GB — tiniest footprint",
    ),
    ("smollm2:360m", "SmolLM2 360M", "~0.4 GB — tiny and fast"),
    (
        "tinyllama:1.1b",
        "TinyLlama 1.1B",
        "~0.7 GB — tiny general model",
    ),
    ("gemma3:1b", "Gemma 3 1B", "~1.0 GB — very lightweight"),
    (
        "llama3.2:1b",
        "Llama 3.2 1B",
        "~1.3 GB — fastest, lowest RAM",
    ),
    (
        "qwen2.5:1.5b",
        "Qwen 2.5 1.5B",
        "~1.0 GB — stronger tiny model",
    ),
    (
        "smollm2:1.7b",
        "SmolLM2 1.7B",
        "~1.1 GB — more capable tiny model",
    ),
    ("llama3.2:3b", "Llama 3.2 3B", "~2.0 GB — better quality"),
    (
        "phi4-mini",
        "Phi-4 Mini",
        "~2.5 GB — great instruction following",
    ),
    (
        "falcon3:1b",
        "Falcon 3 1B",
        "~0.7 GB — compact instruction model",
    ),
    (
        "granite3.1-dense:2b",
        "Granite 3.1 Dense 2B",
        "~1.6 GB — tiny enterprise model",
    ),
    (
        "granite3.1-moe:1b",
        "Granite 3.1 MoE 1B",
        "~0.9 GB — low-latency MoE",
    ),
    ("gemma2:2b", "Gemma 2 2B", "~1.6 GB — balanced tiny model"),
    (
        "qwen2.5-coder:1.5b",
        "Qwen 2.5 Coder 1.5B",
        "~1.0 GB — tiny coding model",
    ),
    (
        "codegemma:2b",
        "CodeGemma 2B",
        "~1.6 GB — lightweight coding",
    ),
    (
        "stable-code:3b",
        "Stable Code 3B",
        "~2.1 GB — code-focused 3B",
    ),
    (
        "orca-mini:3b",
        "Orca Mini 3B",
        "~2.0 GB — compact instruct model",
    ),
    ("phi3:mini", "Phi-3 Mini", "~2.2 GB — lightweight reasoning"),
    (
        "dolphin3:1b",
        "Dolphin 3 1B",
        "~0.8 GB — tiny general model",
    ),
    (
        "mistral-small:3b",
        "Mistral Small 3B",
        "~2.2 GB — efficient small model",
    ),
    (
        "deepseek-coder:1.3b",
        "DeepSeek Coder 1.3B",
        "~1.0 GB — tiny coding model",
    ),
];

const TINY_MODELS_TARGET_COUNT: usize = 22;
const OLLAMA_REGISTRY_TAGS_URL: &str = "https://ollama.com/api/tags";
const HARD_MAX_PARAMS_B: f64 = 6.0;
const HARD_MAX_SIZE_BYTES: u64 = 8_000_000_000;

// Model families commonly present in Artificial Analysis tiny open-source, non-reasoning slice.
const AA_TINY_FAMILY_HINTS: &[&str] = &[
    "qwen3",
    "qwen2.5",
    "qwen",
    "gemma",
    "phi",
    "granite",
    "ministral",
    "mistral",
    "smollm",
    "tinyllama",
    "llama3.2",
    "falcon",
    "lfm",
    "exaone",
];

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct OllamaModelInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub is_pulled: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelEntry>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelEntry {
    name: String,
}

#[derive(Debug, Deserialize)]
struct OllamaRegistryTagsResponse {
    models: Vec<OllamaRegistryModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaRegistryModel {
    name: String,
    #[serde(default)]
    modified_at: String,
    #[serde(default)]
    size: u64,
}

fn format_bytes_gb(size_bytes: u64) -> String {
    if size_bytes == 0 {
        return "size unknown".to_string();
    }
    let gb = size_bytes as f64 / 1_000_000_000_f64;
    format!("~{:.1} GB", gb)
}

fn looks_like_tiny_model(name: &str, size_bytes: u64) -> bool {
    let lower = name.to_lowercase();

    let excluded_keywords = [
        "embed",
        "rerank",
        "vision",
        "vl",
        "whisper",
        "tts",
        "diffusion",
        "sdxl",
        "clip",
    ];
    if excluded_keywords.iter().any(|k| lower.contains(k)) {
        return false;
    }

    if size_bytes > 0 && size_bytes <= 4_000_000_000 {
        return true;
    }

    let size_token_re = Regex::new(r"(?i)(\d+(?:\.\d+)?)\s*([bm])").unwrap();
    for cap in size_token_re.captures_iter(&lower) {
        let value = cap
            .get(1)
            .and_then(|m| m.as_str().parse::<f64>().ok())
            .unwrap_or(999.0);
        let unit = cap.get(2).map(|m| m.as_str()).unwrap_or("b");
        if (unit == "m" && value <= 2200.0) || (unit == "b" && value <= 3.5) {
            return true;
        }
    }

    let tiny_keywords = [
        "tiny", "mini", "small", "smol", "nano", "compact", "1b", "2b", "3b",
    ];
    tiny_keywords.iter().any(|k| lower.contains(k))
}

fn exceeds_hard_param_limit(name: &str, size_bytes: u64) -> bool {
    let lower = name.to_lowercase();
    let size_token_re = Regex::new(r"(?i)(\d+(?:\.\d+)?)\s*([bm])").unwrap();

    for cap in size_token_re.captures_iter(&lower) {
        let value = cap
            .get(1)
            .and_then(|m| m.as_str().parse::<f64>().ok())
            .unwrap_or(0.0);
        let unit = cap.get(2).map(|m| m.as_str()).unwrap_or("b");

        if (unit == "b" && value > HARD_MAX_PARAMS_B)
            || (unit == "m" && value > HARD_MAX_PARAMS_B * 1000.0)
        {
            return true;
        }
    }

    size_bytes > HARD_MAX_SIZE_BYTES
}

fn matches_aa_tiny_family(name: &str) -> bool {
    let lower = name.to_lowercase();
    AA_TINY_FAMILY_HINTS
        .iter()
        .any(|family| lower.contains(family))
}

async fn fetch_registry_tiny_models() -> Vec<OllamaModelInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let response = match client.get(OLLAMA_REGISTRY_TAGS_URL).send().await {
        Ok(resp) if resp.status().is_success() => resp,
        _ => return vec![],
    };

    let registry = match response.json::<OllamaRegistryTagsResponse>().await {
        Ok(data) => data,
        Err(_) => return vec![],
    };

    let mut tiny = registry
        .models
        .into_iter()
        .filter(|m| looks_like_tiny_model(&m.name, m.size))
        .filter(|m| !exceeds_hard_param_limit(&m.name, m.size))
        .collect::<Vec<_>>();

    tiny.sort_by(|a, b| {
        let a_priority = matches_aa_tiny_family(&a.name);
        let b_priority = matches_aa_tiny_family(&b.name);

        b_priority
            .cmp(&a_priority)
            .then_with(|| b.modified_at.cmp(&a.modified_at))
            .then_with(|| a.name.cmp(&b.name))
    });

    tiny.into_iter()
        .take(TINY_MODELS_TARGET_COUNT)
        .map(|m| OllamaModelInfo {
            id: m.name.clone(),
            label: m.name.clone(),
            description: format!(
                "{} — tiny model (AA-style family + Ollama registry)",
                format_bytes_gb(m.size)
            ),
            is_pulled: false,
        })
        .collect()
}

fn fallback_tiny_models() -> Vec<OllamaModelInfo> {
    RECOMMENDED_OLLAMA_MODELS
        .iter()
        .filter(|(id, _, _)| !exceeds_hard_param_limit(id, 0))
        .map(|(id, label, desc)| OllamaModelInfo {
            id: id.to_string(),
            label: label.to_string(),
            description: desc.to_string(),
            is_pulled: false,
        })
        .collect()
}

/// Check if Ollama is installed and running, and list available models
pub async fn get_ollama_status() -> OllamaStatus {
    // First check if the binary exists
    let installed = is_ollama_installed();

    if !installed {
        return OllamaStatus {
            installed: false,
            running: false,
            models: vec![],
        };
    }

    // Try to ping the API
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    let url = format!("{}/api/tags", OLLAMA_BASE_URL);
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let models = resp
                .json::<OllamaTagsResponse>()
                .await
                .map(|r| r.models.into_iter().map(|m| m.name).collect())
                .unwrap_or_default();
            OllamaStatus {
                installed: true,
                running: true,
                models,
            }
        }
        _ => OllamaStatus {
            installed: true,
            running: false,
            models: vec![],
        },
    }
}

fn is_ollama_installed() -> bool {
    // Check common install locations
    let paths = [
        "/usr/local/bin/ollama",
        "/usr/bin/ollama",
        "/opt/homebrew/bin/ollama",
    ];
    for path in &paths {
        if std::path::Path::new(path).exists() {
            return true;
        }
    }
    // Fallback: check PATH
    std::process::Command::new("which")
        .arg("ollama")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Install Ollama using the official install script (macOS/Linux)
/// or winget on Windows. Emits progress events to the frontend.
pub async fn install_ollama_impl(app: &AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    info!("Starting Ollama installation...");
    app.emit("ollama-install-progress", "Downloading Ollama installer...")
        .ok();

    #[cfg(target_os = "windows")]
    {
        let status = tokio::process::Command::new("winget")
            .args([
                "install",
                "Ollama.Ollama",
                "--silent",
                "--accept-source-agreements",
                "--accept-package-agreements",
            ])
            .status()
            .await
            .map_err(|e| format!("Failed to run winget: {}", e))?;

        if !status.success() {
            return Err(
                "winget install failed. Please install Ollama manually from https://ollama.com"
                    .to_string(),
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Use the official Ollama install script
        let status = tokio::process::Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://ollama.com/install.sh | sh")
            .status()
            .await
            .map_err(|e| format!("Failed to run install script: {}", e))?;

        if !status.success() {
            return Err("Installation script failed. Please install Ollama manually from https://ollama.com".to_string());
        }
    }

    app.emit("ollama-install-progress", "Starting Ollama service...")
        .ok();

    // Start Ollama serve in background
    tokio::process::Command::new("ollama")
        .arg("serve")
        .spawn()
        .map_err(|e| format!("Failed to start Ollama service: {}", e))?;

    // Give it a moment to start
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    app.emit("ollama-install-complete", true).ok();
    info!("Ollama installation complete.");
    Ok(())
}

/// Pull (download) an Ollama model, streaming progress events to the frontend
pub async fn pull_ollama_model_impl(app: &AppHandle, model_name: String) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    info!("Pulling Ollama model: {}", model_name);
    app.emit(
        "ollama-pull-progress",
        serde_json::json!({ "model": model_name, "status": "starting", "percent": 0 }),
    )
    .ok();

    let client = reqwest::Client::new();
    let url = format!("{}/api/pull", OLLAMA_BASE_URL);
    let body = serde_json::json!({ "name": model_name, "stream": true });

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

    if !response.status().is_success() {
        let err = response.text().await.unwrap_or_default();
        return Err(format!("Ollama pull failed: {}", err));
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                let status = val.get("status").and_then(|s| s.as_str()).unwrap_or("");
                let total = val.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
                let completed = val.get("completed").and_then(|v| v.as_u64()).unwrap_or(0);
                let percent = if total > 0 {
                    ((completed as f64 / total as f64) * 100.0) as u32
                } else {
                    0
                };
                debug!(
                    "Ollama pull {}: {} ({}/{})",
                    model_name, status, completed, total
                );
                app.emit(
                    "ollama-pull-progress",
                    serde_json::json!({
                        "model": model_name,
                        "status": status,
                        "percent": percent,
                        "total": total,
                        "completed": completed,
                    }),
                )
                .ok();
                if status == "success" {
                    app.emit("ollama-pull-complete", &model_name).ok();
                    info!("Ollama model {} pulled successfully.", model_name);
                    return Ok(());
                }
            }
        }
    }

    app.emit("ollama-pull-complete", &model_name).ok();
    Ok(())
}

/// Delete a locally pulled Ollama model
pub async fn delete_ollama_model_impl(model_name: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/delete", OLLAMA_BASE_URL);
    let body = serde_json::json!({ "name": model_name });

    let response = client
        .delete(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

    if !response.status().is_success() {
        let err = response.text().await.unwrap_or_default();
        return Err(format!("Failed to delete model: {}", err));
    }
    Ok(())
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn check_ollama_status() -> OllamaStatus {
    get_ollama_status().await
}

#[tauri::command]
#[specta::specta]
pub async fn install_ollama(app: AppHandle) -> Result<(), String> {
    install_ollama_impl(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn pull_ollama_model(app: AppHandle, model_name: String) -> Result<(), String> {
    pull_ollama_model_impl(&app, model_name).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_ollama_model(model_name: String) -> Result<(), String> {
    delete_ollama_model_impl(model_name).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_recommended_ollama_models() -> Vec<OllamaModelInfo> {
    let mut dynamic = fetch_registry_tiny_models().await;
    if dynamic.len() >= TINY_MODELS_TARGET_COUNT {
        return dynamic;
    }

    let fallback = fallback_tiny_models();
    for model in fallback {
        if dynamic.iter().any(|m| m.id == model.id) {
            continue;
        }
        dynamic.push(model);
        if dynamic.len() >= TINY_MODELS_TARGET_COUNT {
            break;
        }
    }

    dynamic
}

/// Start the Ollama serve process if it's installed but not running
#[tauri::command]
#[specta::specta]
pub async fn start_ollama_serve() -> Result<(), String> {
    if !is_ollama_installed() {
        return Err("Ollama is not installed".to_string());
    }
    tokio::process::Command::new("ollama")
        .arg("serve")
        .spawn()
        .map_err(|e| format!("Failed to start Ollama: {}", e))?;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    Ok(())
}
