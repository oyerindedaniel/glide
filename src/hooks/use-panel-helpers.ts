import { usePanelStore, PanelType } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import { useCallback } from "react";

/**
 * Hook providing consistent helper functions for managing panels
 *
 * This abstraction ensures that panels are opened and closed with the correct panel type,
 * preventing inconsistencies across the application.
 */
export function usePanelHelpers() {
  const { openPanel, closePanel } = usePanelStore();

  /**
   * Functions for File Upload Options Panel
   */
  const openFileUploadOptionsPanel = useCallback(() => {
    openPanel(PANEL_IDS.ABORT_PROCESSING, PanelType.RIGHT);
  }, [openPanel]);

  const closeFileUploadOptionsPanel = useCallback(() => {
    closePanel(PANEL_IDS.ABORT_PROCESSING, PanelType.RIGHT);
  }, [closePanel]);

  const toggleFileUploadOptionsPanel = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        openFileUploadOptionsPanel();
      } else {
        closeFileUploadOptionsPanel();
      }
    },
    [openFileUploadOptionsPanel, closeFileUploadOptionsPanel]
  );

  /**
   * Add functions for other panels as needed...
   */

  return {
    // File Upload Options Panel
    openFileUploadOptionsPanel,
    closeFileUploadOptionsPanel,
    toggleFileUploadOptionsPanel,

    // Direct store access (for cases not covered by helpers)
    rawOpenPanel: openPanel,
    rawClosePanel: closePanel,
  };
}
