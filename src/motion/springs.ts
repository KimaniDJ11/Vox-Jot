import type { Transition } from "framer-motion";

// Raycast-feel: almost critically damped, ~2% overshoot.
// damping / sqrt(stiffness) ≈ 1.6.
export const crisp: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 32,
  mass: 0.9,
};

// Button press / tap feedback. Tighter, faster settle.
export const press: Transition = {
  type: "spring",
  stiffness: 700,
  damping: 38,
  mass: 0.6,
};

// Cmd+K / sheet / modal enter. Slower, heavier feel.
export const modal: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 1,
};

// Arc-style folder / overlay bounce. ~10% overshoot.
export const bounce: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 28,
  mass: 0.8,
};

// Notion Calendar / Raycast shared-element hover track.
// Fast, almost-critically-damped.
export const track: Transition = {
  type: "spring",
  stiffness: 550,
  damping: 40,
  mass: 0.7,
};
