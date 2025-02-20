import { useState, useEffect, useMemo, useCallback } from "react";

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

  const handleAnimation = useCallback(
    async (presence: boolean): Promise<void> => {
      try {
        await onAnimate(presence);
      } catch (error) {
        console.error("Animation error:", error);
        return Promise.reject(error);
      }
    },
    []
  );

  useEffect(() => {
    let isMounted = true;

    handleAnimation(externalPresence).then(() => {
      if (isMounted) {
        setInternalPresence(externalPresence);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [externalPresence, handleAnimation]);

  return useMemo(
    () => internalPresence || externalPresence,
    [externalPresence, internalPresence]
  );
}
