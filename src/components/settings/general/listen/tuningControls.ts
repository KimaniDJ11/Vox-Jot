import type {
  CatalogModelDescriptor,
  TtsAdvancedControlDescriptor,
  TtsControlGroup,
} from "@/lib/modelPlatform";
import type { TtsVoiceTuningSettings } from "@/lib/ttsVoicePresets";

export function tuningNumberLabel(
  control: TtsAdvancedControlDescriptor | undefined,
  fallbackLabel: string,
) {
  return control?.label ?? fallbackLabel;
}

export function tuningDescription(
  control: TtsAdvancedControlDescriptor | undefined,
  fallbackDescription: string,
) {
  return control?.description ?? fallbackDescription;
}

function sliderTuningControl(
  id: string,
  group: TtsControlGroup,
  label: string,
  description: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
  unit: string | null = null,
): TtsAdvancedControlDescriptor {
  return {
    id,
    group,
    label,
    description,
    kind: "slider",
    min,
    max,
    step,
    unit,
    options: [],
    default_value: { kind: "number", value: defaultValue },
  };
}

function tempoTuningControl(description: string) {
  return sliderTuningControl(
    "tempo_rate",
    "tempo",
    "Tempo",
    description,
    0.5,
    2,
    0.05,
    1,
    "x",
  );
}

function randomnessTuningControl(defaultValue = 0.7) {
  return sliderTuningControl(
    "randomness",
    "sampler",
    "Temperature",
    "Controls sampling variation during audio generation.",
    0,
    1,
    0.05,
    defaultValue,
  );
}

function repetitionTuningControl(defaultValue = 1.2) {
  return sliderTuningControl(
    "repetition_penalty",
    "guidance",
    "Repetition Penalty",
    "Discourages repeated words or token loops in longer reads.",
    1,
    3,
    0.1,
    defaultValue,
  );
}

function topPTuningControl(defaultValue = 0.8) {
  return sliderTuningControl(
    "top_p",
    "sampler",
    "Top P",
    "Keeps sampling inside the most likely token mass.",
    0.5,
    1,
    0.05,
    defaultValue,
  );
}

function topKTuningControl(defaultValue = 50) {
  return sliderTuningControl(
    "top_k",
    "sampler",
    "Top K",
    "Caps how many candidate audio tokens can be sampled.",
    1,
    100,
    1,
    defaultValue,
  );
}

function minPTuningControl(defaultValue = 0.05) {
  return sliderTuningControl(
    "min_p",
    "sampler",
    "Min P",
    "Filters very unlikely audio tokens while keeping expressive options open.",
    0,
    1,
    0.01,
    defaultValue,
  );
}

function styleInstructionsControl(
  description: string,
): TtsAdvancedControlDescriptor {
  return {
    id: "style_instructions",
    group: "steering",
    label: "Style Instructions",
    description,
    kind: "text",
    min: null,
    max: null,
    step: null,
    unit: null,
    options: [],
    default_value: null,
  };
}

