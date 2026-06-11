//! Serves bundled frontend assets over loopback HTTP for macOS release builds.
//!
//! macOS 26 WebKit can crash in WKURLSchemeHandler when Tauri's custom asset
//! scheme races resource loading, so release builds load every window from
//! `http://127.0.0.1:<port>` (see `app_webview_url`). That makes this server
//! the single delivery path for the whole UI: if it dies, every window is a
//! permanent blank page.
//!
//! This replaces `tauri-plugin-localhost`, whose serving thread panicked when
//! the port was already bound at launch or when a single client aborted a
//! request mid-response. Here bind collisions fall through a fixed candidate
//! list, request failures are logged and skipped, and the accept loop rebinds
//! itself if it ever ends.

use std::net::{Ipv4Addr, TcpListener};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, AssetResolver, Wry};
use tiny_http::{Header, Request, Response, Server};

/// Ports the asset server may bind, in order of preference.
///
/// IPC capability grants for remote origins match exact URLs, so every entry
/// here must also be listed under `remote.urls` in `capabilities/default.json`
/// and `capabilities/recording-overlay.json`.
const CANDIDATE_PORTS: [u16; 4] = [47635, 47641, 47653, 47667];

static ACTIVE_PORT: OnceLock<u16> = OnceLock::new();

/// The port the asset server bound, falling back to the preferred candidate
/// before [`start`] has run. Window URLs are only built after `start`, so the
/// fallback exists for safety, not as a real code path.
pub fn active_port() -> u16 {
    ACTIVE_PORT.get().copied().unwrap_or(CANDIDATE_PORTS[0])
}

/// Binds the first free candidate port and serves bundled assets on it for
/// the lifetime of the app. Must run before any webview window is created so
/// `app_webview_url` points at the bound port.
pub fn start(app: &AppHandle) -> anyhow::Result<u16> {
    let (listener, port) = bind_first_free_port()?;
    let _ = ACTIVE_PORT.set(port);

    let resolver = app.asset_resolver();
    std::thread::Builder::new()
        .name("asset-server".into())
        .spawn(move || serve(listener, port, resolver))?;

    log::info!("Asset server listening on 127.0.0.1:{port}");
    Ok(port)
}

fn bind_first_free_port() -> anyhow::Result<(TcpListener, u16)> {
    for port in CANDIDATE_PORTS {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            Ok(listener) => return Ok((listener, port)),
            Err(error) => {
                log::warn!("Asset server could not bind 127.0.0.1:{port}: {error}");
            }
        }
    }
    Err(anyhow::anyhow!(
        "all candidate asset server ports are in use: {CANDIDATE_PORTS:?}"
    ))
}

fn serve(mut listener: TcpListener, port: u16, resolver: AssetResolver<Wry>) {
    loop {
        let server = match Server::from_listener(listener, None) {
            Ok(server) => server,
            Err(error) => {
                log::error!("Asset server failed to start on 127.0.0.1:{port}: {error}");
                return;
            }
        };

        for request in server.incoming_requests() {
            handle_request(request, &resolver);
        }

        // incoming_requests() only ends when accepting fails (e.g. fd
        // exhaustion). The UI cannot load without this server, so recover by
        // rebinding the same port instead of letting the thread die.
        drop(server);
        log::error!("Asset server accept loop ended; rebinding 127.0.0.1:{port}");
        listener = loop {
            match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
                Ok(listener) => break listener,
                Err(error) => {
                    log::error!("Asset server rebind failed: {error}; retrying in 1s");
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
        };
    }
}

fn handle_request(request: Request, resolver: &AssetResolver<Wry>) {
    // Requests are origin-form ("/path?query"); strip query and fragment.
    let path = request
        .url()
        .split(['?', '#'])
        .next()
        .unwrap_or("/")
        .to_string();

    let Some(asset) = resolver.get(path) else {
        if let Err(error) = request.respond(Response::empty(404)) {
            log::debug!("Asset server failed to send 404: {error}");
        }
        return;
    };

    let mut response = Response::from_data(asset.bytes);
    append_header(&mut response, "Content-Type", &asset.mime_type);
    if let Some(csp) = asset.csp_header {
        append_header(&mut response, "Content-Security-Policy", &csp);
    }
    append_header(&mut response, "Cache-Control", "no-cache");

    if let Err(error) = request.respond(response) {
        // Routine when WebKit cancels an in-flight load; never fatal.
        log::debug!("Asset server failed to send response: {error}");
    }
}

fn append_header<R: std::io::Read>(response: &mut Response<R>, name: &str, value: &str) {
    match Header::from_bytes(name.as_bytes(), value.as_bytes()) {
        Ok(header) => response.add_header(header),
        Err(()) => log::warn!("Asset server skipped invalid header {name}: {value}"),
    }
}
