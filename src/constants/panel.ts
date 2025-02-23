/**
 * Centralized object for managing panel IDs
 * This provides a consistent and immutable reference to panel identifiers.
 */
export const PANEL_IDS = Object.freeze({
  ABORT_PROCESSING: "abort_processing",
} as const);

export type PanelId = (typeof PANEL_IDS)[keyof typeof PANEL_IDS];
