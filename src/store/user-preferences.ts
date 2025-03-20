import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FileUploadAction = "override" | "add-to-queue";

interface UserPreferencesState {
  hasProgressUploadBeenOpened: boolean;
  lastFileUploadAction: FileUploadAction;

  markProgressUploadAsOpened: () => void;
  setLastFileUploadAction: (action: FileUploadAction) => void;
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set) => ({
      hasProgressUploadBeenOpened: false,
      lastFileUploadAction: "add-to-queue",

      markProgressUploadAsOpened: () =>
        set({ hasProgressUploadBeenOpened: true }),
      setLastFileUploadAction: (action: FileUploadAction) =>
        set({ lastFileUploadAction: action }),
    }),
    {
      name: "preferences",
      partialize: (state) => ({
        hasProgressUploadBeenOpened: state.hasProgressUploadBeenOpened,
        lastFileUploadAction: state.lastFileUploadAction,
      }),
    }
  )
);
