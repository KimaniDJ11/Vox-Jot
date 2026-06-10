import React, { useEffect, useMemo, useRef } from "react";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";

export type ReaderRenderedWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ReaderRenderedPage = {
  index: number;
  /** Page size in PDF points; word bboxes share this space. */
  width: number;
  height: number;
  scale: number;
  imageDataUrl: string;
  words: ReaderRenderedWord[];
};

type ReaderPageMatch = {
  pageIndex: number;
  startWord: number;
  endWord: number;
};

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-zÀ-￿]+/g, "");
}

/**
 * Locate a spoken unit's words on the rendered pages by content, so the page
 * view can highlight them (geometry-based highlighting). Tolerant of the text
 * cleanup applied to the reading units: it anchors on the first few normalized
 * tokens and accepts a partial match. Searches pages outward from a hint page.
 */
function matchUnitOnPages(
  unitWords: string[],
  pages: Map<number, ReaderRenderedPage>,
  hintPage: number,
  pageCount: number,
): ReaderPageMatch | null {
  const target = unitWords.map(normalizeToken).filter(Boolean);
  if (target.length === 0) return null;
  const anchor = target.slice(0, Math.min(4, target.length));
  const needed = Math.max(2, Math.ceil(anchor.length * 0.6));

  const order: number[] = [];
  for (let distance = 0; distance < pageCount; distance += 1) {
    const before = hintPage - distance;
    const after = hintPage + distance;
    if (distance === 0) {
      if (hintPage >= 0 && hintPage < pageCount) order.push(hintPage);
      continue;
    }
    if (after < pageCount) order.push(after);
    if (before >= 0) order.push(before);
  }

  for (const pageIndex of order) {
    const page = pages.get(pageIndex);
    if (!page) continue;
    const tokens = page.words.map((word) => normalizeToken(word.text));
    for (let start = 0; start < tokens.length; start += 1) {
      let matched = 0;
      for (let k = 0; k < anchor.length && start + k < tokens.length; k += 1) {
        if (tokens[start + k] === anchor[k]) matched += 1;
      }
      if (matched >= needed) {
        const endWord = Math.min(tokens.length, start + target.length);
        return { pageIndex, startWord: start, endWord };
      }
    }
  }
  return null;
}

const ReaderPageImage = React.memo(function ReaderPageImage({
  page,
  highlight,
  registerRef,
}: {
  page: ReaderRenderedPage;
  highlight: { startWord: number; endWord: number; activeWord: number } | null;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}) {
  const runRect = useMemo(() => {
    if (!highlight || page.width <= 0 || page.height <= 0) return null;
    const words = page.words.slice(highlight.startWord, highlight.endWord);
    if (words.length === 0) return null;
    const x0 = Math.min(...words.map((word) => word.x0));
    const y0 = Math.min(...words.map((word) => word.y0));
    const x1 = Math.max(...words.map((word) => word.x1));
    const y1 = Math.max(...words.map((word) => word.y1));
    return {
      left: (x0 / page.width) * 100,
      top: (y0 / page.height) * 100,
      width: ((x1 - x0) / page.width) * 100,
      height: ((y1 - y0) / page.height) * 100,
    };
  }, [highlight, page]);

  const activeRect = useMemo(() => {
    if (!highlight || page.width <= 0 || page.height <= 0) return null;
    const word = page.words[highlight.activeWord];
    if (!word) return null;
    return {
      left: (word.x0 / page.width) * 100,
      top: (word.y0 / page.height) * 100,
      width: ((word.x1 - word.x0) / page.width) * 100,
      height: ((word.y1 - word.y0) / page.height) * 100,
    };
  }, [highlight, page]);

  return (
    <div
      ref={(el) => registerRef(page.index, el)}
      data-page-index={page.index}
      className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      <img
        src={page.imageDataUrl}
        alt=""
        className="block h-auto w-full select-none"
        draggable={false}
      />
      {runRect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[2px] bg-[var(--accent-soft)] mix-blend-multiply transition-all duration-150"
          style={{
            left: `${runRect.left}%`,
            top: `${runRect.top}%`,
            width: `${runRect.width}%`,
            height: `${runRect.height}%`,
          }}
        />
      ) : null}
      {activeRect ? (
        <div
          aria-hidden
          data-active-word="true"
          className="pointer-events-none absolute rounded-[2px] bg-[var(--accent)] opacity-40 mix-blend-multiply transition-all duration-100"
          style={{
            left: `${activeRect.left}%`,
            top: `${activeRect.top}%`,
            width: `${activeRect.width}%`,
            height: `${activeRect.height}%`,
          }}
        />
      ) : null}
    </div>
  );
});

