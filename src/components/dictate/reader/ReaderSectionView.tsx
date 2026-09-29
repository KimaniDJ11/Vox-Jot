import React, { useMemo } from "react";
import { splitReaderWords } from "./readerPresentation";
import { useTranslation } from "react-i18next";

type ReaderDisplaySection = {
  index: number;
  title: string;
  enabled: boolean;
  paragraphs: Array<{
    paragraphIndex: number;
    chunks: Array<{ id: string; text: string }>;
  }>;
};

const ReaderWordSpans = React.memo(function ReaderWordSpans({
  text,
  activeWordIndex,
}: {
  text: string;
  activeWordIndex: number;
}) {
  const words = useMemo(() => splitReaderWords(text), [text]);
  return (
    <>
      {words.map((word, index) => (
        <span
          key={index}
          data-word-index={index}
          className={
            index === activeWordIndex
              ? "rounded-[3px] bg-[var(--accent)] px-[1px] text-[var(--on-accent)]"
              : undefined
          }
        >
          {word}{" "}
        </span>
      ))}
    </>
  );
});

export const ReaderSectionView = React.memo(function ReaderSectionView({
  section,
  totalSections,
  activeUnitId,
  activeWordIndex,
  unitIndexById,
  onSeek,
}: {
  section: ReaderDisplaySection;
  totalSections: number;
  activeUnitId: string | null;
  /** Active word within the active unit (-1 when none); only the active unit
   *  splits into per-word spans so word-by-word highlighting stays cheap. */
  activeWordIndex: number;
  unitIndexById: Map<string, number>;
  onSeek: (unitIndex: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-section-index={section.index}
      className="scroll-mt-24 space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] pb-2">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          {t("dictate.reader.sectionLabel", {
            defaultValue: "Section {{current}} of {{total}}",
            current: section.index + 1,
            total: totalSections,
          })}
        </div>
        <div
          className={[
            "min-w-0 flex-1 truncate text-right text-sm font-semibold",
            section.enabled
              ? "text-[var(--text)]"
              : "text-[var(--muted)] line-through",
          ].join(" ")}
        >
          {section.title}
          {!section.enabled ? (
            <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] no-underline">
              {t("dictate.reader.skipped", { defaultValue: "Skipped" })}
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={[
          "space-y-3 text-[15px] leading-8",
          section.enabled ? "text-[var(--text)]" : "text-[var(--muted)]",
        ].join(" ")}
      >
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph.paragraphIndex} className="break-words">
            {paragraph.chunks.map((chunk) => {
              const unitIndex = unitIndexById.get(chunk.id);
              const interactive = unitIndex !== undefined;
              const isActive = chunk.id === activeUnitId;
              const activate = () => {
                if (unitIndex !== undefined) onSeek(unitIndex);
              };
              return (
                <span
                  key={chunk.id}
                  data-unit-id={chunk.id}
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={interactive ? activate : undefined}
                  onKeyDown={
                    interactive
                      ? (event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          activate();
                        }
                      : undefined
                  }
                  className={[
                    "rounded-[3px] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]",
                    interactive
                      ? "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                      : "",
                    isActive
                      ? "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--accent-soft)]"
                      : interactive
                        ? "hover:bg-[var(--input)]"
                        : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {isActive ? (
                    <ReaderWordSpans
                      text={chunk.text}
                      activeWordIndex={activeWordIndex}
                    />
                  ) : (
                    <>{chunk.text} </>
                  )}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </section>
  );
});
