import { useEffect, useLayoutEffect } from "react";

/**
 * A hook that works like `useLayoutEffect` in the browser
 * and falls back to `useEffect` on the server.
 *
 * This ensures compatibility with server-side rendering (SSR).
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