export function ReaderPageView({
  pageCount,
  pages,
  renderingPages,
  pageErrors,
  onRequestPage,
  activeUnitWords,
  activeWordIndex,
  hintFraction,
  autoFollow,
  loadingLabel,
  errorLabel,
  retryLabel,
  renderLabel,
}: {
  pageCount: number;
  pages: Map<number, ReaderRenderedPage>;
  renderingPages: Set<number>;
  pageErrors: Map<number, string>;
  onRequestPage: (pageIndex: number) => void;
  activeUnitWords: string[] | null;
  activeWordIndex: number;
  hintFraction: number;
  autoFollow: boolean;
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  renderLabel: string;
}) {
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const registerRef = (index: number, el: HTMLDivElement | null) => {
    if (el) pageElsRef.current.set(index, el);
    else pageElsRef.current.delete(index);
  };

  const hintPage = Math.round(
    Math.max(0, Math.min(1, hintFraction)) * Math.max(0, pageCount - 1),
  );

  const match = useMemo(
    () =>
      activeUnitWords && activeUnitWords.length > 0
        ? matchUnitOnPages(activeUnitWords, pages, hintPage, pageCount)
        : null,
    [activeUnitWords, pages, hintPage, pageCount],
  );

  // Ensure the active page (and its neighbours) are rendered so a match can be
  // found even before the reader scrolls there.
  useEffect(() => {
    for (const candidate of [hintPage, hintPage + 1, hintPage - 1]) {
      if (
        candidate >= 0 &&
        candidate < pageCount &&
        !pages.has(candidate) &&
        !renderingPages.has(candidate) &&
        !pageErrors.has(candidate)
      ) {
        onRequestPage(candidate);
      }
    }
  }, [hintPage, pageCount, pages, renderingPages, pageErrors, onRequestPage]);

  // Lazy-render pages as their placeholders approach the viewport.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(
            (entry.target as HTMLElement).dataset.pageIndex ?? "-1",
          );
          if (
            index >= 0 &&
            !pages.has(index) &&
            !renderingPages.has(index) &&
            !pageErrors.has(index)
          ) {
            onRequestPage(index);
          }
        }
      },
      { rootMargin: "800px 0px" },
    );
    for (const el of pageElsRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [pageCount, pages, renderingPages, pageErrors, onRequestPage]);

  // Follow the narration: scroll the matched word into view.
  useEffect(() => {
    if (!match || !autoFollow) return;
    const el = pageElsRef.current.get(match.pageIndex);
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[data-active-word="true"]');
    const raf = window.requestAnimationFrame(() => {
      (active ?? el).scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [match, activeWordIndex, autoFollow]);

  const indices = useMemo(
    () => Array.from({ length: Math.max(0, pageCount) }, (_, index) => index),
    [pageCount],
  );

  return (
    <div className="space-y-4 pb-4">
      {indices.map((pageIndex) => {
        const page = pages.get(pageIndex);
        if (!page) {
          const pageError = pageErrors.get(pageIndex);
          const isRendering = renderingPages.has(pageIndex);
          return (
            <div
              key={pageIndex}
              ref={(el) => registerRef(pageIndex, el)}
              data-page-index={pageIndex}
              className="mx-auto flex min-h-[420px] w-full max-w-3xl flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted,var(--bg))] px-6 text-center"
            >
              {pageError ? (
                <>
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text)]">
                    <AlertCircle
                      size={14}
                      className="text-[var(--danger)]"
                      aria-hidden="true"
                    />
                    {errorLabel}
                  </span>
                  <p className="max-w-md text-xs leading-5 text-[var(--muted)]">
                    {pageError}
                  </p>
                  <button
                    type="button"
                    onClick={() => onRequestPage(pageIndex)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--input)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    {retryLabel}
                  </button>
                </>
              ) : isRendering ? (
                <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                  <Loader2
                    size={14}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  {loadingLabel}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRequestPage(pageIndex)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--input)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  {renderLabel}
                </button>
              )}
            </div>
          );
        }
        const highlight =
          match && match.pageIndex === pageIndex
            ? {
                startWord: match.startWord,
                endWord: match.endWord,
                activeWord:
                  match.startWord +
                  Math.max(
                    0,
                    Math.min(
                      activeWordIndex,
                      match.endWord - match.startWord - 1,
                    ),
                  ),
              }
            : null;
        return (
          <ReaderPageImage
            key={pageIndex}
            page={page}
            highlight={highlight}
            registerRef={registerRef}
          />
        );
      })}
    </div>
  );
}
