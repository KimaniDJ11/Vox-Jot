use clap::{Parser, Subcommand, ValueEnum};

/// Top-level CLI for Vox Jot.
///
/// Without a subcommand the binary launches the GUI as before. With a
/// subcommand it acts as a thin HTTP client that talks to the loopback
/// API (see `http_api/`) on the running app instance and exits without
/// ever opening a window.
#[derive(Parser, Debug, Clone, Default)]
#[command(name = "vox_jot", about = "Vox Jot - Speech to Text")]
pub struct CliArgs {
    /// Optional subcommand. Omit to launch the GUI.
    #[command(subcommand)]
    pub command: Option<CliCommand>,

    /// Start with the main window hidden
    #[arg(long)]
    pub start_hidden: bool,

    /// Disable the system tray icon
    #[arg(long)]
    pub no_tray: bool,

    /// Toggle transcription on/off (sent to running instance)
    #[arg(long)]
    pub toggle_transcription: bool,

    /// Toggle transcription with post-processing on/off (sent to running instance)
    #[arg(long)]
    pub toggle_post_process: bool,

    /// Cancel the current operation (sent to running instance)
    #[arg(long)]
    pub cancel: bool,

    /// Enable debug mode with verbose logging
    #[arg(long)]
    pub debug: bool,

    /// Run the offline audio regression harness against a manifest JSON file
    #[arg(long)]
    pub regression_manifest: Option<String>,

    /// Write the regression report JSON to this path
    #[arg(long)]
    pub regression_output: Option<String>,

    /// Override the settings_store.json path used by the regression harness
    #[arg(long)]
    pub regression_settings_file: Option<String>,

    /// Limit regression processing to the first N manifest entries
    #[arg(long)]
    pub regression_limit: Option<usize>,

    /// Override the selected STT model for the regression harness
    #[arg(long)]
    pub regression_model_id: Option<String>,

    /// Skip LLM post-processing during regression runs
    #[arg(long)]
    pub regression_skip_post_process: bool,
}

#[derive(Subcommand, Debug, Clone)]
pub enum CliCommand {
    /// Transcribe an audio file via the running Vox Jot instance.
    ///
    /// Requires the local API to be enabled in Settings → Diagnostics and
    /// `VOX_JOT_API_TOKEN` to match the token shown there. Use `-` as the
    /// path to read WAV from stdin (e.g. `cat audio.wav | vox-jot transcribe -`).
    Transcribe {
        /// Path to a WAV file, or `-` to read WAV from stdin.
        path: String,

        /// Output format. Defaults to plain text on stdout.
        #[arg(long, value_enum, default_value_t = CliOutputFormat::Text)]
        format: CliOutputFormat,

        /// ISO language code hint (currently informational; honored when
        /// the server-side engine supports it).
        #[arg(long)]
        language: Option<String>,
    },

    /// List the speech-to-text models the running app currently knows
    /// about, plus which one is loaded.
    Models {
        /// Emit JSON instead of human-readable text.
        #[arg(long)]
        json: bool,
    },

    /// Probe the local API and print version + status. Useful as a
    /// quick "is the app running with the API on?" check from scripts.
    Health,
}

#[derive(ValueEnum, Debug, Clone, Copy)]
pub enum CliOutputFormat {
    /// Plain transcript on stdout.
    Text,
    /// Full JSON `{ text, segments }` payload on stdout.
    Json,
    /// SubRip subtitles on stdout.
    Srt,
    /// WebVTT subtitles on stdout.
    Vtt,
}
