use log::debug;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::collections::HashMap;

/// A text expansion snippet: when the trigger phrase is spoken,
/// it gets replaced with the full expansion text.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct Snippet {
    pub id: String,
    pub trigger: String,
    pub expansion: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Default)]
pub struct SnippetContext {
    pub clipboard: Option<String>,
    pub selected_text: Option<String>,
    pub now: Option<chrono::DateTime<chrono::Local>>,
    pub locale: Option<String>,
    pub protect_sensitive_values: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SnippetContextRequirements {
    pub clipboard: bool,
    pub selected_text: bool,
}

#[derive(Debug, Clone, Default)]
pub struct SnippetExpansionResult {
    pub text: String,
    pub hits: Vec<String>,
    pub sensitive_placeholders: HashMap<String, String>,
    pub limit_exceeded: bool,
}

impl SnippetExpansionResult {
    /// Restore any sensitive placeholders (e.g. clipboard content) that were
    /// shielded from remote LLM prompts.
    pub fn restore_sensitive_values(&mut self) {
        for (placeholder, real_value) in &self.sensitive_placeholders {
            self.text = self.text.replace(placeholder, real_value);
        }
    }

    pub fn placeholders_intact_in(&self, text: &str) -> bool {
        self.sensitive_placeholders
            .keys()
            .all(|placeholder| text.match_indices(placeholder).count() == 1)
    }
}

const MAX_IMPORT_SNIPPETS: usize = 1000;
const MAX_TRIGGER_CHARS: usize = 60;
const MAX_EXPANSION_CHARS: usize = 4000;
pub const MAX_RENDERED_SNIPPET_OUTPUT_CHARS: usize = 64_000;

fn variable_name(tag: &str) -> &str {
    tag.split_once(':')
        .map(|(name, _)| name)
        .unwrap_or(tag)
        .trim()
}

pub fn unsupported_template_variables(template: &str) -> Vec<String> {
    let mut unknown = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find("{{") {
        let after_open = &rest[open + 2..];
        let Some(close) = after_open.find("}}") else {
            break;
        };
        let tag = after_open[..close].trim();
        let name = variable_name(tag);
        let valid = matches!(name, "date" | "time" | "clipboard" | "selected_text")
            && (!matches!(name, "clipboard" | "selected_text") || !tag.contains(':'));
        if !valid && !tag.is_empty() && !unknown.iter().any(|item| item == tag) {
            unknown.push(tag.to_string());
        }
        rest = &after_open[close + 2..];
    }
    unknown
}

fn template_requirements(template: &str) -> SnippetContextRequirements {
    let mut requirements = SnippetContextRequirements::default();
    let mut rest = template;
    while let Some(open) = rest.find("{{") {
        let after_open = &rest[open + 2..];
        let Some(close) = after_open.find("}}") else {
            break;
        };
        match after_open[..close].trim() {
            "clipboard" => requirements.clipboard = true,
            "selected_text" => requirements.selected_text = true,
            _ => {}
        }
        rest = &after_open[close + 2..];
    }
    requirements
}

fn localized_date(now: chrono::DateTime<chrono::Local>, locale: Option<&str>) -> String {
    let locale = locale.unwrap_or_default().to_ascii_lowercase();
    if locale.starts_with("en-us") || locale == "en" {
        now.format("%B %-d, %Y").to_string()
    } else if locale.starts_with("zh") || locale.starts_with("ja") {
        now.format("%Y年%-m月%-d日").to_string()
    } else if locale.starts_with("ko") {
        now.format("%Y년 %-m월 %-d일").to_string()
    } else if locale.starts_with("en-gb") {
        now.format("%-d %B %Y").to_string()
    } else if locale.starts_with("de") {
        now.format("%d.%m.%Y").to_string()
    } else if locale.starts_with("fr")
        || locale.starts_with("es")
        || locale.starts_with("it")
        || locale.starts_with("pt")
    {
        now.format("%d/%m/%Y").to_string()
    } else {
        now.format("%Y-%m-%d").to_string()
    }
}

fn localized_time(now: chrono::DateTime<chrono::Local>, locale: Option<&str>) -> String {
    let locale = locale.unwrap_or_default().to_ascii_lowercase();
    if locale.starts_with("en-us") || locale == "en" {
        now.format("%-I:%M %p").to_string()
    } else {
        now.format("%H:%M").to_string()
    }
}

#[derive(Deserialize)]
struct LooseSnippet {
    #[serde(default)]
    id: String,
    #[serde(default, alias = "phrase", alias = "shortcut", alias = "key")]
    trigger: String,
    #[serde(default, alias = "text", alias = "replacement", alias = "value")]
    expansion: String,
    #[serde(default = "default_enabled")]
    enabled: bool,
}

fn import_array_value(value: &Value) -> Option<&Vec<Value>> {
    if let Some(array) = value.as_array() {
        return Some(array);
    }

    value
        .get("snippets")
        .or_else(|| value.get("phraseKeys"))
        .or_else(|| value.get("phrase_keys"))
        .or_else(|| value.get("entries"))
        .and_then(Value::as_array)
}

/// Parse phrase-key imports from Vox Jot exports and common JSON shapes.
///
/// Supported shapes:
/// - `[{"trigger":"my email","expansion":"me@example.com"}]`
/// - `{"snippets":[...]}`
/// - `{"phraseKeys":[...]}`
/// - `{"my email":"me@example.com"}`
pub fn parse_snippet_import_json(json: &str) -> Result<Vec<Snippet>, String> {
    let value: Value = serde_json::from_str(json).map_err(|e| format!("Invalid JSON: {}", e))?;

    let loose_snippets: Vec<LooseSnippet> = if let Some(array) = import_array_value(&value) {
        if array.len() > MAX_IMPORT_SNIPPETS {
            return Err("Import limit is 1,000 phrase keys".to_string());
        }

        array
            .iter()
            .cloned()
            .map(serde_json::from_value)
            .collect::<Result<Vec<LooseSnippet>, _>>()
            .map_err(|e| format!("Invalid phrase key format: {}", e))?
    } else if let Some(object) = value.as_object() {
        if object.len() > MAX_IMPORT_SNIPPETS {
            return Err("Import limit is 1,000 phrase keys".to_string());
        }

        let snippets = object
            .iter()
            .filter_map(|(trigger, expansion)| {
                expansion.as_str().map(|expansion| LooseSnippet {
                    id: String::new(),
                    trigger: trigger.clone(),
                    expansion: expansion.to_string(),
                    enabled: true,
                })
            })
            .collect::<Vec<_>>();
        if snippets.is_empty() && !object.is_empty() {
            return Err("Expected phrase-key object values to be text expansions".to_string());
        }
        snippets
    } else {
        return Err(
            "Expected a JSON array, an object with a snippets array, or a trigger-to-expansion object"
                .to_string(),
        );
    };

    let mut snippets = Vec::new();
    for (index, imported) in loose_snippets.into_iter().enumerate() {
        let trigger = imported.trigger.trim().to_string();
        let expansion = imported.expansion.trim().to_string();
        if trigger.is_empty() || expansion.is_empty() {
            continue;
        }
        if trigger.chars().count() > MAX_TRIGGER_CHARS
            || expansion.chars().count() > MAX_EXPANSION_CHARS
        {
            continue;
        }
        let unsupported = unsupported_template_variables(&expansion);
        if !unsupported.is_empty() {
            return Err(format!(
                "Phrase key '{}' uses unsupported variable(s): {}",
                trigger,
                unsupported.join(", ")
            ));
        }

        let id = if imported.id.trim().is_empty() {
            format!("snippet_import_{}", index)
        } else {
            imported.id.trim().to_string()
        };

        snippets.push(Snippet {
            id,
            trigger,
            expansion,
            enabled: imported.enabled,
        });
    }

    Ok(snippets)
}

/// Strip punctuation from edges of a word for matching purposes.
fn strip_punctuation(s: &str) -> &str {
    let s = s.trim_start_matches(|c: char| c.is_ascii_punctuation());
    s.trim_end_matches(|c: char| c.is_ascii_punctuation())
}

/// Normalize a trigger or text segment for comparison:
/// lowercase and strip punctuation.
fn normalize_for_match(s: &str) -> String {
    s.split_whitespace()
        .map(|w| strip_punctuation(w).to_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Renders dynamic variables within snippet expansions non-recursively.
///
/// Supported variables:
/// - `{{date}}` (default format: `%Y-%m-%d`) or `{{date:%format}}`
/// - `{{time}}` (default format: `%H:%M:%S`) or `{{time:%format}}`
/// - `{{clipboard}}` (evaluates current system clipboard)
/// - `{{selected_text}}` (evaluates current active selection)
pub fn render_template(
    template: &str,
    context: &SnippetContext,
    sensitive_placeholders: &mut HashMap<String, String>,
) -> String {
    let now = context.now.unwrap_or_else(chrono::Local::now);
    let mut result = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start_idx) = rest.find("{{") {
        result.push_str(&rest[..start_idx]);
        let after_open = &rest[start_idx + 2..];
        if let Some(close_idx) = after_open.find("}}") {
            let tag_content = after_open[..close_idx].trim();
            let tag_name = variable_name(tag_content);
            if tag_name == "date" {
                let formatted = if let Some((_, stripped)) = tag_content.split_once(':') {
                    let fmt = stripped.trim();
                    std::panic::catch_unwind(|| now.format(fmt).to_string())
                        .unwrap_or_else(|_| localized_date(now, context.locale.as_deref()))
                } else {
                    localized_date(now, context.locale.as_deref())
                };
                result.push_str(&formatted);
            } else if tag_name == "time" {
                let formatted = if let Some((_, stripped)) = tag_content.split_once(':') {
                    let fmt = stripped.trim();
                    std::panic::catch_unwind(|| now.format(fmt).to_string())
                        .unwrap_or_else(|_| localized_time(now, context.locale.as_deref()))
                } else {
                    localized_time(now, context.locale.as_deref())
                };
                result.push_str(&formatted);
            } else if tag_content == "clipboard" {
                if let Some(ref cb) = context.clipboard {
                    if context.protect_sensitive_values {
                        let placeholder =
                            format!("__VOX_JOT_LOCAL_SLOT_{}__", uuid::Uuid::new_v4().simple());
                        sensitive_placeholders.insert(placeholder.clone(), cb.clone());
                        result.push_str(&placeholder);
                    } else {
                        result.push_str(cb);
                    }
                }
            } else if tag_content == "selected_text" {
                if let Some(ref sel) = context.selected_text {
                    if context.protect_sensitive_values {
                        let placeholder =
                            format!("__VOX_JOT_LOCAL_SLOT_{}__", uuid::Uuid::new_v4().simple());
                        sensitive_placeholders.insert(placeholder.clone(), sel.clone());
                        result.push_str(&placeholder);
                    } else {
                        result.push_str(sel);
                    }
                }
            } else {
                result.push_str("{{");
                result.push_str(tag_content);
                result.push_str("}}");
            }
            rest = &after_open[close_idx + 2..];
        } else {
            result.push_str("{{");
            rest = after_open;
        }
    }
    result.push_str(rest);
    result
}

/// Apply snippet expansions to the given text using default context.
pub fn apply_snippets(text: &str, snippets: &[Snippet]) -> SnippetExpansionResult {
    apply_snippets_with_context(text, snippets, &SnippetContext::default())
}

/// Apply snippet expansions to the given text with dynamic variables evaluated
/// against the provided context.
///
/// Matching is case-insensitive and punctuation-tolerant (a trailing period
/// from STT won't block a match). Longer triggers are tried first to avoid
/// shorter triggers shadowing them.
pub fn apply_snippets_with_context(
    text: &str,
    snippets: &[Snippet],
    context: &SnippetContext,
) -> SnippetExpansionResult {
    if text.trim().is_empty() || snippets.is_empty() {
        return SnippetExpansionResult {
            text: text.to_string(),
            hits: Vec::new(),
            sensitive_placeholders: HashMap::new(),
            limit_exceeded: false,
        };
    }

    // Only consider enabled snippets, sorted by trigger word count descending
    let mut active: Vec<&Snippet> = snippets.iter().filter(|s| s.enabled).collect();
    active.sort_by(|a, b| {
        let a_words = a.trigger.split_whitespace().count();
        let b_words = b.trigger.split_whitespace().count();
        b_words.cmp(&a_words)
    });

    // Pre-compute normalized triggers and their word counts
    let prepared: Vec<(&Snippet, String, usize)> = active
        .iter()
        .map(|s| {
            let norm = normalize_for_match(&s.trigger);
            let wc = norm.split_whitespace().count();
            (*s, norm, wc)
        })
        .collect();

    let max_words = prepared.iter().map(|(_, _, wc)| *wc).max().unwrap_or(1);
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut output = Vec::new();
    let mut hits = Vec::new();
    let mut sensitive_placeholders = HashMap::new();
    let mut output_chars = 0usize;
    let mut i = 0;

    while i < words.len() {
        let mut matched = false;

        // Try longest trigger phrases first
        for window in (1..=max_words).rev() {
            if i + window > words.len() {
                continue;
            }

            let phrase_words = &words[i..i + window];
            let normalized_phrase: String = phrase_words
                .iter()
                .map(|w| strip_punctuation(w).to_lowercase())
                .collect::<Vec<_>>()
                .join(" ");

            for (snippet, norm_trigger, wc) in &prepared {
                if *wc != window {
                    continue;
                }
                if normalized_phrase == *norm_trigger {
                    // Preserve only *extra* edge punctuation the speaker added
                    // around the trigger — e.g., a trailing sentence period.
                    // Punctuation that was part of the trigger itself (e.g.,
                    // the leading apostrophe in "'tis") must not be re-added
                    // in front of the expansion.
                    let first = phrase_words[0];
                    let last = phrase_words[window - 1];
                    let trigger_words: Vec<&str> = snippet.trigger.split_whitespace().collect();
                    let trigger_first = trigger_words.first().copied().unwrap_or("");
                    let trigger_last = trigger_words.last().copied().unwrap_or("");

                    let trigger_leading_count = trigger_first
                        .chars()
                        .take_while(|c| c.is_ascii_punctuation())
                        .count();
                    let trigger_trailing_count = trigger_last
                        .chars()
                        .rev()
                        .take_while(|c| c.is_ascii_punctuation())
                        .count();

                    // Input leading punct = user-added extras prepended *before*
                    // the trigger's own leading punct. Keep only (total - trigger)
                    // chars from the start.
                    let input_leading_count = first
                        .chars()
                        .take_while(|c| c.is_ascii_punctuation())
                        .count();
                    let user_leading_count =
                        input_leading_count.saturating_sub(trigger_leading_count);
                    let leading: String = first.chars().take(user_leading_count).collect();

                    let input_trailing_count = last
                        .chars()
                        .rev()
                        .take_while(|c| c.is_ascii_punctuation())
                        .count();
                    let user_trailing_count =
                        input_trailing_count.saturating_sub(trigger_trailing_count);
                    let trailing_rev: String =
                        last.chars().rev().take(user_trailing_count).collect();
                    let trailing: String = trailing_rev.chars().rev().collect();

                    let rendered_expansion =
                        render_template(&snippet.expansion, context, &mut sensitive_placeholders);
                    let expanded = format!("{}{}{}", leading, rendered_expansion, trailing);
                    let expanded_chars = expanded.chars().count();
                    if output_chars.saturating_add(expanded_chars)
                        > MAX_RENDERED_SNIPPET_OUTPUT_CHARS
                    {
                        return SnippetExpansionResult {
                            text: text.to_string(),
                            hits: Vec::new(),
                            sensitive_placeholders: HashMap::new(),
                            limit_exceeded: true,
                        };
                    }
                    output_chars = output_chars.saturating_add(expanded_chars + 1);
                    output.push(expanded);
                    hits.push(snippet.trigger.clone());
                    debug!(
                        "Snippet expanded: '{}' ({} output characters)",
                        snippet.trigger, expanded_chars
                    );
                    i += window;
                    matched = true;
                    break;
                }
            }

            if matched {
                break;
            }
        }

        if !matched {
            let word = words[i].to_string();
            output_chars = output_chars.saturating_add(word.chars().count() + 1);
            if output_chars > MAX_RENDERED_SNIPPET_OUTPUT_CHARS {
                return SnippetExpansionResult {
                    text: text.to_string(),
                    hits: Vec::new(),
                    sensitive_placeholders: HashMap::new(),
                    limit_exceeded: true,
                };
            }
            output.push(word);
            i += 1;
        }
    }

    let rendered_text = output.join(" ");
    let restored_chars = sensitive_placeholders.iter().fold(
        rendered_text.chars().count(),
        |count, (placeholder, value)| {
            count
                .saturating_sub(placeholder.chars().count())
                .saturating_add(value.chars().count())
        },
    );
    if restored_chars > MAX_RENDERED_SNIPPET_OUTPUT_CHARS {
        return SnippetExpansionResult {
            text: text.to_string(),
            hits: Vec::new(),
            sensitive_placeholders: HashMap::new(),
            limit_exceeded: true,
        };
    }

    SnippetExpansionResult {
        text: rendered_text,
        hits,
        sensitive_placeholders,
        limit_exceeded: false,
    }
}

/// Determine which sensitive sources are needed by snippets that actually
/// match this transcription. This does not read either source.
pub fn required_dynamic_context(text: &str, snippets: &[Snippet]) -> SnippetContextRequirements {
    let matched = apply_snippets(text, snippets);
    let mut requirements = SnippetContextRequirements::default();
    for snippet in snippets.iter().filter(|snippet| {
        matched
            .hits
            .iter()
            .any(|trigger| trigger.eq_ignore_ascii_case(&snippet.trigger))
    }) {
        let next = template_requirements(&snippet.expansion);
        requirements.clipboard |= next.clipboard;
        requirements.selected_text |= next.selected_text;
    }
    requirements
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippet(trigger: &str, expansion: &str) -> Snippet {
        Snippet {
            id: trigger.to_string(),
            trigger: trigger.to_string(),
            expansion: expansion.to_string(),
            enabled: true,
        }
    }

    #[test]
    fn basic_expansion() {
        let snippets = vec![snippet("my email", "user@example.com")];
        let result = apply_snippets("please send it to my email thanks", &snippets);
        assert_eq!(result.text, "please send it to user@example.com thanks");
        assert_eq!(result.hits, vec!["my email"]);
    }

    #[test]
    fn punctuation_tolerance() {
        let snippets = vec![snippet("my email", "user@example.com")];
        let result = apply_snippets("send to my email.", &snippets);
        assert_eq!(result.text, "send to user@example.com.");
        assert_eq!(result.hits.len(), 1);
    }

    #[test]
    fn case_insensitive() {
        let snippets = vec![snippet("my email", "user@example.com")];
        let result = apply_snippets("My Email is here", &snippets);
        assert_eq!(result.text, "user@example.com is here");
    }

    #[test]
    fn disabled_snippet_skipped() {
        let snippets = vec![Snippet {
            id: "1".to_string(),
            trigger: "my email".to_string(),
            expansion: "user@example.com".to_string(),
            enabled: false,
        }];
        let result = apply_snippets("send to my email", &snippets);
        assert_eq!(result.text, "send to my email");
        assert!(result.hits.is_empty());
    }

    #[test]
    fn longer_trigger_wins() {
        let snippets = vec![snippet("my address", "123 Main St"), snippet("my", "mine")];
        let result = apply_snippets("type my address here", &snippets);
        assert_eq!(result.text, "type 123 Main St here");
    }

    #[test]
    fn empty_text() {
        let snippets = vec![snippet("my email", "user@example.com")];
        let result = apply_snippets("", &snippets);
        assert_eq!(result.text, "");
        assert!(result.hits.is_empty());
    }

    #[test]
    fn trigger_with_leading_punct_does_not_reprepend_it() {
        // Trigger '"tis" → expansion "it is". The leading apostrophe is part
        // of the trigger itself and must NOT be preserved in front of the
        // expansion.
        let snippets = vec![snippet("'tis", "it is")];
        let result = apply_snippets("'tis the season", &snippets);
        assert_eq!(result.text, "it is the season");
        assert_eq!(result.hits.len(), 1);
    }

    #[test]
    fn extra_edge_punct_still_preserved_when_trigger_also_has_some() {
        // Trigger "'tis" already starts with an apostrophe. If the speaker
        // adds an extra opening bracket before it and a period after, those
        // extras should survive.
        let snippets = vec![snippet("'tis", "it is")];
        let result = apply_snippets("('tis the season.", &snippets);
        assert_eq!(result.text, "(it is the season.");
    }

    #[test]
    fn no_snippets() {
        let result = apply_snippets("hello world", &[]);
        assert_eq!(result.text, "hello world");
        assert!(result.hits.is_empty());
    }

    #[test]
    fn multiple_matches() {
        let snippets = vec![
            snippet("my email", "user@example.com"),
            snippet("my phone", "555-0100"),
        ];
        let result = apply_snippets("my email and my phone", &snippets);
        assert_eq!(result.text, "user@example.com and 555-0100");
        assert_eq!(result.hits.len(), 2);
    }

    #[test]
    fn import_accepts_export_array_without_ids() {
        let parsed = parse_snippet_import_json(
            r#"[{"trigger":" my email ","expansion":" user@example.com "}]"#,
        )
        .unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].trigger, "my email");
        assert_eq!(parsed[0].expansion, "user@example.com");
        assert!(parsed[0].enabled);
        assert!(!parsed[0].id.is_empty());
    }

