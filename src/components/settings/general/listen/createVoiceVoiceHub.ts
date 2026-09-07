import type { VoiceInfo } from "@/bindings";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import {
  voiceCapabilityFlagsForModel,
  type VoiceCapabilityFlags,
} from "./voiceCapabilities";

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
  capabilities: VoiceCapabilityFlags;
  searchText: string;
}

const VOICE_AVATAR_GRADIENTS = [
  ["var(--accent-gold)", "var(--success)", "var(--info)"],
  ["var(--voice)", "var(--accent-gold)", "var(--accent-2)"],
  ["var(--success)", "var(--accent-teal)", "var(--voice)"],
  ["var(--info)", "var(--accent-2)", "var(--voice)"],
  ["var(--danger)", "var(--accent-2)", "var(--info)"],
  ["var(--accent-gold)", "var(--voice)", "var(--accent-teal)"],
  ["var(--muted)", "var(--surface-elevated)", "var(--info)"],
  ["var(--warning)", "var(--voice)", "var(--accent-2)"],
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
  HK: "Hong Kong",
  IN: "Indian",
  IT: "Italian",
  JP: "Japanese",
  KR: "Korean",
  MX: "Mexican",
  NL: "Dutch",
  PT: "Portuguese",
  SG: "Singapore",
  TW: "Taiwanese",
  US: "US",
};

const LANGUAGE_DEFAULT_REGIONS: Record<string, string> = {
  ar: "SA",
  be: "BY",
  bg: "BG",
  bn: "BD",
  cs: "CZ",
  da: "DK",
  de: "DE",
  el: "GR",
  en: "US",
  es: "ES",
  et: "EE",
  fa: "IR",
  fi: "FI",
  fr: "FR",
  he: "IL",
  hi: "IN",
  hr: "HR",
  hu: "HU",
  id: "ID",
  it: "IT",
  ja: "JP",
  ka: "GE",
  kk: "KZ",
  kn: "IN",
  ko: "KR",
  lt: "LT",
  lv: "LV",
  ms: "MY",
  nl: "NL",
  no: "NO",
  pl: "PL",
  pt: "PT",
  ro: "RO",
  ru: "RU",
  sk: "SK",
  sl: "SI",
  sv: "SE",
  sw: "KE",
  ta: "IN",
  te: "IN",
  th: "TH",
  tr: "TR",
  uk: "UA",
  ur: "PK",
  vi: "VN",
  zh: "CN",
  "zh-cn": "CN",
  "zh-hans": "CN",
  "zh-hant": "TW",
  "zh-hk": "HK",
  "zh-tw": "TW",
};

export function splitCompoundLocales(
  locale: string | null | undefined,
): string[] {
  if (!locale) return [];
  return locale
    .split(/[/,+&]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

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
  const trimmed = voiceId.trim().toLowerCase();
  const prefix = trimmed.split("_")[0] ?? "";
  if (
    /^[a-z]f$/.test(prefix) ||
    /^f\d+$/.test(prefix) ||
    prefix === "female" ||
    /(?:^|[_-])(?:female|woman|girl)(?:$|[_-])/.test(trimmed)
  ) {
    return "female";
  }
  if (
    /^[a-z]m$/.test(prefix) ||
    /^m\d+$/.test(prefix) ||
    prefix === "male" ||
    /(?:^|[_-])(?:male|man|boy)(?:$|[_-])/.test(trimmed)
  ) {
    return "male";
  }
  return null;
}

export function normalizeVoiceLocale(
  voice: Pick<VoiceInfo, "locale"> | null | undefined,
  model: Pick<CatalogModelDescriptor, "locale" | "supported_languages">,
) {
  if (voice?.locale) return voice.locale;
  if (model.locale) return model.locale;
  const supported = model.supported_languages.filter((language) =>
    language.trim(),
  );
  if (
    supported.some(
      (lang) =>
        lang.toLowerCase() === "mul" || lang.toLowerCase() === "multiple",
    ) ||
    supported.length > 2
  ) {
    return "mul";
  }
  if (supported.length > 0 && supported.length <= 2) {
    return supported.join("/");
  }
  return supported[0] ?? null;
}

export function voiceLanguageFromLocale(locale: string | null | undefined) {
  if (!locale) return null;
  const parts = splitCompoundLocales(locale);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return parts[0].split(/[-_]/)[0]?.toLowerCase() || null;
  }
  return parts
    .map((part) => part.toLowerCase())
    .filter(Boolean)
    .join("/");
}

function regionFromLocale(locale: string | null | undefined) {
  const parts = locale?.split(/[-_]/).filter(Boolean) ?? [];
  const region = parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part));
  if (!region) return null;
  return region.toUpperCase();
}

