//! Runtime IPC capability for the loopback asset-server origin (macOS release).
//!
//! macOS release builds load every window from `http://127.0.0.1:<port>` (see
//! `asset_server`), which Tauri treats as a *remote* origin: the static
//! capability files only apply to local app URLs. Previously the capability
//! files statically whitelisted all four candidate ports, which granted the
//! full IPC surface to whichever local process happened to bind the other
//! three ports first. Instead, this module clones each static capability at
//! runtime and grants it to exactly the one origin whose port the asset
//! server actually bound.

// In dev builds windows load from the Vite dev server (a local origin covered
// by the static capabilities), so `asset_server` — the only runtime consumer —
// is compiled out and only the tests below reference this module.
#![cfg_attr(dev, allow(dead_code))]

use anyhow::{anyhow, Context};
use serde_json::{json, Value};

/// Static capability files whose permission sets must also apply to the
/// loopback asset-server origin. Single-sourcing from the JSON files keeps
/// the runtime grant from drifting when permissions change.
const CAPABILITY_SOURCES: [&str; 2] = [
    include_str!("../capabilities/default.json"),
    include_str!("../capabilities/recording-overlay.json"),
];

/// Grants each static capability's permission set to `http://127.0.0.1:<port>`.
///
/// Must run before any webview window is created so page-load IPC is already
/// authorized. Failure is fatal to the caller by design: without this grant
/// every window is a UI that cannot invoke a single command.
#[cfg(not(dev))]
pub fn grant_to_port(app: &tauri::AppHandle, port: u16) -> anyhow::Result<()> {
    use tauri::Manager;

    let origin = loopback_origin(port);
    for source in CAPABILITY_SOURCES {
        let capability = capability_for_origin(source, &origin)?;
        // Parse ahead of add_capability: the &str RuntimeCapability impl
        // panics on malformed capabilities instead of returning an error.
        capability
            .parse::<tauri::utils::acl::capability::CapabilityFile>()
            .map_err(|error| anyhow!("loopback capability does not parse: {error}"))?;
        app.add_capability(capability.as_str())
            .with_context(|| format!("failed to grant loopback IPC capability for {origin}"))?;
    }
    log::info!("Granted loopback IPC capabilities for {origin}");
    Ok(())
}

fn loopback_origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Rewrites a static capability file into a runtime capability that applies
/// only to the given remote origin (and not to local URLs, which the static
/// capability already covers).
fn capability_for_origin(source: &str, origin: &str) -> anyhow::Result<String> {
    let mut capability: Value =
        serde_json::from_str(source).context("static capability file is not valid JSON")?;
    let object = capability
        .as_object_mut()
        .ok_or_else(|| anyhow!("static capability file is not a JSON object"))?;

    let identifier = object
        .get("identifier")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("static capability file has no string identifier"))?
        .to_string();

    object.remove("$schema");
    object.insert("identifier".into(), json!(format!("{identifier}-loopback")));
    object.insert("local".into(), json!(false));
    object.insert("remote".into(), json!({ "urls": [origin] }));

    serde_json::to_string(&capability).context("failed to serialize loopback capability")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::acl::capability::{Capability, CapabilityFile};

    const TEST_ORIGIN: &str = "http://127.0.0.1:47635";

    fn rewritten(source: &str) -> Capability {
        let capability_json = capability_for_origin(source, TEST_ORIGIN)
            .expect("static capability should rewrite cleanly");
        match capability_json
            .parse::<CapabilityFile>()
            .expect("rewritten capability should parse as a Tauri capability")
        {
            CapabilityFile::Capability(capability) => capability,
            _ => panic!("expected a single capability, got a capability list"),
        }
    }

    #[test]
    fn grants_only_the_bound_origin_and_never_local_urls() {
        for source in CAPABILITY_SOURCES {
            let capability = rewritten(source);
            let remote = capability.remote.expect("rewritten capability has remote");
            assert_eq!(remote.urls, vec![TEST_ORIGIN.to_string()]);
            assert!(!capability.local);
            assert!(
                capability.identifier.ends_with("-loopback"),
                "identifier must not collide with the static capability: {}",
                capability.identifier
            );
        }
    }

    #[test]
    fn preserves_windows_and_permissions_from_the_static_files() {
        for source in CAPABILITY_SOURCES {
            let original: Value = serde_json::from_str(source).unwrap();
            let capability = rewritten(source);

            let original_windows: Vec<&str> = original["windows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|window| window.as_str().unwrap())
                .collect();
            assert_eq!(capability.windows, original_windows);
            assert_eq!(
                capability.permissions.len(),
                original["permissions"].as_array().unwrap().len()
            );
            assert!(!capability.permissions.is_empty());
        }
    }

    #[test]
    fn static_files_no_longer_carry_a_remote_grant() {
        // The whole point of the runtime grant: no fixed port keeps IPC
        // authority in the static files.
        for source in CAPABILITY_SOURCES {
            let original: Value = serde_json::from_str(source).unwrap();
            assert!(
                original.get("remote").is_none(),
                "static capability files must not grant remote origins"
            );
        }
    }

    #[test]
    fn origin_format_matches_the_asset_server_url_scheme() {
        assert_eq!(loopback_origin(47641), "http://127.0.0.1:47641");
    }
}
