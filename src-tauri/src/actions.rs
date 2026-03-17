#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::correction_tracker::span::InsertionMethod;
use crate::correction_tracker::store::CorrectionStore;
use crate::correction_tracker::InsertedSpanTracker;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::post_processing::{
    apply_personal_dictionary, build_correction_bias_prompt, detect_post_process_edits,
    get_merged_dictionary, ActiveAppContext, PostProcessMode, PostProcessPreviewPayload,
    PostProcessResult, PreviewManager,
};
use crate::settings::{
    get_settings, post_process_provider_is_local, AppSettings, AutoSubmitKey,
    APPLE_INTELLIGENCE_PROVIDER_ID,
};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::TranscriptionCoordinator;
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, warn};
use once_cell::sync::Lazy;
use serde::Serialize;
use specta::Type;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes — whether it completes normally or panics.
struct FinishGuard(AppHandle);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
    rewrite_selection: bool,
}

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

struct PostProcessExecution {
    result: PostProcessResult,
    prompt_used: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PostProcessPass {
    Pass1,
    Pass2,
    Command,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct PostProcessRouteDebug {
    pub route: String,
    pub word_count: usize,
    pub has_correction_cue: bool,
    pub has_list_cue: bool,
    pub has_paragraph_cue: bool,
    pub has_transform_cue: bool,
    pub has_technical_tokens: bool,
    pub looks_incomplete: bool,
    pub score: i32,
}

#[derive(Debug, Clone)]
struct RouteFeatures {
    word_count: usize,
    has_correction_cue: bool,
    has_list_cue: bool,
    has_paragraph_cue: bool,
    has_transform_cue: bool,
    has_technical_tokens: bool,
    looks_incomplete: bool,
}

#[derive(Debug, Clone)]
struct ResolvedToneContext {
    active_app_context: ActiveAppContext,
    tone_id: String,
    instruction: String,
}

fn first_match_index(text: &str, patterns: &[&str]) -> Option<usize> {
    patterns
        .iter()
        .filter_map(|pattern| text.find(pattern))
        .min()
}

fn maybe_apply_verification_request_fallback(raw_text: &str, final_text: &str) -> Option<String> {
    let normalized_raw = normalize_match_text(raw_text);
    let normalized_final = normalize_match_text(final_text);
    let starts_like_request = normalized_raw.starts_with("required verification request")
        || normalized_raw.starts_with("required verifications request");
    let likely_unstructured = normalized_final == normalized_raw
        || normalized_final.contains(" i meant ")
        || !final_text
            .lines()
            .any(|line| line.trim_start().starts_with("* "));

    if !starts_like_request || !likely_unstructured {
        return None;
    }

    let mut items: Vec<(usize, &'static str)> = Vec::new();

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &[
            "government-issued id",
            "government issued id",
            "government issue id",
        ],
    ) {
        items.push((pos, "Government-issued ID"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &["conduct in-person meeting", "conduct in person meeting"],
    ) {
        items.push((pos, "Conduct in-person meeting"));
    }

    if let Some(pos) = first_match_index(&normalized_raw, &["employment verification"]) {
        items.push((pos, "Employment verification"));
    }

    if let Some(pos) = first_match_index(&normalized_raw, &["income documentation"]) {
        items.push((pos, "Income documentation"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &["personal references", "personal reference"],
    ) {
        items.push((pos, "Personal references"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &[
            "previous landlord reference",
            "i meant previous landlord reference",
        ],
    ) {
        items.push((pos, "Previous landlord reference"));
    } else if let Some(pos) = first_match_index(&normalized_raw, &["previous reference"]) {
        items.push((pos, "Previous reference"));
    }

    if let Some(pos) = first_match_index(&normalized_raw, &["credit check"]) {
        items.push((pos, "Credit check"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &["social security verification", "security verification"],
    ) {
        items.push((pos, "Social security verification"));
    }

    if items.len() < 3 {
        return None;
    }

    items.sort_by_key(|(pos, _)| *pos);
    items.dedup_by(|a, b| a.1 == b.1);

    let bullets = items
        .into_iter()
        .map(|(_, item)| format!("* {}", item))
        .collect::<Vec<_>>()
        .join("\n");

    Some(format!("Required Verification Request:\n{}", bullets))
}

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

fn strip_spoken_suffix(input: &str, suffix: &str) -> Option<String> {
    let candidate = input
        .trim_end()
        .trim_end_matches(|c: char| matches!(c, '.' | ',' | '!' | '?' | ';' | ':'));

    if candidate.len() < suffix.len() {
        return None;
    }

    let start = candidate.len() - suffix.len();
    let tail = candidate.get(start..)?;
    if !tail.eq_ignore_ascii_case(suffix) {
        return None;
    }

    let raw_prefix = candidate.get(..start)?;
    if let Some(last) = raw_prefix.chars().last() {
        if !last.is_whitespace() && !matches!(last, ',' | ':' | ';' | '-' | '(' | '[') {
            return None;
        }
    }

    let prefix = raw_prefix.trim_end();
    Some(prefix.trim_end_matches([',', ':', ';']).trim().to_string())
}

fn extract_spoken_submit_command(text: &str) -> (String, Option<AutoSubmitKey>) {
    let candidates = [
        ("send with control enter", AutoSubmitKey::CtrlEnter),
        ("send with ctrl enter", AutoSubmitKey::CtrlEnter),
        ("press control enter", AutoSubmitKey::CtrlEnter),
        ("press ctrl enter", AutoSubmitKey::CtrlEnter),
        ("send with command enter", AutoSubmitKey::CmdEnter),
        ("send with cmd enter", AutoSubmitKey::CmdEnter),
        ("press command enter", AutoSubmitKey::CmdEnter),
        ("press cmd enter", AutoSubmitKey::CmdEnter),
        ("press enter", AutoSubmitKey::Enter),
        ("hit enter", AutoSubmitKey::Enter),
        ("send message", AutoSubmitKey::Enter),
        ("and send", AutoSubmitKey::Enter),
        ("and submit", AutoSubmitKey::Enter),
        ("submit", AutoSubmitKey::Enter),
        ("send", AutoSubmitKey::Enter),
    ];

    for (phrase, key) in candidates {
        if let Some(stripped) = strip_spoken_suffix(text, phrase) {
            if !stripped.is_empty() {
                return (stripped, Some(key));
            }
        }
    }

    (text.to_string(), None)
}

fn app_display_name(context: &ActiveAppContext) -> &str {
    if context.localized_name.trim().is_empty() {
        &context.bundle_id
    } else {
        &context.localized_name
    }
}

fn resolve_tone_context(
    settings: &AppSettings,
    active_app_context: Option<&ActiveAppContext>,
) -> Option<ResolvedToneContext> {
    if !settings.app_aware_tone_enabled {
        return None;
    }

    let active_app_context = active_app_context?;
    let mapping = settings.app_tone_mapping(&active_app_context.bundle_id)?;
    let tone = settings.tone_definition(&mapping.tone_id)?;

    Some(ResolvedToneContext {
        active_app_context: active_app_context.clone(),
        tone_id: tone.id.clone(),
        instruction: tone.instruction.clone(),
    })
}

fn build_post_process_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    final_text: String,
    dictionary_hits: Vec<String>,
    active_app_context: Option<ActiveAppContext>,
    applied_tone_id: Option<String>,
) -> PostProcessResult {
    let final_text = strip_invisible_chars(&final_text);
    let final_text =
        maybe_apply_verification_request_fallback(raw_text, &final_text).unwrap_or(final_text);
    let edits = detect_post_process_edits(raw_text, &normalized_text, &final_text);

    PostProcessResult {
        raw_text: raw_text.to_string(),
        normalized_text,
        final_text,
        dictionary_hits,
        edits,
        mode: settings.post_process_mode,
        active_app_context,
        applied_tone_id,
    }
}

fn build_apple_system_prompt(
    settings: &AppSettings,
    tone_context: Option<&ResolvedToneContext>,
    _route: PostProcessPass,
    rewrite_strength: u8,
    _conservative_gate_active: bool,
) -> String {
    let mode_label = match settings.post_process_mode {
        PostProcessMode::Literal => "literal",
        PostProcessMode::Intent => "intent",
    };
    let tone_rule = if let Some(tone_context) = tone_context {
        format!(
            "- {} (tone: {}): {}",
            app_display_name(&tone_context.active_app_context),
            tone_context.tone_id,
            tone_context.instruction
        )
    } else {
        "- Notes (tone: neutral): Keep the tone neutral and close to the speaker's original wording."
            .to_string()
    };

    format!(
        "You are a local dictation post-processor.\n\
\n\
Task:\n\
Clean speech-to-text output while preserving the speaker's meaning exactly.\n\
\n\
Active mode: {mode_label}\n\
Rewrite strength: {} (0=conservative, 2=aggressive)\n\
\n\
Return only the final text.\n\
\n\
Rules:\n\
- Preserve meaning and the speaker's intended correction.\n\
- Never invent facts, headings, commentary, explanations, or extra detail.\n\
- Apply personal dictionary spellings exactly when they appear in the transcript.\n\
- Preserve names, acronyms, URLs, emails, filenames, code terms, variable names, product names, unusual proper nouns, and technical jargon unless the speaker clearly corrected them.\n\
- Preserve technical punctuation and symbols when they are likely intentional, including slashes, backslashes, underscores, hyphens, periods, colons, parentheses, brackets, quotes, @ symbols, plus signs, minus signs, and file extensions.\n\
- Fix capitalization, punctuation, spacing, paragraph breaks, and formatting only when the intended structure is reasonably clear.\n\
- Interpret spoken correction cues such as \"scratch that\", \"actually\", \"I mean\", \"correction\", \"wait no\", \"rather\", and natural restarts, and keep only the corrected intent.\n\
- Remove filler words, false starts, and repeated fragments only when doing so does not change meaning.\n\
- If the transcript is already clear, make the smallest possible changes.\n\
- Use stronger rewrites only when clear structure, correction, or formatting cues are present.\n\
- If multiple interpretations are possible, choose the most conservative one.\n\
- If the utterance seems incomplete, ambiguous, cut off, or mid-thought, avoid heavy rewriting and stay close to the transcript.\n\
- Structure rules:\n\
- Do not force bullets, numbering, or heavy formatting unless structure is clearly implied.\n\
- If the transcript contains an introductory sentence that implies a list, followed by two or more short parallel items, format the items as a bullet list and end the intro sentence with a colon.\n\
- Treat groceries, packing items, tasks, ingredients, feature lists, names, and short noun phrases as strong list candidates when grouped together.\n\
- You may infer list item boundaries from repeated short noun phrases even when the transcript has little or no punctuation.\n\
- Treat joiners such as \"and\", \"also\", and \"plus\" as list separators when the content is clearly list-like.\n\
- When you turn an intro sentence plus short items into an unordered list, keep the intro sentence and use `* ` bullets for each item.\n\
- Example: \"I want to pick up a few things from the store. Bread, potato chips, ice cream.\" -> \"I want to pick up a few things from the store:\\n* Bread\\n* Potato chips\\n* Ice cream\"\n\
- Example: \"Required verifications Request Government Issue ID conduct in person meeting employment verification income documentation personal reference previous reference I meant previous landlord reference and credit check also social security verification\" -> \"Required Verification Request:\\n* Government-issued ID\\n* Conduct in-person meeting\\n* Employment verification\\n* Income documentation\\n* Personal references\\n* Previous landlord reference\\n* Credit check\\n* Social security verification\"\n\
- If sequence words or ordered cues appear, such as \"one\", \"two\", \"three\", \"first\", \"second\", \"next\", or \"finally\", prefer a numbered list when the content is clearly step-like or ordered.\n\
- If the user clearly dictated separate thoughts, insert paragraph breaks.\n\
- If the user says \"new line\", \"new paragraph\", \"skip a line\", or equivalent phrasing, reflect that structure in the final text when it fits naturally.\n\
- If punctuation words are spoken explicitly, such as \"period\", \"comma\", \"question mark\", \"exclamation point\", or \"colon\", respect them when they appear intentional.\n\
- If the content is ordinary prose, keep it as ordinary prose rather than converting it into a list.\n\
- Mode behavior:\n\
- In literal mode, preserve wording as much as possible.\n\
- In intent mode, lightly clean for readability while preserving tone, specificity, and meaning.\n\
- In intent mode, convert obvious rambling speech into clean written text only when the meaning is unmistakable.\n\
- Do not summarize, shorten, or formalize unless the transcript itself clearly signals that intent.\n\
- Correction behavior:\n\
- When the speaker revises a phrase mid-sentence, keep the final intended wording and remove the abandoned wording.\n\
- When the speaker restates something more clearly, prefer the later phrasing if it is obviously a replacement rather than an addition.\n\
- Treat a later contradiction or restart as a replacement when the intent is clear, including patterns like \"...? No, ...\" and \"..., no, ...\".\n\
- Example: \"Hi Greg, let's connect soon. Are you available Friday at three o'clock? No, I'm at four o'clock.\" -> \"Hi Greg, let's connect soon. Are you available Friday at four o'clock?\"\n\
- When a correction cue appears inside a list or sequence of short items, replace only the item being corrected and keep the surrounding items.\n\
- Example: \"Personnel Reference Previous Reference I meant previous landlord reference credit check social security verification\" -> \"Personnel Reference Previous Landlord Reference Credit Check Social Security Verification\"\n\
- Example: \"Required verifications Request Government Issue ID conduct in person meeting employment verification income documentation personal reference previous reference I meant previous landlord reference and credit check also social security verification\" -> \"Required Verification Request:\\n* Government-issued ID\\n* Conduct in-person meeting\\n* Employment verification\\n* Income documentation\\n* Personal references\\n* Previous landlord reference\\n* Credit check\\n* Social security verification\"\n\
- If a correction is unclear, preserve the original wording instead of guessing.\n\
- Safety behavior:\n\
- Do not guess unknown jargon.\n\
- Do not replace uncommon words with more common words unless the speaker clearly intended that.\n\
- Do not convert uncertain technical text into plain English.\n\
- Do not add markdown headings, explanations, labels, or surrounding quotation marks.\n\
\n\
Active app guidance:\n\
- {tone_rule}\n\
\n\
- Output:\n\
- Return only the final processed text.\n\
- Do not explain changes.\n\
- Do not mention rules.",
        rewrite_strength,
    )
}

fn build_apple_user_content(
    settings: &AppSettings,
    normalized_text: &str,
    rewrite_strength: u8,
    conservative_gate_active: bool,
) -> String {
    let mode_label = match settings.post_process_mode {
        PostProcessMode::Literal => "literal",
        PostProcessMode::Intent => "intent",
    };

    let dictionary_section = if settings.personal_dictionary.is_empty() {
        "Personal dictionary:\n- (none)".to_string()
    } else {
        let entries = settings
            .personal_dictionary
            .iter()
            .map(|entry| {
                let qualifier = if entry.exact_only {
                    " [exact only]"
                } else {
                    ""
                };
                format!("- {} => {}{}", entry.spoken, entry.written, qualifier)
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!("Personal dictionary:\n{}", entries)
    };

    let conservative_gate_note = if conservative_gate_active {
        "Utterance boundary confidence: low. Keep edits minimal and conservative."
    } else {
        "Utterance boundary confidence: sufficient for normal formatting rules."
    };

    format!(
        "Mode: {mode_label}\n\
Rewrite strength: {}\n\
{conservative_gate_note}\n\
\n\
Special handling:\n\
- If the transcript corrects itself with a later \"no\", \"sorry\", \"actually\", or similar restart, keep only the corrected wording.\n\
- If the transcript has an intro sentence followed by short list items, keep the intro sentence and format the items as `* ` bullets.\n\
- If a correction happens inside a list of short items, replace only the corrected item and keep the items after it.\n\
- You may infer list boundaries from repeated short phrases even when commas are missing, especially for request, checklist, or verification-style content.\n\
\n\
{dictionary_section}\n\
\n\
Transcript:\n{normalized_text}",
        rewrite_strength
    )
}

fn build_non_apple_tone_instruction(tone_context: Option<&ResolvedToneContext>) -> Option<String> {
    tone_context.map(|tone| {
        format!(
            "Apply this tone guidance for the active app {} (tone: {}): {}",
            app_display_name(&tone.active_app_context),
            tone.tone_id,
            tone.instruction
        )
    })
}

fn contains_any_ci(text: &str, cues: &[&str]) -> bool {
    let lower = text.to_ascii_lowercase();
    cues.iter().any(|cue| lower.contains(cue))
}

fn normalize_match_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn has_spoken_correction_restart(text: &str) -> bool {
    let normalized = normalize_match_text(text);
    let direct_cues = [
        "scratch that",
        "i mean",
        "correction",
        "actually",
        "wait no",
        "rather",
    ];
    if direct_cues.iter().any(|cue| normalized.contains(cue)) {
        return true;
    }

    let restart_markers = [
        ", no, ",
        ". no, ",
        "? no, ",
        "! no, ",
        "; no, ",
        ": no, ",
        ", sorry, ",
        ". sorry, ",
        "? sorry, ",
        "! sorry, ",
        "; sorry, ",
        ": sorry, ",
    ];

    restart_markers
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn looks_like_short_item_series(text: &str) -> bool {
    let items: Vec<String> = text
        .split(',')
        .map(|item| {
            item.trim()
                .trim_matches(|c: char| matches!(c, '.' | ',' | ';' | ':' | '!' | '?'))
                .to_string()
        })
        .filter(|item| !item.is_empty())
        .collect();

    if items.len() < 3 {
        return false;
    }

    items.iter().all(|item| {
        let word_count = item.split_whitespace().count();
        word_count > 0
            && word_count <= 4
            && !contains_any_ci(item, &[" and ", " or ", " because ", " but ", " if "])
    })
}

fn has_intro_plus_short_items(text: &str) -> bool {
    let intro_cues = [
        "list",
        "things",
        "items",
        "store",
        "shopping",
        "grocery",
        "groceries",
        "verification",
        "verifications",
        "request",
        "pick up",
        "buy",
        "bring",
        "pack",
        "ingredients",
        "tasks",
        "to do",
        "todo",
        "goals",
    ];

    [".", ":", "\n"].iter().any(|separator| {
        let Some((intro, tail)) = text.split_once(separator) else {
            return false;
        };

        let intro = intro.trim();
        let tail = tail.trim();
        if intro.split_whitespace().count() < 4 || tail.is_empty() {
            return false;
        }

        contains_any_ci(intro, &intro_cues) && looks_like_short_item_series(tail)
    })
}

fn has_technical_tokens(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let strong_tokens = [
        "http://", "https://", "www.", "@", "src/", ".tsx", ".ts", ".rs",
    ];
    if strong_tokens.iter().any(|token| lower.contains(token)) {
        return true;
    }

    text.chars().any(|c| {
        matches!(
            c,
            '/' | '\\' | '_' | '{' | '}' | '[' | ']' | '<' | '>' | '`'
        )
    })
}

fn looks_incomplete_utterance(transcription: &str) -> bool {
    let trimmed = transcription.trim();
    if trimmed.is_empty() {
        return false;
    }

    let has_terminal_boundary = trimmed
        .chars()
        .last()
        .map(|c| matches!(c, '.' | '!' | '?'))
        .unwrap_or(false);
    if has_terminal_boundary {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    let trailing_fragment_cues = [" and", " or", " to", " for", " with", " because", " but"];
    trailing_fragment_cues
        .iter()
        .any(|cue| lower.ends_with(cue))
}

fn extract_route_features(transcription: &str) -> RouteFeatures {
    let trimmed = transcription.trim();
    let word_count = trimmed.split_whitespace().count();

    let list_cues = [
        "grocery list",
        "shopping list",
        "packing list",
        "required verification",
        "required verifications",
        "verification request",
        "verification requests",
        "first",
        "second",
        "third",
        "next",
        "then",
        "one",
        "two",
        "three",
    ];
    let paragraph_cues = ["new line", "new paragraph", "skip a line"];
    let transform_cues = [
        "make this shorter",
        "translate this",
        "turn this into",
        "rewrite this",
        "summarize this",
    ];

    RouteFeatures {
        word_count,
        has_correction_cue: has_spoken_correction_restart(trimmed),
        has_list_cue: contains_any_ci(trimmed, &list_cues) || has_intro_plus_short_items(trimmed),
        has_paragraph_cue: contains_any_ci(trimmed, &paragraph_cues),
        has_transform_cue: contains_any_ci(trimmed, &transform_cues),
        has_technical_tokens: has_technical_tokens(trimmed),
        looks_incomplete: looks_incomplete_utterance(trimmed),
    }
}

fn route_score(features: &RouteFeatures) -> i32 {
    let mut score = 0;
    if features.has_correction_cue {
        score += 3;
    }
    if features.has_list_cue {
        score += 3;
    }
    if features.has_paragraph_cue {
        score += 2;
    }
    if features.word_count >= 12 {
        score += 1;
    }
    if features.has_technical_tokens {
        score -= 2;
    }
    score
}

fn choose_post_process_pass(transcription: &str) -> PostProcessPass {
    let trimmed = transcription.trim();
    if trimmed.is_empty() {
        return PostProcessPass::Pass1;
    }

    let features = extract_route_features(trimmed);

    if features.has_transform_cue {
        return PostProcessPass::Command;
    }
    if features.looks_incomplete {
        return PostProcessPass::Pass1;
    }
    if features.word_count <= 6
        && !features.has_correction_cue
        && !features.has_list_cue
        && !features.has_paragraph_cue
    {
        return PostProcessPass::Pass1;
    }

    let score = route_score(&features);

    if score >= 3 {
        PostProcessPass::Pass2
    } else {
        PostProcessPass::Pass1
    }
}

pub fn analyze_post_process_route(transcription: &str) -> PostProcessRouteDebug {
    let features = extract_route_features(transcription);
    let route = choose_post_process_pass(transcription);
    let score = route_score(&features);

    let route_label = match route {
        PostProcessPass::Pass1 => "pass1",
        PostProcessPass::Pass2 => "pass2",
        PostProcessPass::Command => "command",
    }
    .to_string();

    PostProcessRouteDebug {
        route: route_label,
        word_count: features.word_count,
        has_correction_cue: features.has_correction_cue,
        has_list_cue: features.has_list_cue,
        has_paragraph_cue: features.has_paragraph_cue,
        has_transform_cue: features.has_transform_cue,
        has_technical_tokens: features.has_technical_tokens,
        looks_incomplete: features.looks_incomplete,
        score,
    }
}

fn has_any_case_insensitive(text: &str, cues: &[&str]) -> bool {
    let lower = text.to_ascii_lowercase();
    cues.iter().any(|cue| lower.contains(cue))
}

fn should_force_conservative_rewrite(transcription: &str) -> bool {
    let trimmed = transcription.trim();
    if trimmed.is_empty() {
        return false;
    }

    let structure_cues = [
        "first", "second", "third", "next", "then", "step", "steps", "bullet", "numbered", "list",
    ];
    if has_spoken_correction_restart(trimmed)
        || has_any_case_insensitive(trimmed, &structure_cues)
        || has_intro_plus_short_items(trimmed)
    {
        return false;
    }

    let word_count = trimmed.split_whitespace().count();
    let has_terminal_boundary = trimmed
        .chars()
        .last()
        .map(|c| matches!(c, '.' | '!' | '?'))
        .unwrap_or(false);
    let has_newline = trimmed.contains('\n');
    let trailing_fragment_cues = [" and", " or", " to", " for", " with", " because"];
    let has_trailing_fragment = trailing_fragment_cues
        .iter()
        .any(|cue| trimmed.to_ascii_lowercase().ends_with(cue));

    if has_terminal_boundary || has_newline {
        return false;
    }

    word_count <= 8 || has_trailing_fragment
}

fn live_partial_config_for_model(model_id: &str) -> (u64, usize, usize) {
    let lower = model_id.to_ascii_lowercase();

    if lower.contains("moonshine") && lower.contains("stream") {
        return (450, 8_000, 2_400);
    }
    if lower.contains("moonshine") {
        return (650, 12_000, 3_200);
    }
    if lower.contains("whisper") {
        return (1_200, 20_000, 6_400);
    }
    if lower.contains("parakeet") {
        return (900, 16_000, 4_800);
    }

    (900, 16_000, 4_800)
}

fn build_apple_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    final_text: String,
    dictionary_hits: Vec<String>,
    system_prompt: String,
    active_app_context: Option<ActiveAppContext>,
    applied_tone_id: Option<String>,
) -> PostProcessExecution {
    PostProcessExecution {
        result: build_post_process_result(
            settings,
            raw_text,
            normalized_text,
            final_text,
            dictionary_hits,
            active_app_context,
            applied_tone_id,
        ),
        prompt_used: Some(system_prompt),
    }
}

fn apple_fallback_result(
    settings: &AppSettings,
    raw_text: &str,
    normalized_text: String,
    dictionary_hits: Vec<String>,
    active_app_context: Option<ActiveAppContext>,
) -> Option<PostProcessExecution> {
    if settings.fallback_to_raw_on_failure {
        Some(build_apple_result(
            settings,
            raw_text,
            normalized_text.clone(),
            normalized_text,
            dictionary_hits,
            build_apple_system_prompt(
                settings,
                None,
                PostProcessPass::Pass1,
                settings.max_rewrite_strength,
                false,
            ),
            active_app_context,
            None,
        ))
    } else {
        None
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn capture_active_app_context(settings: &AppSettings) -> Option<ActiveAppContext> {
    if !settings.app_aware_tone_enabled {
        return None;
    }

    match apple_intelligence::get_frontmost_app_context() {
        Ok(context) => Some(context),
        Err(err) => {
            warn!("Failed to detect frontmost app for app-aware tone: {}", err);
            None
        }
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn capture_active_app_context(_settings: &AppSettings) -> Option<ActiveAppContext> {
    None
}

fn preview_app_context_from_override(
    settings: &AppSettings,
    app_bundle_id_override: Option<&str>,
) -> Option<ActiveAppContext> {
    let bundle_id = app_bundle_id_override?.trim();
    if bundle_id.is_empty() {
        return None;
    }

    if let Some(mapping) = settings.app_tone_mapping(bundle_id) {
        return Some(ActiveAppContext {
            bundle_id: mapping.bundle_id.clone(),
            localized_name: mapping.app_name.clone(),
        });
    }

    Some(ActiveAppContext {
        bundle_id: bundle_id.to_string(),
        localized_name: String::new(),
    })
}

async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
    active_app_context: Option<ActiveAppContext>,
) -> Option<PostProcessExecution> {
    let route_features = extract_route_features(transcription);
    let selected_pass = choose_post_process_pass(transcription);
    let force_conservative_rewrite = should_force_conservative_rewrite(transcription);
    let prefers_stronger_list_rewrite = route_features.has_list_cue
        && (route_features.has_correction_cue || route_features.word_count >= 10);
    let effective_rewrite_strength = if force_conservative_rewrite {
        0
    } else {
        match selected_pass {
            PostProcessPass::Pass1 => settings.max_rewrite_strength.min(1),
            PostProcessPass::Pass2 => {
                if prefers_stronger_list_rewrite {
                    settings.max_rewrite_strength.max(2)
                } else {
                    settings.max_rewrite_strength
                }
            }
            PostProcessPass::Command => 2,
        }
    };

    if force_conservative_rewrite {
        debug!(
            "Applying conservative post-process safeguard for low-boundary-confidence utterance"
        );
    }

    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    if settings.local_privacy_mode && !post_process_provider_is_local(&provider) {
        warn!(
            "Local privacy mode blocked non-local provider '{}'; skipping post-processing",
            provider.id
        );
        return None;
    }

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        let dictionary_result =
            apply_personal_dictionary(transcription, &settings.personal_dictionary);
        let tone_context = resolve_tone_context(settings, active_app_context.as_ref());
        let system_prompt = build_apple_system_prompt(
            settings,
            tone_context.as_ref(),
            selected_pass,
            effective_rewrite_strength,
            force_conservative_rewrite,
        );
        let user_content = build_apple_user_content(
            settings,
            &dictionary_result.text,
            effective_rewrite_strength,
            force_conservative_rewrite,
        );
        let applied_tone_id = tone_context.as_ref().map(|tone| tone.tone_id.clone());

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                debug!("Apple Intelligence selected but not currently available on this device");
                return apple_fallback_result(
                    settings,
                    transcription,
                    dictionary_result.text,
                    dictionary_result.hits,
                    active_app_context,
                );
            }

            return match apple_intelligence::process_text_with_system_prompt(
                &system_prompt,
                &user_content,
                0,
            ) {
                Ok(result) => {
                    let final_text = strip_invisible_chars(&result);
                    if final_text.trim().is_empty() {
                        debug!("Apple Intelligence returned an empty response");
                        apple_fallback_result(
                            settings,
                            transcription,
                            dictionary_result.text,
                            dictionary_result.hits,
                            active_app_context,
                        )
                    } else {
                        debug!(
                            "Apple Intelligence post-processing succeeded. Output length: {} chars",
                            final_text.len()
                        );
                        Some(build_apple_result(
                            settings,
                            transcription,
                            dictionary_result.text,
                            final_text,
                            dictionary_result.hits,
                            system_prompt.clone(),
                            active_app_context,
                            applied_tone_id,
                        ))
                    }
                }
                Err(err) => {
                    error!("Apple Intelligence post-processing failed: {}", err);
                    apple_fallback_result(
                        settings,
                        transcription,
                        dictionary_result.text,
                        dictionary_result.hits,
                        active_app_context,
                    )
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            debug!("Apple Intelligence provider selected on unsupported platform");
            return apple_fallback_result(
                settings,
                transcription,
                dictionary_result.text,
                dictionary_result.hits,
                active_app_context,
            );
        }
    }

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            debug!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let tone_context = resolve_tone_context(settings, active_app_context.as_ref());
    let mut base_system_prompt = build_apple_system_prompt(
        settings,
        tone_context.as_ref(),
        selected_pass,
        effective_rewrite_strength,
        force_conservative_rewrite,
    );
    let custom_prompt = build_system_prompt(&prompt);
    if !custom_prompt.is_empty() {
        base_system_prompt.push_str("\n\nAdditional custom instructions:\n");
        base_system_prompt.push_str(&custom_prompt);
    }

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = base_system_prompt.clone();
        let user_content = transcription.to_string();

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt.clone()),
            Some(json_schema),
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(PostProcessExecution {
                                result: build_post_process_result(
                                    settings,
                                    transcription,
                                    transcription.to_string(),
                                    result.clone(),
                                    Vec::new(),
                                    None,
                                    None,
                                ),
                                prompt_used: Some(system_prompt.clone()),
                            });
                        } else {
                            error!("Structured output response missing 'transcription' field");
                            let fallback = strip_invisible_chars(&content);
                            return Some(PostProcessExecution {
                                result: build_post_process_result(
                                    settings,
                                    transcription,
                                    transcription.to_string(),
                                    fallback.clone(),
                                    Vec::new(),
                                    None,
                                    None,
                                ),
                                prompt_used: Some(system_prompt.clone()),
                            });
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse structured output JSON: {}. Returning raw content.",
                            e
                        );
                        let fallback = strip_invisible_chars(&content);
                        return Some(PostProcessExecution {
                            result: build_post_process_result(
                                settings,
                                transcription,
                                transcription.to_string(),
                                fallback.clone(),
                                Vec::new(),
                                None,
                                None,
                            ),
                            prompt_used: Some(system_prompt.clone()),
                        });
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = format!("{}\n\nTranscript:\n{}", base_system_prompt, transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(&provider, api_key, &model, processed_prompt)
        .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(PostProcessExecution {
                result: build_post_process_result(
                    settings,
                    transcription,
                    transcription.to_string(),
                    content.clone(),
                    Vec::new(),
                    None,
                    None,
                ),
                prompt_used: Some(prompt),
            })
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
    }
}

async fn rewrite_selected_text(
    settings: &AppSettings,
    selected_text: &str,
    instruction: &str,
) -> Option<String> {
    let provider = settings.active_post_process_provider()?.clone();
    if settings.local_privacy_mode && !post_process_provider_is_local(&provider) {
        warn!(
            "Local privacy mode blocked non-local provider '{}' for rewrite-selection",
            provider.id
        );
        return None;
    }

    let user_prompt = format!(
        "Rewrite the selected text based on the spoken instructions. Return only the rewritten text.\n\nSpoken instructions:\n{}\n\nSelected text:\n{}",
        instruction.trim(),
        selected_text
    );

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        let system_prompt = "You are a local writing assistant. Rewrite the provided text based on spoken instructions while preserving factual meaning. Return only the rewritten text with no explanations.";

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return match apple_intelligence::process_text_with_system_prompt(
                system_prompt,
                &user_prompt,
                0,
            ) {
                Ok(output) => Some(strip_invisible_chars(&output)),
                Err(err) => {
                    error!("Apple Intelligence rewrite-selection failed: {}", err);
                    None
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return None;
        }
    }

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        return None;
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    crate::llm_client::send_chat_completion(&provider, api_key, &model, user_prompt)
        .await
        .ok()
        .flatten()
        .map(|text| strip_invisible_chars(&text))
}

async fn maybe_preview_post_process_result(
    app: &AppHandle,
    settings: &AppSettings,
    result: &PostProcessResult,
) -> Option<String> {
    if !settings.show_preview_before_paste {
        return Some(result.final_text.clone());
    }

    let preview_manager = app.state::<PreviewManager>();
    let (request_id, rx) = preview_manager.create_request();
    let payload = PostProcessPreviewPayload {
        request_id: request_id.clone(),
        source_text: result.normalized_text.clone(),
        preview_text: result.final_text.clone(),
    };

    crate::show_main_window(app);
    if let Err(err) = app.emit("post-process-preview-request", payload) {
        error!("Failed to emit post-process preview request: {}", err);
        preview_manager.clear_request(&request_id);
        return Some(result.final_text.clone());
    }

    match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(resolution)) => {
            if resolution.accepted {
                Some(
                    resolution
                        .final_text
                        .unwrap_or_else(|| result.final_text.clone()),
                )
            } else {
                None
            }
        }
        Ok(Err(_)) => {
            warn!("Preview request '{}' closed before resolution", request_id);
            None
        }
        Err(_) => {
            warn!("Preview request '{}' timed out", request_id);
            preview_manager.clear_request(&request_id);
            None
        }
    }
}

pub(crate) async fn preview_post_process(
    app: &AppHandle,
    transcription: &str,
    app_bundle_id_override: Option<&str>,
) -> Result<PostProcessResult, String> {
    let settings = get_settings(app);
    let base_text = maybe_convert_chinese_variant(&settings, transcription)
        .await
        .unwrap_or_else(|| transcription.to_string());
    let active_app_context = preview_app_context_from_override(&settings, app_bundle_id_override);

    post_process_transcription(&settings, &base_text, active_app_context)
        .await
        .map(|execution| execution.result)
        .ok_or_else(|| "Post-processing did not produce a result".to_string())
}

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        let settings = get_settings(app);
        if (self.post_process || self.rewrite_selection) && !settings.post_process_enabled {
            debug!(
                "Ignoring post-process binding '{}' because post-processing is disabled",
                binding_id
            );
            return;
        }

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        tm.initiate_model_load();

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Get the microphone mode to determine audio feedback timing
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_error: Option<String> = None;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            if let Err(e) = rm.try_start_recording(&binding_id) {
                debug!("Recording failed: {}", e);
                recording_error = Some(e);
            }
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            match rm.try_start_recording(&binding_id) {
                Ok(()) => {
                    debug!("Recording started in {:?}", recording_start_time.elapsed());
                    // Small delay to ensure microphone stream is active
                    let app_clone = app.clone();
                    let rm_clone = Arc::clone(&rm);
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        debug!("Handling delayed audio feedback/mute sequence");
                        // Helper handles disabled audio feedback by returning early, so we reuse it
                        // to keep mute sequencing consistent in every mode.
                        play_feedback_sound_blocking(&app_clone, SoundType::Start);
                        rm_clone.apply_mute();
                    });
                }
                Err(e) => {
                    debug!("Failed to start recording: {}", e);
                    recording_error = Some(e);
                }
            }
        }

        if recording_error.is_none() {
            let ah_partial = app.clone();
            let rm_partial = Arc::clone(&rm);
            let tm_partial = Arc::clone(&tm);
            let binding_id_partial = binding_id.clone();
            let selected_model_id = settings.selected_model.clone();
            std::thread::spawn(move || {
                let mut last_snapshot_len = 0usize;
                let mut last_partial = String::new();
                let (base_interval_ms, min_samples, min_growth) =
                    live_partial_config_for_model(&selected_model_id);
                let mut interval_ms = base_interval_ms;

                while rm_partial.is_recording() {
                    std::thread::sleep(std::time::Duration::from_millis(interval_ms));

                    let Some(snapshot) = rm_partial.snapshot_recording(&binding_id_partial) else {
                        break;
                    };

                    if snapshot.len() < min_samples
                        || snapshot.len() <= last_snapshot_len + min_growth
                    {
                        continue;
                    }

                    let snapshot_len = snapshot.len();
                    match tm_partial.transcribe(snapshot) {
                        Ok(text) => {
                            let trimmed = text.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            let cleaned = strip_invisible_chars(trimmed);
                            if cleaned == last_partial {
                                continue;
                            }
                            last_partial = cleaned.clone();
                            last_snapshot_len = snapshot_len;
                            interval_ms = base_interval_ms;
                            crate::overlay::emit_partial_transcription(&ah_partial, &cleaned);
                        }
                        Err(_) => {
                            // Ignore transient model/loading errors during live preview.
                            interval_ms = (interval_ms + 200).min(1_800);
                        }
                    }
                }

                crate::overlay::emit_partial_transcription(&ah_partial, "");
            });

            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        } else {
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
            utils::hide_recording_overlay(app);
            change_tray_icon(app, TrayIconState::Idle);
            if let Some(err) = recording_error {
                let _ = app.emit("recording-error", err);
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let post_process = self.post_process;
        let rewrite_selection = self.rewrite_selection;

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard(ah.clone());
            crate::overlay::emit_partial_transcription(&ah, "");
            let binding_id = binding_id.clone(); // Clone for the inner async task
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let stop_recording_time = Instant::now();
            if let Some(samples) = rm.stop_recording(&binding_id) {
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                let transcription_time = Instant::now();
                let samples_clone = samples.clone(); // Clone for history saving
                match tm.transcribe(samples) {
                    Ok(transcription) => {
                        debug!(
                            "Transcription completed in {:?}: '{}'",
                            transcription_time.elapsed(),
                            transcription
                        );
                        if !transcription.is_empty() {
                            let settings = get_settings(&ah);
                            let mut final_text = transcription.clone();
                            let mut post_processed_text: Option<String> = None;
                            let mut post_process_prompt: Option<String> = None;

                            // First, check if Chinese variant conversion is needed
                            if let Some(converted_text) =
                                maybe_convert_chinese_variant(&settings, &transcription).await
                            {
                                final_text = converted_text;
                            }

                            // Then apply LLM post-processing if this is the post-process hotkey
                            // Uses final_text which may already have Chinese conversion applied
                            let should_post_process =
                                post_process && settings.post_process_enabled && !rewrite_selection;
                            let active_app_context = if should_post_process {
                                capture_active_app_context(&settings)
                            } else {
                                None
                            };
                            if should_post_process {
                                show_processing_overlay(&ah);
                            }

                            // Merge auto-learned corrections into the personal dictionary
                            let mut effective_settings = settings.clone();
                            if settings.auto_apply_corrections {
                                if let Some(correction_store) =
                                    ah.try_state::<Arc<CorrectionStore>>()
                                {
                                    match correction_store.get_active_corrections(
                                        settings.correction_min_frequency,
                                        settings.correction_min_confidence,
                                    ) {
                                        Ok(auto_entries) if !auto_entries.is_empty() => {
                                            debug!(
                                                "Merging {} auto-corrections into personal dictionary",
                                                auto_entries.len()
                                            );
                                            effective_settings.personal_dictionary =
                                                get_merged_dictionary(
                                                    &settings.personal_dictionary,
                                                    &auto_entries,
                                                );
                                        }
                                        Ok(_) => {}
                                        Err(e) => {
                                            warn!("Failed to load auto-corrections: {}", e);
                                        }
                                    }
                                }
                            }

                            let processed = if should_post_process {
                                post_process_transcription(
                                    &effective_settings,
                                    &final_text,
                                    active_app_context,
                                )
                                .await
                            } else {
                                None
                            };
                            let mut text_to_paste = Some(final_text.clone());
                            if let Some(processed) = processed {
                                let preview_text = if should_post_process {
                                    maybe_preview_post_process_result(
                                        &ah,
                                        &settings,
                                        &processed.result,
                                    )
                                    .await
                                } else {
                                    Some(processed.result.final_text.clone())
                                };

                                if let Some(preview_text) = preview_text {
                                    final_text = preview_text;
                                    text_to_paste = Some(final_text.clone());
                                } else {
                                    text_to_paste = None;
                                    final_text = processed.result.final_text.clone();
                                }

                                post_processed_text = Some(final_text.clone());
                                post_process_prompt = processed.prompt_used;
                            } else if final_text != transcription {
                                // Chinese conversion was applied but no LLM post-processing
                                post_processed_text = Some(final_text.clone());
                            }

                            if rewrite_selection {
                                match utils::capture_selected_text(&ah) {
                                    Ok(Some(selected_text)) => {
                                        if let Some(rewritten) = rewrite_selected_text(
                                            &settings,
                                            &selected_text,
                                            &final_text,
                                        )
                                        .await
                                        {
                                            final_text = rewritten;
                                            post_processed_text = Some(final_text.clone());
                                        } else {
                                            warn!(
                                                "Rewrite-selection failed; keeping selected text unchanged"
                                            );
                                            text_to_paste = None;
                                        }
                                    }
                                    Ok(None) => {
                                        warn!(
                                            "Rewrite-selection shortcut used without selected text"
                                        );
                                        text_to_paste = None;
                                    }
                                    Err(err) => {
                                        error!("Failed to capture selected text: {}", err);
                                        text_to_paste = None;
                                    }
                                }
                            }

                            let (cleaned_text, submit_override) =
                                extract_spoken_submit_command(&final_text);
                            if let Some(text) = text_to_paste.as_mut() {
                                *text = cleaned_text;
                            }

                            // Save to history after preview resolution so stored text matches
                            // the final pasted output when preview editing is enabled.
                            let hm_clone = Arc::clone(&hm);
                            let transcription_for_history = transcription.clone();
                            let post_processed_for_history = post_processed_text.clone();
                            let post_process_prompt_for_history = post_process_prompt.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = hm_clone
                                    .save_transcription(
                                        samples_clone,
                                        transcription_for_history,
                                        post_processed_for_history,
                                        post_process_prompt_for_history,
                                    )
                                    .await
                                {
                                    error!("Failed to save transcription to history: {}", e);
                                }
                            });

                            if let Some(ref text_to_paste) = text_to_paste {
                                // Start correction monitoring if enabled
                                let correction_settings = get_settings(&ah);
                                if correction_settings.correction_tracking_enabled {
                                    if let Some(span_tracker) =
                                        ah.try_state::<InsertedSpanTracker>()
                                    {
                                        if let Some(correction_store) =
                                            ah.try_state::<Arc<CorrectionStore>>()
                                        {
                                            let insertion_method = match correction_settings
                                                .paste_method
                                            {
                                                crate::settings::PasteMethod::Direct => {
                                                    InsertionMethod::DirectType
                                                }
                                                crate::settings::PasteMethod::ExternalScript => {
                                                    InsertionMethod::ExternalScript
                                                }
                                                _ => InsertionMethod::Clipboard,
                                            };

                                            let app_id = active_app_context
                                                .as_ref()
                                                .map(|c| c.bundle_id.clone());
                                            let app_name_val = active_app_context
                                                .as_ref()
                                                .map(|c| c.localized_name.clone());

                                            span_tracker.record_and_start_monitoring(
                                                text_to_paste.clone(),
                                                app_id,
                                                app_name_val,
                                                insertion_method,
                                                (*correction_store).clone(),
                                                correction_settings
                                                    .correction_monitoring_delay_secs,
                                            );
                                        }
                                    }
                                }

                                // Paste the final text (either processed or original)
                                let text_for_paste = text_to_paste.clone();
                                let ah_clone = ah.clone();
                                let paste_time = Instant::now();
                                let submit_override = submit_override;
                                ah.run_on_main_thread(move || {
                                    let paste_result = if let Some(submit_key) = submit_override {
                                        utils::paste_with_submit_override(
                                            text_for_paste,
                                            ah_clone.clone(),
                                            Some(submit_key),
                                        )
                                    } else {
                                        utils::paste(text_for_paste, ah_clone.clone())
                                    };

                                    match paste_result {
                                        Ok(()) => debug!(
                                            "Text pasted successfully in {:?}",
                                            paste_time.elapsed()
                                        ),
                                        Err(e) => error!("Failed to paste transcription: {}", e),
                                    }
                                    // Hide the overlay after transcription is complete
                                    utils::hide_recording_overlay(&ah_clone);
                                    change_tray_icon(&ah_clone, TrayIconState::Idle);
                                })
                                .unwrap_or_else(|e| {
                                    error!("Failed to run paste on main thread: {:?}", e);
                                    utils::hide_recording_overlay(&ah);
                                    change_tray_icon(&ah, TrayIconState::Idle);
                                });
                            } else {
                                debug!("Post-process preview was cancelled; skipping paste");
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            }
                        } else {
                            utils::hide_recording_overlay(&ah);
                            change_tray_icon(&ah, TrayIconState::Idle);
                        }
                    }
                    Err(err) => {
                        debug!("Global Shortcut Transcription error: {}", err);
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                    }
                }
            } else {
                debug!("No samples retrieved from recording stop");
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{
        analyze_post_process_route, apple_fallback_result, build_apple_system_prompt,
        build_apple_user_content, build_non_apple_tone_instruction, choose_post_process_pass,
        extract_spoken_submit_command, live_partial_config_for_model,
        maybe_apply_verification_request_fallback, preview_app_context_from_override,
        resolve_tone_context, should_force_conservative_rewrite, PostProcessPass,
    };
    use crate::post_processing::{ActiveAppContext, DictionaryEntry, PostProcessMode};
    use crate::settings::{get_default_settings, AutoSubmitKey};

    #[test]
    fn apple_prompt_uses_selected_mode_and_strength() {
        let mut settings = get_default_settings();
        settings.post_process_mode = PostProcessMode::Intent;
        settings.max_rewrite_strength = 2;

        let prompt = build_apple_system_prompt(
            &settings,
            None,
            PostProcessPass::Pass2,
            settings.max_rewrite_strength,
            false,
        );

        assert!(prompt.contains("Active mode: intent"));
        assert!(prompt.contains("Rewrite strength: 2"));
        assert!(prompt.contains("Return only the final text."));
        assert!(prompt.contains("scratch that"));
        assert!(prompt.contains("Are you available Friday at four o'clock?"));
        assert!(prompt.contains("I want to pick up a few things from the store"));
        assert!(prompt
            .contains("Previous Landlord Reference Credit Check Social Security Verification"));
        assert!(prompt.contains("Required Verification Request:"));
    }

    #[test]
    fn apple_user_content_includes_dictionary_entries() {
        let mut settings = get_default_settings();
        settings.personal_dictionary = vec![DictionaryEntry {
            spoken: "swift ui".to_string(),
            written: "SwiftUI".to_string(),
            priority: 0,
            case_sensitive: false,
            exact_only: true,
        }];

        let content = build_apple_user_content(
            &settings,
            "swift ui example",
            settings.max_rewrite_strength,
            false,
        );

        assert!(content.contains("Mode: literal"));
        assert!(content.contains("Special handling:"));
        assert!(content.contains("format the items as `* ` bullets"));
        assert!(content.contains("replace only the corrected item"));
        assert!(content.contains("verification-style content"));
        assert!(content.contains("- swift ui => SwiftUI [exact only]"));
        assert!(content.contains("Transcript:\nswift ui example"));
    }

    #[test]
    fn verification_request_fallback_formats_flat_sequence() {
        let input = "Required verifications Request Government Issue ID conduct in person meeting employment verification income documentation personal reference previous reference I meant previous landlord reference and credit check also security verification";
        let rewritten = maybe_apply_verification_request_fallback(input, input)
            .expect("verification request fallback should trigger");

        assert_eq!(
            rewritten,
            "Required Verification Request:\n* Government-issued ID\n* Conduct in-person meeting\n* Employment verification\n* Income documentation\n* Personal references\n* Previous landlord reference\n* Credit check\n* Social security verification"
        );
    }

    #[test]
    fn verification_request_fallback_skips_unrelated_text() {
        assert!(maybe_apply_verification_request_fallback(
            "Please call me tomorrow morning",
            "Please call me tomorrow morning"
        )
        .is_none());
    }

    #[test]
    fn fallback_only_returns_result_when_enabled() {
        let mut settings = get_default_settings();
        settings.fallback_to_raw_on_failure = true;

        let fallback = apple_fallback_result(
            &settings,
            "raw text",
            "normalized text".to_string(),
            vec!["SwiftUI".to_string()],
            None,
        );
        assert!(fallback.is_some());

        settings.fallback_to_raw_on_failure = false;
        let no_fallback = apple_fallback_result(
            &settings,
            "raw text",
            "normalized text".to_string(),
            vec![],
            None,
        );
        assert!(no_fallback.is_none());
    }

    #[test]
    fn app_aware_tone_prompt_includes_matching_instruction() {
        let mut settings = get_default_settings();
        settings.app_aware_tone_enabled = true;
        let context = ActiveAppContext {
            bundle_id: "com.tinyspeck.slackmacgap".to_string(),
            localized_name: "Slack".to_string(),
        };

        let tone_context = resolve_tone_context(&settings, Some(&context))
            .expect("Slack should resolve to a default tone");
        let prompt = build_apple_system_prompt(
            &settings,
            Some(&tone_context),
            PostProcessPass::Pass2,
            settings.max_rewrite_strength,
            false,
        );

        assert_eq!(tone_context.tone_id, "casual");
        assert!(prompt.contains("tone: casual"));
        assert!(prompt.contains("Slack"));
        assert!(prompt.contains("casual, conversational tone"));
    }

    #[test]
    fn unmatched_app_keeps_neutral_prompt_behavior() {
        let mut settings = get_default_settings();
        settings.app_aware_tone_enabled = true;
        let context = ActiveAppContext {
            bundle_id: "com.example.Unknown".to_string(),
            localized_name: "Unknown".to_string(),
        };

        let tone_context = resolve_tone_context(&settings, Some(&context));
        let prompt = build_apple_system_prompt(
            &settings,
            tone_context.as_ref(),
            PostProcessPass::Pass2,
            settings.max_rewrite_strength,
            false,
        );

        assert!(tone_context.is_none());
        assert!(prompt.contains(
            "Notes (tone: neutral): Keep the tone neutral and close to the speaker's original wording."
        ));
    }

    #[test]
    fn preview_override_uses_mapping_without_live_lookup() {
        let settings = get_default_settings();
        let context = preview_app_context_from_override(&settings, Some("com.apple.mail")).unwrap();

        assert_eq!(context.bundle_id, "com.apple.mail");
        assert_eq!(context.localized_name, "Mail");
    }

    #[test]
    fn spoken_submit_command_is_extracted_from_suffix() {
        let (text, submit) = extract_spoken_submit_command("Thanks for your help and send.");
        assert_eq!(text, "Thanks for your help");
        assert_eq!(submit, Some(AutoSubmitKey::Enter));
    }

    #[test]
    fn spoken_submit_command_respects_ctrl_enter_suffix() {
        let (text, submit) =
            extract_spoken_submit_command("Please revise this sentence press ctrl enter");
        assert_eq!(text, "Please revise this sentence");
        assert_eq!(submit, Some(AutoSubmitKey::CtrlEnter));
    }

    #[test]
    fn non_apple_tone_instruction_contains_app_and_tone() {
        let mut settings = get_default_settings();
        settings.app_aware_tone_enabled = true;
        let context = ActiveAppContext {
            bundle_id: "com.tinyspeck.slackmacgap".to_string(),
            localized_name: "Slack".to_string(),
        };

        let tone_context = resolve_tone_context(&settings, Some(&context)).unwrap();
        let instruction = build_non_apple_tone_instruction(Some(&tone_context)).unwrap();

        assert!(instruction.contains("Slack"));
        assert!(instruction.contains("tone: casual"));
    }

    #[test]
    fn live_partial_config_picks_fast_streaming_profile() {
        let (interval_ms, min_samples, min_growth) =
            live_partial_config_for_model("moonshine-streaming");

        assert_eq!(interval_ms, 450);
        assert_eq!(min_samples, 8_000);
        assert_eq!(min_growth, 2_400);
    }

    #[test]
    fn conservative_rewrite_gate_detects_short_fragment_without_boundary() {
        assert!(should_force_conservative_rewrite(
            "draft email to marketing"
        ));
    }

    #[test]
    fn conservative_rewrite_gate_allows_correction_cue() {
        assert!(!should_force_conservative_rewrite(
            "Actually wait no send this update to product"
        ));
    }

    #[test]
    fn conservative_rewrite_gate_allows_complete_sentence() {
        assert!(!should_force_conservative_rewrite(
            "Please send this to the team after lunch."
        ));
    }

    #[test]
    fn choose_pass_prefers_pass1_for_short_plain_phrase() {
        assert_eq!(
            choose_post_process_pass("sounds good"),
            PostProcessPass::Pass1
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_sequence_cues() {
        assert_eq!(
            choose_post_process_pass(
                "my top goals this week are first finish the report second send the presentation"
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_sentence_level_correction_restart() {
        assert_eq!(
            choose_post_process_pass(
                "Hi Greg, let's connect soon. Are you available Friday at three o'clock? No, I'm at four o'clock."
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_intro_plus_items() {
        assert_eq!(
            choose_post_process_pass(
                "I want to pick up a few things from the store. Bread, potato chips, ice cream."
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_pass2_for_verification_request_list() {
        assert_eq!(
            choose_post_process_pass(
                "Required verifications request government issue ID conduct in person meeting employment verification income documentation"
            ),
            PostProcessPass::Pass2
        );
    }

    #[test]
    fn choose_pass_uses_command_for_transform_intent() {
        assert_eq!(
            choose_post_process_pass("make this shorter and clearer"),
            PostProcessPass::Command
        );
    }

    #[test]
    fn analyze_route_reports_expected_flags() {
        let result = analyze_post_process_route(
            "my top goals this week are first finish the report second send the presentation",
        );

        assert_eq!(result.route, "pass2");
        assert!(result.has_list_cue);
        assert!(!result.has_transform_cue);
        assert!(!result.looks_incomplete);
    }

    #[test]
    fn analyze_route_detects_intro_plus_items_as_list_cue() {
        let result = analyze_post_process_route(
            "I want to pick up a few things from the store. Bread, potato chips, ice cream.",
        );

        assert_eq!(result.route, "pass2");
        assert!(result.has_list_cue);
        assert!(!result.has_transform_cue);
    }

    #[test]
    fn analyze_route_detects_verification_request_as_list_cue() {
        let result = analyze_post_process_route(
            "Required verifications request government issue ID conduct in person meeting employment verification income documentation",
        );

        assert_eq!(result.route, "pass2");
        assert!(result.has_list_cue);
        assert!(!result.has_transform_cue);
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            rewrite_selection: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            rewrite_selection: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "rewrite_selection".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            rewrite_selection: true,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
