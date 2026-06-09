import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
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
  ArrowRight,
  Sparkles,
  Copy,
  History,
} from "lucide-react";

import { commands } from "@/bindings";
import { HighlightTrack } from "@/motion/HighlightTrack";
import { modal } from "@/motion/springs";
import { Kbd } from "@/components/ui/Kbd";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";

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

const THEME_IDS = [
  "system",
  "light",
  "dark",
  "graphite",
  "slate",
  "sepia",
  "ocean",
  "rose",
  "aurora",
  "lagoon",
  "daybreak",
  "ember",
  "galaxy",
  "forest",
  "solarized",
] as const;

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
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogFocusTrap({
    enabled: open,
    containerRef: dialogRef,
    initialFocusSelector: "input",
  });

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

  const groups = useMemo(
    () => ({
      navigate: t("commandMenu.groups.navigate"),
      actions: t("commandMenu.groups.actions"),
      open: t("commandMenu.groups.open"),
      theme: t("commandMenu.groups.theme"),
      jumpTo: t("commandMenu.groups.jumpTo"),
    }),
    [t],
  );

  const actions: CommandAction[] = useMemo(() => {
    const base: CommandAction[] = [
      {
        id: "nav.dictate",
        title: t("commandMenu.actions.startDictation"),
        subtitle: t("commandMenu.actions.startDictationSubtitle"),
        icon: Compass,
        group: groups.navigate,
        keywords: ["dictation", "record"],
        onRun: () => onNavigate("dictate"),
      },
      {
        id: "nav.refine",
        title: t("commandMenu.actions.goToRefine"),
        icon: Compass,
        group: groups.navigate,
        keywords: ["post-process", "edit"],
        onRun: () => onNavigate("refine"),
      },
      {
        id: "nav.listen",
        title: t("commandMenu.actions.goToListen"),
        icon: Compass,
        group: groups.navigate,
        keywords: ["tts", "voice"],
        onRun: () => onNavigate("listen"),
      },
      {
        id: "nav.settings",
        title: t("commandMenu.actions.openSettings"),
        icon: Compass,
        group: groups.navigate,
        keywords: ["preferences", "config"],
        shortcut: ["⌘", ","],
        onRun: () => onNavigate("settings"),
      },
      {
        id: "post-process.toggle",
        title: postProcessEnabled
          ? t("commandMenu.actions.disablePostProcess")
          : t("commandMenu.actions.enablePostProcess"),
        subtitle: postProcessEnabled
          ? t("commandMenu.actions.postProcessOn")
          : t("commandMenu.actions.postProcessOff"),
        icon: Sparkles,
        group: groups.actions,
        keywords: ["ai", "cleanup", "rewrite"],
        onRun: () => onTogglePostProcess(),
      },
      {
        id: "history.open-last",
        title: t("commandMenu.actions.openLastTranscription"),
        subtitle: t("commandMenu.actions.openLastTranscriptionSubtitle"),
        icon: History,
        group: groups.actions,
        keywords: ["recent", "latest", "history"],
        onRun: () => {
          onNavigate("dictate");
          onJumpToSection?.("history");
        },
      },
      {
        id: "history.copy-last",
        title: t("commandMenu.actions.copyLastTranscription"),
        subtitle: t("commandMenu.actions.copyLastTranscriptionSubtitle"),
        icon: Copy,
        group: groups.actions,
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
        title: t("commandMenu.actions.cancelOperation"),
        icon: XCircle,
        group: groups.actions,
        keywords: ["stop", "abort", "esc"],
        onRun: () => void commands.cancelOperation(),
      },
      {
        id: "open.recordings",
        title: t("commandMenu.actions.openRecordings"),
        icon: FolderOpen,
        group: groups.open,
        onRun: () => void commands.openRecordingsFolder(),
      },
      {
        id: "open.logs",
        title: t("commandMenu.actions.openLogs"),
        icon: FileText,
        group: groups.open,
        onRun: () => void commands.openLogDir(),
      },
      {
        id: "open.appdata",
        title: t("commandMenu.actions.openAppData"),
        icon: Database,
        group: groups.open,
        onRun: () => void commands.openAppDataDir(),
      },
    ];

    THEME_IDS.forEach((id) => {
      const Icon =
        id === "light"
          ? Sun
          : id === "system"
            ? Laptop
            : id === "dark" ||
                id === "slate" ||
                id === "graphite" ||
                id === "aurora" ||
                id === "ember" ||
                id === "galaxy"
              ? Moon
              : Palette;
      base.push({
        id: `theme.${id}`,
        title: t("commandMenu.actions.switchTheme", {
          name: t(`commandMenu.themes.${id}`),
        }),
        icon: Icon,
        group: groups.theme,
        keywords: ["appearance", "color"],
        onRun: () => onSelectTheme(id),
      });
    });

    sectionJumps.forEach((s) => {
      base.push({
        id: `jump.${s.view}.${s.id}`,
        title: t("commandMenu.actions.jumpTo", { label: s.label }),
        subtitle: s.view,
        icon: ArrowRight,
        group: groups.jumpTo,
        onRun: () => onJumpToSection?.(s.id),
      });
    });

    base.push(
      {
        id: "jump.refine.write-profiles",
        title: t("commandMenu.actions.applyWriteProfile"),
        subtitle: t("commandMenu.actions.applyWriteProfileSubtitle"),
        icon: ArrowRight,
        group: groups.jumpTo,
        onRun: () => {
          onNavigate("refine");
          onJumpToSection?.("write-profiles");
        },
      },
      {
        id: "jump.refine.phrase-keys",
        title: t("commandMenu.actions.insertPhraseKey"),
        subtitle: t("commandMenu.actions.insertPhraseKeySubtitle"),
        icon: ArrowRight,
        group: groups.jumpTo,
        onRun: () => {
          onNavigate("refine");
          onJumpToSection?.("phrase-keys");
        },
      },
    );

    return base;
  }, [
    groups,
    onJumpToSection,
    onNavigate,
    onSelectTheme,
    onTogglePostProcess,
    postProcessEnabled,
    sectionJumps,
    t,
  ]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    actions.forEach((a) => {
      if (!map.has(a.group)) map.set(a.group, []);
      map.get(a.group)!.push(a);
    });
    return Array.from(map.entries());
  }, [actions]);

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
            className="absolute inset-0 bg-[var(--scrim-bg)] backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("commandMenu.label")}
            className="relative w-full max-w-[640px]"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={modal}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) =>
              handleDialogKeyDown(event, dialogRef.current, onClose)
            }
          >
            <Command
              label={t("commandMenu.label")}
              value={value}
              onValueChange={setValue}
              className="card-linear--elevated overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--surface-elevated,var(--card))]/90 shadow-[var(--modal-shadow)] backdrop-blur-xl"
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
                  placeholder={t("commandMenu.searchPlaceholder")}
                  className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--muted)]"
                />
                <Kbd>{t("commandMenu.esc")}</Kbd>
              </div>
              <Command.List className="max-h-[420px] overflow-y-auto px-1 py-2">
                <Command.Empty className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">
                  {t("commandMenu.noResults")}
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
                        className="group relative flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13px] text-[var(--text)] outline-none data-[selected=true]:bg-[var(--input)] data-[selected=true]:text-[var(--text)]"
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
                          <span className="relative z-10 text-[12px] text-[var(--muted)] group-data-[selected=true]:text-[var(--text)]">
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
