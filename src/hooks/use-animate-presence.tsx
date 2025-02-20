import { useState, useEffect, useMemo, useCallback, useRef } from "react";

/**
 * Hook to manage presence state with an async callback.
 *
 * @param {boolean} externalPresence - External control of presence.
 * @param {(presence: boolean) => Promise<void>} onAnimate - Callback that resolves when animations complete.
 * @returns {boolean} - The computed presence state.
 */
export function useAnimatePresence(
  externalPresence: boolean,
  onAnimate: (presence: boolean) => Promise<void>
): boolean {
  const [internalPresence, setInternalPresence] =
    useState<boolean>(externalPresence);
  const onAnimateRef = useRef(onAnimate);

  useEffect(() => {
    onAnimateRef.current = onAnimate;
  });

  const handleAnimation = useCallback(
    async (presence: boolean): Promise<void> => {
      try {
        await onAnimateRef.current(presence);
      } catch (error) {
        console.error("Animation error:", error);
        return Promise.reject(error);
      }
    },
    []
  );

  useEffect(() => {
    handleAnimation(externalPresence).then(() => {
      setInternalPresence(externalPresence);
    });
  }, [externalPresence, handleAnimation]);

  return useMemo(
    () => internalPresence || externalPresence,
    [externalPresence, internalPresence]
  );
}
