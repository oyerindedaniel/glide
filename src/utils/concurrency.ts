import {
  DEFAULT_MAX_CONCURRENT_FILES,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
  CPU_USAGE_PERCENTAGE,
} from "@/config/app";
import { isWindowDefined } from "./app";
import logger from "./logger";

/**
 * Configuration options for optimal concurrency detection
 */
export interface ConcurrencyOptions {
  /**
   * Skip auto-detection and use this exact concurrency value
   * This takes precedence over all other options if provided
   */
  customConcurrency?: number;

  /**
   * Minimum concurrency level regardless of system capabilities
   */
  minConcurrency?: number;

  /**
   * Maximum concurrency level regardless of system capabilities
   */
  maxConcurrency?: number;

  /**
   * Percentage of available CPU cores to use (0.0-1.0)
   */
  cpuPercentage?: number;
}

/**
 * Result from concurrency configuration creation
 */
export interface ConcurrencyConfig {
  /**
   * The determined number of concurrent files to process
   */
  maxConcurrentFiles: number;

  /**
   * Whether the value was automatically determined (true) or
   * manually specified via customConcurrency (false)
   */
  usedOptimalDetection: boolean;
}

/**
 * Determines the optimal concurrency level based on system capabilities
 *
 * @param options - Configuration options
 * @param options.defaultConcurrency - Default concurrency if system detection fails
 * @param options.minConcurrency - Minimum concurrency level
 * @param options.maxConcurrency - Maximum concurrency level
 * @param options.cpuPercentage - Percentage of available CPU cores to use (0.0-1.0)
 * @returns The recommended concurrency level
 */
export function getOptimalConcurrency({
  defaultConcurrency = DEFAULT_MAX_CONCURRENT_FILES,
  minConcurrency = MIN_CONCURRENCY,
  maxConcurrency = MAX_CONCURRENCY,
  cpuPercentage = CPU_USAGE_PERCENTAGE,
}: {
  defaultConcurrency?: number;
  minConcurrency?: number;
  maxConcurrency?: number;
  cpuPercentage?: number;
} = {}): number {
  // Ensure we're in a browser environment
  if (!isWindowDefined()) {
    return defaultConcurrency;
  }

  try {
    // Get available CPU cores
    const cores = navigator.hardwareConcurrency || 4;

    // Calculate optimal concurrency based on cores
    // We use a percentage of cores to leave resources for other tasks
    // and round down to be conservative
    const optimalConcurrency = Math.max(
      minConcurrency,
      Math.min(maxConcurrency, Math.floor(cores * cpuPercentage))
    );

    return optimalConcurrency;
  } catch (error) {
    // If there's any error in detection, fall back to default
    logger.warn("Failed to detect optimal concurrency:", error);
    return defaultConcurrency;
  }
}

/**
 * Determines the optimal concurrency for the current system configuration
 * for use in non-React contexts
 *
 * @param options - Optional configuration to override defaults
 * @returns The recommended concurrency level
 */
export function determineOptimalConcurrency(
  options?: ConcurrencyOptions
): number {
  return getOptimalConcurrency({
    defaultConcurrency:
      options?.customConcurrency || DEFAULT_MAX_CONCURRENT_FILES,
    minConcurrency: options?.minConcurrency || MIN_CONCURRENCY,
    maxConcurrency: options?.maxConcurrency || MAX_CONCURRENCY,
    cpuPercentage: options?.cpuPercentage || CPU_USAGE_PERCENTAGE,
  });
}

/**
 * Creates a concurrency configuration suitable for PDF processing
 * based on system capabilities
 *
 * @param options - Optional settings to override defaults
 * @returns An object with concurrency settings
 *
 * @example
 * // Auto-detect optimal concurrency
 * const config = createConcurrencyConfig();
 *
 * @example
 * // Force a specific concurrency value
 * const config = createConcurrencyConfig({ customConcurrency: 4 });
 *
 * @example
 * // Auto-detect with constraints
 * const config = createConcurrencyConfig({
 *   minConcurrency: 2,
 *   maxConcurrency: 6,
 *   cpuPercentage: 0.5
 * });
 */
export function createConcurrencyConfig(
  options?: ConcurrencyOptions & {
    forceDefaultConcurrency?: boolean;
  }
): ConcurrencyConfig {
  // If forcing default or custom value is provided, don't detect
  if (options?.forceDefaultConcurrency) {
    return {
      maxConcurrentFiles: DEFAULT_MAX_CONCURRENT_FILES,
      usedOptimalDetection: false,
    };
  }

  if (typeof options?.customConcurrency === "number") {
    return {
      maxConcurrentFiles: options.customConcurrency,
      usedOptimalDetection: false,
    };
  }

  const concurrency = determineOptimalConcurrency({
    minConcurrency: options?.minConcurrency,
    maxConcurrency: options?.maxConcurrency,
    cpuPercentage: options?.cpuPercentage,
  });

  return {
    maxConcurrentFiles: concurrency,
    usedOptimalDetection: true,
  };
}
