import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCcw } from "lucide-react";
import {
  commands,
  type AppToneMapping,
  type DictionaryEntry,
  type PostProcessResult,
  type ToneDefinition,
} from "@/bindings";

import { Alert } from "../../ui/Alert";
import {
  Dropdown,
  SettingContainer,
  SettingsGroup,
  Textarea,
  ToggleSwitch,
} from "@/components/ui";
import { Button } from "../../ui/Button";
import { ResetButton } from "../../ui/ResetButton";
import { Input } from "../../ui/Input";

import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import {
  usePostProcessProviderState,
  type PostProcessProviderState,
} from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ShortcutInput } from "../ShortcutInput";
import { PostProcessingToggle } from "../PostProcessingToggle";
import { useSettings } from "../../../hooks/useSettings";

interface ProviderSectionProps {
  disabled?: boolean;
  providerState: PostProcessProviderState;
}

type SetupStatus = {
  variant: "info" | "warning" | "error" | "success";
  message: React.ReactNode;
};

const isLocalBaseUrl = (baseUrl: string): boolean => {
  const lower = baseUrl.trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.startsWith("http://localhost") ||
    lower.startsWith("https://localhost") ||
    lower.startsWith("http://127.0.0.1") ||
    lower.startsWith("https://127.0.0.1") ||
    lower.startsWith("http://[::1]") ||
    lower.startsWith("https://[::1]")
  );
};

