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

export function parseStoryScript(scriptText: string): StoryValidationResult {
  const lines: StoryScriptLine[] = [];
  const errors: string[] = [];

  scriptText.split(/\r?\n/).forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      return;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      errors.push(`Line ${index + 1} needs "Character: dialogue".`);
      return;
    }

    const speaker = trimmed.slice(0, separatorIndex).trim();
    const text = trimmed.slice(separatorIndex + 1).trim();
    if (!speaker || !text) {
      errors.push(`Line ${index + 1} needs both a character and dialogue.`);
      return;
    }

    lines.push({ speaker, text, lineNumber: index + 1 });
  });

  if (scriptText.trim() && lines.length === 0 && errors.length === 0) {
    errors.push("Write at least one script line.");
  }

  return { lines, errors };
}

export function validateStoryDraft(
  cast: StoryCastMemberDraft[],
  scriptText: string,
  presets: TtsVoicePreset[],
): StoryValidationResult {
  const parsed = parseStoryScript(scriptText);
  const errors = [...parsed.errors];
  const presetIds = new Set(presets.map((preset) => preset.id));
  const castNames = new Set<string>();

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

  return { lines: parsed.lines, errors: uniqueErrors(errors) };
}

export function normalizeStoryName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function uniqueErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
}
