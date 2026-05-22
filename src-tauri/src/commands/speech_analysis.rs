use crate::speech_analysis::{
    self, HuggingFaceTokenStatus, SpeechAnalysisCatalog, SpeechAnalysisModelDescriptor,
    SpeechAnalysisSelection,
};
use std::future::Future;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

// Speech Analysis catalog/download commands are invoked from model/settings UI.
// Keep that work off WebKit's URL-scheme callback stack.
const SPEECH_ANALYSIS_COMMAND_STACK_BYTES: usize = 64 * 1024 * 1024;

async fn run_speech_analysis_command_on_stack<T, F, Fut>(
    thread_name: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, String>> + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    thread::Builder::new()
        .name(thread_name.to_string())
        .stack_size(SPEECH_ANALYSIS_COMMAND_STACK_BYTES)
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|err| {
                        format!("Failed to start speech-analysis command runtime: {err}")
                    })?;
                runtime.block_on(task())
            })();
            let _ = tx.send(result);
        })
        .map_err(|err| format!("Failed to start speech-analysis command thread: {err}"))?;

    rx.await
        .map_err(|_| "Speech-analysis command thread stopped before returning data.".to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn get_speech_analysis_catalog(app: AppHandle) -> Result<SpeechAnalysisCatalog, String> {
    run_speech_analysis_command_on_stack("get-speech-analysis-catalog", move || async move {
        Ok(speech_analysis::get_catalog(&app))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_speech_analysis_model(
    app: AppHandle,
    model_id: String,
) -> Result<Option<SpeechAnalysisModelDescriptor>, String> {
    run_speech_analysis_command_on_stack("get-speech-analysis-model", move || async move {
        Ok(speech_analysis::get_model(&app, &model_id))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_speech_analysis_selection(
    app: AppHandle,
) -> Result<SpeechAnalysisSelection, String> {
    run_speech_analysis_command_on_stack("get-speech-analysis-selection", move || async move {
        Ok(speech_analysis::selection_from_settings(&app))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn set_speech_analysis_selection(
    app: AppHandle,
    asr_model_id: String,
    diarization_model_id: String,
) -> Result<SpeechAnalysisSelection, String> {
    run_speech_analysis_command_on_stack("set-speech-analysis-selection", move || async move {
        speech_analysis::set_selection(&app, asr_model_id, diarization_model_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn download_speech_analysis_model(
    app: AppHandle,
    sidecar_manager: State<'_, Arc<crate::sidecar::SidecarManager>>,
    model_id: String,
) -> Result<SpeechAnalysisModelDescriptor, String> {
    let sidecar_manager = sidecar_manager.inner().clone();
    run_speech_analysis_command_on_stack("download-speech-analysis-model", move || async move {
        let descriptor = speech_analysis::download_model(&app, model_id).await?;
        let runtime_result = if speech_analysis::model_uses_managed_python_runtime(&descriptor.id) {
            speech_analysis::emit_download_progress(
                &app,
                &descriptor.id,
                "installing-runtime",
                0,
                0,
                Some("speech-analysis Python runtime"),
                None,
                None,
                None,
            );
            let sidecar = sidecar_manager.clone();
            tokio::task::spawn_blocking(move || sidecar.ensure_speech_analysis_environment())
                .await
                .map_err(|err| format!("Failed to join speech-analysis runtime setup task: {err}"))
                .and_then(|result| result.map(|_| ()))
        } else if speech_analysis::model_uses_mlx_native(&descriptor.id) {
            speech_analysis::emit_download_progress(
                &app,
                &descriptor.id,
                "installing-runtime",
                0,
                0,
                Some("mlx-audio runtime"),
                None,
                None,
                None,
            );
            let sidecar = sidecar_manager.clone();
            tokio::task::spawn_blocking(move || sidecar.ensure_mlx_audio_environment())
                .await
                .map_err(|err| format!("Failed to join mlx-audio runtime setup task: {err}"))
                .and_then(|result| result.map(|_| ()))
        } else {
            Ok(())
        };

        if let Err(err) = runtime_result {
            speech_analysis::emit_download_progress(
                &app,
                &descriptor.id,
                "failed",
                0,
                0,
                Some("runtime setup"),
                None,
                None,
                Some(&err),
            );
            return Err(err);
        }

        speech_analysis::emit_download_progress(
            &app,
            &descriptor.id,
            "complete",
            0,
            0,
            Some("ready to use"),
            None,
            None,
            None,
        );
        if crate::shared_model_assets::is_shared_model_asset(&descriptor.id) {
            let _ = app.emit("model-download-complete", &descriptor.id);
        }
        Ok(speech_analysis::get_model(&app, &descriptor.id).unwrap_or(descriptor))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_speech_analysis_download(
    app: AppHandle,
    model_id: String,
) -> Result<(), String> {
    run_speech_analysis_command_on_stack("cancel-speech-analysis-download", move || async move {
        speech_analysis::cancel_download(&app, model_id).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_speech_analysis_model(
    app: AppHandle,
    model_id: String,
) -> Result<SpeechAnalysisModelDescriptor, String> {
    run_speech_analysis_command_on_stack("delete-speech-analysis-model", move || async move {
        speech_analysis::delete_model(&app, model_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_active_speech_analysis_downloads() -> Vec<String> {
    speech_analysis::active_downloads().await
}

#[tauri::command]
#[specta::specta]
pub fn get_hugging_face_token_status() -> Result<HuggingFaceTokenStatus, String> {
    Ok(speech_analysis::hugging_face_token_status())
}

#[tauri::command]
#[specta::specta]
pub async fn set_hugging_face_token(token: String) -> Result<HuggingFaceTokenStatus, String> {
    speech_analysis::set_hugging_face_token(token).await
}

#[tauri::command]
#[specta::specta]
pub fn clear_hugging_face_token() -> Result<HuggingFaceTokenStatus, String> {
    speech_analysis::clear_hugging_face_token()
}

#[tauri::command]
#[specta::specta]
pub fn open_speech_analysis_model_access_page(
    app: AppHandle,
    model_id: String,
) -> Result<(), String> {
    let model = speech_analysis::model_by_id(&model_id)
        .ok_or_else(|| format!("Unknown speech analysis model '{}'.", model_id))?;
    let url = model
        .source_url
        .ok_or_else(|| format!("{} has no access page URL.", model.label))?;
    if !url.starts_with("https://huggingface.co/") {
        return Err(format!(
            "{} has an unsupported access page URL: {}",
            model.label, url
        ));
    }

    app.opener()
        .open_url(url, None::<String>)
        .map_err(|err| format!("Failed to open Hugging Face access page: {err}"))
}
