import React from "react";

import RefineModelsSettings from "@/components/settings/llm/RefineModelsSettings";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
export {
  RefinePhraseKeysSection,
  RefineProfilesSection,
  RefineTranslationSection,
} from "@/components/app-sections/refineCore";

export const RefineModelsSection: React.FC<{
  titleActionTargetId?: string;
  hubSearchQuery?: string;
  onHubSearchQueryChange?: (value: string) => void;
  modelHubControls?: ModelHubControlState;
  hubFilterLabels?: boolean;
  showEvaluationPanel?: boolean;
}> = ({
  titleActionTargetId,
  hubSearchQuery,
  onHubSearchQueryChange,
  modelHubControls,
  hubFilterLabels,
  showEvaluationPanel,
}) => (
  <div className="space-y-6">
    <RefineModelsSettings
      titleActionTargetId={titleActionTargetId}
      hubSearchQuery={hubSearchQuery}
      onHubSearchQueryChange={onHubSearchQueryChange}
      modelHubControls={modelHubControls}
      hubFilterLabels={hubFilterLabels}
      showEvaluationPanel={showEvaluationPanel}
    />
  </div>
);
