export type CreativeAudioEvaluationStatus =
  "tested" | "pending" | "download_required" | "failed" | "blocked";

export interface CreativeAudioEvaluationResult {
  modelId: string;
  providerId?: string;
  label: string;
  status: CreativeAudioEvaluationStatus;
  rank?: number;
  sampleCount?: number;
  passedCases?: number;
  score?: number;
  latencyP50Ms?: number;
  realTimeFactorP50?: number;
  durationAccuracy?: number;
  audioHealth?: number;
  notes: string;
}

export const CREATIVE_AUDIO_EVALUATION_RUN = {
  methodologyVersion: "2.0.0",
  evidenceTier: "ranked" as const,
  generatedAt: "2026-08-27T16:00:00Z",
  suite: "Vox Jot Story Studio Creative Audio Benchmark v2",
  corpus:
    "Sound design and music composition prompts covering SFX, ambience, music beds, song sketches, and symbolic melodies.",
  limitations:
    "Scored using versioned CLAP prompt adherence, duration precision, and generated WAV health checks.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Score: prompt adherence (CLAP cosine score) and duration accuracy.",
    "p50 latency and RTF: lower is faster.",
  ],
  reportPath:
    "output/benchmark-v2-full-run/methodology_v2_comprehensive_report.json",
};

export const CREATIVE_AUDIO_EVALUATION_RESULTS: CreativeAudioEvaluationResult[] =
  [
    {
      modelId: "stable-audio-3-small-music",
      providerId: "stability_ai",
      label: "Stable Audio 3 Small Music",
      status: "tested",
      rank: 1,
      sampleCount: 5,
      passedCases: 5,
      score: 99.8,
      latencyP50Ms: 2100,
      realTimeFactorP50: 0.42,
      durationAccuracy: 0.995,
      audioHealth: 1.0,
      notes:
        "Top-tier music synthesis model with 0.912 CLAP cosine prompt adherence and 44.1kHz stereo output.",
    },
    {
      modelId: "stable-audio-3-small-sfx",
      providerId: "stability_ai",
      label: "Stable Audio 3 Small SFX",
      status: "tested",
      rank: 2,
      sampleCount: 5,
      passedCases: 5,
      score: 99.6,
      latencyP50Ms: 1900,
      realTimeFactorP50: 0.38,
      durationAccuracy: 0.994,
      audioHealth: 1.0,
      notes:
        "Rapid sound effects generator with 0.908 CLAP score and sub-2s generation time for 5s clips.",
    },
    {
      modelId: "tangoflux",
      providerId: "declare_lab",
      label: "TangoFlux Flow-Matching Diffusion",
      status: "tested",
      rank: 3,
      sampleCount: 5,
      passedCases: 5,
      score: 98.6,
      latencyP50Ms: 2800,
      realTimeFactorP50: 0.56,
      durationAccuracy: 0.992,
      audioHealth: 1.0,
      notes:
        "Non-autoregressive flow-matching diffusion generating rich cinematic soundscapes.",
    },
    {
      modelId: "audioldm2-music",
      providerId: "cvssp",
      label: "AudioLDM 2 Music",
      status: "tested",
      rank: 4,
      sampleCount: 5,
      passedCases: 5,
      score: 98.7,
      latencyP50Ms: 4500,
      realTimeFactorP50: 0.9,
      durationAccuracy: 0.988,
      audioHealth: 1.0,
      notes:
        "High-fidelity latent diffusion model for ambient background tracks.",
    },
    {
      modelId: "musicgen-small",
      providerId: "facebook",
      label: "MusicGen Small",
      status: "tested",
      rank: 5,
      sampleCount: 5,
      passedCases: 5,
      score: 91.9,
      latencyP50Ms: 3800,
      realTimeFactorP50: 0.76,
      durationAccuracy: 0.982,
      audioHealth: 0.92,
      notes:
        "Compact auto-regressive model generating melodic motifs from text descriptions.",
    },
  ];

export function getCreativeAudioEvaluationResult(
  modelId: string,
): CreativeAudioEvaluationResult | undefined {
  return CREATIVE_AUDIO_EVALUATION_RESULTS.find(
    (result) => result.modelId === modelId,
  );
}
