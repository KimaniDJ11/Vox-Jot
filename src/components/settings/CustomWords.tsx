import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface CustomWordsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  title?: string;
  description?: string;
  placeholder?: string;
  addLabel?: string;
  formatDuplicateMessage?: (word: string) => string;
  formatRemoveLabel?: (word: string) => string;
}

export const CustomWords: React.FC<CustomWordsProps> = React.memo(
  ({
    descriptionMode = "tooltip",
    grouped = false,
    title,
    description,
    placeholder,
    addLabel,
    formatDuplicateMessage,
    formatRemoveLabel,
  }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const [newWord, setNewWord] = useState("");
    const [confirmingRemoveWord, setConfirmingRemoveWord] = useState<
      string | null
    >(null);
    const customWords = getSetting("custom_words") || [];

    const handleAddWord = () => {
      const trimmedWord = newWord.trim();
      const sanitizedWord = trimmedWord.replace(/[<>"'&]/g, "");
      if (
        sanitizedWord &&
        !sanitizedWord.includes(" ") &&
        sanitizedWord.length <= 50
      ) {
        if (customWords.includes(sanitizedWord)) {
          toast.error(
            formatDuplicateMessage
              ? formatDuplicateMessage(sanitizedWord)
              : t("settings.advanced.customWords.duplicate", {
                  word: sanitizedWord,
                }),
          );
          return;
        }
        updateSetting("custom_words", [...customWords, sanitizedWord]);
        setNewWord("");
      }
    };

    const handleRemoveWord = (wordToRemove: string) => {
      updateSetting(
        "custom_words",
        customWords.filter((word) => word !== wordToRemove),
      );
      setConfirmingRemoveWord(null);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddWord();
      }
    };

    return (
      <>
        <SettingContainer
          title={title ?? t("settings.advanced.customWords.title")}
          description={
            description ?? t("settings.advanced.customWords.description")
          }
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex items-center gap-2">
            <Input
              type="text"
              className="max-w-40 min-h-[44px]"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={
                placeholder ?? t("settings.advanced.customWords.placeholder")
              }
              disabled={isUpdating("custom_words")}
            />
            <Button
              onClick={handleAddWord}
              disabled={
                !newWord.trim() ||
                newWord.includes(" ") ||
                newWord.trim().length > 50 ||
                isUpdating("custom_words")
              }
              variant="primary"
              size="md"
            >
              {addLabel ?? t("settings.advanced.customWords.add")}
            </Button>
          </div>
        </SettingContainer>
        {customWords.length > 0 && (
          <div
            className={`px-4 p-2 ${grouped ? "" : "rounded-2xl border border-mid-gray/20 bg-[var(--card)] shadow-[var(--shadow-sm)]"} flex flex-wrap gap-1`}
          >
            {customWords.map((word) =>
              confirmingRemoveWord === word ? (
                <span
                  key={word}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[var(--danger)] bg-[var(--danger-soft)] px-2 text-xs font-medium text-[var(--text)]"
                >
                  <span>{word}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    className="min-h-8 px-2 py-1"
                    onClick={() => handleRemoveWord(word)}
                    disabled={isUpdating("custom_words")}
                  >
                    {t("common.remove", { defaultValue: "Remove" })}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-8 px-2 py-1"
                    onClick={() => setConfirmingRemoveWord(null)}
                    disabled={isUpdating("custom_words")}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Button>
                </span>
              ) : (
                <Button
                  key={word}
                  onClick={() => setConfirmingRemoveWord(word)}
                  disabled={isUpdating("custom_words")}
                  variant="secondary"
                  size="sm"
                  className="inline-flex cursor-pointer items-center gap-1"
                  aria-label={
                    formatRemoveLabel
                      ? formatRemoveLabel(word)
                      : t("settings.advanced.customWords.remove", { word })
                  }
                >
                  <span>{word}</span>
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </Button>
              ),
            )}
          </div>
        )}
      </>
    );
  },
);
