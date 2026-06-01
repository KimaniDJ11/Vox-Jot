import React from "react";
import { motion } from "framer-motion";

export type SectionFeatureCard = {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  icon: React.ReactNode;
  accentColor: string;
  title?: string;
};

export type SectionFeatureCardsLayout = "stats" | "capability";

const cardEntranceByLayout: Record<
  SectionFeatureCardsLayout,
  {
    hidden: { opacity: number; y: number; scale: number };
    visible: (index: number) => {
      opacity: number;
      y: number;
      scale: number;
      transition: {
        delay: number;
        duration: number;
        ease: [number, number, number, number];
      };
    };
  }
> = {
  stats: {
    hidden: { opacity: 0, y: 12, scale: 0.98 },
    visible: (index) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        delay: index * 0.05,
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1],
      },
    }),
  },
  capability: {
    hidden: { opacity: 0, y: 10, scale: 0.98 },
    visible: (index) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        delay: index * 0.04,
        duration: 0.32,
        ease: [0.22, 1, 0.36, 1],
      },
    }),
  },
};

const gridClassByLayout: Record<SectionFeatureCardsLayout, string> = {
  stats: "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
  capability: "grid gap-3 md:grid-cols-3",
};

type SectionFeatureCardsProps = {
  ariaLabel: string;
  cards: SectionFeatureCard[];
  layout?: SectionFeatureCardsLayout;
  /** Override the default column count for the selected layout. */
  columns?: 3 | 4;
};

const gridClassByColumns: Record<3 | 4, string> = {
  3: "grid gap-3 md:grid-cols-3",
  4: "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
};

export const SectionFeatureCards: React.FC<SectionFeatureCardsProps> = ({
  ariaLabel,
  cards,
  layout = "stats",
  columns,
}) => {
  const cardEntrance = cardEntranceByLayout[layout];
  const gridClassName =
    columns !== undefined
      ? gridClassByColumns[columns]
      : gridClassByLayout[layout];

  return (
    <section className={gridClassName} aria-label={ariaLabel}>
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          variants={cardEntrance}
          initial="hidden"
          animate="visible"
          custom={index}
          whileHover={{
            y: -3,
            boxShadow: "var(--shadow-md)",
            borderColor: card.accentColor,
            transition: { duration: 0.2, ease: "easeOut" },
          }}
          className={
            layout === "stats"
              ? "flat-card group relative flex min-h-[6.5rem] flex-col justify-between overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 shadow-[var(--shadow-sm)] transition-colors duration-300"
              : "flat-card group relative flex min-h-[6.75rem] flex-col justify-between overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-sm)] transition-colors duration-300"
          }
          style={
            {
              "--card-accent": card.accentColor,
            } as React.CSSProperties
          }
          title={card.title}
        >
          <span
            className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-40 transition-opacity duration-300 group-hover:opacity-100"
            style={{ background: card.accentColor }}
            aria-hidden
          />

          {layout === "stats" ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${card.accentColor} 10%, transparent)`,
                    color: card.accentColor,
                  }}
                  aria-hidden
                >
                  {card.icon}
                </span>
                <span className="text-2xl font-bold tabular-nums leading-none tracking-tight text-[var(--text)]">
                  {card.value}
                </span>
              </div>

              <div className="mt-2 min-w-0">
                <span className="block text-sm font-semibold leading-tight text-[var(--text)]">
                  {card.label}
                </span>
                <span className="mt-1 block truncate text-[11px] font-medium leading-4 text-[var(--muted)]">
                  {card.detail}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${card.accentColor} 13%, transparent)`,
                    color: card.accentColor,
                  }}
                  aria-hidden
                >
                  {card.icon}
                </span>
                <div className="min-w-0 flex-1 text-right">
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {card.label}
                  </p>
                  <p className="mt-0.5 truncate text-base font-semibold leading-6 text-[var(--text)]">
                    {card.value}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                {card.detail}
              </p>
            </>
          )}
        </motion.div>
      ))}
    </section>
  );
};
