export type ProductModuleTier = "core" | "advanced" | "lab";

export interface ProductModuleDescriptor {
  id: string;
  tier: ProductModuleTier;
  sectionIds: string[];
  hotPath: boolean;
  enabledByDefault: boolean;
}

export const PRODUCT_MODULES: ProductModuleDescriptor[] = [
  {
    id: "dictation",
    tier: "core",
    sectionIds: [
      "history",
      "corrections",
      "file-transcription",
      "reader",
      "enhance-audio",
      "general",
      "shortcuts",
      "recording-devices",
      "output-paste",
      "corrections-settings",
      "privacy",
      "about",
    ],
    hotPath: true,
    enabledByDefault: true,
  },
  {
    id: "refine",
    tier: "advanced",
    sectionIds: [
      "write-profiles",
      "phrase-keys",
      "translation",
      "ai-setup",
      "screen-context",
    ],
    hotPath: false,
    enabledByDefault: true,
  },
  {
    id: "listen",
    tier: "advanced",
    sectionIds: [
      "voice-design",
      "voice-cloning",
      "voice-changer",
      "story-studio",
      "story-audio-history",
    ],
    hotPath: false,
    enabledByDefault: true,
  },
  {
    id: "lab",
    tier: "lab",
    sectionIds: ["model-testing", "automation-agents"],
    hotPath: false,
    enabledByDefault: false,
  },
  {
    id: "diagnostics",
    tier: "advanced",
    sectionIds: ["diagnostics", "legal-model-terms"],
    hotPath: false,
    enabledByDefault: true,
  },
];

const SECTION_TO_MODULE = new Map(
  PRODUCT_MODULES.flatMap((module) =>
    module.sectionIds.map((sectionId) => [sectionId, module] as const),
  ),
);

export function productModuleForSection(
  sectionId: string,
): ProductModuleDescriptor | undefined {
  return SECTION_TO_MODULE.get(sectionId);
}

export function isProductSectionVisible(
  sectionId: string,
  experimentalEnabled: boolean,
): boolean {
  const module = productModuleForSection(sectionId);
  if (!module) return true;
  if (module.tier !== "lab") return true;
  return experimentalEnabled;
}
