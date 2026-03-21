import React from "react";
import ReactDOM from "react-dom/client";
import DetailApp from "./DetailApp";
import "@/App.css";
import "@/i18n";
import { useModelStore } from "@/stores/modelStore";
import { useSettingsStore } from "@/stores/settingsStore";

useModelStore.getState().initialize();
useSettingsStore.getState().initialize();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DetailApp />
  </React.StrictMode>,
);
