// Templates seed a new profile with a sensible starting point so the
// user is not staring at a blank "Use global setting" form. Each
// template only sets fields whose values we can guarantee are valid
// regardless of the user's installed models / tones / prompts — that
// rules out tone_id / post_process_prompt_id / stt_model_id (all
// user-specific). What's left (language, paste method, the boolean
// tri-states) is enough to make each preset meaningful.
//
// Apps and URL patterns are *not* templated because they're highly
// user-specific and users almost always want to pick their own.

import {
  Code2,
  FileText,
  Mail,
  MessageSquare,
  Minimize2,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WriteRule } from "@/bindings";

export type ProfileTemplateId =
  | "blank"
  | "email"
  | "coding"
  | "chat"
  | "notes"
  | "concise";

export interface ProfileTemplate {
  id: ProfileTemplateId;
  label: string;
  description: string;
  icon: LucideIcon;
  apply: (draft: WriteRule) => WriteRule;
}

export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    description: "Start from scratch.",
    icon: Plus,
    apply: (draft) => draft,
  },
  {
    id: "email",
    label: "Email",
    description: "Polished punctuation, no auto-submit.",
    icon: Mail,
    apply: (draft) => ({
      ...draft,
      name: draft.name || "Email",
      overrides: {
        ...draft.overrides,
        auto_submit: false,
        append_trailing_space: true,
        force_post_process: true,
      },
    }),
  },
  {
    id: "coding",
    label: "Coding",
    description: "English, paste, no auto-submit.",
    icon: Code2,
    apply: (draft) => ({
      ...draft,
      name: draft.name || "Coding",
      overrides: {
        ...draft.overrides,
        stt_language: "en",
        paste_method: "ctrl_v",
        auto_submit: false,
        append_trailing_space: false,
      },
    }),
  },
  {
    id: "chat",
    label: "Chat",
    description: "Quick, casual, auto-submit on.",
    icon: MessageSquare,
    apply: (draft) => ({
      ...draft,
      name: draft.name || "Chat",
      overrides: {
        ...draft.overrides,
        auto_submit: true,
        append_trailing_space: false,
      },
    }),
  },
  {
    id: "notes",
    label: "Notes",
    description: "Always polish, with trailing space.",
    icon: FileText,
    apply: (draft) => ({
      ...draft,
      name: draft.name || "Notes",
      overrides: {
        ...draft.overrides,
        force_post_process: true,
        append_trailing_space: true,
        auto_submit: false,
      },
    }),
  },
  {
    id: "concise",
    label: "Concise",
    description: "Shorter, clearer rewrites.",
    icon: Minimize2,
    apply: (draft) => ({
      ...draft,
      name: draft.name || "Concise",
      overrides: {
        ...draft.overrides,
        tone_id: "concise",
        force_post_process: true,
        append_trailing_space: true,
        auto_submit: false,
      },
    }),
  },
];
