import React from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";
import { openModelHubView } from "@/components/model-hub/modelHubTabs";
import { SidebarNavRow } from "@/components/sidebar/SidebarNavRow";

export const MODEL_HUB_ROW_ID = "__model_hub__";

interface SidebarModelLaunchersProps {
  collapsed?: boolean;
  hovered?: boolean;
  onHoverStart?: () => void;
}

const SidebarModelLaunchers: React.FC<SidebarModelLaunchersProps> = ({
  collapsed = false,
  hovered,
  onHoverStart,
}) => {
  const { t } = useTranslation();
  const label = t("sidebar.openModelHub", { defaultValue: "Model Hub" });

  return (
    <SidebarNavRow
      id={MODEL_HUB_ROW_ID}
      label={label}
      icon={Cpu}
      iconTone="gold"
      collapsed={collapsed}
      hovered={hovered}
      onHoverStart={onHoverStart}
      onClick={() => void openModelHubView()}
    />
  );
};

export default SidebarModelLaunchers;
