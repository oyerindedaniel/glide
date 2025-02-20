import { ANIMATION_DURATION } from "@/constants/drop-animation";
import { create } from "zustand";

interface DropAnimationState {
  isDragging: boolean;
  dropPosition: { x: number; y: number };
  snapPosition: { x: number; y: number };
  constraints: {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
  };
  nodeRef: HTMLElement | null;
  setIsDragging: (isDragging: boolean) => void;
  setDropPosition: (x: number, y: number) => void;
  setSnapPosition: (x: number, y: number) => void;
  setNodeRef: (node: HTMLElement | null) => void;
  setConstraints: (constraints: {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
  }) => void;
  animateToSnapPosition: () => void;
  cleanup: () => void;
}

export const useDropAnimationStore = create<DropAnimationState>((set, get) => ({
  isDragging: false,
  dropPosition: { x: 0, y: 0 },
  snapPosition: { x: 0, y: 0 },
  constraints: {
    minWidth: 0,
    minHeight: 0,
    maxWidth: window.innerWidth,
    maxHeight: window.innerHeight,
  },
  nodeRef: null,
  setIsDragging: (isDragging) => set({ isDragging }),
  setDropPosition: (x, y) => set({ dropPosition: { x, y } }),
  setSnapPosition: (x, y) => set({ snapPosition: { x, y } }),
  setConstraints: (constraints) => set({ constraints }),
  setNodeRef: (node) => set({ nodeRef: node }),
  animateToSnapPosition: () => {
    const { dropPosition, snapPosition, nodeRef } = get();
    if (!nodeRef) return;

    nodeRef.style.transition = "none";
    nodeRef.style.transform = `translate3d(${dropPosition.x}px, ${dropPosition.y}px, 0)`;
    nodeRef.style.opacity = "1";
    nodeRef.style.visibility = "visible";

    let start: number | null = null;
    let animationFrameId: number | null = null;
    const duration = ANIMATION_DURATION;

    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / duration, 1);

      const newX =
        dropPosition.x + (snapPosition.x - dropPosition.x) * progress;
      const newY =
        dropPosition.y + (snapPosition.y - dropPosition.y) * progress;

      nodeRef.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        nodeRef.style.transition = "none";
        nodeRef.style.opacity = "0";
        nodeRef.style.visibility = "hidden";

        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
        animationFrameId = null;
      }
    };

    animationFrameId = requestAnimationFrame(animate);
  },
  cleanup: () => {
    set({
      isDragging: false,
      dropPosition: { x: 0, y: 0 },
      snapPosition: { x: 0, y: 0 },
      nodeRef: null,
    });
  },
}));
