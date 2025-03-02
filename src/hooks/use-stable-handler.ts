/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useRef } from "react";
import { useIsomorphicLayoutEffect } from "./use-Isomorphic-layout-effect";

/**
 * A custom hook to create a stable event handler reference.
 *
 * @param handler - The function to be stabilized.
 * @returns A stable callback that always uses the latest version of the handler.
 */
export function useStableHandler<T extends (...args: any[]) => any>(
  handler: T
): (...args: Parameters<T>) => ReturnType<T> {
  const handlerRef = useRef<T>(handler);

  useIsomorphicLayoutEffect(() => {
    handlerRef.current = handler;
  });

  return useCallback((...args: Parameters<T>): ReturnType<T> => {
    return handlerRef.current?.(...args);
  }, []);
}
