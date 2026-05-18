import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGroup, motion } from "framer-motion";

import {
  FILE_ASR_EVALUATION_RESULTS,
  FILE_ASR_EVALUATION_RUN,
} from "@/lib/fileAsrEvaluationResults";
import {
  LLM_EVALUATION_RESULTS,
  LLM_EVALUATION_RUN,
} from "@/lib/llmEvaluationResults";
import {
  STT_EVALUATION_RESULTS,
  STT_EVALUATION_RUN,
} from "@/lib/sttEvaluationResults";
import {
  SPEAKER_ISOLATION_EVALUATION_RESULTS,
  SPEAKER_ISOLATION_EVALUATION_RUN,
} from "@/lib/speakerIsolationEvaluationResults";
import {
  SCREEN_OCR_EVALUATION_RESULTS,
  SCREEN_OCR_EVALUATION_RUN,
} from "@/lib/screenOcrEvaluationResults";
import {
  TTS_EVALUATION_RESULTS,
  TTS_EVALUATION_RUN,
} from "@/lib/ttsEvaluationResults";
import {
  TTS_STYLE_EVALUATION_RESULTS,
  TTS_STYLE_EVALUATION_RUN,
} from "@/lib/ttsStyleEvaluationResults";
import {
  TTS_VOICE_CLONE_EVALUATION_RESULTS,
  TTS_VOICE_CLONE_EVALUATION_RUN,
} from "@/lib/ttsVoiceCloneEvaluationResults";
import { SuiteLeaderboard } from "@/components/app-sections/testing/SuiteLeaderboard";
import {
  buildFileAsrRow,
  buildLlmRow,
  buildScreenOcrRow,
  buildSpeakerIsolationRow,
  buildSttRow,
  buildTtsStyleRow,
  buildTtsVoiceCloneRow,
  buildTtsRow,
  orderByRank,
} from "@/components/app-sections/testing/suiteAdapters";
import { press } from "@/motion/springs";

type TestingTabId =
  | "file-asr"
  | "speaker-isolation"
  | "tts"
  | "tts-style"
  | "tts-voice-clone"
  | "llm"
  | "stt"
  | "screen-ocr";

const TABS: Array<{
  id: TestingTabId;
  labelKey: string;
  defaultLabel: string;
}> = [
  {
    id: "file-asr",
    labelKey: "testing.tabs.fileAsr",
    defaultLabel: "File ASR",
  },
  {
    id: "speaker-isolation",
    labelKey: "testing.tabs.speakerIsolation",
    defaultLabel: "Speaker Isolation",
  },
  {
    id: "tts",
    labelKey: "testing.tabs.tts",
    defaultLabel: "TTS",
  },
  {
    id: "tts-style",
    labelKey: "testing.tabs.ttsStyle",
    defaultLabel: "TTS Style",
  },
  {
    id: "tts-voice-clone",
    labelKey: "testing.tabs.ttsVoiceClone",
    defaultLabel: "Voice Cloning",
  },
  {
    id: "llm",
    labelKey: "testing.tabs.llm",
    defaultLabel: "LLM",
  },
  {
    id: "stt",
    labelKey: "testing.tabs.stt",
    defaultLabel: "Live STT",
  },
  {
    id: "screen-ocr",
    labelKey: "testing.tabs.screenOcr",
    defaultLabel: "Screen OCR",
  },
];

function splitRanked<
  T extends { status: string; rank?: number; label: string },
>(results: T[]) {
  return {
    ranked: orderByRank(
      results.filter(
        (result) => result.status === "tested" && result.rank !== undefined,
      ),
    ),
    unranked: results.filter(
      (result) => result.status !== "tested" || result.rank === undefined,
    ),
  };
}

