fn main() {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    build_apple_intelligence_bridge();

    generate_tray_translations();

    tauri_build::build()
}

/// Generate tray menu translations from frontend locale files.
///
/// Source of truth: src/i18n/locales/*/translation.json
/// The English "tray" section defines the struct fields.
fn generate_tray_translations() {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let locales_dir = Path::new("../src/i18n/locales");

    println!("cargo:rerun-if-changed=../src/i18n/locales");

    // Collect all locale translations
    let mut translations: BTreeMap<String, serde_json::Value> = BTreeMap::new();

    for entry in fs::read_dir(locales_dir).unwrap().flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let lang = path.file_name().unwrap().to_str().unwrap().to_string();
        let json_path = path.join("translation.json");

        println!("cargo:rerun-if-changed={}", json_path.display());

        let content = fs::read_to_string(&json_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        if let Some(tray) = parsed.get("tray").cloned() {
            translations.insert(lang, tray);
        }
    }

    // English defines the schema
    let english = translations.get("en").unwrap().as_object().unwrap();
    let fields: Vec<_> = english
        .keys()
        .map(|k| (camel_to_snake(k), k.clone()))
        .collect();

    // Generate code
    let mut out = String::from(
        "// Auto-generated from src/i18n/locales/*/translation.json - do not edit\n\n",
    );

    // Struct
    out.push_str("#[derive(Debug, Clone)]\npub struct TrayStrings {\n");
    for (rust_field, _) in &fields {
        out.push_str(&format!("    pub {rust_field}: String,\n"));
    }
    out.push_str("}\n\n");

    // Static map
    out.push_str(
        "pub static TRANSLATIONS: Lazy<HashMap<&'static str, TrayStrings>> = Lazy::new(|| {\n",
    );
    out.push_str("    let mut m = HashMap::new();\n");

    for (lang, tray) in &translations {
        out.push_str(&format!("    m.insert(\"{lang}\", TrayStrings {{\n"));
        for (rust_field, json_key) in &fields {
            let val = tray.get(json_key).and_then(|v| v.as_str()).unwrap_or("");
            out.push_str(&format!(
                "        {rust_field}: \"{}\".to_string(),\n",
                escape_string(val)
            ));
        }
        out.push_str("    });\n");
    }

    out.push_str("    m\n});\n");

    fs::write(Path::new(&out_dir).join("tray_translations.rs"), out).unwrap();

    let _ = (translations.len(), fields.len());
}

fn camel_to_snake(s: &str) -> String {
    s.chars()
        .enumerate()
        .fold(String::new(), |mut acc, (i, c)| {
            if c.is_uppercase() && i > 0 {
                acc.push('_');
            }
            acc.push(c.to_lowercase().next().unwrap());
            acc
        })
}

