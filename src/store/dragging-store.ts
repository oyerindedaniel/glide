import { create } from "zustand";

interface DraggingState {
  isDragging: boolean;
  dropPosition: { x: number; y: number };
  constraints: {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
  };
  setIsDragging: (isDragging: boolean) => void;
  setDropPosition: (x: number, y: number) => void;
  setConstraints: (constraints: {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
  }) => void;
}

export const useDraggingStore = create<DraggingState>((set) => ({
  isDragging: false,
  dropPosition: { x: 0, y: 0 },
  constraints: {
    minWidth: 0,
    minHeight: 0,
    maxWidth: window.innerWidth,
    maxHeight: window.innerHeight,
  },
  setIsDragging: (isDragging) => set({ isDragging }),
  setDropPosition: (x, y) => set({ dropPosition: { x, y } }),
  setConstraints: (constraints) => set({ constraints }),
}));
