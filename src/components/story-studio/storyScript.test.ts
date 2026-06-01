import { describe, expect, it } from "vitest";
import {
  buildCastNameSet,
  generateStoryTitleFromScript,
  parseStoryScript,
  validateStoryDraft,
  type StoryCastMemberDraft,
} from "./storyScript";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";

const preset: TtsVoicePreset = {
  id: "preset-1",
  label: "Narrator Voice",
  provider_id: "system",
  model_id: "system",
  voice_id: "Alex",
  voice_profile_id: null,
  voice_label_snapshot: "Alex",
  locale_snapshot: "en-US",
  tuning: {
    tempo_rate: 1,
    expressiveness: 0.5,
    exaggeration: 0.5,
    randomness: 0.5,
    guidance: 0.5,
    stability: 0.5,
    repetition_penalty: 1.2,
    style_instructions: null,
  },
};

const cast: StoryCastMemberDraft[] = [
  { id: "cast-1", characterName: "Narrator", presetId: "preset-1" },
];

describe("storyScript", () => {
  it("parses Character: line scripts", () => {
    const result = parseStoryScript("Narrator: Hello\nHero: Go now");
    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      { speaker: "Narrator", text: "Hello", lineNumber: 1 },
      { speaker: "Hero", text: "Go now", lineNumber: 2 },
    ]);
  });

  it("reports malformed lines", () => {
    const result = parseStoryScript("Narrator says hello");
    expect(result.errors[0]).toContain("Line 1");
    expect(result.lines).toEqual([]);
  });

  it("allows cue-only sound tag lines", () => {
    const result = parseStoryScript(
      '[sound id="sound-1" mode="insert" title="Door slam"]',
    );
    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("strips sound tags from parsed spoken text", () => {
    const result = parseStoryScript(
      'Narrator: Wait here [sound id="sound-1" mode="overlay" title="Rain"] quietly.',
    );
    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      { speaker: "Narrator", text: "Wait here quietly.", lineNumber: 1 },
    ]);
  });

  it("validates unknown speakers", () => {
    const result = validateStoryDraft(cast, "Hero: Hello", [preset]);
    expect(result.errors).toContain(
      'Line 1: "Hero" appears in the script but is not in the cast.',
    );
  });

  it("generates a title from the first spoken script line", () => {
    const title = generateStoryTitleFromScript(
      "Narrator: The door creaked open.\nHero: Who is there?",
      "Untitled Story",
    );
    expect(title).toBe("The door creaked open.");
  });

  it("strips inline tags when generating a story title", () => {
    const title = generateStoryTitleFromScript(
      'Narrator: [whisper] Stay quiet [sound id="sound-1" mode="insert" title="Rain"] now.',
      "Untitled Story",
    );
    expect(title).toBe("Stay quiet now.");
  });

  it("falls back when the script has no spoken lines", () => {
    const title = generateStoryTitleFromScript(
      '[sound id="sound-1" mode="insert" title="Door slam"]',
      "Untitled Story",
    );
    expect(title).toBe("Untitled Story");
  });

  it("validates duplicate cast names", () => {
    const result = validateStoryDraft(
      [
        ...cast,
        { id: "cast-2", characterName: "narrator", presetId: "preset-1" },
      ],
      "Narrator: Hello",
      [preset],
    );
    expect(result.errors).toContain('Duplicate character name "narrator".');
  });

  it("validates missing voice presets", () => {
    const result = validateStoryDraft(cast, "Narrator: Hello", []);
    expect(result.errors).toContain(
      'Choose a saved voice preset for "Narrator".',
    );
  });

  it("builds a normalized cast name set", () => {
    expect(buildCastNameSet(cast)).toEqual(new Set(["narrator"]));
    expect(
      buildCastNameSet([
        { id: "1", characterName: "  Emmy  ", presetId: "preset-1" },
        { id: "2", characterName: "", presetId: "preset-1" },
      ]),
    ).toEqual(new Set(["emmy"]));
  });
});