export const ModelTestingSection: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TestingTabId>("file-asr");

  const fileAsr = splitRanked(FILE_ASR_EVALUATION_RESULTS);
  const speakerIsolation = splitRanked(
    SPEAKER_ISOLATION_EVALUATION_RESULTS.filter(
      (result) => result.status !== "not_applicable",
    ),
  );
  const llm = splitRanked(LLM_EVALUATION_RESULTS);
  const stt = splitRanked(STT_EVALUATION_RESULTS);
  const tts = splitRanked(TTS_EVALUATION_RESULTS);
  const ttsStyle = splitRanked(TTS_STYLE_EVALUATION_RESULTS);
  const ttsVoiceClone = splitRanked(TTS_VOICE_CLONE_EVALUATION_RESULTS);
  const screenOcr = splitRanked(SCREEN_OCR_EVALUATION_RESULTS);

  return (
    <div className="flex min-h-0 flex-col">
      <div
        data-model-testing-sticky-header=""
        className="sticky top-0 z-20 -mx-5 border-b border-[var(--border)] bg-[var(--bg)] px-5 pb-3 pt-0"
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            <LayoutGroup id="model-testing-tabs">
              <div
                role="tablist"
                className="relative inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--ring-hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_80%,transparent)] p-0.5"
              >
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <motion.button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      whileTap={{ scale: 0.97 }}
                      transition={press}
                      onClick={() => setActiveTab(tab.id)}
                      className="relative whitespace-nowrap rounded-[10px] px-3 py-1.5 text-xs font-semibold outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                      style={{
                        color: isActive
                          ? "var(--inverse-text)"
                          : "var(--muted)",
                        transition: "color 160ms var(--spring-crisp)",
                      }}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="model-testing-tab-indicator"
                          transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 32,
                            mass: 0.9,
                          }}
                          className="absolute inset-0 rounded-[10px] bg-[var(--accent)]"
                          aria-hidden
                        />
                      )}
                      <span className="relative z-10">
                        {t(tab.labelKey, {
                          defaultValue: tab.defaultLabel,
                        })}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </LayoutGroup>
          </div>
          <div className="app-no-drag flex shrink-0 items-center justify-end gap-2" />
        </div>
      </div>

      <div className="min-w-0 flex-1 pt-3">
        {activeTab === "file-asr" ? (
          <SuiteLeaderboard
            run={FILE_ASR_EVALUATION_RUN}
            ranked={fileAsr.ranked}
            unranked={fileAsr.unranked}
            renderRow={buildFileAsrRow}
            t={t}
          />
        ) : null}

        {activeTab === "llm" ? (
          <SuiteLeaderboard
            run={LLM_EVALUATION_RUN}
            ranked={llm.ranked}
            unranked={llm.unranked}
            renderRow={buildLlmRow}
            t={t}
          />
        ) : null}

        {activeTab === "speaker-isolation" ? (
          <SuiteLeaderboard
            run={SPEAKER_ISOLATION_EVALUATION_RUN}
            ranked={speakerIsolation.ranked}
            unranked={speakerIsolation.unranked}
            renderRow={buildSpeakerIsolationRow}
            t={t}
          />
        ) : null}

        {activeTab === "tts" ? (
          <SuiteLeaderboard
            run={TTS_EVALUATION_RUN}
            ranked={tts.ranked}
            unranked={tts.unranked}
            renderRow={buildTtsRow}
            t={t}
          />
        ) : null}

        {activeTab === "tts-style" ? (
          <SuiteLeaderboard
            run={TTS_STYLE_EVALUATION_RUN}
            ranked={ttsStyle.ranked}
            unranked={ttsStyle.unranked}
            renderRow={buildTtsStyleRow}
            t={t}
          />
        ) : null}

        {activeTab === "tts-voice-clone" ? (
          <SuiteLeaderboard
            run={TTS_VOICE_CLONE_EVALUATION_RUN}
            ranked={ttsVoiceClone.ranked}
            unranked={ttsVoiceClone.unranked}
            renderRow={buildTtsVoiceCloneRow}
            t={t}
          />
        ) : null}

        {activeTab === "stt" ? (
          <SuiteLeaderboard
            run={STT_EVALUATION_RUN}
            ranked={stt.ranked}
            unranked={stt.unranked}
            renderRow={buildSttRow}
            t={t}
          />
        ) : null}

        {activeTab === "screen-ocr" ? (
          <SuiteLeaderboard
            run={SCREEN_OCR_EVALUATION_RUN}
            ranked={screenOcr.ranked}
            unranked={screenOcr.unranked}
            renderRow={buildScreenOcrRow}
            t={t}
          />
        ) : null}
      </div>
    </div>
  );
};
