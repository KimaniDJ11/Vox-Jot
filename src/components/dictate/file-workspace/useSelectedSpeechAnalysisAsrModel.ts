import { useSettingsSlice } from "@/hooks/useSettings";
import { useState, useEffect } from "react";
import { type SpeechAnalysisModelDescriptor, commands } from "@/bindings";

export function useSelectedSpeechAnalysisAsrModel() {
  const { file_transcription_asr_model_id: fileTranscriptionAsrModelIdValue } =
    useSettingsSlice(["file_transcription_asr_model_id"] as const);
  const [selectedAsrModel, setSelectedAsrModel] =
    useState<SpeechAnalysisModelDescriptor | null>(null);
  const fileTranscriptionAsrModelId = fileTranscriptionAsrModelIdValue ?? "";

  useEffect(() => {
    let isCurrent = true;

    void commands
      .getSpeechAnalysisCatalog()
      .then((result) => {
        if (!isCurrent) return;
        if (result.status !== "ok") {
          setSelectedAsrModel(null);
          return;
        }
        const selectedModel =
          result.data.models.find(
            (model) => model.id === result.data.selection.asr_model_id,
          ) ?? null;
        setSelectedAsrModel(selectedModel);
      })
      .catch(() => {
        if (isCurrent) setSelectedAsrModel(null);
      });

    return () => {
      isCurrent = false;
    };
  }, [fileTranscriptionAsrModelId]);

  return selectedAsrModel;
}
