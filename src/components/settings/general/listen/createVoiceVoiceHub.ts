import type { VoiceInfo } from "@/bindings";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";

export type InferredVoiceGender = "female" | "male";

export interface CreateVoiceHubVoiceRow {
  id: string;
  providerId: string;
  modelId: string;
  modelLabel: string;
  voiceId: string | null;
  voiceLabel: string;
  locale: string | null;
  language: string | null;
  accent: string | null;
  countryFlag: string | null;
  gender: InferredVoiceGender | null;
  description: string;
  avatarGradient: string;
  searchText: string;
}

const VOICE_AVATAR_GRADIENTS = [
  ["#F9D976", "#8AC6A1", "#7EA7FF"],
  ["#FF8F70", "#FFD86B", "#FF6BAA"],
  ["#84FAB0", "#8FD3F4", "#F8D7FF"],
  ["#A1C4FD", "#C2E9FB", "#FFD6E7"],
  ["#F5576C", "#F093FB", "#4FACFE"],
  ["#FFE29F", "#FFA99F", "#7DD3FC"],
  ["#B8C6DB", "#F5F7FA", "#8EC5FC"],
  ["#F6D365", "#FDA085", "#FBC2EB"],
] as const;

const REGION_NAMES: Record<string, string> = {
  AU: "Australian",
  BR: "Brazilian",
  CA: "Canadian",
  CN: "Chinese",
  DE: "German",
  ES: "Spanish",
  FR: "French",
  GB: "British",
  IN: "Indian",
  IT: "Italian",
  JP: "Japanese",
  KR: "Korean",
  MX: "Mexican",
  NL: "Dutch",
  PT: "Portuguese",
  US: "US",
};

const LANGUAGE_DEFAULT_REGIONS: Record<string, string> = {
  ar: "SA",
  de: "DE",
  en: "US",
  es: "ES",
  fr: "FR",
  hi: "IN",
  it: "IT",
  ja: "JP",
  ko: "KR",
  nl: "NL",
  pt: "PT",
  zh: "CN",
};

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function voiceAvatarGradient(seed: string) {
  const colors =
    VOICE_AVATAR_GRADIENTS[stableHash(seed) % VOICE_AVATAR_GRADIENTS.length];
  const angle = 125 + (stableHash(`${seed}:angle`) % 90);
  return `linear-gradient(${angle}deg, ${colors[0]}, ${colors[1]} 52%, ${colors[2]})`;
}

export function inferVoiceGender(voiceId: string): InferredVoiceGender | null {
  const prefix = voiceId.trim().toLowerCase().split("_")[0] ?? "";
  if (/^[a-z]f$/.test(prefix)) return "female";
  if (/^[a-z]m$/.test(prefix)) return "male";
  return null;
}

export function normalizeVoiceLocale(
  voice: Pick<VoiceInfo, "locale"> | null | undefined,
  model: Pick<CatalogModelDescriptor, "locale" | "supported_languages">,
) {
  return (
    voice?.locale ??
    model.locale ??
    model.supported_languages.find((language) => language.trim()) ??
    null
  );
}

export function voiceLanguageFromLocale(locale: string | null | undefined) {
  return locale?.split(/[-_]/)[0]?.toLowerCase() || null;
}

function regionFromLocale(locale: string | null | undefined) {
  const parts = locale?.split(/[-_]/).filter(Boolean) ?? [];
  const region = parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part));
  if (!region) return null;
  return region.toUpperCase();
}

export function voiceAccentFromLocale(locale: string | null | undefined) {
  const region = regionFromLocale(locale);
  return region ? (REGION_NAMES[region] ?? region) : null;
}

