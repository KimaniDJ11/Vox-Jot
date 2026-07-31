use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use sentry::ClientInitGuard;

static CRASH_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
static USAGE_ANALYTICS_ENABLED: AtomicBool = AtomicBool::new(false);
static FIRST_DICTATION_REPORTED: AtomicBool = AtomicBool::new(false);
static SENTRY_GUARD: OnceLock<ClientInitGuard> = OnceLock::new();

const COMPILED_DSN: Option<&str> = option_env!("SENTRY_DSN");

pub fn set_crash_reporting_enabled(enabled: bool) {
    CRASH_REPORTING_ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn set_usage_analytics_enabled(enabled: bool) {
    USAGE_ANALYTICS_ENABLED.store(enabled, Ordering::SeqCst);
}

fn capture_usage_event(event: &'static str) {
    if !USAGE_ANALYTICS_ENABLED.load(Ordering::SeqCst) {
        return;
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };

    let _ = client
        .post("https://voxjot-launch-metrics.wpskbj7prw.workers.dev/app-event")
        .header("X-Vox-Jot-Metrics", "1")
        .json(&serde_json::json!({ "event": event }))
        .send();
}

pub fn track_usage_event(event: &'static str) {
    if !matches!(event, "analytics_enabled" | "app_launch") {
        log::warn!("Ignored unknown usage metric: {event}");
        return;
    }
    std::thread::spawn(move || capture_usage_event(event));
}

pub fn track_first_dictation_success() {
    if !USAGE_ANALYTICS_ENABLED.load(Ordering::SeqCst)
        || FIRST_DICTATION_REPORTED.swap(true, Ordering::SeqCst)
    {
        return;
    }

    std::thread::spawn(|| capture_usage_event("first_dictation_success"));
}

pub fn init() {
    let Some(dsn) = COMPILED_DSN else {
        log::debug!("Sentry not initialised: SENTRY_DSN was not set at build time");
        return;
    };
    if dsn.trim().is_empty() {
        log::debug!("Sentry not initialised: SENTRY_DSN was empty");
        return;
    }

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            send_default_pii: false,
            attach_stacktrace: true,
            auto_session_tracking: false,
            before_send: Some(Arc::new(|event| {
                if CRASH_REPORTING_ENABLED.load(Ordering::SeqCst) {
                    Some(event)
                } else {
                    None
                }
            })),
            before_breadcrumb: Some(Arc::new(|crumb| {
                if CRASH_REPORTING_ENABLED.load(Ordering::SeqCst) {
                    Some(crumb)
                } else {
                    None
                }
            })),
            ..Default::default()
        },
    ));

    if SENTRY_GUARD.set(guard).is_err() {
        log::warn!("Sentry init called twice; second call ignored");
    } else {
        log::info!("Sentry initialised; crash reports gated on user opt-in");
    }
}
