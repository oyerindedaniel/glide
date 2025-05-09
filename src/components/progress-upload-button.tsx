"use client";

import React, { memo, useRef, useMemo, useEffect } from "react";
import Image from "next/image";
import { useProcessedFilesStore } from "@/store/processed-files";
import { useDropAnimationStore } from "@/store/drop-animation-store";
import { useAnimatePresence } from "@/hooks/use-animate-presence";
import {
  ANIMATION_DURATION,
  ANIMATION_EASING,
} from "@/constants/drop-animation";
import { PanelType, usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import { cn } from "@/lib/utils";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { useShallow } from "zustand/shallow";

/**
 * ProgressUploadButton Component
 * A button that triggers the upload progress panel.
 */

export function ProgressUploadButton() {
  const totalFiles = useProcessedFilesStore((state) => state.totalFiles);
  const { isDragging, setSnapPosition, setNodeRef, snapPosition } =
    useDropAnimationStore();

  const { centerStack, openPanel } = usePanelStore(
    useShallow((state) => ({
      centerStack: state.centerStack,
      openPanel: state.openPanel,
    }))
  );

  const { hasProgressUploadBeenOpened, markProgressUploadAsOpened } =
    useUserPreferencesStore(
      useShallow((state) => ({
        hasProgressUploadBeenOpened: state.hasProgressUploadBeenOpened,
        markProgressUploadAsOpened: state.markProgressUploadAsOpened,
      }))
    );

  const elementRef = useRef<HTMLButtonElement>(null);
  const snapToelementRef = useRef<HTMLDivElement>(null);
  const animateItemRef = useRef<HTMLImageElement>(null);

  const isProcessedFiles = Boolean(totalFiles);

  const isOpen = centerStack.includes(PANEL_IDS.PROGRESS_UPLOAD);

  const isActive = useMemo(
    () => isDragging || totalFiles > 0,
    [isDragging, totalFiles]
  );

  // Mark panel as opened when it's first opened
  useEffect(() => {
    if (isOpen && !hasProgressUploadBeenOpened) {
      markProgressUploadAsOpened();
    }
  }, [isOpen, hasProgressUploadBeenOpened, markProgressUploadAsOpened]);

  const isPresent = useAnimatePresence(
    isActive,
    async (presence) => {
      const element = elementRef.current;
      if (!element) return;

      let rafId: number | null = null;

      const runTransition = (
        opacity: string,
        transform: string,
        easing: string = ANIMATION_EASING
      ) =>
        new Promise<void>((resolve) => {
          const handleTransitionEnd = (e: TransitionEvent) => {
            if (e.target === element) {
              resolve();
              if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
              }
              element.removeEventListener("transitionend", handleTransitionEnd);
            }
          };

          element.addEventListener("transitionend", handleTransitionEnd);

          rafId = requestAnimationFrame(() => {
            element.style.transition = `all ${ANIMATION_DURATION}ms ${easing}`;
            element.style.opacity = opacity;
            element.style.transform = transform;
          });
        });

      if (presence) {
        element.style.transition = "none";
        element.style.opacity = "0";
        element.style.transform = "scale(0.8)";

        return runTransition("1", "scale(1)");
      } else {
        return runTransition("0", "scale(0.8)");
      }
    },
    { animateOnInitialLoad: false }
  );

  useEffect(() => {
    const element = snapToelementRef.current;
    if (!element || !isPresent) return;

    const { left, top } = element.getBoundingClientRect();

    const x = Math.round(left);
    const y = Math.round(top);

    const { x: oldX, y: oldY } = snapPosition;

    if (oldX === 0 && oldY === 0) {
      setSnapPosition(x, y);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent, setSnapPosition, snapPosition.x, snapPosition.y]);

  useEffect(() => {
    const element = animateItemRef.current;

    if (element) {
      setNodeRef(element);
    }
  }, [setNodeRef]);

  const handleOpenProgressPanel = () => {
    if (isProcessedFiles) {
      openPanel(PANEL_IDS.PROGRESS_UPLOAD, PanelType.CENTER);
    }
  };

  return (
    <>
      <Image
        ref={animateItemRef}
        className="w-5 opacity-0 invisible"
        src="/uploads-icon.svg"
        alt="upload progress animate"
        unoptimized
        width={78}
        height={84}
        aria-hidden
      />

      {isPresent && (
        <button
          onClick={handleOpenProgressPanel}
          disabled={!isProcessedFiles}
          {...(isProcessedFiles ? { "data-dropped": true } : {})}
          ref={elementRef}
          aria-controls={PANEL_IDS.PROGRESS_UPLOAD}
          aria-expanded={isOpen}
          className={cn(
            "group absolute bottom-12 left-12 cursor-pointer hover:scale-105 transition-transform duration-500",
            { "data-dropped:animate-bounce": !hasProgressUploadBeenOpened }
          )}
        >
          <div className="relative">
            <Image
              className="w-12"
              src="/uploads-icon.svg"
              alt="upload progress"
              priority
              unoptimized
              width={78}
              height={84}
            />
            <span
              ref={snapToelementRef}
              className="absolute top-0 right-0 opacity-0 scale-90 group-data-dropped:opacity-100 group-data-dropped:scale-100 transition-all ease-in-out duration-500 delay-250 -translate-y-2/4 translate-x-2/4 bg-white w-5 h-5 text-xs inline-flex items-center justify-center aspect-square rounded-full border border-primary text-primary font-bold"
            >
              {totalFiles}
            </span>
          </div>
        </button>
      )}
    </>
  );
}

export default memo(ProgressUploadButton);