function fallbackTuningControlsForModel(
  model: CatalogModelDescriptor | null | undefined,
): TtsAdvancedControlDescriptor[] {
  if (!model) return [];

  const providerId = model.provider_id.toLowerCase();
  const modelId = model.id.toLowerCase();
  const familyKey = [
    providerId,
    modelId,
    model.label,
    model.description,
    model.source_label,
    model.runtime.engine_family,
  ]
    .join(" ")
    .toLowerCase();

  if (providerId === "system_builtin") {
    return [
      tempoTuningControl("Adjusts the operating system voice speaking rate."),
    ];
  }

  if (providerId === "sherpa_pack") {
    return [
      tempoTuningControl(
        "Adjusts Sherpa VITS length scale for faster or slower delivery.",
      ),
    ];
  }

  if (providerId === "vibevoice") {
    return [
      sliderTuningControl(
        "cfg_weight",
        "guidance",
        "Guidance",
        "Controls VibeVoice classifier-free guidance strength.",
        0,
        5,
        0.1,
        1.3,
      ),
    ];
  }

  if (familyKey.includes("kokoro")) {
    return [
      tempoTuningControl("Adjusts Kokoro delivery speed for this preset."),
    ];
  }

  if (modelId.includes("chatterbox-turbo")) {
    return [
      randomnessTuningControl(0.8),
      repetitionTuningControl(1.2),
      topPTuningControl(0.95),
      sliderTuningControl(
        "top_k",
        "sampler",
        "Top K",
        "Caps how many candidate speech tokens can be sampled.",
        1,
        1000,
        1,
        1000,
      ),
    ];
  }

  if (modelId.includes("chatterbox-multilingual")) {
    return [
      sliderTuningControl(
        "guidance",
        "guidance",
        "Guidance",
        "Controls how strongly Chatterbox follows its conditioning signal.",
        0,
        1,
        0.05,
        0.5,
      ),
      randomnessTuningControl(0.8),
      sliderTuningControl(
        "exaggeration",
        "style",
        "Exaggeration",
        "Pushes Chatterbox toward a more pronounced style.",
        0.25,
        2,
        0.05,
        0.5,
      ),
      repetitionTuningControl(2),
      topPTuningControl(1),
      minPTuningControl(0.05),
    ];
  }

  if (familyKey.includes("chatterbox")) {
    const isMlx = providerId.includes("mlx");
    return [
      isMlx
        ? tempoTuningControl(
            "Adjusts MLX Chatterbox delivery speed when supported by the model.",
          )
        : null,
      sliderTuningControl(
        isMlx ? "cfg_weight" : "guidance",
        "guidance",
        "Guidance",
        "Controls how strongly Chatterbox follows its conditioning signal.",
        0,
        1,
        0.05,
        0.5,
      ),
      randomnessTuningControl(isMlx ? 0.7 : 0.8),
      sliderTuningControl(
        "exaggeration",
        "style",
        "Exaggeration",
        "Pushes Chatterbox toward a more pronounced style.",
        0.25,
        2,
        0.05,
        0.5,
      ),
      repetitionTuningControl(1.2),
      topPTuningControl(0.95),
      minPTuningControl(0.05),
    ].filter(Boolean) as TtsAdvancedControlDescriptor[];
  }

  if (familyKey.includes("xtts") || familyKey.includes("coqui")) {
    return [
      tempoTuningControl("Adjusts XTTS delivery speed."),
      randomnessTuningControl(0.65),
      repetitionTuningControl(2),
      topPTuningControl(0.8),
      topKTuningControl(50),
    ];
  }

  if (providerId === "supertonic" || familyKey.includes("supertonic")) {
    return [
      sliderTuningControl(
        "tempo_rate",
        "tempo",
        "Tempo",
        "Adjusts Supertonic speech speed.",
        0.7,
        2,
        0.05,
        1.05,
        "x",
      ),
      sliderTuningControl(
        "quality_steps",
        "sampler",
        "Quality Steps",
        "Sets Supertonic denoising steps; higher can improve quality at the cost of latency.",
        1,
        12,
        1,
        5,
      ),
    ];
  }

  if (familyKey.includes("openvoice")) {
    return [
      tempoTuningControl(
        "Speeds OpenVoice up or down for a tighter delivery fit.",
      ),
      sliderTuningControl(
        "sdp_ratio",
        "style",
        "SDP Ratio",
        "Balances deterministic and stochastic duration prediction.",
        0,
        1,
        0.05,
        0.2,
      ),
      sliderTuningControl(
        "noise_scale",
        "sampler",
        "Noise Scale",
        "Controls base voice acoustic variation before tone conversion.",
        0,
        1,
        0.05,
        0.6,
      ),
      sliderTuningControl(
        "noise_scale_w",
        "sampler",
        "Duration Noise",
        "Controls stochastic duration variation in the base voice.",
        0,
        1,
        0.05,
        0.8,
      ),
      sliderTuningControl(
        "tau",
        "style",
        "Tone Blend",
        "Adjusts tone-color conversion strength for cloned voices.",
        0,
        1,
        0.05,
        0.3,
      ),
    ];
  }

  if (providerId === "mlx_qwen3tts" || providerId === "mlx_fish_audio") {
    return [
      tempoTuningControl(
        "Adjusts delivery speed when supported by this MLX model.",
      ),
      randomnessTuningControl(0.7),
      repetitionTuningControl(1.2),
      topPTuningControl(0.8),
      topKTuningControl(50),
    ];
  }

  if (
    providerId === "mlx_dia" ||
    providerId === "mlx_spark" ||
    providerId === "mlx_voxtral_tts"
  ) {
    return [
      randomnessTuningControl(0.7),
      topPTuningControl(0.8),
      topKTuningControl(50),
    ];
  }

  if (providerId === "mlx_ming_omni") {
    return [
      tempoTuningControl("Adjusts Ming Omni delivery speed."),
      randomnessTuningControl(0.7),
      topPTuningControl(0.8),
      topKTuningControl(50),
    ];
  }

  if (providerId === "mlx_lfm_audio" || providerId === "mlx_pocket_tts") {
    return [randomnessTuningControl(0.7)];
  }

  if (providerId === "mlx_voxcpm") {
    return [
      sliderTuningControl(
        "cfg_weight",
        "guidance",
        "Guidance",
        "Controls VoxCPM2 conditioning strength.",
        0,
        5,
        0.1,
        2,
      ),
    ];
  }

  if (providerId === "local_sidecar_api") {
    return [
      tempoTuningControl("Sends a speed hint to compatible local speech APIs."),
      styleInstructionsControl(
        "Optional sidecar-specific instructions passed through with speech generation.",
      ),
    ];
  }

  return [];
}