export function voiceAccentFromLocale(locale: string | null | undefined) {
  const parts = splitCompoundLocales(locale);
  if (parts.length > 1) return null;
  const region = regionFromLocale(locale);
  if (!region) return null;
  if (REGION_NAMES[region]) return REGION_NAMES[region];
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" }).of(
      region,
    );
    if (display) return display;
  } catch {
    // fallback to region code
  }
  return region;
}

function flagFromRegion(region: string | null | undefined) {
  if (!region || !/^[A-Z]{2}$/.test(region)) return null;
  return Array.from(region)
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

function singleLocaleFlag(subLocale: string): string[] {
  const trimmed = subLocale.trim().toLowerCase();
  if (trimmed === "mul" || trimmed === "multiple") {
    return ["🌐"];
  }
  const parts = subLocale.split(/[-_]/).filter(Boolean);
  const language = parts[0]?.toLowerCase() || null;
  const explicitRegion =
    parts
      .slice(1)
      .find((part) => /^[A-Za-z]{2}$/.test(part))
      ?.toUpperCase() || null;
  const defaultRegion = language
    ? (LANGUAGE_DEFAULT_REGIONS[language] ?? null)
    : null;

  if (
    language === "zh" &&
    explicitRegion &&
    (explicitRegion === "TW" || explicitRegion === "HK")
  ) {
    return [flagFromRegion(explicitRegion)].filter(Boolean) as string[];
  }

  const flags = [flagFromRegion(defaultRegion)];
  if (explicitRegion && explicitRegion !== defaultRegion) {
    flags.push(flagFromRegion(explicitRegion));
  }
  return flags.filter(Boolean) as string[];
}

export function countryFlagFromLocale(locale: string | null | undefined) {
  if (!locale) return null;
  const trimmed = locale.trim().toLowerCase();
  if (trimmed === "mul" || trimmed === "multiple") return "🌐";

  const subLocales = splitCompoundLocales(locale);
  if (subLocales.length === 0) return null;

  if (subLocales.length === 1) {
    const flags = singleLocaleFlag(subLocales[0]);
    return flags.join("") || null;
  }

  const flags: string[] = [];
  for (const sub of subLocales) {
    const subLower = sub.trim().toLowerCase();
    if (subLower === "mul" || subLower === "multiple") {
      if (!flags.includes("🌐")) flags.push("🌐");
      continue;
    }
    const parts = sub.split(/[-_]/).filter(Boolean);
    const lang = parts[0]?.toLowerCase() || null;
    const explicitRegion =
      parts
        .slice(1)
        .find((part) => /^[A-Za-z]{2}$/.test(part))
        ?.toUpperCase() || null;

    if (explicitRegion) {
      const flag = flagFromRegion(explicitRegion);
      if (flag && !flags.includes(flag)) flags.push(flag);
    } else if (LANGUAGE_DEFAULT_REGIONS[subLower]) {
      const flag = flagFromRegion(LANGUAGE_DEFAULT_REGIONS[subLower]);
      if (flag && !flags.includes(flag)) flags.push(flag);
    } else if (lang && LANGUAGE_DEFAULT_REGIONS[lang]) {
      const flag = flagFromRegion(LANGUAGE_DEFAULT_REGIONS[lang]);
      if (flag && !flags.includes(flag)) flags.push(flag);
    }
  }

  return flags.join("") || null;
}

export function languageDisplayName(
  languageOrLocale: string | null | undefined,
): string | null {
  if (!languageOrLocale) return null;
  const parts = splitCompoundLocales(languageOrLocale);
  if (parts.length === 0) return null;

  const names = parts
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return null;
      const lower = trimmed.toLowerCase();
      if (lower === "mul" || lower === "multiple") {
        return "Multiple languages";
      }
      if (lower === "zh-tw" || lower === "zh-hant" || lower === "zh-hant-tw") {
        return "Chinese (Taiwan)";
      }
      if (lower === "zh-cn" || lower === "zh-hans") {
        return "Chinese (Simplified)";
      }
      if (lower === "zh-hk") {
        return "Chinese (Hong Kong)";
      }
      try {
        const display = new Intl.DisplayNames(["en"], {
          type: "language",
        }).of(trimmed);
        if (display && display.toLowerCase() !== lower) {
          return display;
        }
      } catch {
        // subtag fallback below
      }
      const langSubtag = trimmed.split(/[-_]/)[0]?.toLowerCase();
      if (langSubtag && langSubtag !== lower) {
        try {
          const display = new Intl.DisplayNames(["en"], {
            type: "language",
          }).of(langSubtag);
          if (display) return display;
        } catch {
          // ignore
        }
      }
      return trimmed.toUpperCase();
    })
    .filter(Boolean) as string[];

  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return names.join(", ");
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
      const capabilities = voiceCapabilityFlagsForModel(model);
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
        capabilities,
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
          capabilities.supportsExpressions ? "expressions" : null,
          capabilities.supportsPrompts ? "prompts" : null,
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
