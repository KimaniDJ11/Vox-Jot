// Providers whose API keys are generated on an external page. When an entry
// exists, the API-key UI surfaces a "Get your key" link that opens this URL in
// the browser. Add entries here as we onboard more key-gated cloud providers.
//
// Shared by both API-key surfaces: the provider dropdown
// (PostProcessingSettings.tsx) and the refine model-hub dialog
// (RefineModelsSettings.tsx).
export const PROVIDER_API_KEY_URLS: Record<string, string> = {
  modelscope: "https://modelscope.cn/my/myaccesstoken",
};
