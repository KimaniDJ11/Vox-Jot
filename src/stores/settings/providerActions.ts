import { commands } from "@/bindings";
import { unwrapCommandResult, type CommandResult } from "@/lib/commandResult";
import { reportSettingError } from "./reportSettingError";
import type { SettingsActionContext, SettingsStore } from "./types";

export function createProviderActions({
  setState: set,
  getState: get,
  updates,
}: SettingsActionContext): Pick<
  SettingsStore,
  | "setPostProcessProvider"
  | "updatePostProcessBaseUrl"
  | "updatePostProcessApiKey"
  | "updatePostProcessModel"
  | "updateTranslationModel"
  | "fetchPostProcessModels"
  | "setPostProcessModelOptions"
  | "previewPostProcessText"
> {
  const modelListVersions = new Map<string, number>();
  const clearModelOptions = (providerId: string) => {
    modelListVersions.set(
      providerId,
      (modelListVersions.get(providerId) ?? 0) + 1,
    );
    get().setPostProcessModelOptions(providerId, []);
  };

  /** Persist a provider-scoped change, reporting a rejection to the user. */
  const saveProviderChange = async (
    updateKey: string,
    save: () => Promise<CommandResult<null>>,
  ): Promise<boolean> =>
    updates.run(updateKey, async () => {
      try {
        await unwrapCommandResult(save());
        return true;
      } catch (error) {
        reportSettingError(error);
        return false;
      }
    });

  return {
    setPostProcessProvider: async (providerId) => {
      // A provider's cached models may come from an earlier endpoint or key.
      clearModelOptions(providerId);
      return get().updateSetting("post_process_provider_id", providerId);
    },
    updatePostProcessBaseUrl: async (providerId, baseUrl) => {
      const saved = await saveProviderChange(
        `post_process_base_url:${providerId}`,
        () => commands.setPostProcessBaseUrl(providerId, baseUrl),
      );
      if (saved) clearModelOptions(providerId);
      return saved;
    },
    updatePostProcessApiKey: async (providerId, apiKey) => {
      const saved = await saveProviderChange(
        `post_process_api_key:${providerId}`,
        () => commands.setPostProcessApiKey(providerId, apiKey),
      );
      if (saved) clearModelOptions(providerId);
      return saved;
    },
    updatePostProcessModel: (providerId, model) =>
      saveProviderChange(`post_process_model:${providerId}`, () =>
        commands.setPostProcessModel(providerId, model),
      ),
    updateTranslationModel: (providerId, model) =>
      saveProviderChange(`translation_model:${providerId}`, () =>
        commands.setTranslationModel(providerId, model),
      ),
    fetchPostProcessModels: (providerId) => {
      const updateKey = `post_process_models_fetch:${providerId}`;
      return updates.run(updateKey, async () => {
        const version = modelListVersions.get(providerId) ?? 0;
        try {
          const models = await unwrapCommandResult(
            commands.fetchPostProcessModels(providerId),
          );
          if (version !== (modelListVersions.get(providerId) ?? 0)) return [];
          get().setPostProcessModelOptions(providerId, models);
          return models;
        } catch (error) {
          reportSettingError(error, "settings.errors.modelListFailed");
          return [];
        }
      });
    },
    setPostProcessModelOptions: (providerId, models) =>
      set((state) => ({
        postProcessModelOptions: {
          ...state.postProcessModelOptions,
          [providerId]: models,
        },
      })),
    previewPostProcessText: (text, appBundleIdOverride = null) =>
      unwrapCommandResult(
        commands.previewPostProcessText(text, appBundleIdOverride),
      ),
  };
}