fn escape_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn build_apple_intelligence_bridge() {
    use std::env;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const REAL_SWIFT_FILE: &str = "swift/apple_intelligence.swift";
    const STUB_SWIFT_FILE: &str = "swift/apple_intelligence_stub.swift";
    const APPLE_SPEECH_SWIFT_FILE: &str = "swift/apple_speech.swift";
    const APPLE_SPEECH_STUB_SWIFT_FILE: &str = "swift/apple_speech_stub.swift";
    const ACTIVE_BROWSER_URL_SWIFT_FILE: &str = "swift/active_browser_url.swift";
    const ACTIVE_BROWSER_URL_STUB_SWIFT_FILE: &str = "swift/active_browser_url_stub.swift";
    const SCREEN_CONTEXT_SWIFT_FILE: &str = "swift/screen_context.swift";
    const BRIDGE_HEADER: &str = "swift/apple_intelligence_bridge.h";

    println!("cargo:rerun-if-changed={REAL_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={STUB_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={APPLE_SPEECH_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={APPLE_SPEECH_STUB_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={ACTIVE_BROWSER_URL_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={ACTIVE_BROWSER_URL_STUB_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={SCREEN_CONTEXT_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={BRIDGE_HEADER}");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let object_paths = [
        out_dir.join("apple_intelligence.o"),
        out_dir.join("screen_context.o"),
        out_dir.join("apple_speech.o"),
        out_dir.join("active_browser_url.o"),
    ];
    let static_lib_path = out_dir.join("libapple_intelligence.a");

    let sdk_path = String::from_utf8(
        Command::new("xcrun")
            .args(["--sdk", "macosx", "--show-sdk-path"])
            .output()
            .expect("Failed to locate macOS SDK")
            .stdout,
    )
    .expect("SDK path is not valid UTF-8")
    .trim()
    .to_string();

    // Check if the SDK supports FoundationModels (required for Apple Intelligence)
    let framework_path =
        Path::new(&sdk_path).join("System/Library/Frameworks/FoundationModels.framework");
    let has_foundation_models = framework_path.exists();
    let has_speech_analyzer = sdk_supports_speech_analyzer(Path::new(&sdk_path));

    let source_file = if has_foundation_models {
        REAL_SWIFT_FILE
    } else {
        STUB_SWIFT_FILE
    };
    let speech_source_file = if has_speech_analyzer {
        APPLE_SPEECH_SWIFT_FILE
    } else {
        APPLE_SPEECH_STUB_SWIFT_FILE
    };
    let browser_url_source_file = ACTIVE_BROWSER_URL_SWIFT_FILE;

    for source in [
        source_file,
        SCREEN_CONTEXT_SWIFT_FILE,
        speech_source_file,
        browser_url_source_file,
    ] {
        if !Path::new(source).exists() {
            panic!("Source file {} is missing!", source);
        }
    }

    let swiftc_path = String::from_utf8(
        Command::new("xcrun")
            .args(["--find", "swiftc"])
            .output()
            .expect("Failed to locate swiftc")
            .stdout,
    )
    .expect("swiftc path is not valid UTF-8")
    .trim()
    .to_string();

    let toolchain_swift_lib = Path::new(&swiftc_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|root| root.join("lib/swift/macosx"))
        .expect("Unable to determine Swift toolchain lib directory");
    let sdk_swift_lib = Path::new(&sdk_path).join("usr/lib/swift");

    // Use macOS 11.0 as deployment target for compatibility
    // The @available(macOS 26.0, *) checks in Swift handle runtime availability
    // Weak linking for FoundationModels is handled via cargo:rustc-link-arg below
    for (source, object_path) in [
        (source_file, &object_paths[0]),
        (SCREEN_CONTEXT_SWIFT_FILE, &object_paths[1]),
        (speech_source_file, &object_paths[2]),
        (browser_url_source_file, &object_paths[3]),
    ] {
        let status = Command::new("xcrun")
            .args([
                "swiftc",
                "-target",
                "arm64-apple-macosx11.0",
                "-sdk",
                &sdk_path,
                "-O",
                "-import-objc-header",
                BRIDGE_HEADER,
                "-c",
                source,
                "-o",
                object_path
                    .to_str()
                    .expect("Failed to convert object path to string"),
            ])
            .status()
            .expect("Failed to invoke swiftc for Apple Intelligence bridge");

        if !status.success() {
            panic!("swiftc failed to compile {source}");
        }
    }

    let status = Command::new("libtool")
        .arg("-static")
        .arg("-o")
        .arg(
            static_lib_path
                .to_str()
                .expect("Failed to convert static lib path to string"),
        )
        .args(object_paths.iter().map(|path| {
            path.to_str()
                .expect("Failed to convert object path to string")
        }))
        .status()
        .expect("Failed to create static library for Apple Intelligence bridge");

    if !status.success() {
        panic!("libtool failed for Apple Intelligence bridge");
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=apple_intelligence");
    println!(
        "cargo:rustc-link-search=native={}",
        toolchain_swift_lib.display()
    );
    println!("cargo:rustc-link-search=native={}", sdk_swift_lib.display());
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=Vision");
    println!("cargo:rustc-link-arg=-weak_framework");
    println!("cargo:rustc-link-arg=ScreenCaptureKit");

    if has_foundation_models {
        // Use weak linking so the app can launch on systems without FoundationModels
        println!("cargo:rustc-link-arg=-weak_framework");
        println!("cargo:rustc-link-arg=FoundationModels");
    }
    if has_speech_analyzer {
        println!("cargo:rustc-link-arg=-weak_framework");
        println!("cargo:rustc-link-arg=Speech");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
    }

    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn sdk_supports_speech_analyzer(sdk_path: &std::path::Path) -> bool {
    let swiftmodule_dir =
        sdk_path.join("System/Library/Frameworks/Speech.framework/Modules/Speech.swiftmodule");
    let candidates = [
        swiftmodule_dir.join("arm64-apple-macos.swiftinterface"),
        swiftmodule_dir.join("arm64e-apple-macos.swiftinterface"),
        swiftmodule_dir.join("Project/arm64-apple-macos.swiftsourceinfo"),
    ];
    candidates.iter().any(|path| {
        std::fs::read_to_string(path)
            .map(|content| {
                content.contains("SpeechAnalyzer") && content.contains("SpeechTranscriber")
            })
            .unwrap_or(false)
    })
}
