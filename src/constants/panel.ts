/**
 * Centralized object for managing panel IDs
 * This provides a consistent and immutable reference to panel identifiers.
 */
export const PANEL_IDS = Object.freeze({
  PROGRESS_UPLOAD: "progess_upload",
  ABORT_PROCESSING: "abort_processing",
  IMAGE_PREVIEW: "image_preview",
} as const);

export type PanelId = (typeof PANEL_IDS)[keyof typeof PANEL_IDS];
