import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";

export interface StoryCastMemberDraft {
  id: string;
  characterName: string;
  presetId: string;
}

export interface StoryScriptLine {
  speaker: string;
  text: string;
  lineNumber: number;
}

export interface StoryValidationResult {
  lines: StoryScriptLine[];
  errors: string[];
}

export interface StorySoundCueReference {
  id: string;
}

export function parseStoryScript(scriptText: string): StoryValidationResult {
  const lines: StoryScriptLine[] = [];
  const errors: string[] = [];
  let hasRenderableLine = false;

  scriptText.split(/\r?\n/).forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      return;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      if (containsOnlySoundTags(trimmed)) {
        hasRenderableLine = true;
        return;
      }
      errors.push(`Line ${index + 1} needs "Character: dialogue".`);
      return;
    }

    const speaker = trimmed.slice(0, separatorIndex).trim();
    const rawText = trimmed.slice(separatorIndex + 1).trim();
    const text = stripSoundTags(rawText).trim();
    if (!speaker || (!text && !containsSoundTag(rawText))) {
      errors.push(`Line ${index + 1} needs both a character and dialogue.`);
      return;
    }

    hasRenderableLine = true;
    if (text) {
      lines.push({ speaker, text, lineNumber: index + 1 });
    }
  });

  if (scriptText.trim() && !hasRenderableLine && errors.length === 0) {
    errors.push("Write at least one script line.");
  }

  return { lines, errors };
}

export function validateStoryDraft(
  cast: StoryCastMemberDraft[],
  scriptText: string,
  presets: TtsVoicePreset[],
  sounds: StorySoundCueReference[] = [],
): StoryValidationResult {
  const parsed = parseStoryScript(scriptText);
  const errors = [...parsed.errors];
  const presetIds = new Set(presets.map((preset) => preset.id));
  const castNames = new Set<string>();
  const soundIds = new Set(sounds.map((sound) => sound.id));

  if (cast.length === 0) {
    errors.push("Add at least one character.");
  }

  cast.forEach((member) => {
    const name = member.characterName.trim();
    const normalizedName = normalizeStoryName(name);
    if (!name) {
      errors.push("Every cast member needs a character name.");
      return;
    }
    if (castNames.has(normalizedName)) {
      errors.push(`Duplicate character name "${name}".`);
    }
    castNames.add(normalizedName);
    if (!member.presetId || !presetIds.has(member.presetId)) {
      errors.push(`Choose a saved voice preset for "${name}".`);
    }
  });

  if (!scriptText.trim()) {
    errors.push("Write a script before generating audio.");
  }

  parsed.lines.forEach((line) => {
    if (!castNames.has(normalizeStoryName(line.speaker))) {
      errors.push(
        `Line ${line.lineNumber}: "${line.speaker}" appears in the script but is not in the cast.`,
      );
    }
  });

  validateSoundTags(scriptText, soundIds).forEach((error) =>
    errors.push(error),
  );

  return { lines: parsed.lines, errors: uniqueErrors(errors) };
}

export function normalizeStoryName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function uniqueErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
}

const storySoundTagPattern = /\[sound\s+[^\]\n]{1,512}\]/g;
const storySoundTagAttributePattern = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;

function containsSoundTag(value: string): boolean {
  storySoundTagPattern.lastIndex = 0;
  return storySoundTagPattern.test(value);
}

function containsOnlySoundTags(value: string): boolean {
  if (!containsSoundTag(value)) {
    return false;
  }
  storySoundTagPattern.lastIndex = 0;
  return value.replace(storySoundTagPattern, "").trim().length === 0;
}

function stripSoundTags(value: string): string {
  storySoundTagPattern.lastIndex = 0;
  return value.replace(storySoundTagPattern, " ").replace(/\s{2,}/g, " ");
}

function validateSoundTags(
  scriptText: string,
  soundIds: Set<string>,
): string[] {
  const errors: string[] = [];
  scriptText.split(/\r?\n/).forEach((rawLine, index) => {
    storySoundTagPattern.lastIndex = 0;
    for (const match of rawLine.matchAll(storySoundTagPattern)) {
      const tag = match[0];
      const attrsText = tag.slice("[sound".length, -1);
      const attrs = new Map<string, string>();
      storySoundTagAttributePattern.lastIndex = 0;
      for (const attrMatch of attrsText.matchAll(
        storySoundTagAttributePattern,
      )) {
        attrs.set(attrMatch[1].toLowerCase(), attrMatch[2].trim());
      }
      const id = attrs.get("id");
      if (!id) {
        errors.push(
          `Line ${index + 1}: sound tags need id="..." from the Sounds picker.`,
        );
        continue;
      }
      const mode = (attrs.get("mode") ?? "insert").toLowerCase();
      if (mode !== "insert" && mode !== "overlay") {
        errors.push(
          `Line ${index + 1}: sound tag mode must be "insert" or "overlay".`,
        );
      }
      if (soundIds.size > 0 && !soundIds.has(id)) {
        errors.push(
          `Line ${index + 1}: sound cue "${id}" is not in this project.`,
        );
      }
    }

    const malformed = rawLine.match(/\[sound(?:\s+[^\]\n]*)?$/);
    if (malformed) {
      errors.push(`Line ${index + 1}: sound tag is missing a closing ].`);
    }
  });
  return errors;
}