    #[test]
    fn import_accepts_wrapped_snippets_array() {
        let parsed =
            parse_snippet_import_json(r#"{"snippets":[{"trigger":"my phone","expansion":"555"}]}"#)
                .unwrap();
        assert_eq!(parsed[0].trigger, "my phone");
    }

    #[test]
    fn import_accepts_trigger_expansion_object() {
        let parsed = parse_snippet_import_json(r#"{"my email":"user@example.com"}"#).unwrap();
        assert_eq!(parsed[0].trigger, "my email");
        assert_eq!(parsed[0].expansion, "user@example.com");
    }

    #[test]
    fn import_rejects_unrecognized_root() {
        assert!(parse_snippet_import_json(r#""not an import""#).is_err());
    }

    #[test]
    fn import_rejects_object_without_text_expansions() {
        assert!(parse_snippet_import_json(r#"{"snippets":{}}"#).is_err());
    }

    #[test]
    fn test_dynamic_variables_date_and_time_default_and_formatted() {
        use chrono::TimeZone;
        let fixed_time = chrono::Local
            .with_ymd_and_hms(2026, 9, 3, 14, 30, 45)
            .single()
            .unwrap();
        let context = SnippetContext {
            now: Some(fixed_time),
            locale: Some("en-US".to_string()),
            ..Default::default()
        };

        let snippets = vec![
            snippet("insert date", "Today is {{date}}."),
            snippet("insert formatted date", "Date: {{date:%B %d, %Y}}"),
            snippet("insert time", "Time: {{time}}"),
            snippet("insert short time", "Time: {{time:%H:%M}}"),
        ];

        let r1 = apply_snippets_with_context("please insert date thanks", &snippets, &context);
        assert_eq!(r1.text, "please Today is September 3, 2026. thanks");

        let r2 = apply_snippets_with_context("insert formatted date", &snippets, &context);
        assert_eq!(r2.text, "Date: September 03, 2026");

        let r3 = apply_snippets_with_context("insert time", &snippets, &context);
        assert_eq!(r3.text, "Time: 2:30 PM");

        let r4 = apply_snippets_with_context("insert short time", &snippets, &context);
        assert_eq!(r4.text, "Time: 14:30");
    }

    #[test]
    fn test_dynamic_variables_clipboard_and_selected_text() {
        let context = SnippetContext {
            clipboard: Some("https://example.com/pr/123".to_string()),
            selected_text: Some("fn main() {}".to_string()),
            ..Default::default()
        };

        let snippets = vec![
            snippet("insert link", "Link: {{clipboard}}"),
            snippet("wrap code", "```rust\n{{selected_text}}\n```"),
        ];

        let r1 = apply_snippets_with_context("insert link", &snippets, &context);
        assert_eq!(r1.text, "Link: https://example.com/pr/123");

        let r2 = apply_snippets_with_context("wrap code", &snippets, &context);
        assert_eq!(r2.text, "```rust\nfn main() {}\n```");
    }

    #[test]
    fn test_missing_variables_fallback_to_empty() {
        let context = SnippetContext::default();
        let snippets = vec![snippet(
            "paste empty",
            "Clipboard: [{{clipboard}}], Selection: [{{selected_text}}]",
        )];

        let r = apply_snippets_with_context("paste empty", &snippets, &context);
        assert_eq!(r.text, "Clipboard: [], Selection: []");
    }

    #[test]
    fn test_non_recursive_evaluation_prevents_injection() {
        use chrono::TimeZone;
        let fixed_time = chrono::Local
            .with_ymd_and_hms(2026, 9, 3, 14, 30, 45)
            .single()
            .unwrap();
        // Clipboard malicious payload contains {{date}} and {{time}}
        let context = SnippetContext {
            clipboard: Some("Malicious {{date}} and {{time}} payload".to_string()),
            now: Some(fixed_time),
            ..Default::default()
        };

        let snippets = vec![snippet("paste payload", "Data: {{clipboard}}")];

        let r = apply_snippets_with_context("paste payload", &snippets, &context);
        // The expanded clipboard must be literal, not re-evaluated as date/time!
        assert_eq!(r.text, "Data: Malicious {{date}} and {{time}} payload");
    }

    #[test]
    fn test_sensitive_values_are_protected_from_model_prompts() {
        let context = SnippetContext {
            clipboard: Some("SUPER_SECRET_TOKEN_12345".to_string()),
            selected_text: Some("PRIVATE SELECTION".to_string()),
            protect_sensitive_values: true,
            ..Default::default()
        };

        let snippets = vec![snippet(
            "send secret",
            "Auth: {{clipboard}} / Selected: {{selected_text}}",
        )];

        let mut r = apply_snippets_with_context("send secret", &snippets, &context);
        // Prompt text does NOT contain the secret token!
        assert!(!r.text.contains("SUPER_SECRET_TOKEN_12345"));
        assert!(!r.text.contains("PRIVATE SELECTION"));
        assert!(r.text.contains("__VOX_JOT_LOCAL_SLOT_"));
        assert!(r.placeholders_intact_in(&r.text));
        let duplicated = format!("{} {}", r.text, r.text);
        assert!(!r.placeholders_intact_in(&duplicated));

        // When restored after LLM run, the secret token returns intact
        r.restore_sensitive_values();
        assert_eq!(
            r.text,
            "Auth: SUPER_SECRET_TOKEN_12345 / Selected: PRIVATE SELECTION"
        );
    }

    #[test]
    fn sensitive_sources_are_requested_only_for_matching_snippets() {
        let snippets = vec![
            snippet("insert date", "{{date}}"),
            snippet("insert link", "{{clipboard}}"),
            snippet("wrap this", "{{selected_text}}"),
        ];
        assert_eq!(
            required_dynamic_context("insert date", &snippets),
            SnippetContextRequirements::default()
        );
        assert_eq!(
            required_dynamic_context(
                "spaced",
                &[snippet("spaced", "{{ clipboard }} {{ selected_text }}")]
            ),
            SnippetContextRequirements {
                clipboard: true,
                selected_text: true
            },
        );
        assert_eq!(
            required_dynamic_context("please insert link", &snippets),
            SnippetContextRequirements {
                clipboard: true,
                selected_text: false,
            }
        );
    }

    #[test]
    fn protected_values_cannot_bypass_the_rendered_output_limit() {
        let context = SnippetContext {
            clipboard: Some("x".repeat(MAX_RENDERED_SNIPPET_OUTPUT_CHARS + 1)),
            protect_sensitive_values: true,
            ..Default::default()
        };
        let result = apply_snippets_with_context(
            "insert clipboard",
            &[snippet("insert clipboard", "{{clipboard}}")],
            &context,
        );
        assert!(result.limit_exceeded);
        assert_eq!(result.text, "insert clipboard");
        assert!(result.sensitive_placeholders.is_empty());
    }

    #[test]
    fn imports_report_unsupported_variables() {
        let error = parse_snippet_import_json(r#"[{"trigger":"bad","expansion":"{{shell:rm}}"}]"#)
            .unwrap_err();
        assert!(error.contains("shell:rm"));
    }

    #[test]
    fn unknown_variables_remain_literal() {
        let rendered = apply_snippets("insert token", &[snippet("insert token", "{{unknown}}")]);
        assert_eq!(rendered.text, "{{unknown}}");
    }
}
