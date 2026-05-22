import type { CatalogModelDescriptor } from "@/lib/modelPlatform";

export type VoiceChangerModelSelection = {
  providerId: string;
  modelId: string;
};

export const DEFAULT_VOICE_CHANGER_MODEL: VoiceChangerModelSelection = {
  providerId: "openvoice",
  modelId: "openvoice",
};

const VOICE_CHANGER_MODEL_KEYS = new Set([
  "openvoice::openvoice",
  "chatterbox::chatterbox",
  "chatterbox::chatterbox-turbo",
  "chatterbox::chatterbox-multilingual",
]);

export function voiceChangerModelKey(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

export function isVoiceChangerCapableModel(model: CatalogModelDescriptor) {
  return VOICE_CHANGER_MODEL_KEYS.has(
    voiceChangerModelKey(model.provider_id, model.id),
  );
}

export function findVoiceChangerModel(
  models: CatalogModelDescriptor[],
  selection: VoiceChangerModelSelection,
) {
  return (
    models.find(
      (model) =>
        model.provider_id === selection.providerId &&
        model.id === selection.modelId,
    ) ?? null
  );
}
