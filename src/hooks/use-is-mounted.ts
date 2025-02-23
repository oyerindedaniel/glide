"use client";

/**
 * useIsMounted - Custom hook to check if a component is mounted.
 *
 * This hook returns a boolean indicating whether the component is mounted.
 * Useful for preventing state updates on unmounted components.
 *
 * @returns {boolean} True if the component is mounted, false otherwise.
 */
import { useEffect, useState } from "react";

export function useIsMounted(): boolean {
  const [isMounted, setIsMounted] = useState<boolean>(false);

  useEffect(() => {
    setIsMounted(true);

    return () => {
      setIsMounted(false);
    };
  }, []);

  return isMounted;
}
