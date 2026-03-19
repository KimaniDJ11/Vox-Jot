//! App classification for intelligent correction monitoring.
//!
//! Classifies apps by how their text fields behave after a user "submits" content:
//! - **Ephemeral**: Chat apps, search bars, browser URL bars — text field clears after send/submit
//! - **Persistent**: Note apps, editors, IDEs — text stays in the field
//!
//! This classification drives:
//! - Poll interval (faster for ephemeral to catch edits before send-clear)
//! - Monitoring window duration
//! - Clear-event interpretation (instant clear = "sent message", not "deleted everything")

use log::debug;
use serde::{Deserialize, Serialize};
use specta::Type;

/// How the target app's primary text field behaves after a submit action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AppFieldBehavior {
    /// Text persists after save/submit (notes, editors, IDEs).
    Persistent,
    /// Text clears after send/submit (chat, search, browser URL bar).
    Ephemeral,
    /// Unknown app — use conservative defaults with snapshot tracking.
    Unknown,
}

/// How a field-clear event should be interpreted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClearEventKind {
    /// Field went from content → empty in a single poll interval.
    /// In ephemeral apps, this almost certainly means the user sent the message.
    /// In persistent/unknown apps, this is ambiguous.
    InstantClear,
    /// Field content shrank gradually across multiple polls (user is deleting).
    GradualClear,
}

/// Monitoring parameters derived from app classification.
#[derive(Debug, Clone, Copy)]
pub struct MonitoringParams {
    /// Fast polling interval used during the first moments after paste.
    pub fast_poll_interval_ms: u64,
    /// Steadier polling interval used after the fast-start phase.
    pub steady_poll_interval_ms: u64,
    /// Duration of the fast-start phase (milliseconds).
    pub fast_phase_ms: u64,
    /// Total monitoring window (seconds).
    pub window_secs: u32,
}

impl AppFieldBehavior {
    /// Get optimal monitoring parameters for this app behavior type.
    pub fn monitoring_params(&self) -> MonitoringParams {
        match self {
            AppFieldBehavior::Ephemeral => MonitoringParams {
                fast_poll_interval_ms: 250, // Catch quick edit+send flows
                steady_poll_interval_ms: 1000,
                fast_phase_ms: 4000,
                window_secs: 20, // Shorter window; chat messages are sent quickly
            },
            AppFieldBehavior::Persistent => MonitoringParams {
                fast_poll_interval_ms: 1000, // Still capture immediate edits after paste
                steady_poll_interval_ms: 3000,
                fast_phase_ms: 3000,
                window_secs: 45, // Longer window; users may edit slowly in editors
            },
            AppFieldBehavior::Unknown => MonitoringParams {
                fast_poll_interval_ms: 500, // Conservative but responsive for mixed app types
                steady_poll_interval_ms: 2000,
                fast_phase_ms: 4000,
                window_secs: 30, // Medium window
            },
        }
    }
}

