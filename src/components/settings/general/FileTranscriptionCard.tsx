import React, { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Button } from "../../ui/Button";
import { Textarea } from "../../ui/Textarea";
import { SettingsGroup } from "../../ui/SettingsGroup";

export const FileTranscriptionCard: React.FC = () => {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [transcription, setTranscription] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);

  const pickAndTranscribe = async () => {
    setError("");
    const filePath = await open({
      multiple: false,
      filters: [{ name: "WAV", extensions: ["wav"] }],
    });

    if (!filePath || Array.isArray(filePath)) {
      return;
    }

    setSelectedPath(filePath);
    setIsRunning(true);
    try {
      const result = await commands.transcribeFile(filePath);
      if (result.status === "ok") {
        setTranscription(result.data);
      } else {
        setError(result.error || t("settings.general.fileTranscription.errors.failed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.general.fileTranscription.errors.failed"));
    } finally {
      setIsRunning(false);
    }
  };

  const copyResult = async () => {
    if (!transcription.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(transcription);
    } catch {
      setError(t("settings.general.fileTranscription.errors.copyFailed"));
    }
  };

  return (
    <SettingsGroup
      title={t("settings.general.fileTranscription.title")}
      description={t("settings.general.fileTranscription.description")}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Button onClick={pickAndTranscribe} disabled={isRunning}>
            {isRunning
              ? t("settings.general.fileTranscription.transcribing")
              : t("settings.general.fileTranscription.pickFile")}
          </Button>
          <Button
            variant="secondary"
            onClick={copyResult}
            disabled={!transcription.trim()}
          >
            {t("settings.general.fileTranscription.copy")}
          </Button>
        </div>

        {selectedPath && (
          <div className="text-xs text-mid-gray break-all">{selectedPath}</div>
        )}

        <Textarea
          value={transcription}
          readOnly
          placeholder={t("settings.general.fileTranscription.placeholder")}
          className="w-full min-h-[110px]"
        />

        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </SettingsGroup>
  );
};
