//! Opt-in measured evidence, not a ranked model benchmark or microphone test.
//! Requires an app-managed Whisper model. No download or settings mutation occurs.
#[cfg(feature = "speech-runtime")]
use super::*;
#[cfg(feature = "speech-runtime")]
use serde_json::{json, Value};
#[cfg(feature = "speech-runtime")]
use sha2::{Digest, Sha256};
#[cfg(feature = "speech-runtime")]
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    time::Instant,
};
#[cfg(feature = "speech-runtime")]
use transcribe_rs::whisper_cpp::{WhisperEngine, WhisperInferenceParams};

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        })
        .filter(|word| !word.is_empty())
        .collect()
}

fn edit_distance(reference: &[String], hypothesis: &[String]) -> usize {
    let mut row: Vec<_> = (0..=hypothesis.len()).collect();
    for (i, expected) in reference.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, actual) in hypothesis.iter().enumerate() {
            let next = row[j + 1];
            row[j + 1] = (row[j] + 1)
                .min(next + 1)
                .min(previous + usize::from(expected != actual));
            previous = next;
        }
    }
    row[hypothesis.len()]
}

#[test]
fn context_evidence_scoring_counts_unicode_and_edit_distance() {
    assert_eq!(words("Résumé, OTTO!"), ["résumé", "otto"]);
    assert_eq!(
        edit_distance(&words("Otto winked at me"), &words("Auto winked me")),
        2
    );
}

#[test]
#[cfg(feature = "speech-runtime")]
#[ignore = "requires VOX_JOT_CONTEXT_EVAL_MODEL and VOX_JOT_CONTEXT_EVAL_OUTPUT; runs 105 real ASR calls"]
fn measured_raw_whisper_context_comparison() {
    let model =
        PathBuf::from(std::env::var("VOX_JOT_CONTEXT_EVAL_MODEL").expect("model path required"));
    let output =
        PathBuf::from(std::env::var("VOX_JOT_CONTEXT_EVAL_OUTPUT").expect("output path required"));
    assert!(
        model.is_file(),
        "Use an installed app-managed Whisper .bin model"
    );
    assert!(
        !output.exists(),
        "Do not replace an earlier evidence report"
    );
    let mut model_file = fs::File::open(&model).unwrap();
    let mut model_hasher = Sha256::new();
    let mut hash_buffer = [0_u8; 1024 * 1024];
    loop {
        let count = model_file.read(&mut hash_buffer).unwrap();
        if count == 0 {
            break;
        }
        model_hasher.update(&hash_buffer[..count]);
    }
    let model_sha256 = hex::encode(model_hasher.finalize());
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_owned();
    let manifest: Value = serde_json::from_slice(
        &fs::read(root.join("test-data/audio-regression/reports/local-existing-manifest.json"))
            .unwrap(),
    )
    .unwrap();
    let entries = manifest["entries"].as_array().unwrap();
    let names = [
        "Otto",
        "Shimerda",
        "Ambrosch",
        "Kaliko",
        "Bartley",
        "Hilda",
        "Tom",
        "Alexander",
        "Shaggy",
        "Fuchs",
    ];
    let mut settings = crate::settings::get_default_settings();
    settings.custom_words = names.iter().map(|s| (*s).to_string()).collect();
    let useful = build_asr_context_hints(&settings, None, None, &[])
        .unwrap()
        .format_initial_prompt();
    settings.custom_words = vec!["QuokkaNebula".into(), "ZephyrLedger".into()];
    let unrelated = build_asr_context_hints(&settings, None, None, &[])
        .unwrap()
        .format_initial_prompt();
    let prompts = [
        ("none", None),
        ("useful_names", useful),
        ("unrelated", unrelated),
    ];
    let mut engine = WhisperEngine::load(&model).unwrap();
    let mut rows = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let path = root
            .join("test-data/audio-regression/clips")
            .join(format!("{}.wav", entry["id"].as_str().unwrap()));
        let mut reader = hound::WavReader::open(path).unwrap();
        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().bits_per_sample, 16);
        let audio: Vec<f32> = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / 32768.0)
            .collect();
        let expected = entry["expected_text"].as_str().unwrap();
        let reference = words(expected);
        let required: Vec<_> = names
            .iter()
            .filter(|name| reference.contains(&name.to_lowercase()))
            .collect();
        if index == 0 {
            // Exclude cold model warmup; rotate subsequent condition order.
            engine
                .transcribe_with(
                    &audio,
                    &WhisperInferenceParams {
                        language: Some("en".into()),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        for offset in 0..3 {
            let (condition, prompt) = &prompts[(index + offset) % 3];
            let start = Instant::now();
            let result = engine
                .transcribe_with(
                    &audio,
                    &WhisperInferenceParams {
                        language: Some("en".into()),
                        initial_prompt: prompt.clone(),
                        ..Default::default()
                    },
                )
                .unwrap();
            let elapsed = start.elapsed().as_millis();
            let hypothesis = words(&result.text);
            let recalled = required
                .iter()
                .filter(|name| hypothesis.contains(&name.to_lowercase()))
                .count();
            rows.push(json!({
                "id": entry["id"], "condition": condition, "expected": expected,
                "raw_transcription": result.text, "engine_inference_ms": elapsed,
                "reference_words": reference.len(), "word_errors": edit_distance(&reference, &hypothesis),
                "required_terms": required.len(), "recalled_terms": recalled,
                "unrelated_hint_leaks": (["quokkanebula", "zephyrledger"].iter().filter(|s| hypothesis.iter().any(|w| w == **s)).count()),
                "unexpected_name_terms": names.iter().filter(|name| hypothesis.contains(&name.to_lowercase()) && !reference.contains(&name.to_lowercase())).count()
            }));
        }
    }
    let report = json!({
        "methodology_version": "2", "evidence_tier": "diagnostic",
        "execution_path": "direct transcribe-rs Whisper test harness; not installed-app",
        "runtime": "transcribe-rs 0.3.11", "generated_at": chrono::Utc::now().to_rfc3339(),
        "model_path": model, "model_sha256": model_sha256,
        "corpus": manifest["metadata"], "conditions": ["none", "useful_names", "unrelated"],
        "post_processing": false, "dictionary_correction": false,
        "limitations": ["35 short read-speech clips, not a whisper or multi-microphone corpus", "Inference-only timings; not installed-app stop-to-paste or recording-start latency", "Unexpected-name and unrelated-token counts are leakage indicators, not a complete hallucination assessment"],
        "rows": rows
    });
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)
        .unwrap();
    file.write_all(&serde_json::to_vec_pretty(&report).unwrap())
        .unwrap();
    println!("Measured ASR report saved to {}", output.display());
}
