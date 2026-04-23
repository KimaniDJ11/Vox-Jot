import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  Moon,
  Sun,
  Laptop,
  FolderOpen,
  FileText,
  Database,
  XCircle,
  Compass,
  Palette,
  StickyNote,
  ArrowRight,
  Sparkles,
  Copy,
  History,
} from "lucide-react";

import { commands } from "@/bindings";
import { HighlightTrack } from "@/motion/HighlightTrack";
import { modal } from "@/motion/springs";
import { Kbd } from "@/components/ui/Kbd";

export type CommandAction = {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string[];
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  keywords?: string[];
  group: string;
  onRun: () => void | Promise<void>;
};

export interface CommandMenuProps {
  open: boolean;
  onClose: () => void;
  /** Application-aware sink for navigation/theme changes. */
  onNavigate: (view: "dictate" | "refine" | "listen" | "settings") => void;
  onSelectTheme: (theme: string) => void;
  postProcessEnabled: boolean;
  onTogglePostProcess: () => void;
  /** Optional list of extra sections to jump to — e.g. current sidebar items. */
  sectionJumps?: { id: string; label: string; view: string }[];
  onJumpToSection?: (id: string) => void;
}

const THEMES: { id: string; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "graphite", label: "Graphite" },
  { id: "slate", label: "Slate" },
  { id: "sepia", label: "Sepia" },
  { id: "ocean", label: "Ocean" },
  { id: "rose", label: "Rose" },
  { id: "forest", label: "Forest" },
  { id: "solarized", label: "Solarized" },
];

