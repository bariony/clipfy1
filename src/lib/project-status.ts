/**
 * Canonical project/render lifecycle statuses for Clipfy.
 * Shared across UI, hooks, and future edge functions.
 */
export const PROJECT_STATUSES = [
  "draft",
  "uploading",
  "uploaded",
  "transcribing",
  "analyzing",
  "generating_clips",
  "ready",
  "rendering",
  "completed",
  "failed",
  "canceled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_META: Record<
  ProjectStatus,
  { label: string; tone: "neutral" | "accent" | "warning" | "danger" | "success" }
> = {
  draft: { label: "Draft", tone: "neutral" },
  uploading: { label: "Uploading", tone: "accent" },
  uploaded: { label: "Uploaded", tone: "neutral" },
  transcribing: { label: "Transcribing", tone: "accent" },
  analyzing: { label: "Analyzing", tone: "accent" },
  generating_clips: { label: "Generating clips", tone: "accent" },
  ready: { label: "Ready", tone: "success" },
  rendering: { label: "Rendering", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
};
