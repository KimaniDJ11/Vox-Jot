import type { CatalogModelDescriptor } from "@/lib/modelPlatform";

export type TtsExpressionControlKind =
  | "fixed_inline_tags"
  | "freeform_inline_tags"
  | "instruction_prompt"
  | "both"
  | "none";

export type TtsExpressionTagSyntax =
  | "square_brackets"
  | "parentheses"
  | "speaker_plus_parentheses";

export interface TtsExpressionTag {
  value: string;
  label: string;
  group: string;
}

export interface TtsExpressionCapability {
  kind: TtsExpressionControlKind;
  tagSyntax?: TtsExpressionTagSyntax;
  tags: TtsExpressionTag[];
  allowCustomTags: boolean;
  supportsInstructions: boolean;
  emptyLabel: string;
}

const FISH_S2_TAGS = [
  ...tags(
    [
      "[clears throat]",
      "[inhalation]",
      "[inhale]",
      "[exhale]",
      "[sigh]",
      "[panting]",
      "[breathing]",
      "[gasp]",
    ],
    "Fish S2 breathing",
  ),
  ...tags(
    [
      "[groan]",
      "[moaning]",
      "[sobbing]",
      "[crying]",
      "[laughing]",
      "[chuckling]",
      "[giggle]",
    ],
    "Fish S2 vocal sounds",
  ),
  ...tags(["[pause]", "[short pause]", "[long pause]"], "Fish S2 pacing"),
  ...tags(
    [
      "[whispering]",
      "[whispering voice]",
      "[soft voice]",
      "[low voice]",
      "[loud voice]",
      "[shouting]",
    ],
    "Fish S2 voice style",
  ),
  ...tags(
    [
      "[happy]",
      "[sad]",
      "[angry]",
      "[excited]",
      "[calm]",
      "[nervous]",
      "[confident]",
      "[surprised]",
      "[satisfied]",
      "[delighted]",
      "[scared]",
      "[worried]",
      "[upset]",
      "[frustrated]",
      "[depressed]",
      "[empathetic]",
      "[embarrassed]",
      "[disgusted]",
      "[moved]",
      "[proud]",
      "[relaxed]",
      "[grateful]",
      "[curious]",
      "[sarcastic]",
    ],
    "Fish emotions",
  ),
  ...tags(
    [
      "[disdainful]",
      "[unhappy]",
      "[anxious]",
      "[hysterical]",
      "[indifferent]",
      "[uncertain]",
      "[doubtful]",
      "[confused]",
      "[disappointed]",
      "[regretful]",
      "[guilty]",
      "[ashamed]",
      "[jealous]",
      "[envious]",
      "[hopeful]",
      "[optimistic]",
      "[pessimistic]",
      "[nostalgic]",
      "[lonely]",
      "[bored]",
      "[contemptuous]",
      "[sympathetic]",
      "[compassionate]",
      "[determined]",
      "[resigned]",
    ],
    "Fish advanced emotions",
  ),
  ...tags(
    ["[in a hurry tone]", "[screaming]", "[soft tone]"],
    "Fish tone markers",
  ),
  ...tags(
    [
      "[crying loudly]",
      "[sighing]",
      "[groaning]",
      "[gasping]",
      "[yawning]",
      "[snoring]",
    ],
    "Fish audio effects",
  ),
  ...tags(
    [
      "[audience laughing]",
      "[background laughter]",
      "[crowd laughing]",
      "[break]",
      "[long-break]",
      "[emphasis]",
      "[rustling sound]",
    ],
    "Fish special effects",
  ),
];

const CHATTERBOX_TURBO_TAGS = [
  "[advertisement]",
  "[angry]",
  "[chuckle]",
  "[clear throat]",
  "[cough]",
  "[crying]",
  "[dramatic]",
  "[fear]",
  "[gasp]",
  "[groan]",
  "[happy]",
  "[laugh]",
  "[narration]",
  "[sarcastic]",
  "[shush]",
  "[sigh]",
  "[sniff]",
  "[surprised]",
  "[whispering]",
].map((value) => tag(value, "Chatterbox Turbo"));

