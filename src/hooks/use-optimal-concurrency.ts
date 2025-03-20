import { useEffect, useState } from "react";
import { getOptimalConcurrency } from "@/utils/concurrency";
import {
  DEFAULT_MAX_CONCURRENT_FILES,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
  CPU_USAGE_PERCENTAGE,
} from "@/config/app";

/**
 * Hook that determines the optimal concurrency level based on system capabilities
 *
 * @param options - Optional configuration to override defaults
 * @returns The optimal concurrency value for the current system
 *
 * @example
 * const concurrency = useOptimalConcurrency();
 * // or with custom options
 * const concurrency = useOptimalConcurrency({
 *   defaultConcurrency: 2,
 *   minConcurrency: 1,
 *   maxConcurrency: 6
 * });
 */
export function useOptimalConcurrency(options?: {
  defaultConcurrency?: number;
  minConcurrency?: number;
  maxConcurrency?: number;
  cpuPercentage?: number;
}): number {
  const [concurrency, setConcurrency] = useState<number>(
    options?.defaultConcurrency || DEFAULT_MAX_CONCURRENT_FILES
  );

  useEffect(() => {
    const optimal = getOptimalConcurrency({
      defaultConcurrency:
        options?.defaultConcurrency || DEFAULT_MAX_CONCURRENT_FILES,
      minConcurrency: options?.minConcurrency || MIN_CONCURRENCY,
      maxConcurrency: options?.maxConcurrency || MAX_CONCURRENCY,
      cpuPercentage: options?.cpuPercentage || CPU_USAGE_PERCENTAGE,
    });

    setConcurrency(optimal);
  }, [
    options?.defaultConcurrency,
    options?.minConcurrency,
    options?.maxConcurrency,
    options?.cpuPercentage,
  ]);

  return concurrency;
}

export default useOptimalConcurrency;
