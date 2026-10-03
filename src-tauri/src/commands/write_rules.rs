use crate::post_processing::{ActiveAppContext, ResolvedWriteRule, WriteRule};
use crate::settings::{self, get_settings};
use crate::write_rules::{needs_url_capture, validate_write_rules, RuleResolver};
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub fn list_write_rules(app: AppHandle) -> Result<Vec<WriteRule>, String> {
    Ok(get_settings(&app).write_rules)
}

#[tauri::command]
#[specta::specta]
pub fn upsert_write_rule(app: AppHandle, rule: WriteRule) -> Result<WriteRule, String> {
    if rule.name.trim().is_empty() {
        return Err("Profile name is required.".to_string());
    }

    settings::try_update(&app, |settings| {
        match settings
            .write_rules
            .iter_mut()
            .find(|existing| existing.id == rule.id)
        {
            Some(existing) => *existing = rule.clone(),
            None => settings.write_rules.push(rule.clone()),
        }
        validate_write_rules(&settings.write_rules)
    })?;
    Ok(rule)
}

#[tauri::command]
#[specta::specta]
pub fn delete_write_rule(app: AppHandle, id: String) -> Result<(), String> {
    settings::update(&app, |settings| {
        settings.write_rules.retain(|rule| rule.id != id)
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn preview_write_rule_text(
    app: AppHandle,
    rule_id: String,
    text: String,
) -> Result<crate::post_processing::PostProcessResult, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Sample text is required.".to_string());
    }

    crate::actions::preview_write_rule(&app, &rule_id, trimmed).await
}

#[tauri::command]
#[specta::specta]
pub fn reorder_write_rules(app: AppHandle, ordered_ids: Vec<String>) -> Result<(), String> {
    settings::update(&app, |settings| {
        let mut priority = (ordered_ids.len() as i32) * 10;
        for id in &ordered_ids {
            if let Some(rule) = settings.write_rules.iter_mut().find(|rule| &rule.id == id) {
                rule.priority = priority;
                priority -= 10;
            }
        }
        settings
            .write_rules
            .sort_by_key(|rule| std::cmp::Reverse(rule.priority));
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn test_resolve_write_rule(
    app: AppHandle,
    bundle_id: Option<String>,
    app_name: Option<String>,
    url: Option<String>,
) -> Result<Option<ResolvedWriteRule>, String> {
    let settings = get_settings(&app);
    let app_ctx = bundle_id
        .filter(|bundle_id| !bundle_id.trim().is_empty())
        .map(|bundle_id| ActiveAppContext {
            bundle_id,
            localized_name: app_name.unwrap_or_default(),
        });

    Ok(RuleResolver::resolve(
        &settings.write_rules,
        app_ctx.as_ref(),
        url.as_deref(),
    ))
}

#[tauri::command]
#[specta::specta]
pub fn get_frontmost_url_for_write_rules(
    app: AppHandle,
    bundle_id: Option<String>,
) -> Result<Option<String>, String> {
    let settings = get_settings(&app);
    if !settings.write_rules_url_capture_enabled {
        return Ok(None);
    }

    let Some(bundle_id) = bundle_id else {
        return Ok(None);
    };
    let bundle_id = bundle_id.trim();
    if bundle_id.is_empty() {
        return Ok(None);
    }

    let app_ctx = ActiveAppContext {
        bundle_id: bundle_id.to_string(),
        localized_name: String::new(),
    };
    if !needs_url_capture(&settings.write_rules, Some(&app_ctx)) {
        return Ok(None);
    }

    Ok(crate::browser_url::active_browser_url(&app, bundle_id))
}
