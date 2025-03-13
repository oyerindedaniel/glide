import { create } from "zustand";
import { PanelType, usePanelStore } from "./panel";
import { PANEL_IDS } from "@/constants/panel";

interface PreviewImage {
  src: string | null;
  alt: string;
  fileName: string;
}

interface ImagePreviewState {
  previewImage: PreviewImage | null;
  setPreviewImage: (image: PreviewImage | null) => void;
  openImagePreview: (src: string, alt: string, fileName: string) => void;
  closeImagePreview: () => void;
}

export const useImagePreviewStore = create<ImagePreviewState>((set) => {
  const { openPanel, closePanel } = usePanelStore.getState();

  return {
    previewImage: null,
    setPreviewImage: (image) => set({ previewImage: image }),
    openImagePreview: (src, alt, fileName) => {
      set({ previewImage: { src, alt, fileName } });
      setTimeout(() => {
        openPanel(PANEL_IDS.IMAGE_PREVIEW, PanelType.CENTER);
      }, 10);
    },
    closeImagePreview: () => {
      closePanel(PANEL_IDS.IMAGE_PREVIEW, PanelType.CENTER);
    },
  };
});
