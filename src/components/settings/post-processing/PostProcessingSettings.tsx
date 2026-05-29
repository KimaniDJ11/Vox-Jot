import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCcw } from "lucide-react";
import { commands, type PostProcessResult } from "@/bindings";

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
        descriptionMode="inline"
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
              descriptionMode="inline"
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
            descriptionMode="inline"
            layout="horizontal"
            grouped={true}
            disabled={disabled}
          >
            <div className="flex items-center gap-2">
              <ApiKeyField
                onBlur={state.handleApiKeyChange}
                resetKey={state.selectedProviderId}
                hasSavedValue={state.hasApiKey}
                placeholder={
                  state.hasApiKey
                    ? t("settings.postProcessing.api.apiKey.savedPlaceholder", {
                        defaultValue:
                          "Stored in system keychain. Enter a new value to replace it.",
                      })
                    : t("settings.postProcessing.api.apiKey.placeholder")
                }
                disabled={disabled || state.isApiKeyUpdating}
                className="min-w-[320px]"
              />
              <span className="text-xs text-[var(--muted)]">
                {state.hasApiKey
                  ? t("settings.postProcessing.api.apiKey.savedStatus", {
                      defaultValue: "Saved",
                    })
                  : t("settings.postProcessing.api.apiKey.missingStatus", {
                      defaultValue: "Missing",
                    })}
              </span>
            </div>
          </SettingContainer>

          <SettingContainer
            title={t("settings.postProcessing.api.model.title")}
            description={
              state.isCustomProvider
                ? t("settings.postProcessing.api.model.descriptionCustom")
                : t("settings.postProcessing.api.model.descriptionDefault")
            }
            descriptionMode="inline"
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

const PostProcessingSettingsPromptsComponent: React.FC<
  ProviderSectionProps
