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
