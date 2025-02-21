import { create } from "zustand";

export enum PanelType {
  CENTER = "center",
  RIGHT = "right",
}

interface PanelState {
  centerStack: string[]; // Stack for center panels
  rightPanels: Set<string>; // Set for right panels

  openPanel: (id: string, type: PanelType) => void;
  closePanel: (id: string, type: PanelType) => void;
  resetPanels: () => void;
  getCurrentCenter: () => string | null; // Get the currently active center panel
}

export const usePanelStore = create<PanelState>((set, get) => ({
  centerStack: [],
  rightPanels: new Set(),

  openPanel: (id, type) =>
    set((state) => {
      if (type === PanelType.CENTER) {
        let newStack = [...state.centerStack];

        // Removes existing occurrence to maintain unique stack behavior
        newStack = newStack.filter((panel) => panel !== id);
        newStack.push(id);

        return { centerStack: newStack };
      } else {
        const newRightPanels = new Set(state.rightPanels);
        newRightPanels.add(id);
        return { rightPanels: newRightPanels };
      }
    }),

  closePanel: (id, type) =>
    set((state) => {
      if (type === PanelType.CENTER) {
        let newStack = [...state.centerStack];

        if (newStack[newStack.length - 1] === id) {
          newStack.pop();
        } else {
          newStack = newStack.filter((panel) => panel !== id);
        }

        return { centerStack: newStack };
      } else {
        const newRightPanels = new Set(state.rightPanels);
        newRightPanels.delete(id);
        return { rightPanels: newRightPanels };
      }
    }),

  resetPanels: () => set({ centerStack: [], rightPanels: new Set() }),

  getCurrentCenter: () => {
    const state = get();
    return state.centerStack.length > 0
      ? state.centerStack[state.centerStack.length - 1]
      : null;
  },
}));