export function resolvedTuningControlsForModel(
  model: CatalogModelDescriptor | null | undefined,
) {
  const catalogControls = model?.delivery_support.advanced_controls ?? [];
  const controlsById = new Map<string, TtsAdvancedControlDescriptor>();

  for (const control of fallbackTuningControlsForModel(model)) {
    controlsById.set(control.id, control);
  }

  for (const control of catalogControls) {
    controlsById.set(control.id, control);
  }

  const controls = [...controlsById.values()];

  if (
    model?.capabilities.supports_instruction_prompt &&
    !controls.some((control) => control.id === "style_instructions")
  ) {
    controls.push(
      styleInstructionsControl(
        "Optional provider-specific speaking instructions passed through with speech generation.",
      ),
    );
  }

  return controls;
}

export function modelHasTuningControls(model: CatalogModelDescriptor) {
  return (
    resolvedTuningControlsForModel(model).length > 0 ||
    (model.delivery_support.expressiveness_mode ?? "unsupported") !==
      "unsupported"
  );
}

export const DIRECT_TUNING_CONTROL_IDS = new Set([
  "tempo_rate",
  "speed",
  "expressiveness",
  "exaggeration",
  "randomness",
  "guidance",
  "stability",
  "repetition_penalty",
  "style_instructions",
]);

export function tuningFallbackDefault(control: TtsAdvancedControlDescriptor) {
  switch (control.id) {
    case "tempo_rate":
    case "speed":
      return 1;
    case "randomness":
      return 0.7;
    case "top_p":
      return 0.8;
    case "top_k":
      return 50;
    case "min_p":
      return 0.05;
    case "cfg_weight":
    case "guidance":
      return 0.5;
    case "sdp_ratio":
      return 0.2;
    case "noise_scale":
      return 0.6;
    case "noise_scale_w":
      return 0.8;
    case "tau":
      return 0.3;
    case "repetition_penalty":
      return 1.2;
    default:
      return control.min ?? 0.5;
  }
}

export function tuningNumberDefault(
  control: TtsAdvancedControlDescriptor,
  fallback: number,
) {
  return control.default_value?.kind === "number"
    ? control.default_value.value
    : fallback;
}

