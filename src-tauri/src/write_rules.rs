use crate::post_processing::{
    ActiveAppContext, PostProcessCleanupLevel, ResolvedWriteRule, WriteRule, WriteRuleOverrides,
};
use crate::settings::{
    AppSettings, PasteMethod, TranslationOutputMode, TranslationRoutePreference,
};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveSessionSettings {
    pub selected_model: String,
    pub selected_language: String,
    pub translate_to_english: bool,
    pub tone_id: Option<String>,
    pub post_process_prompt_id: Option<String>,
    pub cleanup_level: PostProcessCleanupLevel,
    pub auto_submit: bool,
    pub paste_method: PasteMethod,
    pub append_trailing_space: bool,
    pub mute_while_recording: bool,
}

pub struct RuleResolver;

impl RuleResolver {
    /// Cheap, pure-CPU match. More specific matchers win over broad defaults:
    /// URL match > app-specific default > any-app default.
    pub fn resolve(
        rules: &[WriteRule],
        app_ctx: Option<&ActiveAppContext>,
        url: Option<&str>,
    ) -> Option<ResolvedWriteRule> {
        let app_matches = |rule: &&WriteRule| rule.enabled && rule_app_matches(rule, app_ctx);

        rules
            .iter()
            .filter(app_matches)
            .filter_map(|rule| {
                matched_url_pattern(rule, url).map(|matched_pattern| (rule, matched_pattern))
            })
            .max_by(|(left, left_pattern), (right, right_pattern)| {
                rule_specificity(left)
                    .cmp(&rule_specificity(right))
                    .then_with(|| {
                        normalize_pattern(left_pattern)
                            .len()
                            .cmp(&normalize_pattern(right_pattern).len())
                    })
                    .then_with(|| right.name.cmp(&left.name))
                    .then_with(|| right.id.cmp(&left.id))
            })
            .map(|(rule, matched_pattern)| resolved_rule(rule, app_ctx, url, Some(matched_pattern)))
            .or_else(|| {
                rules
                    .iter()
                    .filter(app_matches)
                    .filter(|rule| rule.matchers.url_patterns.is_empty())
                    .max_by(|left, right| {
                        rule_specificity(left)
                            .cmp(&rule_specificity(right))
                            .then_with(|| right.name.cmp(&left.name))
                            .then_with(|| right.id.cmp(&left.id))
                    })
                    .map(|rule| resolved_rule(rule, app_ctx, url, None))
            })
    }
}

pub fn validate_write_rules(rules: &[WriteRule]) -> Result<(), String> {
    let mut any_app_default: Option<&WriteRule> = None;
    let mut app_defaults: HashMap<String, &WriteRule> = HashMap::new();
    let mut url_patterns: HashMap<String, &WriteRule> = HashMap::new();

    for rule in rules.iter().filter(|rule| rule.enabled) {
        let bundle_ids = rule.matchers.bundle_ids.as_slice();
        let patterns = rule.matchers.url_patterns.as_slice();

        if patterns.is_empty() {
            if bundle_ids.is_empty() {
                if let Some(existing) = any_app_default {
                    if existing.id != rule.id {
                        return Err(format!(
                            "\"{}\" conflicts with \"{}\". Only one enabled Any app profile is allowed.",
                            rule.name, existing.name
                        ));
                    }
                }
                any_app_default = Some(rule);
                continue;
            }

            for bundle_id in bundle_ids {
                let normalized = bundle_id.trim().to_ascii_lowercase();
                if normalized.is_empty() {
                    continue;
                }
                if let Some(existing) = app_defaults.get(&normalized) {
                    if existing.id != rule.id {
                        return Err(format!(
                            "\"{}\" and \"{}\" both target the same app. Each app can only have one default Write profile.",
                            rule.name, existing.name
                        ));
                    }
                } else {
                    app_defaults.insert(normalized, rule);
                }
            }
        }

        for pattern in patterns {
            let normalized = normalize_pattern(pattern);
            if normalized.is_empty() {
                continue;
            }
            if let Some(existing) = url_patterns.get(&normalized) {
                if existing.id != rule.id {
                    return Err(format!(
                        "\"{}\" and \"{}\" both target URL pattern \"{}\". Each URL pattern can only belong to one Write profile.",
                        rule.name, existing.name, normalized
                    ));
                }
            } else {
                url_patterns.insert(normalized, rule);
            }
        }
    }

    Ok(())
}

