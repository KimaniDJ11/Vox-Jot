import React, { useId } from "react";
import { LayoutGroup, motion } from "framer-motion";

import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import { press, track } from "@/motion/springs";

export type SegmentedControlItem<Value extends string> = {
  value: Value;
  label: string;
};

type SegmentedControlProps<Value extends string> = {
  items: SegmentedControlItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  ariaLabel?: string;
  className?: string;
  layoutId?: string;
};

export function SegmentedControl<Value extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
  layoutId,
}: SegmentedControlProps<Value>) {
  const generatedId = useId();
  const indicatorId = layoutId ?? `segmented-control-${generatedId}`;

  return (
    <LayoutGroup id={indicatorId}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={[
          "relative inline-flex rounded-full border border-[var(--border)] bg-[var(--panel-bg)] p-0.5",
          className,
        ].join(" ")}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <motion.button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              whileTap={{ scale: 0.97 }}
              transition={press}
              onClick={() => onChange(item.value)}
              className={[
                "relative isolate inline-flex items-center justify-center rounded-full border border-transparent px-3 py-2 text-xs font-medium",
                minTapTargetHeightClass,
                interactiveFocusRingClass,
                selected
                  ? "text-[var(--accent)]"
                  : "text-[var(--text)] hover:text-[var(--accent)]",
              ].join(" ")}
            >
              {selected ? (
                <motion.span
                  layoutId={`${indicatorId}-indicator`}
                  transition={track}
                  className="absolute inset-0 rounded-full bg-[var(--accent-soft)]"
                  aria-hidden="true"
                />
              ) : null}
              <span className="relative z-10">{item.label}</span>
            </motion.button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
