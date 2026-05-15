use crate::settings::{PostProcessProvider, OLLAMA_PROVIDER_ID};
use futures_util::StreamExt;
use log::debug;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;
use tokio::sync::mpsc::Sender;

/// Sink that receives the *accumulated* LLM output each time new tokens arrive.
/// Used by callers that want to drive progressive UI (overlay) while the request
/// is still in flight. When the underlying provider does not support streaming,
/// the sink is invoked exactly once with the final content before the function
/// returns.
pub type ChunkSink = Sender<String>;

async fn forward_chunk(tx: &ChunkSink, chunk: String) {
    if tx.send(chunk).await.is_err() {
        debug!("Chunk receiver dropped before the latest streaming update could be delivered");
    }
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct JsonSchema {
    name: String,
    strict: bool,
    schema: Value,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
    json_schema: JsonSchema,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

#[derive(Debug, Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    keep_alive: String,
    options: OllamaChatOptions,
}

#[derive(Debug, Serialize)]
struct OllamaChatOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatChunk {
    #[serde(default)]
    done: bool,
    #[serde(default)]
    message: Option<ChatMessageResponse>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct OllamaWarmRequest {
    model: String,
    keep_alive: String,
    stream: bool,
}

fn estimate_text_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(4)
}

fn estimate_max_output_tokens(user_content: &str, system_prompt: Option<&str>) -> u32 {
    let estimated_input_tokens =
        estimate_text_tokens(user_content) + system_prompt.map(estimate_text_tokens).unwrap_or(0);
    ((estimated_input_tokens as f32 * 1.3).ceil() as usize).clamp(64, 256) as u32
}

/// Build headers for API requests based on provider type
fn build_headers(provider: &PostProcessProvider, api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();

    // Common headers
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://www.iriedinamik.org/voxjot/"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Vox Jot/1.0 (+https://www.iriedinamik.org/voxjot/)"),
    );
    headers.insert("X-Title", HeaderValue::from_static("Vox Jot"));

    // Provider-specific auth headers
    if !api_key.is_empty() {
        if provider.id == "anthropic" {
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(api_key)
                    .map_err(|e| format!("Invalid API key header value: {}", e))?,
            );
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        } else {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", api_key))
                    .map_err(|e| format!("Invalid authorization header value: {}", e))?,
            );
        }
    }

    Ok(headers)
}

