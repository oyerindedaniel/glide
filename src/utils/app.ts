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
  return typeof window !== "undefined" && typeof document !== "undefined";
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
 * Converts a file size from bytes to a human-readable format (MB or GB).
 *
 * @param {number} bytes - The file size in bytes.
 * @returns {string} - The formatted file size in MB or GB.
 */
export function formatFileSize(bytes: number): string {
  const MB = 1024 * 1024; // 1 MB = 1,048,576 bytes
  const GB = MB * 1024; // 1 GB = 1,073,741,824 bytes

  if (bytes >= GB) {
    return `${(bytes / GB).toFixed(2)} GB`;
  }

  return `${(bytes / MB).toFixed(2)} MB`;
}
