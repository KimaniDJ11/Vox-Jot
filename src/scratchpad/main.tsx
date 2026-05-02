import React from "react";
import ReactDOM from "react-dom/client";
import ScratchpadApp from "./ScratchpadApp";
import "@/App.css";
import "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";

useSettingsStore.getState().initialize();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ScratchpadApp />
  </React.StrictMode>,
);