> = ({ disabled = false, providerState: _providerState }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [confirmingDeletePromptId, setConfirmingDeletePromptId] = useState<
    string | null
  >(null);

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
    setConfirmingDeletePromptId(null);
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
        setConfirmingDeletePromptId(null);
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
        setConfirmingDeletePromptId(null);
      }
    } catch (error) {
      console.error("Failed to delete prompt:", error);
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setConfirmingDeletePromptId(null);
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
    setConfirmingDeletePromptId(null);
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
              {confirmingDeletePromptId === selectedPromptId ? (
                <>
                  <Button
                    onClick={() => handleDeletePrompt(selectedPromptId)}
                    variant="danger"
                    size="md"
                    disabled={
                      disabled || !selectedPromptId || prompts.length <= 1
                    }
                  >
                    {t("settings.postProcessing.prompts.deletePrompt")}
                  </Button>
                  <Button
                    onClick={() => setConfirmingDeletePromptId(null)}
                    variant="secondary"
                    size="md"
                    disabled={disabled}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => setConfirmingDeletePromptId(selectedPromptId)}
                  variant="secondary"
                  size="md"
                  disabled={disabled || !selectedPromptId || prompts.length <= 1}
                >
                  {t("settings.postProcessing.prompts.deletePrompt")}
                </Button>
              )}
            </div>
          </div>
        )}

        {!isCreating && !selectedPrompt && (
          <div className="p-3 bg-mid-gray/5 rounded-md border border-mid-gray/20">
            <p className="text-sm text-[var(--muted)]">
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

const PostProcessSetupStatus: React.FC<{
  providerState: PostProcessProviderState;
}> = ({ providerState }) => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();

  const postProcessEnabled = getSetting("post_process_enabled") ?? false;
  const cleanupLevel = getSetting("post_process_cleanup_level") || "light";
  const prompts = getSetting("post_process_prompts") || [];
  const selectedPromptId = getSetting("post_process_selected_prompt_id") || "";
  const selectedPromptExists = prompts.some(
    (prompt) => prompt.id === selectedPromptId,
  );
  const hasApiKey =
    getSetting("post_process_api_key_status")?.[
      providerState.selectedProviderId
    ] ?? false;
  const selectedModel = getSetting("post_process_models")?.[
    providerState.selectedProviderId
  ];

  const setupStatus = useMemo<SetupStatus>(() => {
    if (!postProcessEnabled || cleanupLevel === "raw") {
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

    if (
      providerState.isAppleProvider &&
      providerState.appleIntelligenceUnavailable
    ) {
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
      if (!providerAllowsNoApiKey && !hasApiKey) {
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
    hasApiKey,
    cleanupLevel,
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

  if (setupStatus.variant === "success") {
    return null;
  }

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
        descriptionMode="inline"
        grouped={true}
        disabled={disabled}
      />
    </>
  );
};

const CleanupLevelSettings: React.FC<{ disabled?: boolean }> = ({
  disabled = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const cleanupLevel = getSetting("post_process_cleanup_level") || "light";

  return (
    <SettingContainer
      title={t("settings.postProcessing.cleanupLevel.title")}
      description={t("settings.postProcessing.cleanupLevel.description")}
      descriptionMode="inline"
      grouped={true}
      disabled={disabled}
    >
      <Dropdown
        selectedValue={cleanupLevel}
        onSelect={(value) =>
          void updateSetting(
            "post_process_cleanup_level",
            value as "raw" | "light" | "medium" | "high",
          )
        }
        options={[
          {
            value: "raw",
            label: t("settings.postProcessing.cleanupLevel.raw"),
          },
          {
            value: "light",
            label: t("settings.postProcessing.cleanupLevel.light"),
          },
          {
            value: "medium",
            label: t("settings.postProcessing.cleanupLevel.medium"),
          },
          {
            value: "high",
            label: t("settings.postProcessing.cleanupLevel.high"),
          },
        ]}
        disabled={disabled || isUpdating("post_process_cleanup_level")}
      />
    </SettingContainer>
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

  const fallbackToRaw = getSetting("fallback_to_raw_on_failure") ?? true;

  return (
    <>
      <Alert variant="info" contained>
        {t("settings.postProcessing.apple.description")}
      </Alert>

      <ToggleSwitch
        checked={fallbackToRaw}
        onChange={(enabled) =>
          void updateSetting("fallback_to_raw_on_failure", enabled)
        }
        isUpdating={isUpdating("fallback_to_raw_on_failure")}
        label={t("settings.postProcessing.apple.fallback.label")}
        description={t("settings.postProcessing.apple.fallback.description")}
        descriptionMode="inline"
        grouped={true}
        disabled={disabled}
      />
    </>
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

  const writeRules = getSetting("write_rules") || [];
  const previewAppOptions = [
    {
      value: "none",
      label: t("settings.postProcessing.preview.previewApp.none"),
    },
    ...writeRules.flatMap((rule) =>
      (rule.matchers.bundle_ids ?? []).map((bundleId) => ({
        value: bundleId,
        label: rule.name || bundleId,
      })),
    ),
  ];

  const controlsDisabled =
    disabled ||
    (providerState.isAppleProvider &&
      providerState.appleIntelligenceUnavailable) ||
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
      title={t("settings.postProcessing.sections.preview.title")}
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
          <label className="text-xs font-semibold text-[var(--muted)]">
            {t("settings.postProcessing.preview.previewApp.label")}
          </label>
          <Dropdown
            selectedValue={previewAppBundleId}
            onSelect={setPreviewAppBundleId}
            options={previewAppOptions}
            disabled={controlsDisabled}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-xs font-semibold text-[var(--muted)] shrink-0">
              {t("settings.postProcessing.preview.testInput.title")}
            </div>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t(
                "settings.postProcessing.preview.testInput.placeholder",
              )}
              disabled={controlsDisabled}
              className="w-full shrink-0 !min-h-[88px] max-h-[280px] overflow-y-auto [field-sizing:content]"
            />
            <div className="flex shrink-0 gap-2">
              <Button
                onClick={runPreview}
                disabled={controlsDisabled || !input.trim()}
              >
                {isLoading
                  ? t("settings.postProcessing.preview.runLoading")
                  : t("settings.postProcessing.preview.run")}
              </Button>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-xs font-semibold text-[var(--muted)] shrink-0">
              {t("settings.postProcessing.preview.outputLabel")}
            </div>
            <Textarea
              value={result?.final_text || ""}
              placeholder={t("settings.postProcessing.preview.outputLabel")}
              readOnly
              className="w-full shrink-0 !min-h-[88px] max-h-[280px] overflow-y-auto [field-sizing:content]"
            />
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {result && (
          <div className="space-y-3 rounded-md border border-mid-gray/20 bg-[var(--panel-bg)] p-3">
            {result.dictionary_hits.length > 0 && (
              <div className="text-xs text-[var(--muted)]">
                {t("settings.postProcessing.preview.dictionaryHits", {
                  hits: result.dictionary_hits.join(", "),
                })}
              </div>
            )}

            {result.active_app_context && (
              <div className="text-xs text-[var(--muted)]">
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

            <div className="text-xs text-[var(--muted)]">
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

export type PostProcessingSettingsProps = {
  /** When true, local privacy controls are shown under Privacy & data instead. */
  omitLocalPrivacy?: boolean;
};

export const PostProcessingSettings: React.FC<PostProcessingSettingsProps> = ({
  omitLocalPrivacy = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const providerState = usePostProcessProviderState();
  const postProcessEnabled = getSetting("post_process_enabled") ?? false;
  const localPrivacyMode = getSetting("local_privacy_mode") ?? false;
  const controlsDisabled = !postProcessEnabled;

  return (
    <div className="w-full space-y-6">
      <SettingsGroup title={t("settings.postProcessing.sections.setup.title")}>
        <PostProcessingToggle descriptionMode="inline" grouped={true} />
        <CleanupLevelSettings disabled={controlsDisabled} />
        {!omitLocalPrivacy && (
          <>
            <ToggleSwitch
              checked={localPrivacyMode}
              onChange={(enabled) =>
                void updateSetting("local_privacy_mode", enabled)
              }
              isUpdating={isUpdating("local_privacy_mode")}
              label={t("settings.postProcessing.localPrivacy.label")}
              description={t(
                "settings.postProcessing.localPrivacy.description",
              )}
              descriptionMode="inline"
              grouped={true}
            />
            {localPrivacyMode && (
              <Alert variant="info" contained>
                {t("settings.postProcessing.localPrivacy.cloudDisabled")}
              </Alert>
            )}
          </>
        )}
        <ShortcutInput
          shortcutId="transcribe_with_post_process"
          descriptionMode="inline"
          grouped={true}
        />
        <PostProcessingSettingsApi
          disabled={controlsDisabled}
          providerState={providerState}
        />
      </SettingsGroup>

      <PostProcessSetupStatus providerState={providerState} />

      <SettingsGroup title={t("settings.postProcessing.sections.review.title")}>
        <PostProcessReviewSettings
          disabled={controlsDisabled}
          providerState={providerState}
        />
      </SettingsGroup>

      {providerState.isAppleProvider && (
        <SettingsGroup
          title={t("settings.postProcessing.sections.appleCleanup.title")}
        >
          <ApplePostProcessingSettings
            disabled={controlsDisabled}
            providerState={providerState}
          />
        </SettingsGroup>
      )}

      {!providerState.isAppleProvider && (
        <SettingsGroup
          title={t("settings.postProcessing.sections.prompting.title")}
        >
          <PostProcessingSettingsPrompts
            disabled={controlsDisabled}
            providerState={providerState}
          />
        </SettingsGroup>
      )}

      <SettingsGroup>
        <PostProcessPreviewTester
          disabled={controlsDisabled}
          providerState={providerState}
        />
      </SettingsGroup>
    </div>
  );
};
