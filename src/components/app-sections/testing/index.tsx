import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGroup, motion } from "framer-motion";
import { Boxes } from "lucide-react";

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
import {
  CREATIVE_AUDIO_EVALUATION_RESULTS,
  CREATIVE_AUDIO_EVALUATION_RUN,
} from "@/lib/creativeAudioEvaluationResults";
import { SuiteLeaderboard } from "@/components/app-sections/testing/SuiteLeaderboard";
import {
  buildCreativeAudioRow,
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
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import { handleHorizontalTabListKeyDown } from "@/lib/ui/tabKeyboard";
import { press } from "@/motion/springs";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  openModelHub,
  type ModelHubScope,
  type ModelHubTabId,
} from "@/components/model-hub/modelHubTabs";

type TestingTabId =
  | "file-asr"
  | "speaker-isolation"
  | "tts"
  | "tts-style"
  | "tts-voice-clone"
  | "creative-audio"
  | "llm"
  | "stt"
  | "screen-ocr";

interface TestingRunSummary {
  suite: string;
  corpus: string;
  limitations?: string;
  methodologyVersion?: string;
  evidenceTier?: "legacy" | "diagnostic" | "ranked";
}

const TABS: Array<{
  id: TestingTabId;
  labelKey: string;
  defaultLabel: string;
  run: TestingRunSummary;
}> = [
  {
    id: "stt",
    labelKey: "testing.tabs.stt",
    defaultLabel: "Live STT",
    run: STT_EVALUATION_RUN,
  },
  {
    id: "file-asr",
    labelKey: "testing.tabs.fileAsr",
    defaultLabel: "File ASR",
    run: FILE_ASR_EVALUATION_RUN,
  },
  {
    id: "speaker-isolation",
    labelKey: "testing.tabs.speakerIsolation",
    defaultLabel: "Speaker Isolation",
    run: SPEAKER_ISOLATION_EVALUATION_RUN,
  },
  {
    id: "screen-ocr",
    labelKey: "testing.tabs.screenOcr",
    defaultLabel: "Screen OCR",
    run: SCREEN_OCR_EVALUATION_RUN,
  },
  {
    id: "llm",
    labelKey: "testing.tabs.llm",
    defaultLabel: "LLM",
    run: LLM_EVALUATION_RUN,
  },
  {
    id: "tts",
    labelKey: "testing.tabs.tts",
    defaultLabel: "TTS",
    run: TTS_EVALUATION_RUN,
  },
  {
    id: "tts-style",
    labelKey: "testing.tabs.ttsStyle",
    defaultLabel: "TTS Style",
    run: TTS_STYLE_EVALUATION_RUN,
  },
  {
    id: "tts-voice-clone",
    labelKey: "testing.tabs.ttsVoiceClone",
    defaultLabel: "Voice Cloning",
    run: TTS_VOICE_CLONE_EVALUATION_RUN,
  },
  {
    id: "creative-audio",
    labelKey: "testing.tabs.creativeAudio",
    defaultLabel: "Creative Audio",
    run: CREATIVE_AUDIO_EVALUATION_RUN,
  },
];

interface ModelHubTarget {
  tab: ModelHubTabId;
  scope?: ModelHubScope;
}

const MODEL_HUB_TARGETS: Record<TestingTabId, ModelHubTarget> = {
  stt: { tab: "stt" },
  "file-asr": { tab: "analysis", scope: "analysis" },
  "speaker-isolation": { tab: "analysis", scope: "analysis" },
  "screen-ocr": { tab: "ocr" },
  llm: { tab: "llm" },
  tts: { tab: "tts" },
  "tts-style": { tab: "tts" },
  "tts-voice-clone": { tab: "tts" },
  "creative-audio": { tab: "creative_audio", scope: "creative_audio" },
};

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

interface TestingTabButtonProps {
  active: boolean;
  label: string;
  onSelect: () => void;
  tab: (typeof TABS)[number];
}

