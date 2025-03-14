import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProgressUploadPreferencesState {
  hasProgressUploadBeenOpened: boolean;

  markProgressUploadAsOpened: () => void;
}

export const useUserPreferencesStore = create<ProgressUploadPreferencesState>()(
  persist(
    (set) => ({
      hasProgressUploadBeenOpened: false,

      markProgressUploadAsOpened: () =>
        set({ hasProgressUploadBeenOpened: true }),
    }),
    {
      name: "preferences",
      partialize: (state) => ({
        hasProgressUploadBeenOpened: state.hasProgressUploadBeenOpened,
      }),
    }
  )
);
