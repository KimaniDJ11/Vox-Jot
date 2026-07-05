#[cfg(not(feature = "ci-mock-transcription"))]
pub mod apple_speech;
pub mod audio;
pub mod continuous_cloning;
pub mod convo;
pub mod history;
pub mod model;
#[cfg(not(feature = "ci-mock-transcription"))]
pub mod transcription;
#[cfg(feature = "ci-mock-transcription")]
#[path = "transcription_mock.rs"]
pub mod transcription;
pub mod watch_folders;

use std::sync::Arc;
use tauri::Manager;

/// Tauri-managed wrapper around the dedicated background engine used for
/// file/watch-folder transcription. Wrapping in a newtype lets it live in
/// managed state alongside the live `Arc<TranscriptionManager>`.
pub struct FileTranscriptionEngine(pub Arc<transcription::TranscriptionManager>);

/// Pick the engine instance for a file-transcription job (File Transcription
/// panel, watch folders, HTTP API, MCP).
///
/// In-process engines (Whisper, Parakeet, Moonshine, SenseVoice, GigaAM) get
/// the dedicated background instance so a long file never holds the live
/// dictation engine's lock — dictation and file jobs then run truly in
/// parallel, at the cost of a second model copy in RAM while file work is
/// active. Remote-runtime engines (MLX/Gemma/Higgs sidecars, Apple Speech)
/// stay on the live manager: they share one external server per port, and a
/// second in-app handle would fight over server ownership.
pub fn file_transcription_engine(
    app: &tauri::AppHandle,
) -> Option<Arc<transcription::TranscriptionManager>> {
    let live = app
        .try_state::<Arc<transcription::TranscriptionManager>>()?
        .inner()
        .clone();

    let selected = crate::settings::get_settings(app).selected_model;
    let selected = selected.trim();
    let uses_remote_runtime = app
        .try_state::<Arc<model::ModelManager>>()
        .and_then(|mm| mm.get_model_info(selected))
        .map(|info| model::engine_uses_remote_runtime(&info.engine_type))
        .unwrap_or(false);
    if uses_remote_runtime {
        return Some(live);
    }

    match app.try_state::<FileTranscriptionEngine>() {
        Some(background) => Some(Arc::clone(&background.0)),
        None => Some(live),
    }
}