export const CommandMenu: React.FC<CommandMenuProps> = ({
  open,
  onClose,
  onNavigate,
  onSelectTheme,
  postProcessEnabled,
  onTogglePostProcess,
  sectionJumps = [],
  onJumpToSection,
}) => {
  const [value, setValue] = useState("");
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setValue("");
      setActiveItemId(null);
    }
  }, [open]);

  const run = useCallback(
    (fn: () => void | Promise<void>) => {
      void fn();
      onClose();
    },
    [onClose],
  );

  const actions: CommandAction[] = useMemo(() => {
    const base: CommandAction[] = [
      {
        id: "nav.dictate",
        title: "Start dictation",
        subtitle: "Open the Dictate workspace",
        icon: Compass,
        group: "Navigate",
        keywords: ["dictation", "record"],
        onRun: () => onNavigate("dictate"),
      },
      {
        id: "nav.refine",
        title: "Go to Refine",
        icon: Compass,
        group: "Navigate",
        keywords: ["post-process", "edit"],
        onRun: () => onNavigate("refine"),
      },
      {
        id: "nav.listen",
        title: "Go to Listen",
        icon: Compass,
        group: "Navigate",
        keywords: ["tts", "voice"],
        onRun: () => onNavigate("listen"),
      },
      {
        id: "nav.settings",
        title: "Open Settings",
        icon: Compass,
        group: "Navigate",
        keywords: ["preferences", "config"],
        shortcut: ["⌘", ","],
        onRun: () => onNavigate("settings"),
      },
      {
        id: "jot.toggle",
        title: "Open Jot Pad",
        icon: StickyNote,
        group: "Actions",
        keywords: ["scratchpad", "note", "pad"],
        onRun: () => void commands.toggleScratchpad(),
      },
      {
        id: "post-process.toggle",
        title: postProcessEnabled
          ? "Disable post-process"
          : "Enable post-process",
        subtitle: postProcessEnabled ? "AI cleanup is on" : "AI cleanup is off",
        icon: Sparkles,
        group: "Actions",
        keywords: ["ai", "cleanup", "rewrite"],
        onRun: () => onTogglePostProcess(),
      },
      {
        id: "history.open-last",
        title: "Open last transcription",
        subtitle: "Jump to recent history",
        icon: History,
        group: "Actions",
        keywords: ["recent", "latest", "history"],
        onRun: () => {
          onNavigate("dictate");
          onJumpToSection?.("history");
        },
      },
      {
        id: "history.copy-last",
        title: "Copy last transcription",
        subtitle: "Copy the most recent transcript",
        icon: Copy,
        group: "Actions",
        keywords: ["clipboard", "recent", "latest"],
        onRun: async () => {
          const result = await commands.getLatestHistoryEntry();
          if (result.status !== "ok" || !result.data) {
            return;
          }
          const latest = result.data;
          const text =
            latest.pasted_text?.trim() ||
            latest.post_processed_text?.trim() ||
            latest.transcription_text.trim();
          if (text) {
            await navigator.clipboard.writeText(text);
          }
        },
      },
      {
        id: "action.cancel",
        title: "Cancel Current Operation",
        icon: XCircle,
        group: "Actions",
        keywords: ["stop", "abort", "esc"],
        onRun: () => void commands.cancelOperation(),
      },
      {
        id: "open.recordings",
        title: "Open Recordings Folder",
        icon: FolderOpen,
        group: "Open",
        onRun: () => void commands.openRecordingsFolder(),
      },
      {
        id: "open.logs",
        title: "Open Logs Folder",
        icon: FileText,
        group: "Open",
        onRun: () => void commands.openLogDir(),
      },
      {
        id: "open.appdata",
        title: "Open App Data Folder",
        icon: Database,
        group: "Open",
        onRun: () => void commands.openAppDataDir(),
      },
    ];

    THEMES.forEach((th) => {
      const Icon =
        th.id === "light"
          ? Sun
          : th.id === "system"
            ? Laptop
            : th.id === "dark" || th.id === "slate" || th.id === "graphite"
              ? Moon
              : Palette;
      base.push({
        id: `theme.${th.id}`,
        title: `Switch theme → ${th.label}`,
        icon: Icon,
        group: "Theme",
        keywords: ["appearance", "color"],
        onRun: () => onSelectTheme(th.id),
      });
    });

    sectionJumps.forEach((s) => {
      base.push({
        id: `jump.${s.view}.${s.id}`,
        title: `Jump to ${s.label}`,
        subtitle: s.view,
        icon: ArrowRight,
        group: "Jump to",
        onRun: () => onJumpToSection?.(s.id),
      });
    });

    base.push(
      {
        id: "jump.refine.write-profiles",
        title: "Apply write profile → Write Profiles",
        subtitle: "Jump to write profiles",
        icon: ArrowRight,
        group: "Jump to",
        onRun: () => {
          onNavigate("refine");
          onJumpToSection?.("write-profiles");
        },
      },
      {
        id: "jump.refine.phrase-keys",
        title: "Insert phrase key → Phrase Keys",
        subtitle: "Jump to phrase key settings",
        icon: ArrowRight,
        group: "Jump to",
        onRun: () => {
          onNavigate("refine");
          onJumpToSection?.("phrase-keys");
        },
      },
    );

    return base;
  }, [
    onJumpToSection,
    onNavigate,
    onSelectTheme,
    onTogglePostProcess,
    postProcessEnabled,
    sectionJumps,
  ]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    actions.forEach((a) => {
      if (!map.has(a.group)) map.set(a.group, []);
      map.get(a.group)!.push(a);
    });
    return Array.from(map.entries());
  }, [actions]);

  // Esc closes — cmdk handles arrow/enter natively.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center px-4"
          style={{ paddingTop: "20vh" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.div
            className="relative w-full max-w-[640px]"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={modal}
            onClick={(e) => e.stopPropagation()}
          >
            <Command
              label="Command menu"
              value={value}
              onValueChange={setValue}
              className="card-linear--elevated overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--surface-elevated,var(--card))]/90 shadow-[0_24px_64px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            >
              <div className="flex items-center gap-2 border-b border-[var(--ring-hairline)] px-4">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[var(--muted)]"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <Command.Input
                  autoFocus
                  placeholder="Type a command or search..."
                  className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--muted)]"
                />
                {/* eslint-disable-next-line i18next/no-literal-string */}
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[420px] overflow-y-auto px-1 py-2">
                <Command.Empty className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">
                  {/* eslint-disable-next-line i18next/no-literal-string */}
                  <>No results.</>
                </Command.Empty>
                {grouped.map(([group, items]) => (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-[var(--muted)]"
                  >
                    {items.map((a) => (
                      <Command.Item
                        key={a.id}
                        value={`${a.group} ${a.title} ${(a.keywords || []).join(" ")}`}
                        onSelect={() => run(a.onRun)}
                        onPointerEnter={() => setActiveItemId(a.id)}
                        onFocus={() => setActiveItemId(a.id)}
                        className="group relative flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13px] outline-none"
                      >
                        <HighlightTrack
                          active={activeItemId === a.id}
                          layoutId="cmdk-highlight"
                          variant="surface"
                          insetClass="inset-0"
                          radiusClass="rounded-lg"
                        />
                        <a.icon className="h-4 w-4 shrink-0 text-[var(--muted)] group-data-[selected=true]:text-[var(--text)]" />
                        <span className="relative z-10 flex-1 truncate">
                          {a.title}
                        </span>
                        {a.subtitle && (
                          <span className="relative z-10 text-[12px] text-[var(--muted)]">
                            {a.subtitle}
                          </span>
                        )}
                        {a.shortcut && (
                          <span className="relative z-10 ml-auto flex items-center gap-1">
                            {a.shortcut.map((k, i) => (
                              <Kbd key={i}>{k}</Kbd>
                            ))}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
