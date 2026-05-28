// Single source of truth for the 10 overrideable fields on a Write
// Profile. The editor used to render every field with a "Use global
// setting" sentinel as the first dropdown option, which produced rows
// of "Use global setting / Use global setting / Use global setting"
// for any partially-customized profile. The redesign flips that: the
// editor only shows overrides the user has actually opted into, and
// "Use global setting" is implicit (an override row simply isn't
// there).
//
// Each spec carries everything the UI needs to render one override:
// label, group, current value, the dropdown options, plus a
// `defaultValueWhenAdded` so clicking "Add override" lands the user on
// a sensible value rather than re-implementing "global" via the
// override slot.

import type {
  LLMPrompt,
  ModelInfo,
  PasteMethod,
  ToneDefinition,
  WriteRuleOverrides,
} from "@/bindings";
import { LANGUAGES } from "@/lib/constants/languages";

export type OverrideKey =
  | "stt_model_id"
  | "stt_language"
  | "translate_to_english"
  | "tone_id"
  | "post_process_prompt_id"
  | "force_post_process"
  | "auto_submit"
  | "paste_method"
  | "append_trailing_space"
  | "mute_while_recording";

export type OverrideGroup = "speech" | "refine" | "output";

export interface OverrideContext {
  models: ModelInfo[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
}

export interface OverrideSpec {
  key: OverrideKey;
  group: OverrideGroup;
  label: string;
  /** Short hint shown next to the editor when active. */
  description?: string;
  isActive: (overrides: WriteRuleOverrides) => boolean;
  /** Human-readable label for the *current* value of this override. */
  currentValueLabel: (
    overrides: WriteRuleOverrides,
    context: OverrideContext,
  ) => string;
  /** Options to show when editing the value. */
  options: (
    context: OverrideContext,
  ) => Array<{ value: string; label: string }>;
  /** Reads the override as a stringified value for the dropdown. */
  readValue: (overrides: WriteRuleOverrides) => string;
  /** Applies a chosen value, returning the new overrides object. */
  applyValue: (
    overrides: WriteRuleOverrides,
    value: string,
  ) => WriteRuleOverrides;
  /** Removes this override (back to the global setting). */
  reset: (overrides: WriteRuleOverrides) => WriteRuleOverrides;
  /**
   * Builds the value to use the first time this override is added so
   * the user lands on a sensible non-global default instead of a no-op.
   * Returns null when no usable default exists (e.g. tone with empty
   * tone list) — caller should disable the "Add" affordance.
   */
  defaultValueWhenAdded: (
    overrides: WriteRuleOverrides,
    context: OverrideContext,
  ) => WriteRuleOverrides | null;
}

const triState = (
  overrides: WriteRuleOverrides,
  key:
    | "translate_to_english"
    | "auto_submit"
    | "append_trailing_space"
    | "mute_while_recording"
    | "force_post_process",
) => overrides[key];

const onOffOptions = (onLabel: string, offLabel: string) => [
  { value: "on", label: onLabel },
  { value: "off", label: offLabel },
];

export const PASTE_METHOD_LABELS: Record<PasteMethod, string> = {
  ctrl_v: "Clipboard paste",
  direct: "Direct type",
  none: "Do not paste",
  ctrl_shift_v: "Ctrl+Shift+V",
  shift_insert: "Shift+Insert",
  external_script: "External script",
};

const PASTE_METHOD_ORDER: PasteMethod[] = [
  "ctrl_v",
  "direct",
  "none",
  "ctrl_shift_v",
  "shift_insert",
  "external_script",
];

export const OVERRIDE_REGISTRY: OverrideSpec[] = [
  // ─── Speech ─────────────────────────────────────────────────────
  {
    key: "stt_model_id",
    group: "speech",
    label: "STT model",
    description: "Use a different speech-to-text engine here.",
    isActive: (o) => Boolean(o.stt_model_id),
    currentValueLabel: (o, { models }) =>
      models.find((m) => m.id === o.stt_model_id)?.name ?? o.stt_model_id ?? "",
    options: ({ models }) =>
      models.map((m) => ({ value: m.id, label: m.name })),
    readValue: (o) => o.stt_model_id ?? "",
    applyValue: (o, value) => ({ ...o, stt_model_id: value || null }),
    reset: (o) => ({ ...o, stt_model_id: null }),
    defaultValueWhenAdded: (o, { models }) => {
      if (models.length === 0) return null;
      return { ...o, stt_model_id: models[0].id };
    },
  },
  {
    key: "stt_language",
    group: "speech",
    label: "Language",
    description: "Force a specific input language for this mode.",
    isActive: (o) => Boolean(o.stt_language),
    currentValueLabel: (o) =>
      LANGUAGES.find((l) => l.value === o.stt_language)?.label ??
      o.stt_language ??
      "",
    options: () => LANGUAGES.map((l) => ({ value: l.value, label: l.label })),
    readValue: (o) => o.stt_language ?? "",
    applyValue: (o, value) => ({ ...o, stt_language: value || null }),
    reset: (o) => ({ ...o, stt_language: null }),
    defaultValueWhenAdded: (o) => ({ ...o, stt_language: "en" }),
  },
  {
    key: "translate_to_english",
    group: "speech",
    label: "Translate to English",
    description: "Override Whisper translation behavior.",
    isActive: (o) => typeof o.translate_to_english === "boolean",
    currentValueLabel: (o) =>
      o.translate_to_english
        ? "Translate to English"
        : "Keep original language",
    options: () =>
      onOffOptions("Translate to English", "Keep original language"),
    readValue: (o) => (triState(o, "translate_to_english") ? "on" : "off"),
    applyValue: (o, value) => ({
      ...o,
      translate_to_english: value === "on",
    }),
    reset: (o) => ({ ...o, translate_to_english: null }),
    defaultValueWhenAdded: (o) => ({ ...o, translate_to_english: true }),
  },

  // ─── Refine ─────────────────────────────────────────────────────
  {
    key: "tone_id",
    group: "refine",
    label: "Tone",
    description: "Choose the writing voice used during cleanup.",
    isActive: (o) => Boolean(o.tone_id),
    currentValueLabel: (o, { tones }) =>
      tones.find((t) => t.id === o.tone_id)?.label ?? o.tone_id ?? "",
    options: ({ tones }) =>
      tones.map((t) => ({ value: t.id, label: t.label || t.id })),
    readValue: (o) => o.tone_id ?? "",
    applyValue: (o, value) => ({ ...o, tone_id: value || null }),
    reset: (o) => ({ ...o, tone_id: null }),
    defaultValueWhenAdded: (o, { tones }) => {
      if (tones.length === 0) return null;
      return { ...o, tone_id: tones[0].id };
    },
  },
  {
    key: "post_process_prompt_id",
    group: "refine",
    label: "Post-process prompt",
    description: "Use a specific cleanup prompt for this mode.",
    isActive: (o) => Boolean(o.post_process_prompt_id),
    currentValueLabel: (o, { prompts }) =>
      prompts.find((p) => p.id === o.post_process_prompt_id)?.name ??
      o.post_process_prompt_id ??
      "",
    options: ({ prompts }) =>
      prompts.map((p) => ({ value: p.id, label: p.name })),
    readValue: (o) => o.post_process_prompt_id ?? "",
    applyValue: (o, value) => ({
      ...o,
      post_process_prompt_id: value || null,
    }),
    reset: (o) => ({ ...o, post_process_prompt_id: null }),
    defaultValueWhenAdded: (o, { prompts }) => {
      if (prompts.length === 0) return null;
      return { ...o, post_process_prompt_id: prompts[0].id };
    },
  },
  {
    key: "force_post_process",
    group: "refine",
    label: "Post-processing",
    description: "Force AI post-processing on or off when this mode matches.",
    isActive: (o) => typeof o.force_post_process === "boolean",
    currentValueLabel: (o) =>
      o.force_post_process
        ? "Always run post-processing"
        : "Skip post-processing",
    options: () =>
      onOffOptions("Always run post-processing", "Skip post-processing"),
    readValue: (o) => (triState(o, "force_post_process") ? "on" : "off"),
    applyValue: (o, value) => ({
      ...o,
      force_post_process: value === "on",
    }),
    reset: (o) => ({ ...o, force_post_process: null }),
    defaultValueWhenAdded: (o) => ({ ...o, force_post_process: true }),
  },
  {
    key: "auto_submit",
    group: "refine",
    label: "Auto-submit",
    description: "Press Enter automatically after dictating.",
    isActive: (o) => typeof o.auto_submit === "boolean",
    currentValueLabel: (o) =>
      o.auto_submit ? "Auto-submit" : "Don't auto-submit",
    options: () => onOffOptions("Auto-submit", "Don't auto-submit"),
    readValue: (o) => (triState(o, "auto_submit") ? "on" : "off"),
    applyValue: (o, value) => ({
      ...o,
      auto_submit: value === "on",
    }),
    reset: (o) => ({ ...o, auto_submit: null }),
    defaultValueWhenAdded: (o) => ({ ...o, auto_submit: true }),
  },

  // ─── Output ─────────────────────────────────────────────────────
  {
    key: "paste_method",
    group: "output",
    label: "Paste method",
    isActive: (o) => Boolean(o.paste_method),
    currentValueLabel: (o) =>
      o.paste_method ? PASTE_METHOD_LABELS[o.paste_method] : "",
    options: () =>
      PASTE_METHOD_ORDER.map((value) => ({
        value,
        label: PASTE_METHOD_LABELS[value],
      })),
    readValue: (o) => o.paste_method ?? "",
    applyValue: (o, value) => ({
      ...o,
      paste_method: (value || null) as PasteMethod | null,
    }),
    reset: (o) => ({ ...o, paste_method: null }),
    defaultValueWhenAdded: (o) => ({ ...o, paste_method: "ctrl_v" }),
  },
  {
    key: "append_trailing_space",
    group: "output",
    label: "Trailing space",
    description: "Add a space after dictated text.",
    isActive: (o) => typeof o.append_trailing_space === "boolean",
    currentValueLabel: (o) =>
      o.append_trailing_space ? "Add trailing space" : "No trailing space",
    options: () => onOffOptions("Add trailing space", "No trailing space"),
    readValue: (o) => (triState(o, "append_trailing_space") ? "on" : "off"),
    applyValue: (o, value) => ({
      ...o,
      append_trailing_space: value === "on",
    }),
    reset: (o) => ({ ...o, append_trailing_space: null }),
    defaultValueWhenAdded: (o) => ({ ...o, append_trailing_space: true }),
  },
  {
    key: "mute_while_recording",
    group: "output",
    label: "Mute while recording",
    description: "Silence other apps' audio while this profile records.",
    isActive: (o) => typeof o.mute_while_recording === "boolean",
    currentValueLabel: (o) =>
      o.mute_while_recording ? "Mute while recording" : "Keep audio playing",
    options: () => onOffOptions("Mute while recording", "Keep audio playing"),
    readValue: (o) => (triState(o, "mute_while_recording") ? "on" : "off"),
    applyValue: (o, value) => ({
      ...o,
      mute_while_recording: value === "on",
    }),
    reset: (o) => ({ ...o, mute_while_recording: null }),
    defaultValueWhenAdded: (o) => ({ ...o, mute_while_recording: true }),
  },
];

export const GROUP_LABELS: Record<OverrideGroup, string> = {
  speech: "Speech",
  refine: "Refine",
  output: "Output",
};

export const countActiveOverrides = (overrides: WriteRuleOverrides): number =>
  OVERRIDE_REGISTRY.reduce(
    (count, spec) => count + (spec.isActive(overrides) ? 1 : 0),
    0,
  );

export const resetAllOverrides = (
  overrides: WriteRuleOverrides,
): WriteRuleOverrides =>
  OVERRIDE_REGISTRY.reduce((acc, spec) => spec.reset(acc), overrides);
