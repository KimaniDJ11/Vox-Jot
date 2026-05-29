use log::debug;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

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

pub struct SnippetExpansionResult {
    pub text: String,
    pub hits: Vec<String>,
}

const MAX_IMPORT_SNIPPETS: usize = 1000;
const MAX_TRIGGER_CHARS: usize = 60;
const MAX_EXPANSION_CHARS: usize = 4000;

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

/// Apply snippet expansions to the given text.
///
/// Matching is case-insensitive and punctuation-tolerant (a trailing period
/// from STT won't block a match). Longer triggers are tried first to avoid
/// shorter triggers shadowing them.
pub fn apply_snippets(text: &str, snippets: &[Snippet]) -> SnippetExpansionResult {
    if text.trim().is_empty() || snippets.is_empty() {
        return SnippetExpansionResult {
            text: text.to_string(),
            hits: Vec::new(),
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

                    output.push(format!("{}{}{}", leading, snippet.expansion, trailing));
                    hits.push(snippet.trigger.clone());
                    debug!(
                        "Snippet expanded: '{}' → '{}'",
                        snippet.trigger, snippet.expansion
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
            output.push(words[i].to_string());
            i += 1;
        }
    }

    SnippetExpansionResult {
        text: output.join(" "),
        hits,
    }
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
}
