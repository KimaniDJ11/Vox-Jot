import type React from "react";

export interface LeaderboardMetric {
  label: string;
  value: string;
}

export interface LeaderboardRowProps {
  rank?: number;
  label: string;
  modelId?: string;
  providerId?: string;
  status: string;
  statusLabel: string;
  notes?: string;
  metrics?: LeaderboardMetric[];
  footer?: React.ReactNode;
}
