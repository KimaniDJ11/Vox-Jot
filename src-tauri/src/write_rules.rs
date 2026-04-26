use crate::post_processing::{ActiveAppContext, ResolvedWriteRule, WriteRule, WriteRuleOverrides};
use crate::settings::{
    AppSettings, PasteMethod, TranslationOutputMode, TranslationRoutePreference,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveSessionSettings {
    pub selected_model: String,
    pub selected_language: String,
    pub translate_to_english: bool,
    pub tone_id: Option<String>,
    pub post_process_prompt_id: Option<String>,
    pub auto_submit: bool,
    pub paste_method: PasteMethod,
    pub append_trailing_space: bool,
    pub mute_while_recording: bool,
}

pub struct RuleResolver;

impl RuleResolver {
    /// Cheap, pure-CPU match. Rules are sorted by priority; the first match wins.
    pub fn resolve(
        rules: &[WriteRule],
        app_ctx: Option<&ActiveAppContext>,
        url: Option<&str>,
    ) -> Option<ResolvedWriteRule> {
        let mut candidates: Vec<&WriteRule> = rules.iter().filter(|rule| rule.enabled).collect();
        candidates.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.id.cmp(&right.id))
        });

        for rule in candidates {
            let app_match = rule_app_matches(rule, app_ctx);
            if !app_match {
                continue;
            }

            let matched_url_pattern = matched_url_pattern(rule, url);
            if rule.matchers.url_patterns.is_empty() || matched_url_pattern.is_some() {
                return Some(ResolvedWriteRule {
                    rule_id: rule.id.clone(),
                    rule_name: rule.name.clone(),
                    matched_bundle_id: app_ctx.map(|ctx| ctx.bundle_id.clone()),
                    matched_app_name: app_ctx.map(|ctx| ctx.localized_name.clone()),
                    matched_url: url.map(str::to_string),
                    matched_url_pattern,
                    overrides: rule.overrides.clone(),
                });
            }
        }

        None
    }
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
    if let Some(tone_id) = effective.tone_id {
        next.app_tone_mappings.clear();
        next.app_tone_mappings
            .push(crate::post_processing::AppToneMapping {
                bundle_id: resolved.matched_bundle_id.clone().unwrap_or_default(),
                app_name: resolved.matched_app_name.clone().unwrap_or_default(),
                tone_id,
            });
        next.app_aware_tone_enabled = true;
    } else {
        next.app_tone_mappings.clear();
    }
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

fn matched_url_pattern(rule: &WriteRule, url: Option<&str>) -> Option<String> {
    if rule.matchers.url_patterns.is_empty() {
        return None;
    }

    let url = url?;
    rule.matchers
        .url_patterns
        .iter()
        .find(|pattern| url_matches(pattern, url))
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
    fn priority_breaks_ties() {
        let rules = vec![
            rule("low", 10, vec!["com.test"], vec![]),
            rule("high", 20, vec!["com.test"], vec![]),
        ];
        let resolved = RuleResolver::resolve(&rules, Some(&app_ctx("com.test")), None).unwrap();
        assert_eq!(resolved.rule_id, "high");
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
                auto_submit: Some(true),
                paste_method: Some(PasteMethod::Direct),
                append_trailing_space: Some(true),
                mute_while_recording: Some(true),
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
}