function flagFromRegion(region: string | null | undefined) {
  if (!region || !/^[A-Z]{2}$/.test(region)) return null;
  return Array.from(region)
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

export function countryFlagFromLocale(locale: string | null | undefined) {
  const language = voiceLanguageFromLocale(locale);
  const languageRegion = language
    ? (LANGUAGE_DEFAULT_REGIONS[language] ?? null)
    : null;
  const accentRegion = regionFromLocale(locale);
  const flags = [flagFromRegion(languageRegion)];

  if (accentRegion && accentRegion !== languageRegion) {
    flags.push(flagFromRegion(accentRegion));
  }

  return flags.filter(Boolean).join("") || null;
}

function languageDisplayName(language: string | null) {
  if (!language) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(language);
  } catch {
    return language.toUpperCase();
  }
}

export function voiceDescription(row: {
  gender: InferredVoiceGender | null;
  language: string | null;
  accent: string | null;
  modelLabel: string;
}) {
  const language = languageDisplayName(row.language);
  const tone = row.gender ? `${row.gender} voice preset` : "Voice preset";
  const localePhrase =
    language && row.accent
      ? `${language} (${row.accent})`
      : language
        ? language
        : null;
  return localePhrase
    ? `${tone} for ${localePhrase}, from ${row.modelLabel}.`
    : `${tone} from ${row.modelLabel}.`;
}

export function buildCreateVoiceHubRows(
  models: CatalogModelDescriptor[],
  voicesByModelKey: Map<string, VoiceInfo[]>,
) {
  return models.flatMap((model) => {
    const modelKey = `${model.provider_id}::${model.id}`;
    const voices = voicesByModelKey.get(modelKey);
    const sourceVoices: Array<{ voice: VoiceInfo | null; fallback: boolean }> =
      voices && voices.length > 0
        ? voices.map((voice) => ({ voice, fallback: false }))
        : [{ voice: null, fallback: true }];

    return sourceVoices.map(({ voice, fallback }) => {
      const voiceId = fallback ? null : (voice?.id ?? null);
      const voiceLabel = fallback ? model.label : (voice?.label ?? model.label);
      const locale = normalizeVoiceLocale(voice, model);
      const language = voiceLanguageFromLocale(locale);
      const accent = voiceAccentFromLocale(locale);
      const gender = voiceId ? inferVoiceGender(voiceId) : null;
      const countryFlag = countryFlagFromLocale(locale);
      const seed = `${model.provider_id}::${model.id}::${voiceId ?? "__model__"}`;
      const description = voiceDescription({
        gender,
        language,
        accent,
        modelLabel: model.label,
      });
      return {
        id: seed,
        providerId: model.provider_id,
        modelId: model.id,
        modelLabel: model.label,
        voiceId,
        voiceLabel,
        locale,
        language,
        accent,
        countryFlag,
        gender,
        description,
        avatarGradient: voiceAvatarGradient(seed),
        searchText: [
          voiceLabel,
          voiceId,
          model.label,
          model.id,
          model.provider_id,
          locale,
          language,
          accent,
          gender,
          description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      } satisfies CreateVoiceHubVoiceRow;
    });
  });
}

function voiceLocaleOrder(row: CreateVoiceHubVoiceRow) {
  const locale = row.locale?.toLowerCase() ?? "";
  const language = row.language?.toLowerCase() ?? "";
  const accent = row.accent?.toLowerCase() ?? "";

  if (locale === "en-us" || (language === "en" && accent === "us")) {
    return 0;
  }
  if (language === "en" && accent) {
    return 1;
  }
  if (language === "en") {
    return 2;
  }
  if (accent) {
    return 3;
  }
  if (language) {
    return 4;
  }
  return 5;
}

export function orderCreateVoiceHubRows(rows: CreateVoiceHubVoiceRow[]) {
  return [...rows].sort((left, right) => {
    const localeDelta = voiceLocaleOrder(left) - voiceLocaleOrder(right);
    if (localeDelta !== 0) return localeDelta;

    return (
      (left.accent ?? "").localeCompare(right.accent ?? "") ||
      (left.language ?? "").localeCompare(right.language ?? "") ||
      left.modelLabel.localeCompare(right.modelLabel) ||
      left.voiceLabel.localeCompare(right.voiceLabel) ||
      left.id.localeCompare(right.id)
    );
  });
}
