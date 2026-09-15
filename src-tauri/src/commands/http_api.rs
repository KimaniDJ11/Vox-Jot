//! Tauri commands the Settings UI calls to toggle the loopback API and
//! query its current status.
//!
//! The actual server lives in `crate::http_api`. These commands persist
//! the user-visible settings to disk; the `settings-changed` listener in
//! `lib.rs` then asks the manager to start/stop the server. This split
//! keeps the UI thin and means flipping the toggle from any window
//! (main, detail, etc.) is consistent.

use crate::http_api::HttpApiManager;
use crate::secret_store;
use crate::settings::{get_settings, write_settings};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, State};

#[derive(Serialize, Type)]
pub struct HttpApiStatus {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub token_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct LocalApiHealthResult {
    pub ok: bool,
    pub status: String,
    pub version: String,
    pub port: u16,
    pub latency_ms: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn set_http_api_enabled(
    app: AppHandle,
    manager: State<'_, Arc<HttpApiManager>>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    if settings.http_api_enabled == enabled {
        return Ok(());
    }
    settings.http_api_enabled = enabled;
    let port = settings.http_api_port;
    write_settings(&app, settings);

    // The settings-changed listener will eventually re-sync, but we also
    // call directly here so the UI doesn't need to wait a tick to see
    // the badge flip.
    if enabled {
        manager.start(port).await;
    } else {
        manager.stop().await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_http_api_port(
    app: AppHandle,
    manager: State<'_, Arc<HttpApiManager>>,
    port: u16,
) -> Result<(), String> {
    if port == 0 {
        return Err("Port must be > 0".into());
    }
    let mut settings = get_settings(&app);
    settings.http_api_port = port;
    let enabled = settings.http_api_enabled;
    write_settings(&app, settings);

    if enabled {
        // Restart on the new port.
        manager.start(port).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_http_api_status(app: AppHandle) -> Result<HttpApiStatus, String> {
    let mut s = get_settings(&app);
    let token = secret_store::get_or_create_http_api_token(Some(&s.http_api_token))?;
    if !s.http_api_token.trim().is_empty() {
        s.http_api_token.clear();
        write_settings(&app, s.clone());
    }
    Ok(HttpApiStatus {
        enabled: s.http_api_enabled,
        port: s.http_api_port,
        token: mask_token(&token),
        token_available: true,
    })
}

#[tauri::command]
#[specta::specta]
pub fn reveal_http_api_token(app: AppHandle) -> Result<String, String> {
    let mut settings = get_settings(&app);
    let token = secret_store::get_or_create_http_api_token(Some(&settings.http_api_token))?;
    if !settings.http_api_token.trim().is_empty() {
        settings.http_api_token.clear();
        write_settings(&app, settings);
    }
    Ok(token)
}

#[tauri::command]
#[specta::specta]
pub fn rotate_http_api_token(app: AppHandle) -> Result<HttpApiStatus, String> {
    let settings = get_settings(&app);
    let token = secret_store::rotate_http_api_token()?;
    Ok(HttpApiStatus {
        enabled: settings.http_api_enabled,
        port: settings.http_api_port,
        token: mask_token(&token),
        token_available: true,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn check_local_api_health(app: AppHandle) -> Result<LocalApiHealthResult, String> {
    let settings = get_settings(&app);
    if !settings.http_api_enabled {
        return Err("Local API is not enabled in settings.".into());
    }
    let port = settings.http_api_port;
    if !(1024..=65535).contains(&port) {
        return Err(format!("Invalid port configuration: {port}"));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2000))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    check_health_endpoint(&client, port).await
}

/// Structurally parses and validates a health check target URL.
///
/// Enforces:
/// - Scheme is strictly `http` (no `https` or other schemes)
/// - Host is strictly loopback: IPv4 `127.0.0.1`, IPv6 `::1`, or `localhost`
/// - Rejects username/userinfo and passwords
/// - Rejects any remote host or non-loopback IP
/// - Enforces the port matches `expected_port`
/// - Path must be strictly `/v1/health`
/// - Rejects query strings and fragments
pub fn validate_and_construct_health_url(
    raw_url: &str,
    expected_port: u16,
) -> Result<reqwest::Url, String> {
    if !(1024..=65535).contains(&expected_port) {
        return Err(format!("Invalid port configuration: {expected_port}"));
    }

    let url = reqwest::Url::parse(raw_url.trim())
        .map_err(|e| format!("Invalid health check URL: {e}"))?;

    if url.scheme() != "http" {
        return Err(format!(
            "Invalid scheme '{}': health check must strictly use http",
            url.scheme()
        ));
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Userinfo and credentials are strictly prohibited in health check URLs".into());
    }

    let Some(host) = url.host_str() else {
        return Err("Missing host in health check URL".into());
    };

    let is_valid_loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());

    if !is_valid_loopback {
        return Err(format!(
            "Host '{host}' is rejected: health check is strictly restricted to loopback (127.0.0.1, ::1, localhost)"
        ));
    }

    let port = url
        .port()
        .ok_or_else(|| "Missing port in health check URL".to_string())?;
    if port != expected_port {
        return Err(format!(
            "Port mismatch: URL specified port {port}, expected trusted port {expected_port}"
        ));
    }

    if url.path() != "/v1/health" {
        return Err(format!(
            "Invalid path '{}': health check is strictly restricted to /v1/health",
            url.path()
        ));
    }

    if url.query().is_some() {
        return Err("Query parameters are strictly prohibited in health check URLs".into());
    }

    if url.fragment().is_some() {
        return Err("URL fragments are strictly prohibited in health check URLs".into());
    }

    Ok(url)
}

/// Constructs the trusted loopback health check URL from trusted components.
pub fn build_trusted_loopback_health_url(port: u16) -> Result<reqwest::Url, String> {
    if !(1024..=65535).contains(&port) {
        return Err(format!("Invalid port configuration: {port}"));
    }
    let raw = format!("http://127.0.0.1:{port}/v1/health");
    validate_and_construct_health_url(&raw, port)
}

/// Probes the local health endpoint on the trusted port using a structurally validated loopback URL.
pub async fn check_health_endpoint(
    client: &reqwest::Client,
    port: u16,
) -> Result<LocalApiHealthResult, String> {
    let url = build_trusted_loopback_health_url(port)?;
    check_health_endpoint_url(client, url, port).await
}

/// Internal execution helper performing the GET request against a validated Url.
pub async fn check_health_endpoint_url(
    client: &reqwest::Client,
    url: reqwest::Url,
    port: u16,
) -> Result<LocalApiHealthResult, String> {
    let start = std::time::Instant::now();
    let response = client.get(url).send().await.map_err(|err| {
        if err.is_connect() {
            format!("Could not connect to Local API at 127.0.0.1:{port} (connection refused).")
        } else if err.is_timeout() {
            format!("Connection to Local API at 127.0.0.1:{port} timed out.")
        } else {
            format!("Failed to connect to Local API at 127.0.0.1:{port}: {err}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Local API returned HTTP status {status}."));
    }

    #[derive(Deserialize)]
    struct HealthPayload {
        status: String,
        version: String,
    }

    let body = response
        .json::<HealthPayload>()
        .await
        .map_err(|_| "Malformed health response from Local API.".to_string())?;

    let latency_ms = start.elapsed().as_millis() as u64;

    Ok(LocalApiHealthResult {
        ok: body.status == "ok",
        status: body.status,
        version: body.version,
        port,
        latency_ms,
    })
}

fn mask_token(token: &str) -> String {
    let trimmed = token.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 12 {
        return "••••".to_string();
    }
    let prefix: String = chars.iter().take(6).copied().collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(6)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}…{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, StatusCode};
    use axum::response::IntoResponse;
    use axum::routing::get;
    use axum::{Json, Router};
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn test_check_health_backend_healthy() {
        let app = Router::new().route(
            "/v1/health",
            get(|| async {
                Json(json!({
                    "status": "ok",
                    "version": "1.0.22"
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();
        let result = check_health_endpoint(&client, port).await.unwrap();
        assert!(result.ok);
        assert_eq!(result.status, "ok");
        assert_eq!(result.version, "1.0.22");
        assert_eq!(result.port, port);
    }

    #[tokio::test]
    async fn test_check_health_backend_unavailable() {
        // Bind to get an unused port and immediately drop the listener
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();
        let err = check_health_endpoint(&client, port).await.unwrap_err();
        assert!(
            err.contains("connection refused") || err.contains("Could not connect"),
            "Error was: {err}"
        );
    }

    #[tokio::test]
    async fn test_check_health_timeout() {
        let app = Router::new().route(
            "/v1/health",
            get(|| async {
                tokio::time::sleep(Duration::from_millis(300)).await;
                Json(json!({"status": "ok", "version": "1.0.22"}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        let err = check_health_endpoint(&client, port).await.unwrap_err();
        assert!(err.contains("timed out"), "Error was: {err}");
    }

    #[tokio::test]
    async fn test_check_health_unexpected_http_status() {
        let app = Router::new().route(
            "/v1/health",
            get(|| async {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "server error"})),
                )
                    .into_response()
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();
        let err = check_health_endpoint(&client, port).await.unwrap_err();
        assert!(
            err.contains("500 Internal Server Error"),
            "Error was: {err}"
        );
    }

    #[tokio::test]
    async fn test_check_health_malformed_response() {
        let app = Router::new().route(
            "/v1/health",
            get(|| async {
                Json(json!({
                    "unexpected_field": 123
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();
        let err = check_health_endpoint(&client, port).await.unwrap_err();
        assert!(
            err.contains("Malformed health response"),
            "Error was: {err}"
        );
    }

    #[tokio::test]
    async fn test_check_health_requests_never_send_authorization() {
        let captured_headers = Arc::new(Mutex::new(None));
        let captured_clone = Arc::clone(&captured_headers);

        let app = Router::new().route(
            "/v1/health",
            get(move |headers: HeaderMap| {
                let captured = Arc::clone(&captured_clone);
                async move {
                    *captured.lock().unwrap() = Some(headers);
                    (
                        StatusCode::OK,
                        Json(json!({"status": "ok", "version": "1.0.22"})),
                    )
                        .into_response()
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();

        let result = check_health_endpoint(&client, port)
            .await
            .expect("Health check should succeed");
        assert!(result.ok);

        let headers = captured_headers
            .lock()
            .unwrap()
            .take()
            .expect("Mock server should have received request headers");

        assert!(
            headers.get("authorization").is_none(),
            "Authorization header must be absent from /v1/health requests"
        );
        assert!(
            headers.get("x-vox-jot-api-token").is_none(),
            "x-vox-jot-api-token header must be absent from /v1/health requests"
        );
    }

    #[tokio::test]
    async fn test_check_health_unexpected_401_status() {
        let app = Router::new().route(
            "/v1/health",
            get(|| async { (StatusCode::UNAUTHORIZED, "Unauthorized").into_response() }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();

        let err = check_health_endpoint(&client, port).await.unwrap_err();
        assert!(err.contains("401 Unauthorized"), "Error was: {err}");
    }

    #[test]
    fn test_health_url_accepts_valid_127_0_0_1() {
        let url = validate_and_construct_health_url("http://127.0.0.1:18488/v1/health", 18488)
            .expect("Valid 127.0.0.1 loopback URL must be accepted");
        assert_eq!(url.as_str(), "http://127.0.0.1:18488/v1/health");
    }

    #[test]
    fn test_health_url_accepts_valid_localhost() {
        let url = validate_and_construct_health_url("http://localhost:18488/v1/health", 18488)
            .expect("Valid localhost loopback URL must be accepted");
        assert_eq!(url.as_str(), "http://localhost:18488/v1/health");
    }

    #[test]
    fn test_health_url_accepts_valid_ipv6_loopback() {
        let url = validate_and_construct_health_url("http://[::1]:18488/v1/health", 18488)
            .expect("Valid IPv6 ::1 loopback URL must be accepted");
        assert_eq!(url.as_str(), "http://[::1]:18488/v1/health");
    }

    #[test]
    fn test_health_url_rejects_normal_remote_url() {
        let err = validate_and_construct_health_url("http://example.com:18488/v1/health", 18488)
            .unwrap_err();
        assert!(err.contains("rejected: health check is strictly restricted to loopback"));
    }

    #[test]
    fn test_health_url_rejects_deceptive_userinfo_with_localhost() {
        let err1 = validate_and_construct_health_url(
            "http://localhost:secret@evil.com:18488/v1/health",
            18488,
        )
        .unwrap_err();
        assert!(err1.contains("Userinfo and credentials are strictly prohibited"));

        let err2 = validate_and_construct_health_url(
            "http://localhost@attacker.com:18488/v1/health",
            18488,
        )
        .unwrap_err();
        assert!(err2.contains("Userinfo and credentials are strictly prohibited"));
    }

    #[test]
    fn test_health_url_rejects_wrong_scheme_https() {
        let err = validate_and_construct_health_url("https://127.0.0.1:18488/v1/health", 18488)
            .unwrap_err();
        assert!(err.contains("must strictly use http"));
    }

    #[test]
    fn test_health_url_rejects_incorrect_port() {
        let err = validate_and_construct_health_url("http://127.0.0.1:8080/v1/health", 18488)
            .unwrap_err();
        assert!(err.contains("Port mismatch"));
    }

    #[test]
    fn test_health_url_rejects_non_loopback_ip() {
        let err1 = validate_and_construct_health_url("http://192.168.1.100:18488/v1/health", 18488)
            .unwrap_err();
        assert!(err1.contains("rejected: health check is strictly restricted to loopback"));

        let err2 = validate_and_construct_health_url("http://10.0.0.1:18488/v1/health", 18488)
            .unwrap_err();
        assert!(err2.contains("rejected: health check is strictly restricted to loopback"));
    }

    #[test]
    fn test_health_url_rejects_wrong_path_and_query() {
        let err1 = validate_and_construct_health_url("http://127.0.0.1:18488/v1/status", 18488)
            .unwrap_err();
        assert!(err1.contains("strictly restricted to /v1/health"));

        let err2 =
            validate_and_construct_health_url("http://127.0.0.1:18488/v1/health?token=abc", 18488)
                .unwrap_err();
        assert!(err2.contains("Query parameters are strictly prohibited"));

        let err3 =
            validate_and_construct_health_url("http://127.0.0.1:18488/v1/health#fragment", 18488)
                .unwrap_err();
        assert!(err3.contains("URL fragments are strictly prohibited"));
    }

    #[test]
    fn test_health_url_rejects_invalid_port_bounds() {
        assert!(build_trusted_loopback_health_url(80).is_err());
        assert!(build_trusted_loopback_health_url(1000).is_err());
        assert!(build_trusted_loopback_health_url(65535).is_ok());
    }

    #[tokio::test]
    async fn test_check_health_endpoint_url_supports_localhost_and_ipv6() {
        let app = Router::new().route(
            "/v1/health",
            get(|| async {
                Json(json!({
                    "status": "ok",
                    "version": "1.0.22"
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();

        let localhost_url =
            validate_and_construct_health_url(&format!("http://localhost:{port}/v1/health"), port)
                .expect("localhost target should validate");

        let result = check_health_endpoint_url(&client, localhost_url, port)
            .await
            .expect("check_health_endpoint_url should succeed on localhost");
        assert!(result.ok);
    }
}
