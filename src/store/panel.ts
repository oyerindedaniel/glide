import { create } from "zustand";

export enum PanelType {
  CENTER = "center",
  LEFT = "left",
  RIGHT = "right",
}

interface PanelState {
  centerStack: string[]; // Stack for center panels
  sidePanels: { left: string | null; right: string | null }; // Active left and right panels

  openPanel: (id: string, type: PanelType) => void;
  closePanel: (id: string, type: PanelType) => void;
  resetPanels: () => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  centerStack: [],
  sidePanels: { left: null, right: null },

  openPanel: (id, type) =>
    set((state) => {
      if (type === PanelType.CENTER) {
        let newStack = [...state.centerStack];

        newStack = newStack.filter((panel) => panel !== id);

        newStack.push(id);

        if (newStack.length > 3) {
          newStack = newStack.slice(-3);
        }

        return { centerStack: newStack };
      } else if (type === PanelType.LEFT) {
        return { sidePanels: { ...state.sidePanels, left: id } };
      } else if (type === PanelType.RIGHT) {
        return { sidePanels: { ...state.sidePanels, right: id } };
      }
      return state;
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
      } else if (type === PanelType.LEFT && state.sidePanels.left === id) {
        return { sidePanels: { ...state.sidePanels, left: null } };
      } else if (type === PanelType.RIGHT && state.sidePanels.right === id) {
        return { sidePanels: { ...state.sidePanels, right: null } };
      }
      return state;
    }),

  resetPanels: () =>
    set({ centerStack: [], sidePanels: { left: null, right: null } }),
}));
