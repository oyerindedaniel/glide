"use client";

import React, { memo, useRef, useMemo } from "react";
import Image from "next/image";
import { useProcessedFilesStore } from "@/store/processed-files";
import { useDraggingStore } from "@/store/dragging-store";
import { useAnimatePresence } from "@/hooks/use-animate-presence";

/**
 * ProgressUpload Component
 * Displays an upload progress bar.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProgressUploadProps {}

export function ProgressUpload(props: ProgressUploadProps) {
  const totalFiles = useProcessedFilesStore((state) => state.totalFiles);
  const { isDragging, dropPosition } = useDraggingStore();

  const elementRef = useRef<HTMLDivElement>(null);
  const isActive = useMemo(
    () => isDragging || totalFiles > 0,
    [isDragging, totalFiles]
  );

  const isPresent = useAnimatePresence(isActive, async (presence) => {
    const element = elementRef.current;
    if (!element) return;

    let rafId: number | null = null;

    const runTransition = (
      opacity: string,
      transform: string,
      easing: string = "cubic-bezier(0.4, 0, 0.2, 1)"
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
          console.log("in this");
          element.style.transition = `all 250ms ${easing}`;
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
  });

  return (
    isPresent && (
      <div
        ref={elementRef}
        className="absolute bottom-12 left-12 font-[family-name:var(--font-manrope)] cursor-pointer"
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
          <span className="absolute top-0 right-0 -translate-y-2/4 translate-x-2/4 bg-white w-5 h-5 text-xs inline-flex items-center justify-center aspect-square rounded-full border border-primary text-primary font-bold">
            {totalFiles}
          </span>
        </div>
      </div>
    )
  );
}

export default memo(ProgressUpload);