const DIA_TAGS = [
  "[S1]",
  "[S2]",
  "(laughs)",
  "(clears throat)",
  "(sighs)",
  "(gasps)",
  "(coughs)",
  "(singing)",
  "(sings)",
  "(mumbles)",
  "(beep)",
  "(groans)",
  "(sniffs)",
  "(claps)",
  "(screams)",
  "(inhales)",
  "(exhales)",
  "(applause)",
  "(burps)",
  "(humming)",
  "(sneezes)",
  "(chuckle)",
  "(whistles)",
].map((value) => tag(value, value.startsWith("[S") ? "Speakers" : "Dia cues"));

const BARK_TAGS = [
  "[laughter]",
  "[laughs]",
  "[sighs]",
  "[music]",
  "[gasps]",
  "[clears throat]",
  "[MAN]",
  "[WOMAN]",
  "—",
  "♪",
  "...",
].map((value) => tag(value, "Bark cues"));

export const INSTRUCTION_PRESETS = [
  "warm, calm, and intimate",
  "excited and energetic",
  "softly whispered",
  "confident narrator voice",
  "sad and reflective",
  "fast comedic timing",
];

export function expressionCapabilityForModel(
  model: Pick<
    CatalogModelDescriptor,
    "id" | "provider_id" | "label" | "capabilities"
  > | null,
): TtsExpressionCapability {
  if (!model) {
    return noneCapability("Move the cursor to a character line.");
  }

  const modelId = model.id.toLowerCase();
  const providerId = model.provider_id.toLowerCase();
  const supportsInstructions = model.capabilities.supports_instruction_prompt;

  if (modelId.includes("fish-audio-s2-pro")) {
    return inlineCapability({
      kind: supportsInstructions ? "both" : "freeform_inline_tags",
      tagSyntax: "square_brackets",
      tags: FISH_S2_TAGS,
      allowCustomTags: true,
      supportsInstructions,
    });
  }

  if (modelId.includes("chatterbox-turbo")) {
    return inlineCapability({
      kind: supportsInstructions ? "both" : "fixed_inline_tags",
      tagSyntax: "square_brackets",
      tags: CHATTERBOX_TURBO_TAGS,
      allowCustomTags: false,
      supportsInstructions,
    });
  }

  if (modelId === "dia-1.6b" || providerId.includes("dia")) {
    return inlineCapability({
      kind: supportsInstructions ? "both" : "fixed_inline_tags",
      tagSyntax: "speaker_plus_parentheses",
      tags: DIA_TAGS,
      allowCustomTags: false,
      supportsInstructions,
    });
  }

  if (modelId === "bark-small" || providerId.includes("bark")) {
    return inlineCapability({
      kind: supportsInstructions ? "both" : "fixed_inline_tags",
      tagSyntax: "square_brackets",
      tags: BARK_TAGS,
      allowCustomTags: false,
      supportsInstructions,
    });
  }

  if (model.capabilities.supports_inline_tags) {
    return inlineCapability({
      kind: supportsInstructions ? "both" : "fixed_inline_tags",
      tagSyntax: "square_brackets",
      tags: [],
      allowCustomTags: false,
      supportsInstructions,
    });
  }

  if (supportsInstructions) {
    return {
      kind: "instruction_prompt",
      tags: [],
      allowCustomTags: false,
      supportsInstructions: true,
      emptyLabel: "Instruction prompt available",
    };
  }

  return noneCapability("No expression controls for this voice");
}

export function supportsExpressionControls(
  capability: TtsExpressionCapability,
) {
  return capability.kind !== "none";
}

function inlineCapability(
  capability: Omit<TtsExpressionCapability, "emptyLabel">,
): TtsExpressionCapability {
  return {
    ...capability,
    emptyLabel: capability.tags.length
      ? "Expression tags available"
      : "Inline tags available",
  };
}

function noneCapability(emptyLabel: string): TtsExpressionCapability {
  return {
    kind: "none",
    tags: [],
    allowCustomTags: false,
    supportsInstructions: false,
    emptyLabel,
  };
}

function tag(value: string, group: string): TtsExpressionTag {
  return {
    value,
    label: value.replace(/^\[|\]$|^\(|\)$/g, ""),
    group,
  };
}

function tags(values: string[], group: string): TtsExpressionTag[] {
  const seen = new Set<string>();
  return values
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    })
    .map((value) => tag(value, group));
}
