use crate::speech_analysis::{
    self, HuggingFaceTokenStatus, SpeechAnalysisCatalog, SpeechAnalysisModelDescriptor,
    SpeechAnalysisSelection,
};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
#[specta::specta]
pub fn get_speech_analysis_catalog(app: AppHandle) -> Result<SpeechAnalysisCatalog, String> {
    Ok(speech_analysis::get_catalog(&app))
}

#[tauri::command]
#[specta::specta]
pub fn get_speech_analysis_model(
    model_id: String,
) -> Result<Option<SpeechAnalysisModelDescriptor>, String> {
    Ok(speech_analysis::model_by_id(&model_id))
}

#[tauri::command]
#[specta::specta]
pub fn get_speech_analysis_selection(app: AppHandle) -> Result<SpeechAnalysisSelection, String> {
    Ok(speech_analysis::selection_from_settings(&app))
}

#[tauri::command]
#[specta::specta]
pub fn set_speech_analysis_selection(
    app: AppHandle,
    asr_model_id: String,
    diarization_model_id: String,
) -> Result<SpeechAnalysisSelection, String> {
    speech_analysis::set_selection(&app, asr_model_id, diarization_model_id)
}

#[tauri::command]
#[specta::specta]
pub async fn download_speech_analysis_model(
    app: AppHandle,
    model_id: String,
) -> Result<SpeechAnalysisModelDescriptor, String> {
    speech_analysis::download_model(&app, model_id).await
}

#[tauri::command]
#[specta::specta]
pub fn delete_speech_analysis_model(
    app: AppHandle,
    model_id: String,
) -> Result<SpeechAnalysisModelDescriptor, String> {
    speech_analysis::delete_model(&app, model_id)
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
