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
 * Represents the result of an operation that may succeed or fail.
 *
 * @template T - The type of the data returned on success.
 */
type Result<T> = {
  /**
   * The data returned if the operation is successful.
   */
  data?: T;

  /**
   * The error object if the operation fails.
   */
  error?: {
    /**
     * A user-friendly error message describing the failure.
     */
    message: string;

    /**
     * The raw error object for debugging purposes (if available).
     */
    raw?: unknown;
  };
};

/**
 * A mapping of known error messages to user-friendly descriptions.
 */
const errorMessageMap: { [key: string]: string } = {
  "Network Error":
    "Unable to connect to the server. Please check your internet connection and try again.",
  "Database Error":
    "There was a problem accessing the database. Please try again later.",
  "File Not Found":
    "The requested file could not be found. Please check the file path and try again.",
  "Permission Denied":
    "You do not have permission to perform this action. Please contact support if you believe this is an error.",
  "Invalid Input":
    "The provided input is invalid. Please check your data and try again.",
  "Authentication Failed":
    "Authentication failed. Please check your credentials and try again.",
  "Token Expired": "Your session has expired. Please log in again.",
};

/**
 * Executes an asynchronous operation and returns a standardized result object.
 *
 * @template T - The type of the expected successful result.
 * @param {Promise<T>} operation - The asynchronous operation to execute.
 * @param {string} [contextMessage="Operation failed"] - Additional context for error messages.
 * @returns {Promise<Result<T>>} A promise resolving to a `Result` object containing either the data or an error.
 */
export async function tryCatch<T>(
  operation: Promise<T>,
  contextMessage = "Operation failed"
): Promise<Result<T>> {
  const isDevMode = process.env.NODE_ENV === "development";

  try {
    const data = await operation;
    return { data };
  } catch (err) {
    let errorMessage: string;

    if (err instanceof Error) {
      errorMessage = err.message;
    } else {
      errorMessage = String(err);
    }

    let defaultMessage =
      "An unexpected error occurred. Please try again later.";

    if (isDevMode) {
      defaultMessage = `${contextMessage}: ${errorMessage}`;
    } else {
      for (const [key, message] of Object.entries(errorMessageMap)) {
        if (errorMessage.includes(key)) {
          defaultMessage = message;
          break;
        }
      }
    }

    return {
      error: {
        message: defaultMessage,
        raw: err,
      },
    };
  }
}