/// Classify an app by its bundle identifier.
///
/// Uses a known-app lookup table. Returns `Unknown` for unrecognized apps.
pub fn classify_app(app_identifier: Option<&str>) -> AppFieldBehavior {
    let id = match app_identifier {
        Some(id) => id,
        None => return AppFieldBehavior::Unknown,
    };

    let id_lower = id.to_lowercase();

    // ── Ephemeral (chat / messaging / search) ──────────────────────────

    // Slack
    if id_lower.contains("slack") {
        debug!("Classified '{}' as Ephemeral (Slack)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Discord
    if id_lower.contains("discord") {
        debug!("Classified '{}' as Ephemeral (Discord)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Apple Messages / iMessage
    if id_lower == "com.apple.mobilesms"
        || id_lower == "com.apple.ichat"
        || id_lower == "com.apple.messages"
    {
        debug!("Classified '{}' as Ephemeral (Apple Messages)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Telegram
    if id_lower.contains("telegram") {
        debug!("Classified '{}' as Ephemeral (Telegram)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // WhatsApp
    if id_lower.contains("whatsapp") {
        debug!("Classified '{}' as Ephemeral (WhatsApp)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Signal
    if id_lower.contains("signal") && id_lower.contains("org.whispersystems") {
        debug!("Classified '{}' as Ephemeral (Signal)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Microsoft Teams
    if id_lower.contains("teams") && id_lower.contains("microsoft") {
        debug!("Classified '{}' as Ephemeral (Teams)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Zoom chat
    if id_lower.contains("zoom") {
        debug!("Classified '{}' as Ephemeral (Zoom)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Facebook Messenger
    if id_lower.contains("messenger") {
        debug!("Classified '{}' as Ephemeral (Messenger)", id);
        return AppFieldBehavior::Ephemeral;
    }

    // Web browsers host both chat inputs and persistent editors, so
    // bundle-level classification is too coarse. Treat them as Unknown
    // and let the field monitor use more conservative clear handling.
    if id_lower.contains("safari")
        || id_lower.contains("chrome")
        || id_lower.contains("firefox")
        || id_lower.contains("brave")
        || id_lower.contains("edge")
        || id_lower.contains("opera")
        || id_lower.contains("arc")
        || id_lower.contains("vivaldi")
        || id_lower.contains("orion")
        || id_lower.contains("chromium")
        || id_lower == "com.apple.safari"
        || id_lower == "com.google.chrome"
    {
        debug!("Classified '{}' as Unknown (browser)", id);
        return AppFieldBehavior::Unknown;
    }

    // ── Persistent (editors / notes / IDEs) ────────────────────────────

    // Apple Notes
    if id_lower == "com.apple.notes" {
        debug!("Classified '{}' as Persistent (Apple Notes)", id);
        return AppFieldBehavior::Persistent;
    }

    // TextEdit
    if id_lower == "com.apple.textedit" {
        debug!("Classified '{}' as Persistent (TextEdit)", id);
        return AppFieldBehavior::Persistent;
    }

    // VS Code / Cursor / other Electron-based editors
    if id_lower.contains("vscode")
        || id_lower.contains("visual-studio-code")
        || id_lower.contains("cursor")
        || id_lower.contains("zed")
        || id_lower.contains("sublime")
    {
        debug!("Classified '{}' as Persistent (code editor)", id);
        return AppFieldBehavior::Persistent;
    }

    // Notion (desktop app)
    if id_lower.contains("notion") {
        debug!("Classified '{}' as Persistent (Notion)", id);
        return AppFieldBehavior::Persistent;
    }

    // Obsidian
    if id_lower.contains("obsidian") {
        debug!("Classified '{}' as Persistent (Obsidian)", id);
        return AppFieldBehavior::Persistent;
    }

    // Bear
    if id_lower.contains("bear") && id_lower.contains("shinyfrog") {
        debug!("Classified '{}' as Persistent (Bear)", id);
        return AppFieldBehavior::Persistent;
    }

    // Pages
    if id_lower == "com.apple.iwork.pages" {
        debug!("Classified '{}' as Persistent (Pages)", id);
        return AppFieldBehavior::Persistent;
    }

    // Microsoft Word
    if id_lower.contains("microsoft.word") {
        debug!("Classified '{}' as Persistent (Word)", id);
        return AppFieldBehavior::Persistent;
    }

    // Google Docs (via browser is handled above as Ephemeral, but
    // a dedicated app wrapper would be Persistent)

    // JetBrains IDEs
    if id_lower.contains("jetbrains")
        || id_lower.contains("intellij")
        || id_lower.contains("pycharm")
        || id_lower.contains("webstorm")
        || id_lower.contains("clion")
        || id_lower.contains("goland")
        || id_lower.contains("rustrover")
    {
        debug!("Classified '{}' as Persistent (JetBrains IDE)", id);
        return AppFieldBehavior::Persistent;
    }

    // Xcode
    if id_lower == "com.apple.dt.xcode" {
        debug!("Classified '{}' as Persistent (Xcode)", id);
        return AppFieldBehavior::Persistent;
    }

    // Terminal / iTerm
    if id_lower.contains("terminal") || id_lower.contains("iterm") || id_lower.contains("warp") {
        debug!("Classified '{}' as Persistent (terminal)", id);
        return AppFieldBehavior::Persistent;
    }

    debug!("Classified '{}' as Unknown", id);
    AppFieldBehavior::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_slack() {
        assert_eq!(
            classify_app(Some("com.tinyspeck.slackmacgap")),
            AppFieldBehavior::Ephemeral
        );
    }

    #[test]
    fn test_classify_discord() {
        assert_eq!(
            classify_app(Some("com.hnc.Discord")),
            AppFieldBehavior::Ephemeral
        );
    }

    #[test]
    fn test_classify_messages() {
        assert_eq!(
            classify_app(Some("com.apple.MobileSMS")),
            AppFieldBehavior::Ephemeral
        );
    }

    #[test]
    fn test_classify_safari() {
        assert_eq!(
            classify_app(Some("com.apple.Safari")),
            AppFieldBehavior::Unknown
        );
    }

    #[test]
    fn test_classify_chrome() {
        assert_eq!(
            classify_app(Some("com.google.Chrome")),
            AppFieldBehavior::Unknown
        );
    }

    #[test]
    fn test_classify_vscode() {
        assert_eq!(
            classify_app(Some("com.microsoft.VSCode")),
            AppFieldBehavior::Persistent
        );
    }

    #[test]
    fn test_classify_apple_notes() {
        assert_eq!(
            classify_app(Some("com.apple.Notes")),
            AppFieldBehavior::Persistent
        );
    }

    #[test]
    fn test_classify_textedit() {
        assert_eq!(
            classify_app(Some("com.apple.TextEdit")),
            AppFieldBehavior::Persistent
        );
    }

    #[test]
    fn test_classify_xcode() {
        assert_eq!(
            classify_app(Some("com.apple.dt.Xcode")),
            AppFieldBehavior::Persistent
        );
    }

    #[test]
    fn test_classify_unknown() {
        assert_eq!(
            classify_app(Some("com.random.app")),
            AppFieldBehavior::Unknown
        );
    }

    #[test]
    fn test_classify_none() {
        assert_eq!(classify_app(None), AppFieldBehavior::Unknown);
    }

    #[test]
    fn test_ephemeral_params_faster() {
        let ephemeral = AppFieldBehavior::Ephemeral.monitoring_params();
        let persistent = AppFieldBehavior::Persistent.monitoring_params();
        assert!(
            ephemeral.fast_poll_interval_ms < persistent.fast_poll_interval_ms,
            "Ephemeral should poll faster during the fast-start phase"
        );
        assert!(
            ephemeral.window_secs < persistent.window_secs,
            "Ephemeral should have shorter window"
        );
    }

    #[test]
    fn test_telegram() {
        assert_eq!(
            classify_app(Some("ph.nicegram.Telegram")),
            AppFieldBehavior::Ephemeral
        );
        assert_eq!(
            classify_app(Some("ru.keepcoder.Telegram")),
            AppFieldBehavior::Ephemeral
        );
    }

    #[test]
    fn test_whatsapp() {
        assert_eq!(
            classify_app(Some("net.whatsapp.WhatsApp")),
            AppFieldBehavior::Ephemeral
        );
    }

    #[test]
    fn test_obsidian() {
        assert_eq!(
            classify_app(Some("md.obsidian")),
            AppFieldBehavior::Persistent
        );
    }
}
