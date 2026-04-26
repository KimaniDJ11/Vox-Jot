use crate::post_processing::{ActiveAppContext, ResolvedWriteRule, WriteRule};
use crate::settings::{get_settings, write_settings};
use crate::write_rules::RuleResolver;
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

    let mut settings = get_settings(&app);
    if let Some(existing) = settings
        .write_rules
        .iter_mut()
        .find(|existing| existing.id == rule.id)
    {
        *existing = rule.clone();
    } else {
        settings.write_rules.push(rule.clone());
    }
    settings
        .write_rules
        .sort_by(|left, right| right.priority.cmp(&left.priority));
    write_settings(&app, settings);
    Ok(rule)
}

#[tauri::command]
#[specta::specta]
pub fn delete_write_rule(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.write_rules.retain(|rule| rule.id != id);
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn reorder_write_rules(app: AppHandle, ordered_ids: Vec<String>) -> Result<(), String> {
    let mut settings = get_settings(&app);
    let mut priority = (ordered_ids.len() as i32) * 10;
    for id in ordered_ids {
        if let Some(rule) = settings.write_rules.iter_mut().find(|rule| rule.id == id) {
            rule.priority = priority;
            priority -= 10;
        }
    }
    settings
        .write_rules
        .sort_by(|left, right| right.priority.cmp(&left.priority));
    write_settings(&app, settings);
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
pub fn change_write_rules_url_capture_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.write_rules_url_capture_enabled = enabled;
    write_settings(&app, settings);
    Ok(())
}
