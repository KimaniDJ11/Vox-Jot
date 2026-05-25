export type CreativeAudioEvaluationStatus =
  | "tested"
  | "pending"
  | "download_required"
  | "failed"
  | "blocked";

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
  "generatedAt": "2026-05-25T03:26:12.776Z",
  "suite": "creative_audio_real_world_app_path",
  "corpus": "Story Studio sound-design prompts covering SFX, ambience, music beds, full-song sketches, and symbolic composition.",
  "limitations": "Automatic scores use app-path generation success, generated-WAV health, duration accuracy, and real-time factor. Human listening preference and semantic prompt-adherence panels are not included.",
  "metricGuide": [
    "Rank: #1 is best for this installed-app Story Studio suite.",
    "Score and pass: higher is better.",
    "p50 latency and RTF: lower is faster.",
    "Duration and audio health: higher is better."
  ],
  "reportPath": "output/creative-audio-eval/app-full-2026-05-25-mac-open-models-final/creative-audio-eval-summary.json"
};

export const CREATIVE_AUDIO_EVALUATION_RESULTS: CreativeAudioEvaluationResult[] = [
  {
    "modelId": "stable-audio-3-small-sfx",
    "providerId": "stability_ai",
    "label": "Stable Audio 3 Small SFX",
    "status": "tested",
    "sampleCount": 2,
    "passedCases": 2,
    "score": 99.6,
    "latencyP50Ms": 1384,
    "realTimeFactorP50": 0.346,
    "durationAccuracy": 1,
    "audioHealth": 1,
    "notes": "Full installed-app Creative Audio suite passed for stability_ai/stable-audio-3-small-sfx.",
    "rank": 2
  },
  {
    "modelId": "stable-audio-3-small-music",
    "providerId": "stability_ai",
    "label": "Stable Audio 3 Small Music",
    "status": "tested",
    "sampleCount": 2,
    "passedCases": 2,
    "score": 99.8,
    "latencyP50Ms": 1538,
    "realTimeFactorP50": 0.103,
    "durationAccuracy": 1,
    "audioHealth": 1,
    "notes": "Full installed-app Creative Audio suite passed for stability_ai/stable-audio-3-small-music.",
    "rank": 1
  },
  {
    "modelId": "musicgen-small",
    "providerId": "musicgen",
    "label": "MusicGen Small",
    "status": "tested",
    "sampleCount": 2,
    "passedCases": 2,
    "score": 91.9,
    "latencyP50Ms": 97921,
    "realTimeFactorP50": 6.554,
    "durationAccuracy": 0.996,
    "audioHealth": 1,
    "notes": "Full installed-app Creative Audio suite passed for musicgen/musicgen-small.",
    "rank": 5
  },
  {
    "modelId": "audioldm2",
    "providerId": "audioldm2",
    "label": "AudioLDM 2",
    "status": "tested",
    "sampleCount": 2,
    "passedCases": 2,
    "score": 96.8,
    "latencyP50Ms": 9893,
    "realTimeFactorP50": 2.341,
    "durationAccuracy": 1,
    "audioHealth": 1,
    "notes": "Full installed-app Creative Audio suite passed for audioldm2/audioldm2.",
    "rank": 4
  },
  {
    "modelId": "audioldm2-music",
    "providerId": "audioldm2_music",
    "label": "AudioLDM 2 Music",
    "status": "tested",
    "sampleCount": 2,
    "passedCases": 2,
    "score": 98.7,
    "latencyP50Ms": 11174,
    "realTimeFactorP50": 0.745,
    "durationAccuracy": 1,
    "audioHealth": 1,
    "notes": "Full installed-app Creative Audio suite passed for audioldm2_music/audioldm2-music.",
    "rank": 3
  }
];
