import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";

export interface DictationStats {
  total_words: number;
  today_words: number;
  streak_days: number;
  accuracy_percent: number | null;
  total_sessions: number;
}

export function useDictationStats() {
  const [stats, setStats] = useState<DictationStats | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await commands.getDictationStats();
      if (result.status === "ok") {
        setStats(result.data);
      }
    } catch (e) {
      console.warn("Failed to fetch dictation stats:", e);
    }
  }, []);

  useEffect(() => {
    refresh();

    // Refresh stats when history changes (new transcription, delete, etc.)
    const unlisten = listen("history-updated", () => {
      refresh();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  return { stats, refresh };
}
