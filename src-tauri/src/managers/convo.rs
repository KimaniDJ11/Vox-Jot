use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use uuid::Uuid;

use crate::convo::{
    ConvoActionSuggestion, ConvoAudioCapture, ConvoAvailability, ConvoContextItem, ConvoMode,
    ConvoSessionState, ConvoTranscriptItem, ConvoTurnResponse, PersonaPlexHelper,
    SettingsCatalogEntry,
};
use crate::settings::{self, PostProcessProvider};

/// Maximum file size (bytes) when reading a single file as context.
const MAX_FILE_SIZE: u64 = 100_000;
/// Maximum number of files when reading a folder as context.
const MAX_FOLDER_FILES: usize = 50;
/// Maximum total bytes when reading a folder as context.
const MAX_FOLDER_TOTAL_BYTES: u64 = 500_000;

// ── LLM message type ───────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
struct LlmMessage {
    role: String,
    content: String,
}

pub struct ConvoController {
    app_handle: AppHandle,
    sessions: Mutex<HashMap<String, ConvoSessionState>>,
    pub helper: PersonaPlexHelper,
    pub audio_capture: ConvoAudioCapture,
}

impl ConvoController {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            sessions: Mutex::new(HashMap::new()),
            helper: PersonaPlexHelper::new(app_handle),
            audio_capture: ConvoAudioCapture::new(),
        }
    }

    pub fn check_availability(&self) -> ConvoAvailability {
        if !PersonaPlexHelper::is_available() {
            return ConvoAvailability {
                available: false,
                reason: Some(
                    "PersonaPlex conversation requires Apple Silicon (M1 or later).".to_string(),
                ),
                helper_running: false,
            };
        }
        let helper_running = self.helper.is_running();
        ConvoAvailability {
            available: true,
            reason: None,
            helper_running,
        }
    }

    pub fn prepare_session(
        &self,
        mode: ConvoMode,
        voice_id: Option<String>,
        context: Option<String>,
    ) -> Result<ConvoSessionState, String> {
        let session_id = Uuid::new_v4().to_string();
        let state = ConvoSessionState {
            session_id: session_id.clone(),
            mode,
            transcript: Vec::new(),
            context_description: context.unwrap_or_default(),
            voice_id: voice_id.unwrap_or_else(|| "NATM0".to_string()),
            speak_replies: true,
            context_items: Vec::new(),
            suggested_actions: Vec::new(),
        };
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions.insert(session_id, state.clone());
        Ok(state)
    }

    pub async fn send_text_turn(
        &self,
        session_id: &str,
        text: &str,
        context: Option<&str>,
    ) -> Result<ConvoTurnResponse, String> {
        // Record user message
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let user_item = ConvoTranscriptItem {
            id: Uuid::new_v4().to_string(),
            role: "user".to_string(),
            text: text.to_string(),
            timestamp_ms: now,
            has_audio: false,
        };

        // Snapshot session state and build messages while holding the lock briefly
        let (session_snapshot, messages) = {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| format!("Session {} not found", session_id))?;
            if let Some(context_text) = context.filter(|value| !value.trim().is_empty()) {
                session.context_description = context_text.to_string();
            }
            session.transcript.push(user_item);
            let snapshot = session.clone();
            let msgs = self.build_messages(&snapshot, text);
            (snapshot, msgs)
        };

        // Call LLM
        let raw_response = self.call_llm(messages).await?;

        // Parse response for special markers
        let suggested_actions = self.parse_actions(&raw_response, &session_snapshot.mode);

        let assistant_text = self.clean_response_for_display(&raw_response, &session_snapshot.mode);

        let assistant_item = ConvoTranscriptItem {
            id: Uuid::new_v4().to_string(),
            role: "assistant".to_string(),
            text: assistant_text.clone(),
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            has_audio: false,
        };

        // Store assistant message and update suggested actions
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(session) = sessions.get_mut(session_id) {
                session.transcript.push(assistant_item);
                session.suggested_actions = suggested_actions.clone();
            }
        }

        Ok(ConvoTurnResponse {
            user_text: Some(text.to_string()),
            assistant_text,
            audio_base64: None,
            session_id: session_id.to_string(),
            suggested_actions,
        })
    }

    /// Send an audio turn to the PersonaPlex helper and get back audio + text.
    /// This records the user's transcribed text and the assistant reply in the session.
    pub async fn send_audio_turn(
        &self,
        session_id: &str,
        wav_bytes: Vec<u8>,
        context: Option<&str>,
    ) -> Result<ConvoTurnResponse, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        // Get voice from session
        let voice_id = {
            let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let session = sessions
                .get(session_id)
                .ok_or_else(|| format!("Session {} not found", session_id))?;
            if let Some(ctx) = context.filter(|v| !v.trim().is_empty()) {
                // We'll update context below after dropping the lock
                let _ = ctx;
            }
            session.voice_id.clone()
        };

        // Update context if provided
        if let Some(ctx) = context.filter(|v| !v.trim().is_empty()) {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(session) = sessions.get_mut(session_id) {
                session.context_description = ctx.to_string();
            }
        }

        let user_transcription = self.helper.transcribe_audio(wav_bytes.clone()).await.ok();
        let pp_response = self.helper.send_audio_turn(wav_bytes, &voice_id).await?;

        let user_text = user_transcription
            .map(|response| response.text)
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| "[voice input]".to_string());
        let assistant_text = pp_response
            .transcript
            .clone()
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| "[audio reply]".to_string());

        let user_item = ConvoTranscriptItem {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            text: user_text.clone(),
            timestamp_ms: now,
            has_audio: true,
        };

        let assistant_item = ConvoTranscriptItem {
            id: uuid::Uuid::new_v4().to_string(),
            role: "assistant".to_string(),
            text: assistant_text.clone(),
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            has_audio: pp_response.audio_base64.is_some(),
        };

        // Store in session
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(session) = sessions.get_mut(session_id) {
                session.transcript.push(user_item);
                session.transcript.push(assistant_item);
            }
        }

        Ok(ConvoTurnResponse {
            user_text: Some(user_text),
            assistant_text,
            audio_base64: pp_response.audio_base64,
            session_id: session_id.to_string(),
            suggested_actions: Vec::new(),
        })
    }

    pub fn reset_session(&self, session_id: &str) -> Result<ConvoSessionState, String> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        session.transcript.clear();
        session.suggested_actions.clear();
        session.context_items.clear();
        session.context_description.clear();
        Ok(session.clone())
    }

    pub fn get_session(&self, session_id: &str) -> Result<ConvoSessionState, String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Session {} not found", session_id))
    }

    pub fn update_speak_replies(&self, session_id: &str, enabled: bool) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        session.speak_replies = enabled;
        Ok(())
    }

    // ── Context management ──────────────────────────────────────────────────

    pub fn add_context_item(
        &self,
        session_id: &str,
        label: &str,
        source_type: &str,
        content: &str,
    ) -> Result<ConvoContextItem, String> {
        let item = ConvoContextItem {
            id: Uuid::new_v4().to_string(),
            label: label.to_string(),
            source_type: source_type.to_string(),
            content: content.to_string(),
            char_count: content.len(),
        };
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        session.context_items.push(item.clone());
        Ok(item)
    }

    pub fn remove_context_item(&self, session_id: &str, item_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        let before = session.context_items.len();
        session.context_items.retain(|i| i.id != item_id);
        if session.context_items.len() == before {
            return Err(format!("Context item {} not found", item_id));
        }
        Ok(())
    }

    pub fn list_context_items(&self, session_id: &str) -> Result<Vec<ConvoContextItem>, String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        Ok(session.context_items.clone())
    }

    // ── File / folder reading ───────────────────────────────────────────────

    pub fn read_file_as_context(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<ConvoContextItem, String> {
        let file_path = std::path::Path::new(path);
        if !file_path.exists() {
            return Err(format!("File not found: {}", path));
        }
        let metadata = std::fs::metadata(file_path)
            .map_err(|e| format!("Cannot read file metadata: {}", e))?;
        if metadata.len() > MAX_FILE_SIZE {
            return Err(format!(
                "File too large ({} bytes, max {})",
                metadata.len(),
                MAX_FILE_SIZE
            ));
        }
        let content = std::fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read file (not valid UTF-8?): {}", e))?;

        let label = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        self.add_context_item(session_id, &label, "file", &content)
    }

    pub fn read_folder_as_context(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<ConvoContextItem>, String> {
        let dir_path = std::path::Path::new(path);
        if !dir_path.is_dir() {
            return Err(format!("Not a directory: {}", path));
        }

        let mut items = Vec::new();
        let mut total_bytes: u64 = 0;
        let mut file_count: usize = 0;

        self.walk_folder_files(dir_path, &mut |file_path| {
            if file_count >= MAX_FOLDER_FILES || total_bytes >= MAX_FOLDER_TOTAL_BYTES {
                return;
            }
            // Skip hidden files
            if file_path
                .file_name()
                .map(|n| n.to_string_lossy().starts_with('.'))
                .unwrap_or(false)
            {
                return;
            }
            // Skip likely binary files by extension
            let ext = file_path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let binary_exts = [
                "png",
                "jpg",
                "jpeg",
                "gif",
                "bmp",
                "ico",
                "webp",
                "mp3",
                "mp4",
                "wav",
                "ogg",
                "avi",
                "mov",
                "zip",
                "tar",
                "gz",
                "rar",
                "7z",
                "exe",
                "dll",
                "so",
                "dylib",
                "bin",
                "o",
                "a",
                "wasm",
                "pdf",
                "onnx",
                "pt",
                "pth",
                "safetensors",
            ];
            if binary_exts.contains(&ext.as_str()) {
                return;
            }

            let metadata = match std::fs::metadata(file_path) {
                Ok(m) => m,
                Err(_) => return,
            };
            if metadata.len() > MAX_FILE_SIZE {
                return;
            }
            if total_bytes + metadata.len() > MAX_FOLDER_TOTAL_BYTES {
                return;
            }
            let content = match std::fs::read_to_string(file_path) {
                Ok(c) => c,
                Err(_) => return, // skip non-UTF-8 files
            };

            total_bytes += metadata.len();
            file_count += 1;

            let label = file_path
                .strip_prefix(dir_path)
                .unwrap_or(file_path)
                .to_string_lossy()
                .to_string();

            items.push((label, content));
        });

        let mut context_items = Vec::new();
        for (label, content) in items {
            let item = self.add_context_item(session_id, &label, "folder", &content)?;
            context_items.push(item);
        }
        Ok(context_items)
    }

    fn walk_folder_files(&self, dir: &std::path::Path, callback: &mut dyn FnMut(&std::path::Path)) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip hidden directories
                if path
                    .file_name()
                    .map(|n| n.to_string_lossy().starts_with('.'))
                    .unwrap_or(false)
                {
                    continue;
                }
                self.walk_folder_files(&path, callback);
            } else {
                callback(&path);
            }
        }
    }

    // ── Settings catalog ────────────────────────────────────────────────────

    pub fn generate_settings_catalog(&self) -> Result<Vec<SettingsCatalogEntry>, String> {
        let settings = settings::get_settings(&self.app_handle);
        let mut catalog = Vec::new();

        macro_rules! entry {
            ($key:expr, $label:expr, $desc:expr, $val:expr, $cat:expr, $section:expr) => {
                catalog.push(SettingsCatalogEntry {
                    key: $key.to_string(),
                    label: $label.to_string(),
                    description: $desc.to_string(),
                    current_value: $val.to_string(),
                    category: $cat.to_string(),
                    setting_section: $section.to_string(),
                });
            };
        }

        entry!(
            "push_to_talk",
            "Push to Talk",
            "Hold the shortcut key to record instead of toggle.",
            settings.push_to_talk,
            "Dictation",
            "shortcuts"
        );
        entry!(
            "audio_feedback",
            "Audio Feedback",
            "Play sounds when recording starts and stops.",
            settings.audio_feedback,
            "Dictation",
            "general"
        );
        entry!(
            "paste_method",
            "Paste Method",
            "How transcribed text is inserted into the active application.",
            format!("{:?}", settings.paste_method),
            "Output",
            "output-paste"
        );
        entry!(
            "clipboard_handling",
            "Clipboard Handling",
            "Whether to copy transcription to clipboard.",
            format!("{:?}", settings.clipboard_handling),
            "Output",
            "output-paste"
        );
        entry!(
            "post_process_enabled",
            "Post-Processing",
            "Enable LLM-based text improvement after transcription.",
            settings.post_process_enabled,
            "AI",
            "ai-setup"
        );
        entry!(
            "post_process_provider_id",
            "Post-Process Provider",
            "The LLM provider used for post-processing.",
            settings.post_process_provider_id,
            "AI",
            "ai-setup"
        );
        entry!(
            "overlay_position",
            "Overlay Position",
            "Where the recording overlay appears on screen.",
            format!("{:?}", settings.overlay_position),
            "Appearance",
            "general"
        );
        entry!(
            "recording_overlay_style",
            "Recording Overlay Style",
            "Compact (minimal) or detailed (full level meters + partial text).",
            format!("{:?}", settings.recording_overlay_style),
            "Appearance",
            "general"
        );
        entry!(
            "translate_to_english",
            "Translate to English",
            "Automatically translate speech to English.",
            settings.translate_to_english,
            "Translation",
            "translation"
        );
        entry!(
            "tts_enabled",
            "Text-to-Speech",
            "Enable text-to-speech playback.",
            settings.tts_enabled,
            "Listen",
            "voice-design"
        );
        entry!(
            "tts_auto_readback_mode",
            "Auto-Readback Mode",
            "When to automatically read back transcriptions.",
            format!("{:?}", settings.tts_auto_readback_mode),
            "Listen",
            "voice-design"
        );
        entry!(
            "auto_submit",
            "Auto Submit",
            "Automatically press Enter after pasting transcription.",
            settings.auto_submit,
            "Output",
            "output-paste"
        );
        entry!(
            "mute_while_recording",
            "Mute While Recording",
            "Mute system audio during recording.",
            settings.mute_while_recording,
            "Recording",
            "recording-devices"
        );
        entry!(
            "audio_ducking_enabled",
            "Audio Ducking",
            "Lower other apps' volume while recording.",
            settings.audio_ducking_enabled,
            "Recording",
            "recording-devices"
        );
        entry!(
            "start_hidden",
            "Start Hidden",
            "Launch the app without showing the main window.",
            settings.start_hidden,
            "App",
            "general"
        );
        entry!(
            "autostart_enabled",
            "Launch at Login",
            "Automatically start Vox Jot when you log in.",
            settings.autostart_enabled,
            "App",
            "general"
        );
        entry!(
            "show_tray_icon",
            "Show Tray Icon",
            "Display the Vox Jot icon in the system tray.",
            settings.show_tray_icon,
            "App",
            "general"
        );
        entry!(
            "snippets_enabled",
            "Phrase Keys",
            "Enable text expansion with phrase key shortcuts.",
            settings.snippets_enabled,
            "Refine",
            "phrase-keys"
        );
        entry!(
            "correction_tracking_enabled",
            "Correction Tracking",
            "Track corrections you make to improve future transcriptions.",
            settings.correction_tracking_enabled,
            "Corrections",
            "corrections-settings"
        );
        entry!(
            "local_privacy_mode",
            "Local Privacy Mode",
            "Force all AI processing to use local-only providers.",
            settings.local_privacy_mode,
            "Privacy",
            "privacy"
        );
        entry!(
            "debug_mode",
            "Debug Mode",
            "Show additional diagnostic information.",
            settings.debug_mode,
            "Diagnostics",
            "diagnostics"
        );

        Ok(catalog)
    }

    // ── LLM integration ─────────────────────────────────────────────────────

    fn build_system_prompt(&self, session: &ConvoSessionState, user_text: &str) -> String {
        match session.mode {
            ConvoMode::Selection => {
                let context = if !session.context_items.is_empty() {
                    session
                        .context_items
                        .iter()
                        .map(|c| c.content.as_str())
                        .collect::<Vec<_>>()
                        .join("\n\n")
                } else {
                    session.context_description.clone()
                };
                format!(
                    "You are helping the user understand or discuss the following selected text. \
                     Be concise and helpful, and stay grounded in the selected text.\n\n---\nSelected text:\n{}",
                    context
                )
            }
            ConvoMode::SettingsCoach => {
                let catalog = self.generate_settings_catalog().unwrap_or_default();
                let catalog_json =
                    serde_json::to_string_pretty(&catalog).unwrap_or_else(|_| "[]".to_string());
                format!(
                    "You are Vox Jot's settings coach. Help the user find and configure settings. \
                     When mentioning a specific setting, wrap the setting section ID in \
                     [[SETTING:section_id]] markers. Stay grounded in the catalog below and do \
                     not invent settings.\n\n---\nSettings catalog:\n{}",
                    catalog_json
                )
            }
            ConvoMode::FilesContext => {
                let context = self.build_files_context(session, user_text);
                let ctx = if context.is_empty() {
                    session.context_description.clone()
                } else {
                    context
                };
                format!(
                    "You are helping the user discuss files and text they've provided. Answer \
                     questions based on the provided context.\n\n---\nContext:\n{}",
                    ctx
                )
            }
        }
    }

    fn build_messages(&self, session: &ConvoSessionState, _user_text: &str) -> Vec<LlmMessage> {
        let mut messages = Vec::new();

        // System prompt
        messages.push(LlmMessage {
            role: "system".to_string(),
            content: self.build_system_prompt(session, _user_text),
        });

        // Multi-turn conversation history
        for item in &session.transcript {
            messages.push(LlmMessage {
                role: item.role.clone(),
                content: item.text.clone(),
            });
        }

        messages
    }

    fn get_provider_and_credentials(
        &self,
    ) -> Result<(PostProcessProvider, String, String), String> {
        let settings = settings::get_settings(&self.app_handle);

        let provider = settings
            .active_post_process_provider()
            .cloned()
            .ok_or_else(|| {
                "No post-process provider configured. Please set up an LLM provider in Settings > Models & AI.".to_string()
            })?;

        let api_key =
            crate::secret_store::get_post_process_api_key(&settings.post_process_provider_id)
                .map_err(|error| {
                    format!(
                        "Failed to load secure API key for provider '{}': {}",
                        settings.post_process_provider_id, error
                    )
                })?
                .unwrap_or_default();

        let model = settings
            .post_process_models
            .get(&settings.post_process_provider_id)
            .cloned()
            .unwrap_or_default();

        if model.is_empty() {
            return Err(
                "No model configured for the active provider. Please select a model in Settings > Models & AI.".to_string(),
            );
        }

        Ok((provider, api_key, model))
    }

    async fn call_llm(&self, messages: Vec<LlmMessage>) -> Result<String, String> {
        let (provider, api_key, model) = self.get_provider_and_credentials()?;

        let base_url = provider.base_url.trim_end_matches('/');
        let url = format!("{}/chat/completions", base_url);

        // Build headers using the same pattern as llm_client.rs
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );
        headers.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_static(
                "Vox Jot/1.0 (+https://www.iriedinamik.org/voxjot/)",
            ),
        );

        if !api_key.is_empty() {
            if provider.id == "anthropic" {
                headers.insert(
                    "x-api-key",
                    reqwest::header::HeaderValue::from_str(&api_key)
                        .map_err(|e| format!("Invalid API key: {}", e))?,
                );
                headers.insert(
                    "anthropic-version",
                    reqwest::header::HeaderValue::from_static("2023-06-01"),
                );
            } else {
                headers.insert(
                    reqwest::header::AUTHORIZATION,
                    reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key))
                        .map_err(|e| format!("Invalid API key: {}", e))?,
                );
            }
        }

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let resp = client
            .post(&url)
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 2048,
            }))
            .send()
            .await
            .map_err(|e| format!("LLM request failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let error_text = resp
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error response".to_string());
            return Err(format!(
                "LLM API returned status {}: {}",
                status, error_text
            ));
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

        body["choices"][0]["message"]["content"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| "No content in LLM response".to_string())
    }

    // ── Response parsing ────────────────────────────────────────────────────

    fn parse_actions(&self, response: &str, mode: &ConvoMode) -> Vec<ConvoActionSuggestion> {
        let mut actions = Vec::new();

        // Parse [[SETTING:section_id]] markers (Settings Coach mode)
        if *mode == ConvoMode::SettingsCoach {
            let re_setting = regex::Regex::new(r"\[\[SETTING:([^\]]+)\]\]").ok();
            if let Some(re) = re_setting {
                for cap in re.captures_iter(response) {
                    if let Some(section_id) = cap.get(1) {
                        actions.push(ConvoActionSuggestion {
                            action_type: "open_setting".to_string(),
                            label: format!("Open {}", section_id.as_str()),
                            payload: section_id.as_str().to_string(),
                        });
                    }
                }
            }
        }

        actions
    }

    fn clean_response_for_display(&self, response: &str, mode: &ConvoMode) -> String {
        let mut cleaned = response.to_string();

        if *mode == ConvoMode::SettingsCoach {
            if let Ok(re) = regex::Regex::new(r"\s*\[\[SETTING:[^\]]+\]\]") {
                cleaned = re.replace_all(&cleaned, "").to_string();
            }
        }

        let cleaned = cleaned.trim().to_string();
        if !cleaned.is_empty() {
            return cleaned;
        }
        response.trim().to_string()
    }

    fn build_files_context(&self, session: &ConvoSessionState, user_text: &str) -> String {
        if session.context_items.is_empty() {
            return String::new();
        }

        let combined_chars = session
            .context_items
            .iter()
            .map(|item| item.char_count)
            .sum::<usize>();

        let items = if combined_chars <= 8_000 {
            session
                .context_items
                .iter()
                .map(|item| format!("### {}\n{}", item.label, item.content))
                .collect::<Vec<_>>()
        } else {
            self.retrieve_relevant_chunks(session, user_text)
        };

        items.join("\n\n---\n\n")
    }

    fn retrieve_relevant_chunks(
        &self,
        session: &ConvoSessionState,
        user_text: &str,
    ) -> Vec<String> {
        let query_terms = tokenize_terms(user_text);
        let mut scored_chunks = Vec::new();

        for item in &session.context_items {
            for chunk in chunk_text(&item.content, 1_000) {
                let chunk_terms = tokenize_terms(&chunk);
                let score = query_terms
                    .iter()
                    .filter(|term| chunk_terms.contains(*term))
                    .count();
                scored_chunks.push((score, format!("### {}\n{}", item.label, chunk)));
            }
        }

        scored_chunks.sort_by(|a, b| b.0.cmp(&a.0));

        let selected = scored_chunks
            .into_iter()
            .filter(|(score, _)| *score > 0)
            .take(6)
            .map(|(_, chunk)| chunk)
            .collect::<Vec<_>>();

        if selected.is_empty() {
            session
                .context_items
                .iter()
                .take(3)
                .map(|item| format!("### {}\n{}", item.label, item.content))
                .collect()
        } else {
            selected
        }
    }
}

fn chunk_text(text: &str, chunk_size: usize) -> Vec<String> {
    if text.len() <= chunk_size {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n") {
        if current.len() + paragraph.len() + 2 > chunk_size && !current.is_empty() {
            chunks.push(current.trim().to_string());
            current.clear();
        }

        if paragraph.len() > chunk_size {
            let chars = paragraph.chars().collect::<Vec<_>>();
            let mut start = 0;
            while start < chars.len() {
                let end = (start + chunk_size).min(chars.len());
                chunks.push(chars[start..end].iter().collect());
                start = end;
            }
            continue;
        }

        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(paragraph);
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    chunks
}

fn tokenize_terms(text: &str) -> std::collections::HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|term| term.len() >= 3)
        .map(|term| term.to_lowercase())
        .collect()
}
