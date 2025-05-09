/**
 * Creates a delay for a given time in milliseconds.
 *
 * @param {number} ms - The number of milliseconds to delay.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if `window` is defined to prevent SSR-related errors.
 * @returns {boolean} `true` if running in the browser, otherwise `false`.
 */
export function isWindowDefined(): boolean {
  return typeof window !== "undefined";
}

/**
 * Checks if the environment is a browser with Web Worker support.
 * Use this for worker-related code that requires both window and Worker.
 * @returns {boolean} `true` if running in the browser with Worker support, otherwise `false`.
 */
export function isBrowserWithWorker(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

/**
 * Generate a short random ID for logging purposes
 * @returns A 6-character random ID
 */
export function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 8);
}

/**
 * Creates a debounced version of a function that delays its execution
 * until after a specified wait time has passed since the last invocation.
 *
 * @template T - The type of the function to debounce.
 * @param {T} fn - The function to debounce.
 * @param {number} delay - The delay time in milliseconds.
 * @returns {(...args: Parameters<T>) => void} - A debounced version of the original function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const debounce = <T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
};

/**
 * Throttle utility to limit the execution of a function.
 * Ensures the provided function is called at most once in the specified time frame.
 *
 * @template T - Type of the function to throttle.
 * @param func - The function to be throttled.
 * @param delay - The minimum delay (in milliseconds) between function executions.
 * @returns A throttled version of the input function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>): void {
    const now = Date.now();
    const remainingTime = delay - (now - lastCall);

    if (remainingTime <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      lastCall = now;
      func(...args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        lastCall = Date.now();
        timeout = null;
        func(...args);
      }, remainingTime);
    }
  };
}

/**
 * Calculates an exponential backoff delay.
 *
 * @param {number} baseDelay - The base delay in milliseconds.
 * @param {number} attempt - The current retry attempt (starting from 1).
 * @returns {number} The computed delay in milliseconds.
 */
export function getExponentialBackoffDelay(
  baseDelay: number,
  attempt: number
): number {
  if (attempt < 1) {
    throw new Error("Attempt number must be at least 1.");
  }

  return baseDelay * Math.pow(2, attempt - 1);
}
