use clap::Parser;

#[derive(Parser, Debug, Clone, Default)]
#[command(name = "vox_jot", about = "Vox Jot - Speech to Text")]
pub struct CliArgs {
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
