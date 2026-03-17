# Vox Jot UI Overhaul Implementation Plan

## Objective

Revamp Vox Jot from the original Handy style into a premium Aero Glass visual system that reflects the new logo identity while preserving current product behavior.

This plan covers:

1. Full UI redesign (app shell, settings, onboarding, shared controls)
2. Dual theme delivery (Aero Dark plus refined light theme)
3. Accessibility hardening to WCAG 2.1 AA
4. Replacement of plugin-updater with a custom manual-download update flow

Brand anchors:

- Royal Blue: #27408B
- Tan/Gold accent: brand dot accent
- Aero Dark base: #0b0f19
- Refined light base: #fcfbf9

## Design Principles

1. Premium glass surfaces with clear depth hierarchy
2. Clear information density through bento groupings
3. Motion that feels cinematic but calm
4. Accessibility-first contrast and focus behavior
5. No state communicated by color alone

## Architecture Decisions

1. Themes: ship Aero Dark and refined light mode in the same rollout
2. Updater UX: keep tray update action and update setting toggle, but remove auto-install and relaunch behavior
3. Onboarding art direction: blue plus tan/gold ambient visuals only (no purple bias)
4. Motion profile: medium cinematic transitions with reduced-motion fallback

## Delivery Phases

### Phase 0: Baseline and Risk Guardrails

1. Run baseline builds and capture current behavior:
   - bun run build
   - bun run tauri build
2. Record current onboarding flow, sidebar active state, and update-check experience for regression comparison.
3. Confirm no refactors to transcription/audio/business logic are included in this scope.

### Phase 1: Global Tokens and Theme Infrastructure

Primary files:

- Handy/src/App.css
- Handy/tailwind.config.js

Tasks:

1. Replace current root color variables with semantic token sets for both themes.
2. Introduce shared glass utility classes:
   - glass-panel
   - glass-panel-elevated
   - glass-interactive
3. Add dual-theme selectors that do not rely only on prefers-color-scheme.
4. Refine scrollbar styling to minimal fade behavior while keeping contrast visible on hover/focus.
5. Add reduced-motion and high-contrast accommodations globally.

Acceptance criteria:

1. Theme switch is consistent across app shell and controls.
2. New tokens are consumed through classes and variables, not scattered hardcoded colors.

### Phase 2: Core App Shell and Shared UI Components

Primary files:

- Handy/src/App.tsx
- Handy/src/components/Sidebar.tsx
- Handy/src/components/ui/SettingsGroup.tsx
- Handy/src/components/ui/Button.tsx
- Handy/src/components/ui/Input.tsx
- Handy/src/components/ui/Select.tsx
- Handy/src/components/ui/ToggleSwitch.tsx
- Handy/src/components/ui/Slider.tsx

Tasks:

1. Redesign sidebar as detached floating glass navigation.
2. Replace solid active blocks with glowing vertical active indicator plus non-color cues.
3. Convert settings layout into bento-style rounded cards for grouped controls.
4. Standardize component states:
   - focus ring contrast
   - hover/active depth changes
   - disabled clarity
5. Ensure all interaction affordances pass contrast checks in both themes.

Acceptance criteria:

1. Dense settings feel visually segmented and readable.
2. Keyboard focus is visible on all interactive controls.

### Phase 3: Onboarding Cinematic Redesign

Primary files:

- Handy/src/components/onboarding/onboarding.css
- Handy/src/components/onboarding/OnboardingLayout.tsx
- Handy/src/components/onboarding/WelcomeStep.tsx
- Handy/src/components/onboarding/ModelStep.tsx
- Handy/src/components/onboarding/PermissionsStep.tsx
- Handy/src/components/onboarding/OnboardingWizard.tsx

Tasks:

1. Replace split-pane onboarding structure with full-screen ambient scene and centered glass card.
2. Add animated ambient blobs with blue and tan/gold palette only.
3. Increase typography confidence and spacing hierarchy.
4. Restyle CTA and secondary buttons for glass aesthetic.
5. Add smooth step transition animations and reduced-motion fallback.

Acceptance criteria:

1. Onboarding feels immersive and cohesive with main app UI.
2. Step content remains readable and functional at smaller viewport widths.

### Phase 4: Custom Update Mechanism Replacement

Primary files:

- Handy/package.json
- Handy/src/components/update-checker/UpdateChecker.tsx
- Handy/src/components/footer/Footer.tsx
- Handy/src/components/settings/UpdateChecksToggle.tsx
- Handy/src/stores/settingsStore.ts
- Handy/src/lib/utils/customUpdateChecker.ts (new)
- Handy/src-tauri/src/lib.rs
- Handy/src-tauri/src/tray.rs
- Handy/src-tauri/src/shortcut/mod.rs
- Handy/src-tauri/tauri.conf.json
- Handy/src-tauri/capabilities/default.json
- Handy/src-tauri/capabilities/desktop.json
- Handy/src-tauri/Cargo.toml

Tasks:

1. Remove plugin-updater dependency and config wiring.
2. Remove old updater component behavior based on plugin APIs.
3. Add custom checker utility that calls your update endpoint.
4. Keep update checks toggle and tray check action, wired to the custom flow.
5. Surface non-intrusive themed notifications (settings surface and toast/action pattern).
6. Keep update action manual-download only.

Acceptance criteria:

1. No plugin-updater references remain in frontend or backend.
2. User can manually check updates from tray and receive a themed notification with download action.
3. No auto-install or relaunch behavior is triggered.

### Phase 5: Validation and Hardening

Build and static validation:

1. bun run build
2. bun run tauri build

Manual verification:

1. Force onboarding to reappear and complete full flow.
2. Validate sidebar active indicator, bento grouping, and glass depth hierarchy.
3. Trigger tray update check and verify custom notification flow.
4. Confirm visual consistency across dark and light themes.

Accessibility verification:

1. Text contrast: >= 4.5:1 (normal), >= 3:1 (large text)
2. UI component contrast: >= 3:1
3. State cues include iconography, borders, or labels in addition to color
4. Keyboard-only navigation and focus visibility across onboarding and settings
5. Reduced-motion behavior validated

## Dependency Order and Parallel Work

1. Phase 1 must finish before broad component migration.
2. Phase 2 and Phase 3 can run in parallel after token foundation is stable.
3. Phase 4 should follow once primary shell/UI changes are stable to avoid mixed regression surfaces.
4. Phase 5 runs last and gates release.

## Non-Goals

This plan does not include:

1. Changes to transcription model behavior
2. Changes to audio capture pipeline
3. New non-UI feature additions unrelated to update flow replacement

## Milestone-Based Execution (Recommended)

1. PR 1: Theme tokens, glass utilities, core shell migration
2. PR 2: Onboarding cinematic redesign
3. PR 3: Updater replacement plus final accessibility and regression pass

## Definition of Done

1. Aero Glass design language is consistently implemented across onboarding, main shell, and settings.
2. Both dark and refined light themes are production-ready.
3. Custom updater flow is active and plugin-updater is fully removed.
4. Build passes for frontend and Tauri desktop.
5. Manual verification and WCAG checks pass for key user journeys.
