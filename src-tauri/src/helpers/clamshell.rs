#[cfg(target_os = "macos")]
use std::process::Command;

/// Checks if the MacBook is in clamshell mode (lid closed with external display)
///
/// This queries the macOS IORegistry for the AppleClamshellState key.
/// Returns true if the lid is closed, false if open.
#[cfg(target_os = "macos")]
pub fn is_clamshell() -> Result<bool, String> {
    let output = Command::new("ioreg")
        .args(["-r", "-k", "AppleClamshellState", "-d", "4"])
        .output()
        .map_err(|e| format!("Failed to execute ioreg: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ioreg command failed with status: {}",
            output.status
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Look for "AppleClamshellState" = Yes in the output
    Ok(stdout.contains("\"AppleClamshellState\" = Yes"))
}

/// Returns whether the current machine is a laptop.
///
/// macOS detects an internal battery with `pmset`; unsupported platforms return
/// `false`. Keeping this command and its documentation platform-neutral makes
/// the generated frontend contract identical on every build target.
#[tauri::command]
#[specta::specta]
pub fn is_laptop() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("pmset")
            .arg("-g")
            .arg("batt")
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Check if InternalBattery is present (laptops have batteries, desktops typically don't)
        Ok(stdout.contains("InternalBattery"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

/// No-op implementation for non-macOS platforms
/// Always returns false since clamshell mode is macOS-specific
#[cfg(not(target_os = "macos"))]
pub fn is_clamshell() -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn test_clamshell_check() {
        // This will run on macOS and should not panic
        let result = is_clamshell();
        assert!(result.is_ok());
        let _ = result.unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_is_laptop() {
        let result = is_laptop();
        assert!(result.is_ok());
        if let Ok(is_laptop) = result {
            println!("Is laptop: {}", is_laptop);
        }
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn non_macos_is_laptop_reports_false() {
        assert!(!is_laptop().expect("non-macOS laptop detection should not fail"));
    }
}
