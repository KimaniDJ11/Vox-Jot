import React from "react";
import { FileWorkspace } from "./file-workspace/FileWorkspace";

export const FileTranscriptionPanel: React.FC = () => (
  <FileWorkspace
    kind="media"
    initialView="file"
    availableViews={["file", "folders"]}
  />
);

export const ReaderPanel: React.FC = () => (
  <FileWorkspace
    kind="reader"
    initialView="documents"
    availableViews={["documents"]}
  />
);
