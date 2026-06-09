import React, { useState, useRef, useEffect, useMemo, useId } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../ui/SettingContainer";
import { ResetButton } from "../ui/ResetButton";
import { useSettings } from "../../hooks/useSettings";
import {
  getLanguageSearchText,
  getLocalizedLanguageLabel,
  LANGUAGES,
} from "../../lib/constants/languages";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";

interface LanguageSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  supportedLanguages?: string[];
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
  supportedLanguages,
}) => {
  const { t, i18n } = useTranslation();
  const { getSetting, updateSetting, resetSetting, isUpdating } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerId = useId();
  const listboxId = useId();

  const selectedLanguage = getSetting("selected_language") || "auto";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [searchQuery, isOpen]);

  const availableLanguages = useMemo(() => {
    if (!supportedLanguages || supportedLanguages.length === 0)
      return LANGUAGES;
    return LANGUAGES.filter(
      (lang) =>
        lang.value === "auto" || supportedLanguages.includes(lang.value),
    );
  }, [supportedLanguages]);

  const filteredLanguages = useMemo(
    () =>
      availableLanguages.filter((language) =>
        (language.value === "auto"
          ? `${t("settings.general.language.auto")} ${getLanguageSearchText(
              language,
              i18n.language,
            )}`
          : getLanguageSearchText(language, i18n.language)
        ).includes(searchQuery.toLowerCase()),
      ),
    [searchQuery, availableLanguages, i18n.language, t],
  );

  const selectedLanguageName =
    selectedLanguage === "auto"
      ? t("settings.general.language.auto")
      : getLocalizedLanguageLabel(
          LANGUAGES.find((lang) => lang.value === selectedLanguage) ?? {
            value: selectedLanguage,
            label: selectedLanguage,
          },
          i18n.language,
        );

  const handleLanguageSelect = async (languageCode: string) => {
    await updateSetting("selected_language", languageCode);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleReset = async () => {
    await resetSetting("selected_language");
  };

  const handleToggle = () => {
    if (isUpdating("selected_language")) return;
    setIsOpen((current) => !current);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown" && filteredLanguages.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % filteredLanguages.length);
    } else if (event.key === "ArrowUp" && filteredLanguages.length > 0) {
      event.preventDefault();
      setActiveIndex(
        (current) =>
          (current - 1 + filteredLanguages.length) % filteredLanguages.length,
      );
    } else if (event.key === "Home" && filteredLanguages.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && filteredLanguages.length > 0) {
      event.preventDefault();
      setActiveIndex(filteredLanguages.length - 1);
    } else if (event.key === "Enter" && filteredLanguages.length > 0) {
      event.preventDefault();
      const activeLanguage = filteredLanguages[activeIndex];
      if (activeLanguage) {
        void handleLanguageSelect(activeLanguage.value);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setSearchQuery("");
    }
  };

  return (
    <SettingContainer
      title={t("settings.general.language.title")}
      description={t("settings.general.language.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <div className="flex items-center space-x-1">
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            id={triggerId}
            className={`flex min-w-[200px] items-center justify-between rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-start text-sm font-semibold shadow-[var(--shadow-sm)] transition-all duration-150 ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
              isUpdating("selected_language")
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer hover:border-[var(--accent-soft)] hover:bg-[color-mix(in_srgb,var(--card),var(--panel-bg)_15%)]"
            }`}
            onClick={handleToggle}
            onKeyDown={handleTriggerKeyDown}
            disabled={isUpdating("selected_language")}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={isOpen ? listboxId : undefined}
          >
            <span className="truncate">{selectedLanguageName}</span>
            <svg
              className={`w-4 h-4 ms-2 transition-transform duration-200 ${
                isOpen ? "transform rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {isOpen && !isUpdating("selected_language") && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-hidden rounded border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-lg)]">
              {/* Search input */}
              <div className="p-2 border-b border-[var(--border-strong)]">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t("settings.general.language.searchPlaceholder")}
                  className="w-full px-2 py-1 text-sm bg-[var(--input)] border border-[var(--border)] rounded focus:outline-none focus:ring-1 focus:ring-logo-primary focus:border-logo-primary"
                  role="searchbox"
                  aria-controls={listboxId}
                  aria-activedescendant={
                    filteredLanguages[activeIndex]
                      ? `${listboxId}-option-${filteredLanguages[activeIndex].value}`
                      : undefined
                  }
                />
              </div>

              <div
                id={listboxId}
                className="max-h-48 overflow-y-auto"
                role="listbox"
                aria-labelledby={triggerId}
              >
                {filteredLanguages.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-[var(--muted)] text-center">
                    {t("settings.general.language.noResults")}
                  </div>
                ) : (
                  filteredLanguages.map((language, index) => (
                    <button
                      key={language.value}
                      id={`${listboxId}-option-${language.value}`}
                      type="button"
                      role="option"
                      aria-selected={selectedLanguage === language.value}
                      className={`w-full px-2 py-2.5 text-start text-sm transition-colors duration-150 hover:bg-logo-primary/10 ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
                        selectedLanguage === language.value
                          ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                          : index === activeIndex
                            ? "bg-[var(--input)]"
                            : ""
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void handleLanguageSelect(language.value)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">
                          {language.value === "auto"
                            ? t("settings.general.language.auto")
                            : getLocalizedLanguageLabel(
                                language,
                                i18n.language,
                              )}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <ResetButton
          onClick={handleReset}
          disabled={isUpdating("selected_language")}
        />
      </div>
      {isUpdating("selected_language") && (
        <div
          className="absolute inset-0 bg-[var(--input)] rounded flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div
            className="w-4 h-4 border-2 border-logo-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <span className="sr-only">
            {t("common.loading", { defaultValue: "Loading" })}
          </span>
        </div>
      )}
    </SettingContainer>
  );
};