/// Create an HTTP client with provider-specific headers
fn create_client(provider: &PostProcessProvider, api_key: &str) -> Result<reqwest::Client, String> {
    let headers = build_headers(provider, api_key)?;
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Send a chat completion request to an OpenAI-compatible API
/// Returns Ok(Some(content)) on success, Ok(None) if response has no content,
/// or Err on actual errors (HTTP, parsing, etc.)
pub async fn send_chat_completion(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    prompt: String,
) -> Result<Option<String>, String> {
    send_chat_completion_with_schema(provider, api_key, model, prompt, None, None).await
}

/// Send a chat completion request with structured output support
/// When json_schema is provided, uses structured outputs mode
/// system_prompt is used as the system message when provided
pub async fn send_chat_completion_with_schema(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    user_content: String,
    system_prompt: Option<String>,
    json_schema: Option<Value>,
) -> Result<Option<String>, String> {
    send_chat_completion_with_schema_streaming(
        provider,
        api_key,
        model,
        user_content,
        system_prompt,
        json_schema,
        None,
    )
    .await
}

/// Same as `send_chat_completion_with_schema` but allows the caller to receive
/// the partial output as it streams in. Each chunk emitted contains the full
/// accumulated text so far so the UI can simply replace its buffer on each tick.
/// Providers that do not support incremental streaming emit the final content
/// as a single chunk immediately before returning.
pub async fn send_chat_completion_with_schema_streaming(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    user_content: String,
    system_prompt: Option<String>,
    json_schema: Option<Value>,
    chunk_tx: Option<ChunkSink>,
) -> Result<Option<String>, String> {
    if provider.id == OLLAMA_PROVIDER_ID && json_schema.is_none() {
        return send_ollama_chat_completion(
            provider,
            api_key,
            model,
            user_content,
            system_prompt,
            chunk_tx,
        )
        .await;
    }

    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);
    let request_started_at = Instant::now();
    let estimated_prompt_tokens = estimate_text_tokens(&user_content)
        + system_prompt
            .as_ref()
            .map(|prompt| estimate_text_tokens(prompt))
            .unwrap_or(0)
        + json_schema
            .as_ref()
            .map(|schema| estimate_text_tokens(&schema.to_string()))
            .unwrap_or(0);
    let max_output_tokens = estimate_max_output_tokens(&user_content, system_prompt.as_deref());

    debug!("Sending chat completion request to: {}", url);

    let client = create_client(provider, &api_key)?;

    // Build messages vector
    let mut messages = Vec::new();

    // Add system prompt if provided
    if let Some(system) = system_prompt {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system,
        });
    }

    // Add user message
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_content,
    });

    // Build response_format if schema is provided
    let response_format = json_schema.map(|schema| ResponseFormat {
        format_type: "json_schema".to_string(),
        json_schema: JsonSchema {
            name: "transcription_output".to_string(),
            strict: true,
            schema,
        },
    });

    let request_body = ChatCompletionRequest {
        model: model.to_string(),
        messages,
        response_format,
        max_tokens: Some(max_output_tokens),
        temperature: Some(0.0),
    };

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error response".to_string());
        return Err(format!(
            "API request failed with status {}: {}",
            status, error_text
        ));
    }

    let completion: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    debug!(
        "LLM request completed in {:?} (provider='{}', model='{}', prompt_tokens_est={}, max_output_tokens={})",
        request_started_at.elapsed(),
        provider.id,
        model,
        estimated_prompt_tokens,
        max_output_tokens
    );

    let content = completion
        .choices
        .first()
        .and_then(|choice| choice.message.content.clone());

    // Non-streaming providers can still drive progressive UI by emitting the
    // final content as a single chunk. Callers that don't care just pass None.
    if let (Some(tx), Some(final_content)) = (chunk_tx.as_ref(), content.as_ref()) {
        forward_chunk(tx, final_content.clone()).await;
    }

    Ok(content)
}

pub async fn warm_ollama_model(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
) -> Result<(), String> {
    let root_url = provider
        .base_url
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_string();
    let url = format!("{}/api/generate", root_url);
    let request_started_at = Instant::now();
    let client = create_client(provider, &api_key)?;
    let request_body = OllamaWarmRequest {
        model: model.to_string(),
        keep_alive: "30m".to_string(),
        stream: false,
    };

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error response".to_string());
        return Err(format!(
            "API request failed with status {}: {}",
            status, error_text
        ));
    }

    let _ = response.bytes().await;
    debug!(
        "Ollama warm request completed in {:?} (provider='{}', model='{}')",
        request_started_at.elapsed(),
        provider.id,
        model
    );

    Ok(())
}

