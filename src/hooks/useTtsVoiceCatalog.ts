import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type VoiceInfo } from "@/bindings";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import {
  getModelPlatformOverview,
  type CatalogModelDescriptor,
} from "@/lib/modelPlatform";
import {
  createTtsVoicePreset,
  listTtsVoicePresets,
  type TtsVoicePreset,
} from "@/lib/ttsVoicePresets";
import {
  buildCreateVoiceHubRows,
  type CreateVoiceHubVoiceRow,
} from "@/components/settings/general/listen/createVoiceVoiceHub";
import {
  defaultVoiceTuning,
  getTtsVoicesForSelection,
  isDraftVoiceModelAvailable,
} from "@/components/settings/general/listen/utils";

export type TtsVoiceCatalog = {
  /** The user's saved voice presets ("My Voices"). */
  presets: TtsVoicePreset[];
  /** The full preset-voice catalog (every voice across available TTS models). */
  presetVoices: CreateVoiceHubVoiceRow[];
  /** Full TTS model catalog — used to resolve per-voice capability flags. */
  ttsModels: CatalogModelDescriptor[];
  isLoading: boolean;
  refreshPresets: () => Promise<void>;
  /**
   * Materialize a catalog voice into a saved preset (reusing an existing one if
   * it matches) and return its preset id, so playback can keep using presetId
   * references. Mirrors Story Studio's Cast picker behavior.
   */
  createPresetFromVoice: (voice: CreateVoiceHubVoiceRow) => Promise<string>;
};

/**
 * Loads the same voice choices the Story Studio Cast picker uses — saved
 * presets ("My Voices") plus the lazily-loaded per-model voice catalog ("Preset
 * voices") — so any surface can offer the full voice selection.
 */
export function useTtsVoiceCatalog(): TtsVoiceCatalog {
  const [presets, setPresets] = useState<TtsVoicePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [ttsModels, setTtsModels] = useState<CatalogModelDescriptor[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [voicesByModelKey, setVoicesByModelKey] = useState<
    Map<string, VoiceInfo[]>
  >(() => new Map());
  const loadingVoiceKeysRef = useRef(new Set<string>());

  const refreshPresets = useCallback(async () => {
    setIsLoadingPresets(true);
    try {
      setPresets(await listTtsVoicePresets());
    } catch (error) {
      console.error("Failed to load voice presets:", error);
    } finally {
      setIsLoadingPresets(false);
    }
  }, []);

  useEffect(() => {
    void refreshPresets();
  }, [refreshPresets]);

  useEffect(() => {
    let cancelled = false;
    getModelPlatformOverview()
      .then((overview) => {
        if (!cancelled) setTtsModels(overview.tts.models);
      })
      .catch((error) => {
        console.error("Failed to load TTS models for voice catalog:", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useTauriEvent("external-model-storage-changed", () => {
    void getModelPlatformOverview()
      .then((overview) => setTtsModels(overview.tts.models))
      .catch((error) => {
        console.error(
          "Failed to refresh TTS models after storage change:",
          error,
        );
      });
  });

  const availableModels = useMemo(
    () => ttsModels.filter(isDraftVoiceModelAvailable),
    [ttsModels],
  );

  // Lazily load each available model's voices so they can populate the picker
  // alongside saved presets.
  useEffect(() => {
    for (const model of availableModels) {
      const key = `${model.provider_id}::${model.id}`;
      if (voicesByModelKey.has(key) || loadingVoiceKeysRef.current.has(key)) {
        continue;
      }
      loadingVoiceKeysRef.current.add(key);
      void getTtsVoicesForSelection(model.provider_id, model.id)
        .then((voices) => {
          setVoicesByModelKey((current) => {
            const next = new Map(current);
            next.set(key, voices);
            return next;
          });
        })
        .catch(() => {
          setVoicesByModelKey((current) => {
            const next = new Map(current);
            next.set(key, []);
            return next;
          });
        })
        .finally(() => {
          loadingVoiceKeysRef.current.delete(key);
        });
    }
  }, [availableModels, voicesByModelKey]);

  const presetVoices = useMemo(
    () => buildCreateVoiceHubRows(availableModels, voicesByModelKey),
    [availableModels, voicesByModelKey],
  );

  const createPresetFromVoice = useCallback(
    async (voice: CreateVoiceHubVoiceRow): Promise<string> => {
      const existing = presets.find(
        (preset) =>
          preset.provider_id === voice.providerId &&
          preset.model_id === voice.modelId &&
          (preset.voice_id ?? null) === voice.voiceId &&
          (preset.voice_profile_id ?? null) === null,
      );
      if (existing) return existing.id;

      const created = await createTtsVoicePreset({
        label: voice.voiceId
          ? voice.modelLabel === "System Voices"
            ? voice.voiceLabel
            : `${voice.modelLabel} - ${voice.voiceLabel}`
          : voice.modelLabel,
        provider_id: voice.providerId,
        model_id: voice.modelId,
        voice_id: voice.voiceId,
        voice_profile_id: null,
        voice_label_snapshot: voice.voiceId
          ? voice.voiceLabel
          : voice.modelLabel,
        locale_snapshot: voice.locale,
        tuning: defaultVoiceTuning(),
      });
      setPresets((current) => {
        if (current.some((preset) => preset.id === created.id)) return current;
        return [...current, created];
      });
      await refreshPresets();
      return created.id;
    },
    [presets, refreshPresets],
  );

  return {
    presets,
    presetVoices,
    /** Full TTS model catalog — used to resolve per-voice capability flags. */
    ttsModels,
    isLoading: isLoadingPresets || isLoadingModels,
    refreshPresets,
    createPresetFromVoice,
  };
}
