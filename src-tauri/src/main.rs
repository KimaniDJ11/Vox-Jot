// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::Parser;
use vox_jot_app_lib::{cli_client, CliArgs};

fn main() {
    let cli_args = CliArgs::parse();

    // If a subcommand was passed, act as a CLI HTTP client against the
    // running app's loopback API and exit. We never boot Tauri in this
    // path, so commands like `vox-jot transcribe foo.wav` complete in
    // milliseconds and return cleanly to the shell.
    if let Some(cmd) = cli_args.command.clone() {
        let exit_code = cli_client::run(cmd);
        std::process::exit(exit_code);
    }

    #[cfg(target_os = "linux")]
    {
        // DMABUF renderer causes crashes on various GPU/display server configurations
        // See: https://github.com/tauri-apps/tauri/issues/9394
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    vox_jot_app_lib::run(cli_args)
}
