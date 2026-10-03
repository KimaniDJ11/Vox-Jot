import type { SettingsSnapshot } from "@/bindings";

interface LanguageRuntime {
  systemLocale(): Promise<string | null>;
  supportedLanguage(value: string | null): string | null;
  load(language: string): Promise<void>;
  change(language: string): Promise<unknown>;
}

/** Apply committed language choices in order, including the initial snapshot. */
export class AppLanguageSync {
  private revision = -1;
  private requestedLanguage: string | undefined;
  private request = 0;
  private changing: Promise<unknown> = Promise.resolve();

  constructor(private readonly runtime: LanguageRuntime) {}

  async accept({ revision, settings }: SettingsSnapshot): Promise<void> {
    if (revision <= this.revision) return;
    this.revision = revision;
    if (settings.app_language === this.requestedLanguage) return;
    this.requestedLanguage = settings.app_language;
    const request = ++this.request;

    try {
      const language = this.runtime.supportedLanguage(
        settings.app_language || (await this.runtime.systemLocale()),
      );
      if (!language || request !== this.request) return;
      await this.runtime.load(language);
      if (request !== this.request) return;

      // A locale change already in progress must finish before its replacement.
      const change = this.changing.then(() => {
        if (request === this.request) return this.runtime.change(language);
      });
      this.changing = change.catch(() => undefined);
      await change;
    } catch (error) {
      if (request === this.request) this.requestedLanguage = undefined;
      throw error;
    }
  }
}