pub fn apply_overrides(base: &AppSettings, ov: &WriteRuleOverrides) -> EffectiveSessionSettings {
    EffectiveSessionSettings {
        selected_model: ov
            .stt_model_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| base.selected_model.clone()),
        selected_language: ov
            .stt_language
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| base.selected_language.clone()),
        translate_to_english: ov.translate_to_english.unwrap_or(base.translate_to_english),
        tone_id: ov.tone_id.clone().filter(|value| !value.trim().is_empty()),
        post_process_prompt_id: ov
            .post_process_prompt_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| base.post_process_selected_prompt_id.clone()),
        cleanup_level: ov.cleanup_level.unwrap_or(base.post_process_cleanup_level),
        auto_submit: ov.auto_submit.unwrap_or(base.auto_submit),
        paste_method: ov.paste_method.unwrap_or(base.paste_method),
        append_trailing_space: ov
            .append_trailing_space
            .unwrap_or(base.append_trailing_space),
        mute_while_recording: ov.mute_while_recording.unwrap_or(base.mute_while_recording),
    }
}

pub fn apply_resolved_rule_to_settings(
    base: &AppSettings,
    resolved: Option<&ResolvedWriteRule>,
) -> AppSettings {
    let Some(resolved) = resolved else {
        return base.clone();
    };

    let effective = apply_overrides(base, &resolved.overrides);
    let mut next = base.clone();
    next.selected_model = effective.selected_model.clone();
    next.selected_stt_model_id = effective.selected_model;
    next.selected_language = effective.selected_language;
    next.translate_to_english = effective.translate_to_english;
    if effective.translate_to_english {
        next.translation_output_mode = TranslationOutputMode::Translated;
        next.translation_target_language = "en".to_string();
        next.translation_route_preference = TranslationRoutePreference::WhisperEnglish;
    } else if resolved.overrides.translate_to_english == Some(false) {
        next.translation_output_mode = TranslationOutputMode::Source;
    }
    // Tone is resolved directly from write_rules at consumption time
    // (see actions::resolve_tone_context), so no bridge is needed.
    if effective.tone_id.is_some() {
        next.app_aware_tone_enabled = true;
    }
    next.post_process_cleanup_level = effective.cleanup_level;
    next.post_process_mode = effective.cleanup_level.mode();
    next.max_rewrite_strength = effective.cleanup_level.rewrite_strength();
    next.post_process_selected_prompt_id = effective.post_process_prompt_id;
    next.auto_submit = effective.auto_submit;
    next.paste_method = effective.paste_method;
    next.append_trailing_space = effective.append_trailing_space;
    next.mute_while_recording = effective.mute_while_recording;
    next
}

fn rule_app_matches(rule: &WriteRule, app_ctx: Option<&ActiveAppContext>) -> bool {
    if rule.matchers.bundle_ids.is_empty() {
        return true;
    }

    let Some(app_ctx) = app_ctx else {
        return false;
    };

    rule.matchers
        .bundle_ids
        .iter()
        .any(|bundle_id| bundle_id.eq_ignore_ascii_case(&app_ctx.bundle_id))
}

fn rule_specificity(rule: &WriteRule) -> u8 {
    if rule.matchers.bundle_ids.is_empty() {
        0
    } else {
        1
    }
}

