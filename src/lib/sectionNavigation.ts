const LISTEN_SECTION_ALIASES: Record<string, string> = {
  "create-voices": "voice-design",
};

export function resolveListenSectionId(sectionId: string): string {
  return LISTEN_SECTION_ALIASES[sectionId] ?? sectionId;
}
