"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useStableHandler } from "./use-stable-handler";

interface AnimatePresenceOptions {
  animateOnInitialLoad?: boolean;
  timeout?: number; // Timeout for animation in ms
}

export function useAnimatePresence(
  externalPresence: boolean,
  onAnimate: (presence: boolean) => Promise<void>,
  options: AnimatePresenceOptions = {}
): boolean {
  const [internalPresence, setInternalPresence] =
    useState<boolean>(externalPresence);
  const isInitialRender = useRef(true);
  const animationTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isAnimatingRef = useRef(false);

  const {
    animateOnInitialLoad = true,
    timeout = 400, // Default timeout matching our CSS animations
  } = options;

  const onAnimateRef = useStableHandler(onAnimate);

  const handleAnimation = useCallback(
    async (presence: boolean): Promise<void> => {
      if (isAnimatingRef.current) {
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
      }

      isAnimatingRef.current = true;

      try {
        await Promise.race([
          onAnimateRef(presence),
          new Promise((_, reject) => {
            animationTimeoutRef.current = setTimeout(() => {
              reject(new Error("Animation timeout"));
            }, timeout);
          }),
        ]);
      } catch {
        setInternalPresence(presence);
      } finally {
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        isAnimatingRef.current = false;
      }
    },
    [onAnimateRef, timeout]
  );

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      if (!animateOnInitialLoad) {
        setInternalPresence(externalPresence);
        return;
      }
    }

    handleAnimation(externalPresence).then(() => {
      setInternalPresence(externalPresence);
    });

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [animateOnInitialLoad, externalPresence, handleAnimation]);

  return useMemo(
    () => internalPresence || externalPresence,
    [externalPresence, internalPresence]
  );
}