fn resolved_rule(
    rule: &WriteRule,
    app_ctx: Option<&ActiveAppContext>,
    url: Option<&str>,
    matched_url_pattern: Option<String>,
) -> ResolvedWriteRule {
    ResolvedWriteRule {
        rule_id: rule.id.clone(),
        rule_name: rule.name.clone(),
        matched_bundle_id: app_ctx.map(|ctx| ctx.bundle_id.clone()),
        matched_app_name: app_ctx.map(|ctx| ctx.localized_name.clone()),
        matched_url: url.map(str::to_string),
        matched_url_pattern,
        overrides: rule.overrides.clone(),
    }
}

fn matched_url_pattern(rule: &WriteRule, url: Option<&str>) -> Option<String> {
    if rule.matchers.url_patterns.is_empty() {
        return None;
    }

    let url = url?;
    rule.matchers
        .url_patterns
        .iter()
        .filter(|pattern| url_matches(pattern, url))
        .max_by_key(|pattern| normalize_pattern(pattern).len())
        .cloned()
}

pub fn url_matches(pattern: &str, url: &str) -> bool {
    let pattern = normalize_pattern(pattern);
    if pattern.is_empty() {
        return false;
    }

    let Some((host, host_path)) = normalize_url_target(url) else {
        return false;
    };

    if pattern.contains('/') {
        wildcard_match(&pattern, &host_path)
    } else {
        wildcard_match(&pattern, &host)
    }
}

