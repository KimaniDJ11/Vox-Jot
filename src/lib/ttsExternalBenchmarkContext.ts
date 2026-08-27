export interface TtsExternalBenchmarkContext {
  source: "Artificial Analysis";
  leaderboard: "provider-voice";
  modelName: string;
  elo: number;
  globalRank: number;
  appearances: number;
  retrievedAt: "2026-08-27";
  sourceUrl: string;
  methodologyUrl: string;
  caveat: string;
}

const ARTIFICIAL_ANALYSIS_TTS_URL =
  "https://artificialanalysis.ai/text-to-speech/leaderboard/provider-voice";
const ARTIFICIAL_ANALYSIS_TTS_METHODOLOGY_URL =
  "https://artificialanalysis.ai/text-to-speech/methodology";

const contextByModelId: Record<string, TtsExternalBenchmarkContext> = {};

function register(
  modelIds: string[],
  context: Omit<
    TtsExternalBenchmarkContext,
    "source" | "leaderboard" | "retrievedAt" | "sourceUrl" | "methodologyUrl"
  >,
) {
  for (const modelId of modelIds) {
    contextByModelId[modelId] = {
      ...context,
      source: "Artificial Analysis",
      leaderboard: "provider-voice",
      retrievedAt: "2026-08-27",
      sourceUrl: ARTIFICIAL_ANALYSIS_TTS_URL,
      methodologyUrl: ARTIFICIAL_ANALYSIS_TTS_METHODOLOGY_URL,
    };
  }
}

register(["kokoro-82m", "kokoro-82m-v1.0"], {
  modelName: "Kokoro 82M v1.0",
  elo: 1060.12,
  globalRank: 56,
  appearances: 5612,
  caveat:
    "External provider-voice arena result for the upstream model family; local runtime, quantization, voice, memory, and latency differ.",
});

register(["fish-audio-s2-pro", "fish-audio-s2-pro-8bit"], {
  modelName: "Fish Audio S2 Pro",
  elo: 1124.55,
  globalRank: 28,
  appearances: 2199,
  caveat:
    "External provider-voice arena result for the upstream model family; Vox Jot's local MLX precision and voice path are not the hosted provider path.",
});

register(["voxtral-tts-4b", "voxtral-tts-4b-4bit"], {
  modelName: "Voxtral TTS",
  elo: 1081.73,
  globalRank: 42,
  appearances: 2160,
  caveat:
    "External provider-voice arena result for the upstream model family; Vox Jot's local MLX precision and voice path are not the hosted provider path.",
});

export function getTtsExternalBenchmarkContext(
  modelId: string,
): TtsExternalBenchmarkContext | undefined {
  return contextByModelId[modelId];
}