const PostProcessingSettingsApiComponent: React.FC<ProviderSectionProps> = ({
  disabled = false,
  providerState: state,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.api.provider.title")}
        description={t("settings.postProcessing.api.provider.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          <ProviderSelect
            options={state.providerOptions}
            value={state.selectedProviderId}
            onChange={state.handleProviderSelect}
            disabled={disabled}
          />
        </div>
      </SettingContainer>

      {state.isAppleProvider ? (
        state.appleIntelligenceUnavailable ? (
          <Alert variant="warning" contained>
            {t("settings.postProcessing.status.appleUnavailable")}
          </Alert>
        ) : (
          <Alert variant="info" contained>
            {t("settings.postProcessing.api.appleIntelligence.description")}
          </Alert>
        )
      ) : (
        <>
          {state.selectedProvider?.id === "custom" && (
            <SettingContainer
              title={t("settings.postProcessing.api.baseUrl.title")}
              description={t("settings.postProcessing.api.baseUrl.description")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
              disabled={disabled}
            >
              <div className="flex items-center gap-2">
                <BaseUrlField
                  value={state.baseUrl}
                  onBlur={state.handleBaseUrlChange}
                  placeholder={t(
                    "settings.postProcessing.api.baseUrl.placeholder",
                  )}
                  disabled={disabled || state.isBaseUrlUpdating}
                  className="min-w-[380px]"
                />
              </div>
            </SettingContainer>
          )}

          <SettingContainer
            title={t("settings.postProcessing.api.apiKey.title")}
            description={t("settings.postProcessing.api.apiKey.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
            disabled={disabled}
          >
            <div className="flex items-center gap-2">
              <ApiKeyField
                value={state.apiKey}
                onBlur={state.handleApiKeyChange}
                placeholder={t(
                  "settings.postProcessing.api.apiKey.placeholder",
                )}
                disabled={disabled || state.isApiKeyUpdating}
                className="min-w-[320px]"
              />
            </div>
          </SettingContainer>

          <SettingContainer
            title={t("settings.postProcessing.api.model.title")}
            description={
              state.isCustomProvider
                ? t("settings.postProcessing.api.model.descriptionCustom")
                : t("settings.postProcessing.api.model.descriptionDefault")
            }
            descriptionMode="tooltip"
            layout="stacked"
            grouped={true}
            disabled={disabled}
          >
            <div className="flex items-center gap-2">
              <ModelSelect
                value={state.model}
                options={state.modelOptions}
                disabled={disabled || state.isModelUpdating}
                isLoading={state.isFetchingModels}
                placeholder={
                  state.modelOptions.length > 0
                    ? t(
                        "settings.postProcessing.api.model.placeholderWithOptions",
                      )
                    : t(
                        "settings.postProcessing.api.model.placeholderNoOptions",
                      )
                }
                onSelect={state.handleModelSelect}
                onCreate={state.handleModelCreate}
                onBlur={() => {}}
                className="flex-1 min-w-[380px]"
              />
              <ResetButton
                onClick={state.handleRefreshModels}
                disabled={disabled || state.isFetchingModels}
                ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
                className="flex h-10 w-10 items-center justify-center"
              >
                <RefreshCcw
                  className={`h-4 w-4 ${state.isFetchingModels ? "animate-spin" : ""}`}
                />
              </ResetButton>
            </div>
          </SettingContainer>
        </>
      )}
    </>
  );
};

const PostProcessingSettingsPromptsComponent: React.FC<ProviderSectionProps> = ({
  disabled = false,
  providerState: _providerState,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");

  const prompts = getSetting("post_process_prompts") || [];
  const selectedPromptId = getSetting("post_process_selected_prompt_id") || "";
  const selectedPrompt =
    prompts.find((prompt) => prompt.id === selectedPromptId) || null;

  useEffect(() => {
    if (isCreating) return;

    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  }, [
    isCreating,
    selectedPromptId,
    selectedPrompt?.name,
    selectedPrompt?.prompt,
  ]);

  const handlePromptSelect = (promptId: string | null) => {
    if (!promptId || disabled) return;
    void updateSetting("post_process_selected_prompt_id", promptId);
    setIsCreating(false);
  };

  const handleCreatePrompt = async () => {
    if (disabled || !draftName.trim() || !draftText.trim()) return;

    try {
      const result = await commands.addPostProcessPrompt(
        draftName.trim(),
        draftText.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
        await updateSetting("post_process_selected_prompt_id", result.data.id);
        setIsCreating(false);
      }
    } catch (error) {
      console.error("Failed to create prompt:", error);
    }
  };

  const handleUpdatePrompt = async () => {
    if (
      disabled ||
      !selectedPromptId ||
      !draftName.trim() ||
      !draftText.trim()
    ) {
      return;
    }

    try {
      const result = await commands.updatePostProcessPrompt(
        selectedPromptId,
        draftName.trim(),
        draftText.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
      }
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    if (!promptId || disabled) return;

    try {
      const result = await commands.deletePostProcessPrompt(promptId);
      if (result.status === "ok") {
        await refreshSettings();
        setIsCreating(false);
      }
    } catch (error) {
      console.error("Failed to delete prompt:", error);
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  };

  const handleStartCreate = () => {
    if (disabled) return;
    setIsCreating(true);
    setDraftName("");
    setDraftText("");
  };

  const hasPrompts = prompts.length > 0;
  const isDirty =
    !!selectedPrompt &&
    (draftName.trim() !== selectedPrompt.name ||
      draftText.trim() !== selectedPrompt.prompt.trim());

  return (
    <SettingContainer
      title={t("settings.postProcessing.prompts.selectedPrompt.title")}
      description={t(
        "settings.postProcessing.prompts.selectedPrompt.description",
      )}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
      disabled={disabled}
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Dropdown
            selectedValue={selectedPromptId || null}
            options={prompts.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            onSelect={(value) => handlePromptSelect(value)}
            placeholder={
              prompts.length === 0
                ? t("settings.postProcessing.prompts.noPrompts")
                : t("settings.postProcessing.prompts.selectPrompt")
            }
            disabled={
              disabled ||
              isUpdating("post_process_selected_prompt_id") ||
              isCreating
            }
            className="flex-1"
          />
          <Button
            onClick={handleStartCreate}
            variant="primary"
            size="md"
            disabled={disabled || isCreating}
          >
            {t("settings.postProcessing.prompts.createNew")}
          </Button>
        </div>

        {!isCreating && hasPrompts && selectedPrompt && (
          <div className="space-y-3">
            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                variant="compact"
                disabled={disabled}
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
                disabled={disabled}
              />
              <p
                className="text-xs text-mid-gray/70"
                dangerouslySetInnerHTML={{
                  __html: t("settings.postProcessing.prompts.promptTip"),
                }}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleUpdatePrompt}
                variant="primary"
                size="md"
                disabled={
                  disabled || !draftName.trim() || !draftText.trim() || !isDirty
                }
              >
                {t("settings.postProcessing.prompts.updatePrompt")}
              </Button>
              <Button
                onClick={() => handleDeletePrompt(selectedPromptId)}
                variant="secondary"
                size="md"
                disabled={disabled || !selectedPromptId || prompts.length <= 1}
              >
                {t("settings.postProcessing.prompts.deletePrompt")}
              </Button>
            </div>
          </div>
        )}

        {!isCreating && !selectedPrompt && (
          <div className="p-3 bg-mid-gray/5 rounded-md border border-mid-gray/20">
            <p className="text-sm text-mid-gray">
              {hasPrompts
                ? t("settings.postProcessing.prompts.selectToEdit")
                : t("settings.postProcessing.prompts.createFirst")}
            </p>
          </div>
        )}

        {isCreating && (
          <div className="space-y-3">
            <div className="space-y-2 block flex flex-col">
              <label className="text-sm font-semibold text-text">
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                variant="compact"
                disabled={disabled}
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
                disabled={disabled}
              />
              <p
                className="text-xs text-mid-gray/70"
                dangerouslySetInnerHTML={{
                  __html: t("settings.postProcessing.prompts.promptTip"),
                }}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleCreatePrompt}
                variant="primary"
                size="md"
                disabled={disabled || !draftName.trim() || !draftText.trim()}
              >
                {t("settings.postProcessing.prompts.createPrompt")}
              </Button>
              <Button
                onClick={handleCancelCreate}
                variant="secondary"
                size="md"
                disabled={disabled}
              >
                {t("settings.postProcessing.prompts.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingContainer>
  );
};

export const PostProcessingSettingsApi = React.memo(
  PostProcessingSettingsApiComponent,
);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";

export const PostProcessingSettingsPrompts = React.memo(
  PostProcessingSettingsPromptsComponent,
);
PostProcessingSettingsPrompts.displayName = "PostProcessingSettingsPrompts";

const emptyDictionaryEntry = (): DictionaryEntry => ({
  spoken: "",
  written: "",
  priority: 0,
  case_sensitive: false,
  exact_only: false,
});

const emptyToneDefinition = (): ToneDefinition => ({
  id: "",
  label: "",
  instruction: "",
});

const emptyAppToneMapping = (): AppToneMapping => ({
  bundle_id: "",
  app_name: "",
  tone_id: "",
});

const PostProcessSetupStatus: React.FC<{
  providerState: PostProcessProviderState;
}> = ({ providerState }) => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();

  const postProcessEnabled = getSetting("post_process_enabled") ?? false;
  const prompts = getSetting("post_process_prompts") || [];
  const selectedPromptId = getSetting("post_process_selected_prompt_id") || "";
  const selectedPromptExists = prompts.some((prompt) => prompt.id === selectedPromptId);
  const apiKey = getSetting("post_process_api_keys")?.[
    providerState.selectedProviderId
  ];
  const selectedModel = getSetting("post_process_models")?.[
    providerState.selectedProviderId
  ];

  const setupStatus = useMemo<SetupStatus>(() => {
    if (!postProcessEnabled) {
      return {
        variant: "info",
        message: t("settings.postProcessing.status.disabled"),
      };
    }

    if (!providerState.selectedProvider) {
      return {
        variant: "error",
        message: t("settings.postProcessing.status.noProvider"),
      };
    }

    if (providerState.isAppleProvider && providerState.appleIntelligenceUnavailable) {
      return {
        variant: "warning",
        message: t("settings.postProcessing.status.appleUnavailable"),
      };
    }

    if (!providerState.isAppleProvider) {
      const issues: string[] = [];
      const selectedProvider = providerState.selectedProvider;
      const providerAllowsNoApiKey =
        selectedProvider?.id === "custom" || selectedProvider?.id === "ollama"
          ? isLocalBaseUrl(providerState.baseUrl)
          : isLocalBaseUrl(selectedProvider?.base_url ?? "");

      if (
        providerState.isCustomProvider &&
        providerState.baseUrl.trim().length === 0
      ) {
        issues.push(t("settings.postProcessing.status.missingBaseUrl"));
      }
      if (!providerAllowsNoApiKey && !apiKey?.trim()) {
        issues.push(t("settings.postProcessing.status.missingApiKey"));
      }
      if (!selectedModel?.trim()) {
        issues.push(t("settings.postProcessing.status.missingModel"));
      }
      if (!selectedPromptExists) {
        issues.push(t("settings.postProcessing.status.missingPrompt"));
      }

      if (issues.length > 0) {
        return {
          variant: "warning",
          message: (
            <>
              <span>{t("settings.postProcessing.status.finishSetup")}</span>
              <br />
              {issues.map((issue, index) => (
                <React.Fragment key={issue}>
                  <span>{`\u2022 ${issue}`}</span>
                  {index < issues.length - 1 && <br />}
                </React.Fragment>
              ))}
            </>
          ),
        };
      }
    }

    return {
      variant: "success",
      message: t("settings.postProcessing.status.ready"),
    };
  }, [
    apiKey,
    postProcessEnabled,
    providerState.appleIntelligenceUnavailable,
    providerState.baseUrl,
    providerState.isAppleProvider,
    providerState.isCustomProvider,
    providerState.selectedProvider,
    selectedModel,
    selectedPromptExists,
    t,
  ]);

  return <Alert variant={setupStatus.variant}>{setupStatus.message}</Alert>;
};

const PostProcessReviewSettings: React.FC<ProviderSectionProps> = ({
  disabled = false,
  providerState: _providerState,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const enabled = getSetting("show_preview_before_paste") || false;

  return (
    <>
      <ToggleSwitch
        checked={enabled}
        onChange={(value) =>
          void updateSetting("show_preview_before_paste", value)
        }
        isUpdating={isUpdating("show_preview_before_paste")}
        label={t("settings.postProcessing.review.toggle.label")}
        description={t("settings.postProcessing.review.toggle.description")}
        grouped={true}
        disabled={disabled}
      />
      <Alert variant={enabled ? "info" : "warning"} contained>
        {disabled
          ? t("settings.postProcessing.review.status.disabled")
          : enabled
            ? t("settings.postProcessing.review.status.enabled")
            : t("settings.postProcessing.review.status.off")}
      </Alert>
    </>
  );
};

const ApplePostProcessingSettings: React.FC<ProviderSectionProps> = ({
  disabled = false,
  providerState,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  if (!providerState.isAppleProvider) {
    return null;
  }

  const selectedMode = getSetting("post_process_mode") || "literal";
  const rewriteStrength = getSetting("max_rewrite_strength") || 0;
  const fallbackToRaw = getSetting("fallback_to_raw_on_failure") ?? true;

  return (
    <>
      <Alert variant="info" contained>
        {t("settings.postProcessing.apple.description")}
      </Alert>

      <SettingContainer
        title={t("settings.postProcessing.apple.mode.title")}
        description={t("settings.postProcessing.apple.mode.description")}
        descriptionMode="tooltip"
        grouped={true}
        disabled={disabled}
      >
        <Dropdown
          selectedValue={selectedMode}
          onSelect={(value) =>
            void updateSetting("post_process_mode", value as "literal" | "intent")
          }
          options={[
            {
              value: "literal",
              label: t("settings.postProcessing.apple.mode.literal"),
            },
            {
              value: "intent",
              label: t("settings.postProcessing.apple.mode.intent"),
            },
          ]}
          disabled={disabled || isUpdating("post_process_mode")}
        />
      </SettingContainer>

      <SettingContainer
        title={t("settings.postProcessing.apple.rewriteStrength.title")}
        description={t(
          "settings.postProcessing.apple.rewriteStrength.description",
        )}
        descriptionMode="tooltip"
        grouped={true}
        disabled={disabled}
      >
        <Dropdown
          selectedValue={String(rewriteStrength)}
          onSelect={(value) =>
            void updateSetting("max_rewrite_strength", Number(value))
          }
          options={[
            {
              value: "0",
              label: t(
                "settings.postProcessing.apple.rewriteStrength.conservative",
              ),
            },
            {
              value: "1",
              label: t("settings.postProcessing.apple.rewriteStrength.balanced"),
            },
            {
              value: "2",
              label: t(
                "settings.postProcessing.apple.rewriteStrength.aggressive",
              ),
            },
          ]}
          disabled={disabled || isUpdating("max_rewrite_strength")}
        />
      </SettingContainer>

      <ToggleSwitch
        checked={fallbackToRaw}
        onChange={(enabled) =>
          void updateSetting("fallback_to_raw_on_failure", enabled)
        }
        isUpdating={isUpdating("fallback_to_raw_on_failure")}
        label={t("settings.postProcessing.apple.fallback.label")}
        description={t("settings.postProcessing.apple.fallback.description")}
        grouped={true}
        disabled={disabled}
      />
    </>
  );
};

const AppAwareToneSettings: React.FC<ProviderSectionProps> = ({
  disabled = false,
  providerState,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  if (!providerState.isAppleProvider) {
    return null;
  }

  const enabled = getSetting("app_aware_tone_enabled") || false;
  const toneDefinitions = getSetting("tone_definitions") || [];
  const appToneMappings = getSetting("app_tone_mappings") || [];
  const toneOptions = toneDefinitions.map((tone) => ({
    value: tone.id,
    label: tone.label || tone.id,
  }));

  const persistToneDefinitions = (nextDefinitions: ToneDefinition[]) => {
    void updateSetting("tone_definitions", nextDefinitions);
  };

  const persistMappings = (nextMappings: AppToneMapping[]) => {
    void updateSetting("app_tone_mappings", nextMappings);
  };

  const updateToneDefinition = (
    index: number,
    field: keyof ToneDefinition,
    value: string,
  ) => {
    const nextDefinitions = toneDefinitions.map((definition, currentIndex) =>
      currentIndex === index ? { ...definition, [field]: value } : definition,
    );
    persistToneDefinitions(nextDefinitions);
  };

  const updateMapping = (
    index: number,
    field: keyof AppToneMapping,
    value: string,
  ) => {
    const nextMappings = appToneMappings.map((mapping, currentIndex) =>
      currentIndex === index ? { ...mapping, [field]: value } : mapping,
    );
    persistMappings(nextMappings);
  };

  const mappingControlsDisabled = disabled || !enabled;

  return (
    <>
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => void updateSetting("app_aware_tone_enabled", value)}
        isUpdating={isUpdating("app_aware_tone_enabled")}
        label={t("settings.postProcessing.appAware.toggle.label")}
        description={t("settings.postProcessing.appAware.toggle.description")}
        grouped={true}
        disabled={disabled}
      />

      <Alert variant="info" contained>
        {enabled
          ? t("settings.postProcessing.appAware.description")
          : t("settings.postProcessing.appAware.disabledMessage")}
      </Alert>

      <SettingContainer
        title={t("settings.postProcessing.appAware.tones.title")}
        description={t("settings.postProcessing.appAware.tones.description")}
        descriptionMode="tooltip"
        layout="stacked"
        grouped={true}
        disabled={mappingControlsDisabled}
      >
        <div className="space-y-3">
          {toneDefinitions.map((definition, index) => (
            <div
              key={`${definition.id}-${index}`}
              className="rounded-md border border-mid-gray/20 p-3 space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t("settings.postProcessing.appAware.tones.columns.id")}
                  </label>
                  <Input
                    value={definition.id}
                    onChange={(event) =>
                      updateToneDefinition(index, "id", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.appAware.tones.placeholders.id",
                    )}
                    disabled={
                      mappingControlsDisabled || isUpdating("tone_definitions")
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t("settings.postProcessing.appAware.tones.columns.label")}
                  </label>
                  <Input
                    value={definition.label}
                    onChange={(event) =>
                      updateToneDefinition(index, "label", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.appAware.tones.placeholders.label",
                    )}
                    disabled={
                      mappingControlsDisabled || isUpdating("tone_definitions")
                    }
                  />
                </div>
                <div className="flex items-end justify-end">
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() =>
                      persistToneDefinitions(
                        toneDefinitions.filter((_, i) => i !== index),
                      )
                    }
                    disabled={
                      mappingControlsDisabled || isUpdating("tone_definitions")
                    }
                  >
                    {t("settings.postProcessing.appAware.remove")}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-mid-gray">
                  {t(
                    "settings.postProcessing.appAware.tones.columns.instruction",
                  )}
                </label>
                <Textarea
                  value={definition.instruction}
                  onChange={(event) =>
                    updateToneDefinition(index, "instruction", event.target.value)
                  }
                  placeholder={t(
                    "settings.postProcessing.appAware.tones.placeholders.instruction",
                  )}
                  disabled={
                    mappingControlsDisabled || isUpdating("tone_definitions")
                  }
                />
              </div>
            </div>
          ))}

          <Button
            onClick={() =>
              persistToneDefinitions([...toneDefinitions, emptyToneDefinition()])
            }
            variant="primary-soft"
            size="md"
            disabled={mappingControlsDisabled || isUpdating("tone_definitions")}
          >
            {t("settings.postProcessing.appAware.tones.add")}
          </Button>
        </div>
      </SettingContainer>

      <SettingContainer
        title={t("settings.postProcessing.appAware.mappings.title")}
        description={t("settings.postProcessing.appAware.mappings.description")}
        descriptionMode="tooltip"
        layout="stacked"
        grouped={true}
        disabled={mappingControlsDisabled}
      >
        <div className="space-y-3">
          {appToneMappings.map((mapping, index) => (
            <div
              key={`${mapping.bundle_id}-${index}`}
              className="rounded-md border border-mid-gray/20 p-3 space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t(
                      "settings.postProcessing.appAware.mappings.columns.appName",
                    )}
                  </label>
                  <Input
                    value={mapping.app_name}
                    onChange={(event) =>
                      updateMapping(index, "app_name", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.appAware.mappings.placeholders.appName",
                    )}
                    disabled={
                      mappingControlsDisabled || isUpdating("app_tone_mappings")
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t(
                      "settings.postProcessing.appAware.mappings.columns.bundleId",
                    )}
                  </label>
                  <Input
                    value={mapping.bundle_id}
                    onChange={(event) =>
                      updateMapping(index, "bundle_id", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.appAware.mappings.placeholders.bundleId",
                    )}
                    disabled={
                      mappingControlsDisabled || isUpdating("app_tone_mappings")
                    }
                  />
                </div>
                <div className="flex items-end justify-end">
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() =>
                      persistMappings(appToneMappings.filter((_, i) => i !== index))
                    }
                    disabled={
                      mappingControlsDisabled || isUpdating("app_tone_mappings")
                    }
                  >
                    {t("settings.postProcessing.appAware.remove")}
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-mid-gray">
                  {t("settings.postProcessing.appAware.mappings.columns.tone")}
                </label>
                <Dropdown
                  selectedValue={mapping.tone_id}
                  onSelect={(value) => updateMapping(index, "tone_id", value)}
                  options={toneOptions}
                  disabled={
                    mappingControlsDisabled ||
                    isUpdating("app_tone_mappings") ||
                    toneOptions.length === 0
                  }
                />
              </div>
            </div>
          ))}

          <Button
            onClick={() =>
              persistMappings([...appToneMappings, emptyAppToneMapping()])
            }
            variant="primary-soft"
            size="md"
            disabled={mappingControlsDisabled || isUpdating("app_tone_mappings")}
          >
            {t("settings.postProcessing.appAware.mappings.add")}
          </Button>
        </div>
      </SettingContainer>
    </>
  );
};

const PersonalDictionarySettings: React.FC<ProviderSectionProps> = ({
  disabled = false,
  providerState,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  if (!providerState.isAppleProvider) {
    return null;
  }

  const entries = getSetting("personal_dictionary") || [];
  const duplicateSpokenForms = new Set<string>();
  const seenSpokenForms = new Set<string>();
  entries.forEach((entry) => {
    const key = entry.spoken.trim().toLowerCase();
    if (!key) return;
    if (seenSpokenForms.has(key)) {
      duplicateSpokenForms.add(key);
    } else {
      seenSpokenForms.add(key);
    }
  });

  const persistEntries = (nextEntries: DictionaryEntry[]) => {
    void updateSetting("personal_dictionary", nextEntries);
  };

  const updateEntry = (
    index: number,
    field: keyof DictionaryEntry,
    value: DictionaryEntry[keyof DictionaryEntry],
  ) => {
    const nextEntries = entries.map((entry, currentIndex) =>
      currentIndex === index ? { ...entry, [field]: value } : entry,
    );
    persistEntries(nextEntries);
  };

  return (
    <SettingContainer
      title={t("settings.postProcessing.dictionary.editor.title")}
      description={t("settings.postProcessing.dictionary.editor.description")}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
      disabled={disabled}
    >
      <div className="space-y-3">
        {duplicateSpokenForms.size > 0 && (
          <Alert variant="warning" contained>
            {t("settings.postProcessing.dictionary.duplicateWarning")}
          </Alert>
        )}

        {entries.length === 0 && (
          <div className="rounded-md border border-mid-gray/20 bg-mid-gray/5 p-3 text-sm text-mid-gray">
            {t("settings.postProcessing.dictionary.empty")}
          </div>
        )}

        {entries.map((entry, index) => {
          const spokenKey = entry.spoken.trim().toLowerCase();
          const isDuplicate =
            spokenKey.length > 0 && duplicateSpokenForms.has(spokenKey);

          return (
            <div
              key={`${entry.spoken}-${entry.written}-${index}`}
              className="rounded-md border border-mid-gray/20 p-3 space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t("settings.postProcessing.dictionary.columns.spoken")}
                  </label>
                  <Input
                    value={entry.spoken}
                    onChange={(event) =>
                      updateEntry(index, "spoken", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.dictionary.placeholders.spoken",
                    )}
                    disabled={disabled || isUpdating("personal_dictionary")}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t("settings.postProcessing.dictionary.columns.written")}
                  </label>
                  <Input
                    value={entry.written}
                    onChange={(event) =>
                      updateEntry(index, "written", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.dictionary.placeholders.written",
                    )}
                    disabled={disabled || isUpdating("personal_dictionary")}
                  />
                </div>

                <div className="flex items-end justify-end">
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() =>
                      persistEntries(entries.filter((_, currentIndex) => currentIndex !== index))
                    }
                    disabled={disabled || isUpdating("personal_dictionary")}
                  >
                    {t("settings.postProcessing.dictionary.remove")}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.exact_only}
                    onChange={(event) =>
                      updateEntry(index, "exact_only", event.target.checked)
                    }
                    disabled={disabled || isUpdating("personal_dictionary")}
                  />
                  <span>
                    {t("settings.postProcessing.dictionary.columns.exactOnly")}
                  </span>
                </label>

                {isDuplicate && (
                  <span className="text-xs text-yellow-400">
                    {t("settings.postProcessing.dictionary.duplicateBadge")}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <Button
          onClick={() =>
            persistEntries([...entries, emptyDictionaryEntry()])
          }
          variant="primary-soft"
          size="md"
          disabled={disabled || isUpdating("personal_dictionary")}
        >
          {t("settings.postProcessing.dictionary.add")}
        </Button>
      </div>
    </SettingContainer>
  );
};

const PostProcessPreviewTester: React.FC<ProviderSectionProps> = ({
  disabled = false,
  providerState,
}) => {
  const { t } = useTranslation();
  const { getSetting, previewPostProcessText } = useSettings();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<PostProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewAppBundleId, setPreviewAppBundleId] = useState("none");

  const appToneMappings = getSetting("app_tone_mappings") || [];
  const previewAppOptions = [
    {
      value: "none",
      label: t("settings.postProcessing.preview.previewApp.none"),
    },
    ...appToneMappings.map((mapping) => ({
      value: mapping.bundle_id,
      label: mapping.app_name || mapping.bundle_id,
    })),
  ];

  const controlsDisabled =
    disabled ||
    (providerState.isAppleProvider && providerState.appleIntelligenceUnavailable) ||
    isLoading;

  const runPreview = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const preview = await previewPostProcessText(
        input,
        previewAppBundleId === "none" ? null : previewAppBundleId,
      );
      setResult(preview);
    } catch (previewError) {
      setResult(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : t("settings.postProcessing.preview.errors.generic"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SettingContainer
      title={t("settings.postProcessing.preview.testInput.title")}
      description={t("settings.postProcessing.preview.testInput.description")}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
      disabled={disabled}
    >
      <div className="space-y-3">
        {disabled && (
          <Alert variant="warning" contained>
            {t("settings.postProcessing.preview.disabledMessage")}
          </Alert>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-mid-gray">
            {t("settings.postProcessing.preview.previewApp.label")}
          </label>
          <Dropdown
            selectedValue={previewAppBundleId}
            onSelect={setPreviewAppBundleId}
            options={previewAppOptions}
            disabled={controlsDisabled}
          />
        </div>

        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("settings.postProcessing.preview.testInput.placeholder")}
          disabled={controlsDisabled}
        />

        <div className="flex gap-2">
          <Button
            onClick={runPreview}
            disabled={controlsDisabled || !input.trim()}
          >
            {isLoading
              ? t("settings.postProcessing.preview.runLoading")
              : t("settings.postProcessing.preview.run")}
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {result && (
          <div className="space-y-3 rounded-md border border-mid-gray/20 p-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-mid-gray">
                {t("settings.postProcessing.preview.outputLabel")}
              </div>
              <Textarea value={result.final_text} readOnly />
            </div>

            {result.dictionary_hits.length > 0 && (
              <div className="text-xs text-mid-gray">
                {t("settings.postProcessing.preview.dictionaryHits", {
                  hits: result.dictionary_hits.join(", "),
                })}
              </div>
            )}

            {result.active_app_context && (
              <div className="text-xs text-mid-gray">
                {t("settings.postProcessing.preview.appContext", {
                  app:
                    result.active_app_context.localized_name ||
                    result.active_app_context.bundle_id,
                  tone:
                    result.applied_tone_id ||
                    t("settings.postProcessing.preview.previewApp.none"),
                })}
              </div>
            )}

            <div className="text-xs text-mid-gray">
              {t("settings.postProcessing.preview.editSummary", {
                bullets: result.edits.added_bullets
                  ? t("common.yes")
                  : t("common.no"),
                paragraphs: result.edits.added_paragraphs
                  ? t("common.yes")
                  : t("common.no"),
              })}
            </div>
          </div>
        )}
      </div>
    </SettingContainer>
  );
};

export const PostProcessingSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const providerState = usePostProcessProviderState();
  const postProcessEnabled = getSetting("post_process_enabled") ?? false;
  const localPrivacyMode = getSetting("local_privacy_mode") ?? false;
  const controlsDisabled = !postProcessEnabled;

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t("settings.postProcessing.title")}</h1>
        <p className="text-sm text-text/60">
          {t("settings.postProcessing.description")}
        </p>
      </div>

      <SettingsGroup
        title={t("settings.postProcessing.sections.setup.title")}
        description={t("settings.postProcessing.sections.setup.description")}
      >
        <PostProcessingToggle descriptionMode="tooltip" grouped={true} />
        <ToggleSwitch
          checked={localPrivacyMode}
          onChange={(enabled) => void updateSetting("local_privacy_mode", enabled)}
          isUpdating={isUpdating("local_privacy_mode")}
          label="Local Privacy Mode"
          description="Enforce local-only post-processing providers and block cloud providers."
          descriptionMode="tooltip"
          grouped={true}
        />
        {localPrivacyMode && (
          <Alert variant="info" contained>
            Cloud post-processing providers are disabled while Local Privacy Mode is enabled.
          </Alert>
        )}
        <ShortcutInput
          shortcutId="transcribe_with_post_process"
          descriptionMode="tooltip"
          grouped={true}
        />
        <PostProcessingSettingsApi
          disabled={controlsDisabled}
          providerState={providerState}
        />
      </SettingsGroup>

      <PostProcessSetupStatus providerState={providerState} />

      <SettingsGroup
        title={t("settings.postProcessing.sections.review.title")}
        description={t("settings.postProcessing.sections.review.description")}
      >
        <PostProcessReviewSettings
          disabled={controlsDisabled}
          providerState={providerState}
        />
      </SettingsGroup>

      {providerState.isAppleProvider && (
        <>
          <SettingsGroup
            title={t("settings.postProcessing.sections.appleCleanup.title")}
            description={t(
              "settings.postProcessing.sections.appleCleanup.description",
            )}
          >
            <ApplePostProcessingSettings
              disabled={controlsDisabled}
              providerState={providerState}
            />
          </SettingsGroup>

          <SettingsGroup
            title={t("settings.postProcessing.sections.applePersonalization.title")}
            description={t(
              "settings.postProcessing.sections.applePersonalization.description",
            )}
          >
            <AppAwareToneSettings
              disabled={controlsDisabled}
              providerState={providerState}
            />
            <PersonalDictionarySettings
              disabled={controlsDisabled}
              providerState={providerState}
            />
          </SettingsGroup>
        </>
      )}

      {!providerState.isAppleProvider && (
        <SettingsGroup
          title={t("settings.postProcessing.sections.prompting.title")}
          description={t(
            "settings.postProcessing.sections.prompting.description",
          )}
        >
          <PostProcessingSettingsPrompts
            disabled={controlsDisabled}
            providerState={providerState}
          />
        </SettingsGroup>
      )}

      <SettingsGroup
        title={t("settings.postProcessing.sections.preview.title")}
        description={t("settings.postProcessing.sections.preview.description")}
      >
        <PostProcessPreviewTester
          disabled={controlsDisabled}
          providerState={providerState}
        />
      </SettingsGroup>
    </div>
  );
};