fn normalize_pattern(pattern: &str) -> String {
    pattern
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn normalize_url_target(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed);
    let without_auth = without_scheme
        .rsplit_once('@')
        .map(|(_, rest)| rest)
        .unwrap_or(without_scheme);
    let without_fragment = without_auth.split('#').next().unwrap_or(without_auth);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);
    let host_end = without_query.find('/').unwrap_or(without_query.len());
    let host = without_query[..host_end]
        .trim()
        .trim_end_matches(':')
        .to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }

    let path = if host_end < without_query.len() {
        without_query[host_end..].trim_end_matches('/')
    } else {
        ""
    };
    let host_path = if path.is_empty() {
        host.clone()
    } else {
        format!("{host}{path}")
    };

    Some((host, host_path.to_ascii_lowercase()))
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.as_bytes();
    let value = value.as_bytes();
    let (mut p, mut v) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut star_value = 0usize;

    while v < value.len() {
        if p < pattern.len() && (pattern[p] == b'?' || pattern[p] == value[v]) {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            p += 1;
            star_value = v;
        } else if let Some(star_index) = star {
            p = star_index + 1;
            star_value += 1;
            v = star_value;
        } else {
            return false;
        }
    }

    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }

    p == pattern.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::post_processing::{WriteRuleMatchers, WriteRuleOverrides};
    use crate::settings::get_default_settings;

    fn app_ctx(bundle_id: &str) -> ActiveAppContext {
        ActiveAppContext {
            bundle_id: bundle_id.to_string(),
            localized_name: "Test App".to_string(),
        }
    }

    fn rule(id: &str, priority: i32, bundle_ids: Vec<&str>, url_patterns: Vec<&str>) -> WriteRule {
        WriteRule {
            id: id.to_string(),
            name: id.to_string(),
            enabled: true,
            priority,
            matchers: WriteRuleMatchers {
                bundle_ids: bundle_ids.into_iter().map(str::to_string).collect(),
                url_patterns: url_patterns.into_iter().map(str::to_string).collect(),
            },
            overrides: WriteRuleOverrides {
                tone_id: Some(id.to_string()),
                ..Default::default()
            },
        }
    }

    #[test]
    fn resolve_returns_none_when_no_rules() {
        assert!(RuleResolver::resolve(&[], None, None).is_none());
    }

    #[test]
    fn url_match_beats_app_default() {
        let rules = vec![
            rule("app", 100, vec!["com.browser"], vec![]),
            rule("url", 10, vec!["com.browser"], vec!["mail.example.com"]),
        ];
        let resolved = RuleResolver::resolve(
            &rules,
            Some(&app_ctx("com.browser")),
            Some("https://mail.example.com/inbox"),
        )
        .unwrap();
        assert_eq!(resolved.rule_id, "url");
    }

    #[test]
    fn app_default_beats_any_app_default() {
        let rules = vec![
            rule("any", 100, vec![], vec![]),
            rule("app", 10, vec!["com.test"], vec![]),
        ];
        let resolved = RuleResolver::resolve(&rules, Some(&app_ctx("com.test")), None).unwrap();
        assert_eq!(resolved.rule_id, "app");
    }

    #[test]
    fn any_app_default_is_last_resort() {
        let rules = vec![
            rule("app", 100, vec!["com.other"], vec![]),
            rule("any", 10, vec![], vec![]),
        ];
        let resolved = RuleResolver::resolve(&rules, Some(&app_ctx("com.test")), None).unwrap();
        assert_eq!(resolved.rule_id, "any");
    }

    #[test]
    fn longest_matching_url_pattern_wins() {
        let rules = vec![
            rule("broad", 100, vec!["com.browser"], vec!["github.com/*"]),
            rule(
                "specific",
                10,
                vec!["com.browser"],
                vec!["github.com/orgs/*"],
            ),
        ];
        let resolved = RuleResolver::resolve(
            &rules,
            Some(&app_ctx("com.browser")),
            Some("https://github.com/orgs/acme/settings"),
        )
        .unwrap();
        assert_eq!(resolved.rule_id, "specific");
    }

    #[test]
    fn disabled_rules_skipped() {
        let mut disabled = rule("disabled", 100, vec!["com.test"], vec![]);
        disabled.enabled = false;
        let rules = vec![disabled, rule("enabled", 10, vec!["com.test"], vec![])];
        let resolved = RuleResolver::resolve(&rules, Some(&app_ctx("com.test")), None).unwrap();
        assert_eq!(resolved.rule_id, "enabled");
    }

    #[test]
    fn bundle_id_only_match() {
        let rules = vec![rule("app", 1, vec!["com.test"], vec![])];
        assert!(RuleResolver::resolve(&rules, Some(&app_ctx("com.test")), None).is_some());
        assert!(RuleResolver::resolve(&rules, Some(&app_ctx("com.other")), None).is_none());
    }

    #[test]
    fn url_only_match() {
        let rules = vec![rule("url", 1, vec![], vec!["*.gmail.com"])];
        assert!(
            RuleResolver::resolve(&rules, None, Some("https://mail.gmail.com/inbox")).is_some()
        );
    }

    #[test]
    fn bundle_and_url_must_both_match() {
        let rules = vec![rule(
            "both",
            1,
            vec!["com.browser"],
            vec!["github.com/orgs/*"],
        )];
        assert!(RuleResolver::resolve(
            &rules,
            Some(&app_ctx("com.browser")),
            Some("https://github.com/orgs/acme")
        )
        .is_some());
        assert!(RuleResolver::resolve(
            &rules,
            Some(&app_ctx("com.other")),
            Some("https://github.com/orgs/acme")
        )
        .is_none());
        assert!(RuleResolver::resolve(
            &rules,
            Some(&app_ctx("com.browser")),
            Some("https://github.com/acme")
        )
        .is_none());
    }

    #[test]
    fn url_pattern_globs() {
        assert!(url_matches("*.gmail.com", "https://mail.gmail.com/inbox"));
        assert!(url_matches(
            "github.com/orgs/*",
            "https://github.com/orgs/acme/settings?tab=profile"
        ));
        assert!(url_matches("github.com", "https://github.com/orgs/acme"));
        assert!(!url_matches("github.com/orgs/*", "https://github.com/acme"));
    }

    #[test]
    fn apply_overrides_falls_back_to_base() {
        let mut base = get_default_settings();
        base.selected_model = "whisper-medium".to_string();
        base.selected_language = "en".to_string();
        base.translate_to_english = false;
        base.auto_submit = false;
        base.paste_method = PasteMethod::CtrlV;
        base.append_trailing_space = false;
        base.mute_while_recording = false;
        base.post_process_selected_prompt_id = Some("default".to_string());

        let effective = apply_overrides(&base, &WriteRuleOverrides::default());
        assert_eq!(effective.selected_model, "whisper-medium");
        assert_eq!(effective.selected_language, "en");
        assert!(!effective.translate_to_english);
        assert_eq!(effective.post_process_prompt_id.as_deref(), Some("default"));
        assert!(!effective.auto_submit);
        assert_eq!(effective.paste_method, PasteMethod::CtrlV);
        assert!(!effective.append_trailing_space);
        assert!(!effective.mute_while_recording);

        let effective = apply_overrides(
            &base,
            &WriteRuleOverrides {
                stt_model_id: Some("parakeet".to_string()),
                stt_language: Some("ja".to_string()),
                translate_to_english: Some(true),
                tone_id: Some("coding".to_string()),
                post_process_prompt_id: Some("code".to_string()),
                cleanup_level: None,
                auto_submit: Some(true),
                paste_method: Some(PasteMethod::Direct),
                append_trailing_space: Some(true),
                mute_while_recording: Some(true),
                force_post_process: None,
            },
        );
        assert_eq!(effective.selected_model, "parakeet");
        assert_eq!(effective.selected_language, "ja");
        assert!(effective.translate_to_english);
        assert_eq!(effective.tone_id.as_deref(), Some("coding"));
        assert_eq!(effective.post_process_prompt_id.as_deref(), Some("code"));
        assert!(effective.auto_submit);
        assert_eq!(effective.paste_method, PasteMethod::Direct);
        assert!(effective.append_trailing_space);
        assert!(effective.mute_while_recording);
    }

    #[test]
    fn force_post_process_round_trips_through_resolver() {
        let mut force_on = rule("on", 10, vec!["com.app.on"], vec![]);
        force_on.overrides.force_post_process = Some(true);
        let mut force_off = rule("off", 10, vec!["com.app.off"], vec![]);
        force_off.overrides.force_post_process = Some(false);
        let neutral = rule("neutral", 10, vec!["com.app.neutral"], vec![]);

        let rules = vec![force_on, force_off, neutral];

        let resolved_on =
            RuleResolver::resolve(&rules, Some(&app_ctx("com.app.on")), None).unwrap();
        assert_eq!(resolved_on.overrides.force_post_process, Some(true));

        let resolved_off =
            RuleResolver::resolve(&rules, Some(&app_ctx("com.app.off")), None).unwrap();
        assert_eq!(resolved_off.overrides.force_post_process, Some(false));

        let resolved_neutral =
            RuleResolver::resolve(&rules, Some(&app_ctx("com.app.neutral")), None).unwrap();
        assert_eq!(resolved_neutral.overrides.force_post_process, None);
    }

    #[test]
    fn validation_rejects_duplicate_app_defaults() {
        let rules = vec![
            rule("mail-a", 10, vec!["com.mail"], vec![]),
            rule("mail-b", 20, vec!["com.mail"], vec![]),
        ];

        assert!(validate_write_rules(&rules).is_err());
    }

    #[test]
    fn validation_allows_app_default_and_url_override_for_same_app() {
        let rules = vec![
            rule("browser-default", 10, vec!["com.browser"], vec![]),
            rule(
                "browser-url",
                20,
                vec!["com.browser"],
                vec!["mail.example.com"],
            ),
        ];

        assert!(validate_write_rules(&rules).is_ok());
    }

    #[test]
    fn validation_rejects_duplicate_any_app_defaults() {
        let rules = vec![
            rule("any-a", 10, vec![], vec![]),
            rule("any-b", 20, vec![], vec![]),
        ];

        assert!(validate_write_rules(&rules).is_err());
    }

    #[test]
    fn validation_rejects_duplicate_url_patterns() {
        let rules = vec![
            rule("site-a", 10, vec![], vec!["https://mail.example.com/"]),
            rule("site-b", 20, vec![], vec!["mail.example.com"]),
        ];

        assert!(validate_write_rules(&rules).is_err());
    }
}