async fn send_ollama_chat_completion(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    user_content: String,
    system_prompt: Option<String>,
    chunk_tx: Option<ChunkSink>,
) -> Result<Option<String>, String> {
    let root_url = provider
        .base_url
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_string();
    let url = format!("{}/api/chat", root_url);
    let request_started_at = Instant::now();
    let estimated_prompt_tokens = estimate_text_tokens(&user_content)
        + system_prompt
            .as_ref()
            .map(|prompt| estimate_text_tokens(prompt))
            .unwrap_or(0);
    let max_output_tokens = estimate_max_output_tokens(&user_content, system_prompt.as_deref());

    debug!("Sending Ollama chat request to: {}", url);

    let client = create_client(provider, &api_key)?;
    let mut messages = Vec::new();

    if let Some(system) = system_prompt {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system,
        });
    }

    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_content,
    });

    let request_body = OllamaChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
        keep_alive: "30m".to_string(),
        options: OllamaChatOptions {
            num_predict: Some(max_output_tokens),
            temperature: Some(0.0),
        },
    };

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error response".to_string());
        return Err(format!(
            "API request failed with status {}: {}",
            status, error_text
        ));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut content = String::new();
    let mut time_to_first_token = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to read Ollama stream: {}", e))?;
        buffer.extend_from_slice(&chunk);

        while let Some(newline_index) = buffer.iter().position(|byte| *byte == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=newline_index).collect();
            let line = String::from_utf8(line_bytes)
                .map_err(|e| format!("Failed to decode Ollama stream chunk: {}", e))?;
            let line = line.trim().to_string();

            if line.is_empty() {
                continue;
            }

            let parsed: OllamaChatChunk = serde_json::from_str(&line)
                .map_err(|e| format!("Failed to parse Ollama stream chunk: {}", e))?;

            if let Some(error) = parsed.error {
                return Err(format!("Ollama returned an error: {}", error));
            }

            if let Some(message) = parsed.message.and_then(|message| message.content) {
                if !message.is_empty() {
                    if time_to_first_token.is_none() {
                        time_to_first_token = Some(request_started_at.elapsed());
                    }
                    content.push_str(&message);
                    if let Some(tx) = chunk_tx.as_ref() {
                        forward_chunk(tx, content.clone()).await;
                    }
                }
            }

            if parsed.done {
                debug!(
                    "Ollama request completed in {:?} (provider='{}', model='{}', prompt_tokens_est={}, max_output_tokens={}, time_to_first_token={:?})",
                    request_started_at.elapsed(),
                    provider.id,
                    model,
                    estimated_prompt_tokens,
                    max_output_tokens,
                    time_to_first_token
                );
                return Ok((!content.is_empty()).then_some(content));
            }
        }
    }

    if !buffer.is_empty() {
        let line = String::from_utf8(buffer)
            .map_err(|e| format!("Failed to decode final Ollama stream chunk: {}", e))?;
        let parsed: OllamaChatChunk = serde_json::from_str(line.trim())
            .map_err(|e| format!("Failed to parse final Ollama stream chunk: {}", e))?;
        if let Some(error) = parsed.error {
            return Err(format!("Ollama returned an error: {}", error));
        }
        if let Some(message) = parsed.message.and_then(|message| message.content) {
            if !message.is_empty() {
                if time_to_first_token.is_none() {
                    time_to_first_token = Some(request_started_at.elapsed());
                }
                content.push_str(&message);
                if let Some(tx) = chunk_tx.as_ref() {
                    forward_chunk(tx, content.clone()).await;
                }
            }
        }
    }

    debug!(
        "Ollama request completed in {:?} without explicit done marker (provider='{}', model='{}', prompt_tokens_est={}, max_output_tokens={}, time_to_first_token={:?})",
        request_started_at.elapsed(),
        provider.id,
        model,
        estimated_prompt_tokens,
        max_output_tokens,
        time_to_first_token
    );

    Ok((!content.is_empty()).then_some(content))
}

/// Fetch available models from an OpenAI-compatible API
/// Returns a list of model IDs
pub async fn fetch_models(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Vec<String>, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/models", base_url);

    debug!("Fetching models from: {}", url);

    let client = create_client(provider, &api_key)?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "Model list request failed ({}): {}",
            status, error_text
        ));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let mut models = Vec::new();

    // Handle OpenAI format: { data: [ { id: "..." }, ... ] }
    if let Some(data) = parsed.get("data").and_then(|d| d.as_array()) {
        for entry in data {
            if let Some(id) = entry.get("id").and_then(|i| i.as_str()) {
                models.push(id.to_string());
            } else if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                models.push(name.to_string());
            }
        }
    }
    // Handle array format: [ "model1", "model2", ... ]
    else if let Some(array) = parsed.as_array() {
        for entry in array {
            if let Some(model) = entry.as_str() {
                models.push(model.to_string());
            }
        }
    }

    Ok(models)
}
