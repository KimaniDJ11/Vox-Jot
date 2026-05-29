#[cfg(test)]
use serde::{Deserialize, Serialize};
#[cfg(test)]
use specta::Type;
use std::time::Duration;

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProductModuleTier {
    Core,
    Advanced,
    Lab,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProductModuleDomain {
    Dictation,
    Refinement,
    Listen,
    ScreenContext,
    SpeechAnalysis,
    Automation,
    ModelTesting,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProductModuleDescriptor {
    pub id: &'static str,
    pub domain: ProductModuleDomain,
    pub tier: ProductModuleTier,
    pub hot_path: bool,
    pub enabled_by_default: bool,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeArtifactDomain {
    Stt,
    Llm,
    Tts,
    Ocr,
    OcrRuntime,
    SpeechAnalysis,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeExecutionMode {
    InProcess,
    ManagedSidecar,
    SystemFramework,
    RemoteProvider,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RuntimeProviderContract {
    pub id: &'static str,
    pub artifact_domain: RuntimeArtifactDomain,
    pub execution_mode: RuntimeExecutionMode,
    pub may_run_on_dictation_hot_path: bool,
    pub requires_managed_artifacts: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LatencyBudget {
    pub stage: &'static str,
    pub budget: Duration,
}

pub const DICTATION_LATENCY_BUDGETS: &[LatencyBudget] = &[
    LatencyBudget {
        stage: "recording_start",
        budget: Duration::from_millis(150),
    },
    LatencyBudget {
        stage: "stop_capture",
        budget: Duration::from_millis(120),
    },
    LatencyBudget {
        stage: "warm_transcription",
        budget: Duration::from_millis(2500),
    },
    LatencyBudget {
        stage: "paste",
        budget: Duration::from_millis(350),
    },
];

#[cfg(test)]
pub fn builtin_product_modules() -> &'static [ProductModuleDescriptor] {
    &[
        ProductModuleDescriptor {
            id: "dictation",
            domain: ProductModuleDomain::Dictation,
            tier: ProductModuleTier::Core,
            hot_path: true,
            enabled_by_default: true,
        },
        ProductModuleDescriptor {
            id: "write_profiles",
            domain: ProductModuleDomain::Refinement,
            tier: ProductModuleTier::Advanced,
            hot_path: false,
            enabled_by_default: true,
        },
        ProductModuleDescriptor {
            id: "screen_context",
            domain: ProductModuleDomain::ScreenContext,
            tier: ProductModuleTier::Advanced,
            hot_path: false,
            enabled_by_default: true,
        },
        ProductModuleDescriptor {
            id: "listen",
            domain: ProductModuleDomain::Listen,
            tier: ProductModuleTier::Advanced,
            hot_path: false,
            enabled_by_default: true,
        },
        ProductModuleDescriptor {
            id: "automation_agents",
            domain: ProductModuleDomain::Automation,
            tier: ProductModuleTier::Lab,
            hot_path: false,
            enabled_by_default: false,
        },
        ProductModuleDescriptor {
            id: "model_testing",
            domain: ProductModuleDomain::ModelTesting,
            tier: ProductModuleTier::Lab,
            hot_path: false,
            enabled_by_default: false,
        },
        ProductModuleDescriptor {
            id: "speech_analysis",
            domain: ProductModuleDomain::SpeechAnalysis,
            tier: ProductModuleTier::Lab,
            hot_path: false,
            enabled_by_default: false,
        },
    ]
}

#[cfg(test)]
pub fn builtin_runtime_provider_contracts() -> &'static [RuntimeProviderContract] {
    &[
        RuntimeProviderContract {
            id: "stt_whisper",
            artifact_domain: RuntimeArtifactDomain::Stt,
            execution_mode: RuntimeExecutionMode::InProcess,
            may_run_on_dictation_hot_path: true,
            requires_managed_artifacts: true,
        },
        RuntimeProviderContract {
            id: "stt_parakeet",
            artifact_domain: RuntimeArtifactDomain::Stt,
            execution_mode: RuntimeExecutionMode::InProcess,
            may_run_on_dictation_hot_path: true,
            requires_managed_artifacts: true,
        },
        RuntimeProviderContract {
            id: "stt_apple_speech",
            artifact_domain: RuntimeArtifactDomain::Stt,
            execution_mode: RuntimeExecutionMode::SystemFramework,
            may_run_on_dictation_hot_path: true,
            requires_managed_artifacts: false,
        },
        RuntimeProviderContract {
            id: "stt_mlx_audio",
            artifact_domain: RuntimeArtifactDomain::Stt,
            execution_mode: RuntimeExecutionMode::ManagedSidecar,
            may_run_on_dictation_hot_path: true,
            requires_managed_artifacts: true,
        },
        RuntimeProviderContract {
            id: "ocr_neural",
            artifact_domain: RuntimeArtifactDomain::Ocr,
            execution_mode: RuntimeExecutionMode::ManagedSidecar,
            may_run_on_dictation_hot_path: false,
            requires_managed_artifacts: true,
        },
        RuntimeProviderContract {
            id: "tts_mlx",
            artifact_domain: RuntimeArtifactDomain::Tts,
            execution_mode: RuntimeExecutionMode::ManagedSidecar,
            may_run_on_dictation_hot_path: false,
            requires_managed_artifacts: true,
        },
    ]
}

pub fn latency_budget_for(stage: &str) -> Option<Duration> {
    DICTATION_LATENCY_BUDGETS
        .iter()
        .find(|budget| budget.stage == stage)
        .map(|budget| budget.budget)
}

pub fn record_dictation_latency(stage: &str, elapsed: Duration) {
    if let Some(budget) = latency_budget_for(stage) {
        if elapsed > budget {
            log::warn!(
                "Dictation latency budget exceeded for {stage}: {}ms > {}ms",
                elapsed.as_millis(),
                budget.as_millis()
            );
            return;
        }
    }

    log::debug!("Dictation latency {stage}: {}ms", elapsed.as_millis());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_core_dictation_is_marked_hot_path() {
        let hot_path_modules = builtin_product_modules()
            .iter()
            .filter(|module| module.hot_path)
            .map(|module| module.id)
            .collect::<Vec<_>>();

        assert_eq!(hot_path_modules, vec!["dictation"]);
    }

    #[test]
    fn lab_modules_are_not_enabled_by_default() {
        for module in builtin_product_modules() {
            if module.tier == ProductModuleTier::Lab {
                assert!(!module.enabled_by_default, "{} must stay opt-in", module.id);
                assert!(!module.hot_path, "{} must stay off the hot path", module.id);
            }
        }
    }

    #[test]
    fn runtime_contracts_identify_hot_path_providers() {
        let contracts = builtin_runtime_provider_contracts();
        assert!(contracts
            .iter()
            .any(|contract| contract.id == "stt_apple_speech"
                && contract.execution_mode == RuntimeExecutionMode::SystemFramework
                && contract.may_run_on_dictation_hot_path));
        assert!(contracts
            .iter()
            .all(|contract| contract.may_run_on_dictation_hot_path
                || contract.artifact_domain != RuntimeArtifactDomain::Stt));
    }

    #[test]
    fn dictation_latency_budgets_cover_primary_stages() {
        for stage in [
            "recording_start",
            "stop_capture",
            "warm_transcription",
            "paste",
        ] {
            assert!(latency_budget_for(stage).is_some(), "{stage} missing");
        }
    }
}
