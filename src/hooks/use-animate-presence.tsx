"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";

/**
 * Hook to manage presence state with animation control.
 *
 * @param {boolean} externalPresence - External control of presence.
 * @param {boolean} animateOnInitialLoad - Whether to animate on initial load.
 * @param {(presence: boolean) => Promise<void>} onAnimate - Callback that resolves when animations complete.
 * @returns {boolean} - The computed presence state.
 */
export function useAnimatePresence(
  externalPresence: boolean,
  onAnimate: (presence: boolean) => Promise<void>,
  options: { animateOnInitialLoad?: boolean } = {}
): boolean {
  const [internalPresence, setInternalPresence] =
    useState<boolean>(externalPresence);
  const onAnimateRef = useRef(onAnimate);
  const isInitialRender = useRef(true);

  const { animateOnInitialLoad = true } = options;

  useEffect(() => {
    onAnimateRef.current = onAnimate;
  });

  const handleAnimation = useCallback(
    async (presence: boolean): Promise<void> => {
      try {
        await onAnimateRef.current(presence);
      } catch (error) {
        throw error;
      }
    },
    []
  );

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      if (!animateOnInitialLoad) return;
    }

    handleAnimation(externalPresence)
      .then(() => {
        setInternalPresence(externalPresence);
      })
      .catch((error) => console.error("Animation failed:", error));
  }, [animateOnInitialLoad, externalPresence, handleAnimation]);

  return useMemo(
    () => internalPresence || externalPresence,
    [externalPresence, internalPresence]
  );
}
