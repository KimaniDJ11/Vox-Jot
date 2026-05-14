use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use sentry::ClientInitGuard;

static CRASH_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
static SENTRY_GUARD: OnceLock<ClientInitGuard> = OnceLock::new();

const COMPILED_DSN: Option<&str> = option_env!("SENTRY_DSN");

pub fn set_crash_reporting_enabled(enabled: bool) {
    CRASH_REPORTING_ENABLED.store(enabled, Ordering::SeqCst);
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
