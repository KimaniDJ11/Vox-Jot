import React from "react";
import ModelSelector from "../model-selector";
import TitleBarLlmSelector from "./TitleBarLlmSelector";

const TitleBarModels: React.FC = () => {
  return (
    <div className="title-bar-models flex items-center gap-4 text-sm font-bold tabular-nums leading-none">
      <ModelSelector
        statusButtonLabelClassName="font-bold"
        statusButtonDensity="titleBar"
      />
      <TitleBarLlmSelector density="titleBar" labelClassName="font-bold" />
    </div>
  );
};

export default TitleBarModels;