export function tuningNumberValue(
  tuning: TtsVoiceTuningSettings,
  control: TtsAdvancedControlDescriptor,
) {
  switch (control.id) {
    case "tempo_rate":
    case "speed":
      return tuning.tempo_rate ?? tuningNumberDefault(control, 1);
    case "expressiveness":
      return tuning.expressiveness ?? tuningNumberDefault(control, 0.5);
    case "exaggeration":
      return tuning.exaggeration ?? tuningNumberDefault(control, 0.5);
    case "randomness":
      return tuning.randomness ?? tuningNumberDefault(control, 0.7);
    case "guidance":
      return tuning.guidance ?? tuningNumberDefault(control, 0.5);
    case "stability":
      return tuning.stability ?? tuningNumberDefault(control, 0.5);
    case "repetition_penalty":
      return tuning.repetition_penalty ?? tuningNumberDefault(control, 1.2);
    default: {
      const override = tuning.advanced_overrides?.[control.id];
      return override?.kind === "number"
        ? override.value
        : tuningNumberDefault(control, tuningFallbackDefault(control));
    }
  }
}

export function tuningNumberPatch(
  tuning: TtsVoiceTuningSettings,
  control: TtsAdvancedControlDescriptor,
  value: number,
): Partial<TtsVoiceTuningSettings> {
  switch (control.id) {
    case "tempo_rate":
    case "speed":
      return { tempo_rate: value };
    case "expressiveness":
      return { expressiveness: value };
    case "exaggeration":
      return { exaggeration: value };
    case "randomness":
      return { randomness: value };
    case "guidance":
      return { guidance: value };
    case "stability":
      return { stability: value };
    case "repetition_penalty":
      return { repetition_penalty: value };
    default:
      return {
        advanced_overrides: {
          ...(tuning.advanced_overrides ?? {}),
          [control.id]: { kind: "number", value },
        },
      };
  }
}

export function tuningFormatValue(control: TtsAdvancedControlDescriptor) {
  if (
    control.unit === "x" ||
    control.id === "tempo_rate" ||
    control.id === "speed"
  ) {
    return (value: number) => `${value.toFixed(2)}x`;
  }
  if (
    control.id.includes("top_p") ||
    control.id.includes("min_p") ||
    control.id === "randomness" ||
    control.id === "guidance" ||
    control.id === "cfg_weight" ||
    control.id === "sdp_ratio" ||
    control.id === "noise_scale" ||
    control.id === "noise_scale_w" ||
    control.id === "tau" ||
    control.id === "expressiveness" ||
    control.id === "exaggeration" ||
    control.id === "stability"
  ) {
    return (value: number) => `${Math.round(value * 100)}%`;
  }
  if (control.id.includes("top_k") || control.id.includes("tokens")) {
    return (value: number) => `${Math.round(value)}`;
  }
  if (control.id.includes("steps")) {
    return (value: number) => `${Math.round(value)}`;
  }
  return (value: number) => value.toFixed(2);
}

export function tuningRangeHint(control: TtsAdvancedControlDescriptor) {
  switch (control.id) {
    case "tempo_rate":
    case "speed":
      return { left: "Slower", right: "Faster" };
    case "expressiveness":
      return { left: "Calm", right: "Vivid" };
    case "exaggeration":
      return { left: "Subtle", right: "Pushed" };
    case "randomness":
      return { left: "Predictable", right: "Varied" };
    case "guidance":
    case "cfg_weight":
      return { left: "Loose", right: "On-style" };
    case "stability":
      return { left: "Loose", right: "Steady" };
    case "repetition_penalty":
      return { left: "Light", right: "Strong" };
    case "top_p":
    case "min_p":
      return { left: "Focused", right: "Open" };
    case "top_k":
      return { left: "Narrow", right: "Wide" };
    case "quality_steps":
      return { left: "Faster", right: "Higher quality" };
    default:
      return undefined;
  }
}