const TestingTabButton: React.FC<TestingTabButtonProps> = ({
  active,
  label,
  onSelect,
  tab,
}) => {
  const { t } = useTranslation();
  const [showHelp, setShowHelp] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = `model-testing-tab-help-${tab.id}`;
  const helpTitle = `${tab.run.suite}: ${tab.run.corpus}`;
  const title = tab.run.limitations
    ? `${helpTitle} ${tab.run.limitations}`
    : helpTitle;

  return (
    <>
      <motion.button
        ref={buttonRef}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={`model-testing-panel-${tab.id}`}
        aria-describedby={showHelp ? tooltipId : undefined}
        id={`model-testing-tab-${tab.id}`}
        tabIndex={active ? 0 : -1}
        title={title}
        whileTap={{ scale: 0.97 }}
        transition={press}
        onClick={onSelect}
        onFocus={() => setShowHelp(true)}
        onBlur={() => setShowHelp(false)}
        onMouseEnter={() => setShowHelp(true)}
        onMouseLeave={() => setShowHelp(false)}
        className={`relative whitespace-nowrap rounded-[10px] px-3 py-1.5 text-xs font-semibold focus-visible:z-10 ${interactiveFocusRingClass} ${minTapTargetHeightClass}`}
        style={{
          color: active ? "var(--accent-foreground)" : "var(--muted)",
          transition: "color 160ms var(--spring-crisp)",
        }}
      >
        {active && (
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
        <span className="relative z-10">{label}</span>
      </motion.button>
      {showHelp ? (
        <Tooltip targetRef={buttonRef} id={tooltipId} position="bottom">
          <span className="block text-xs font-semibold leading-5">
            {tab.run.suite}
          </span>
          <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
            {tab.run.corpus}
          </span>
          {tab.run.methodologyVersion ? (
            <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              {t("testing.evidenceLabel", {
                defaultValue: "{{tier}} evidence · methodology {{version}}",
                tier: tab.run.evidenceTier ?? "unclassified",
                version: tab.run.methodologyVersion,
              })}
            </span>
          ) : null}
          {tab.run.limitations ? (
            <span className="mt-1 block text-[11px] leading-5 text-[var(--muted)]">
              {tab.run.limitations}
            </span>
          ) : null}
        </Tooltip>
      ) : null}
    </>
  );
};

export const ModelTestingSection: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TestingTabId>("stt");

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
  const creativeAudio = splitRanked(CREATIVE_AUDIO_EVALUATION_RESULTS);
  const screenOcr = splitRanked(SCREEN_OCR_EVALUATION_RESULTS);
  const activePanelId = `model-testing-panel-${activeTab}`;
  const activeTabId = `model-testing-tab-${activeTab}`;
  const modelHubTarget = MODEL_HUB_TARGETS[activeTab];

  return (
    <div className="flex min-h-0 flex-col">
      <div
        data-model-testing-sticky-header=""
        className="sticky top-0 z-20 -mx-5 px-5 pb-3 pt-0"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            <LayoutGroup id="model-testing-tabs">
              <div
                role="tablist"
                aria-label={t("testing.tabs.ariaLabel", {
                  defaultValue: "Benchmark suites",
                })}
                onKeyDown={(event) =>
                  handleHorizontalTabListKeyDown(event, {
                    direction: document.dir === "rtl" ? "rtl" : "ltr",
                  })
                }
                className="relative inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--ring-hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_80%,transparent)] p-0.5"
              >
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  const label = t(tab.labelKey, {
                    defaultValue: tab.defaultLabel,
                  });
                  return (
                    <TestingTabButton
                      key={tab.id}
                      active={isActive}
                      label={label}
                      onSelect={() => setActiveTab(tab.id)}
                      tab={tab}
                    />
                  );
                })}
              </div>
            </LayoutGroup>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={press}
            onClick={() =>
              void openModelHub(modelHubTarget.tab, {
                scope: modelHubTarget.scope,
              })
            }
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] hover:bg-[color-mix(in_srgb,var(--accent)_6%,var(--card))] ${interactiveFocusRingClass}`}
          >
            <Boxes
              className="h-4 w-4 text-[var(--accent)]"
              aria-hidden="true"
            />
            {t("testing.manageInModelHub", {
              defaultValue: "Manage in Model Hub",
            })}
          </motion.button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {t("testing.readOnlyExplanation", {
            defaultValue:
              "Benchmark results are read-only. Install and select models in Model Hub.",
          })}
        </p>
      </div>

      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
        className="min-w-0 flex-1 pt-3"
      >
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

        {activeTab === "creative-audio" ? (
          <SuiteLeaderboard
            run={CREATIVE_AUDIO_EVALUATION_RUN}
            ranked={creativeAudio.ranked}
            unranked={creativeAudio.unranked}
            renderRow={buildCreativeAudioRow}
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
