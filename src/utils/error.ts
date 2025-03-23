import logger from "@/utils/logger";
import { isProduction } from "@/config/app";
import { isWindowDefined } from "./app";

/**
 * Known error codes for better error classification.
 */
export enum ErrorCode {
  SYSTEM_ERROR = "SYSTEM_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INVALID_INPUT = "INVALID_INPUT",
  AUTH_FAILED = "AUTH_FAILED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",

  // Worker-specific error codes
  WORKER_ERROR = "WORKER_ERROR",
  WORKER_INIT_ERROR = "WORKER_INIT_ERROR",
  WORKER_TIMEOUT = "WORKER_TIMEOUT",
  WORKER_CLEANUP_ERROR = "WORKER_CLEANUP_ERROR",
  WORKER_COMMUNICATION_ERROR = "WORKER_COMMUNICATION_ERROR",
  WORKER_POOL_ERROR = "WORKER_POOL_ERROR",
  ABORT_ERROR = "ABORT_ERROR",
  // PDF-specific error codes
  PDF_CORRUPTED = "PDF_CORRUPTED",
  PDF_PASSWORD_PROTECTED = "PDF_PASSWORD_PROTECTED",
  PDF_PROCESSING_FAILED = "PDF_PROCESSING_FAILED",
  PDF_BATCH_FAILURE = "PDF_BATCH_FAILURE",
  PDF_FORMAT_ERROR = "PDF_FORMAT_ERROR",
  PDF_MEMORY_ERROR = "PDF_MEMORY_ERROR",
  PDF_ALL_PAGES_FAILED = "PDF_ALL_PAGES_FAILED",
  PDF_SOME_PAGES_FAILED = "PDF_SOME_PAGES_FAILED",
  PDF_PAGE_CORRUPT = "PDF_PAGE_CORRUPT",
  PDF_PAGE_RENDER_ERROR = "PDF_PAGE_RENDER_ERROR",
  PDF_PAGE_MEMORY_ERROR = "PDF_PAGE_MEMORY_ERROR",

  /**
   * An unknown error occurred.
   */
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * A mapping of error codes to user-friendly descriptions.
 */
export const errorMessageMap: Record<ErrorCode, string> = {
  [ErrorCode.SYSTEM_ERROR]:
    "A system error occurred, please try again later. If this persists, please contact support.",
  [ErrorCode.NETWORK_ERROR]:
    "Unable to connect to the server. Please check your internet connection and try again.",
  [ErrorCode.DATABASE_ERROR]:
    "There was a problem accessing the database. Please try again later.",
  [ErrorCode.TIMEOUT_ERROR]: "The operation timed out. Please try again.",
  [ErrorCode.FILE_NOT_FOUND]:
    "The requested file could not be found. Please check the file path and try again.",
  [ErrorCode.PERMISSION_DENIED]:
    "You do not have permission to perform this action. Please contact support if you believe this is an error.",
  [ErrorCode.INVALID_INPUT]:
    "The provided input is invalid. Please check your data and try again.",
  [ErrorCode.AUTH_FAILED]:
    "Authentication failed. Please check your credentials and try again.",
  [ErrorCode.TOKEN_EXPIRED]: "Your session has expired. Please log in again.",
  // Worker-specific error messages
  [ErrorCode.WORKER_ERROR]:
    "An error occurred while processing the file. Please try again.",
  [ErrorCode.WORKER_INIT_ERROR]:
    "Failed to initialize the worker. Please try refreshing the page.",
  [ErrorCode.WORKER_TIMEOUT]:
    "The worker operation timed out. Please try again.",
  [ErrorCode.WORKER_CLEANUP_ERROR]:
    "Failed to clean up worker resources. This may affect performance.",
  [ErrorCode.WORKER_COMMUNICATION_ERROR]:
    "Failed to communicate with the worker. Please try again.",
  [ErrorCode.WORKER_POOL_ERROR]:
    "There was an error with the worker pool. Please try again.",
  [ErrorCode.ABORT_ERROR]:
    "The operation was aborted. This may have been requested by the user or due to system constraints.",
  // PDF-specific error messages
  [ErrorCode.PDF_CORRUPTED]:
    "The PDF file appears to be corrupted or invalid. Please check the file and try again.",
  [ErrorCode.PDF_PASSWORD_PROTECTED]:
    "The PDF file is password protected. Please provide the password or use an unprotected file.",
  [ErrorCode.PDF_PROCESSING_FAILED]:
    "Failed to process the PDF file. The file may be corrupted or in an unsupported format.",
  [ErrorCode.PDF_BATCH_FAILURE]:
    "One or more PDF files could not be processed. Please check the files and try again.",
  [ErrorCode.PDF_FORMAT_ERROR]:
    "The file is not in a supported PDF format. Please check the file and try again.",
  [ErrorCode.PDF_MEMORY_ERROR]:
    "Not enough memory to process the PDF file. Try closing other applications or processing a smaller file.",
  [ErrorCode.PDF_ALL_PAGES_FAILED]:
    "All pages in the PDF file could not be processed. Please check the file and try again.",
  [ErrorCode.PDF_SOME_PAGES_FAILED]:
    "Some pages in the PDF file could not be processed. You can still view the successful pages.",
  [ErrorCode.PDF_PAGE_CORRUPT]:
    "One or more pages in the PDF file appear to be corrupted.",
  [ErrorCode.PDF_PAGE_RENDER_ERROR]:
    "Failed to render one or more pages from the PDF file.",
  [ErrorCode.PDF_PAGE_MEMORY_ERROR]:
    "Not enough memory to process one or more pages from the PDF file.",
  [ErrorCode.UNKNOWN_ERROR]:
    "An unexpected error occurred. Please try again later.",
};

/**
 * Base error class for application-specific errors
 */
class AppError extends Error {
  public code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN_ERROR) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base error class for system-specific errors
 */
class SystemError extends AppError {
  constructor(message: string = errorMessageMap[ErrorCode.SYSTEM_ERROR]) {
    super(message, ErrorCode.SYSTEM_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base error class for worker-specific errors
 */
class WorkerError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCode.WORKER_ERROR) {
    super(message, code);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker initialization failures
 */
class WorkerInitializationError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_INIT_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker timeout failures
 */
class WorkerTimeoutError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_TIMEOUT);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker cleanup failures
 */
class WorkerCleanupError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_CLEANUP_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker communication failures
 */
class WorkerCommunicationError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_COMMUNICATION_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker pool failures
 */
class WorkerPoolError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_POOL_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for operation abortion
 */
class AbortError extends AppError {
  constructor(message: string = "Operation aborted") {
    super(message, ErrorCode.ABORT_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type ResultError<E> = {
  message: string;
  raw: E;
  code: ErrorCode;
};

type Result<T, E extends Error = Error> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: ResultError<E>; data?: undefined };

/**
 * Executes an asynchronous operation and returns a standardized result object.
 *
 * @template T - The type of the expected successful result.
 * @param {Promise<T>} operation - The asynchronous operation to execute.
 * @returns {Promise<Result<T>>} A promise resolving to a `Result` object containing either the data or an error.
 */
export async function tryCatch<T, E extends Error = Error>(
  operation: Promise<T>
): Promise<Result<T, E>> {
  try {
    const data = await operation;
    return { success: true, data };
  } catch (err) {
    let errorMessage = errorMessageMap[ErrorCode.UNKNOWN_ERROR];
    let errorCode = ErrorCode.UNKNOWN_ERROR;

    if (err) {
      errorMessage = getErrorMessage(err);
      errorCode = getErrorCode(err);
    }

    return {
      success: false,
      error: {
        message: errorMessage,
        code: errorCode,
        raw: normalizeError(err) as E,
      },
    };
  }
}

/**
 * Normalizes any error value to a proper Error instance
 *
 * @param error - Any error value (could be Error, string, number, etc.)
 * @returns A properly typed Error instance
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  // Check if the error is a ResultError object with a raw property that's an Error
  if (
    error &&
    typeof error === "object" &&
    "raw" in error &&
    error.raw instanceof Error
  ) {
    return error.raw;
  }

  return new Error(String(error));
}

/**
 * Gets a user-friendly message for an error.
 * Uses the error code message map for AppErrors, or the error message otherwise.
 *
 * @param error - Any error value
 * @param fallback - A fallback function to return an error message if the error is not an AppError
 * @returns A user-friendly error message
 */
export function getErrorMessage(
  error: unknown,
  fallback?: () => string
): string {
  const normalizedError = normalizeError(error);
  const isInProduction = isWindowDefined() && isProduction;

  try {
    logger.error("[ErrorHandler] error:", normalizedError);

    if (isInProduction && isWorkerErrorType(normalizedError)) {
      return errorMessageMap[ErrorCode.SYSTEM_ERROR];
    }

    if (normalizedError instanceof AppError) {
      return normalizedError.message || errorMessageMap[normalizedError.code];
    }

    return fallback ? fallback() : normalizedError.message;
  } catch {
    return errorMessageMap[ErrorCode.SYSTEM_ERROR];
  }
}

/**
 * Gets the error code for an error.
 * Returns UNKNOWN_ERROR for non-AppError instances.
 *
 * @param error - Any error value
 * @param fallback - A fallback function to return an error code if the error is not an AppError
 * @returns The error code
 */
export function getErrorCode(
  error: unknown,
  fallback?: () => ErrorCode
): ErrorCode {
  const normalizedError = normalizeError(error);
  const isInProduction = isWindowDefined() && isProduction;

  try {
    if (isInProduction && isWorkerErrorType(normalizedError)) {
      return ErrorCode.SYSTEM_ERROR;
    }

    if (normalizedError instanceof AppError) {
      return normalizedError.code;
    }

    return fallback ? fallback() : ErrorCode.UNKNOWN_ERROR;
  } catch {
    return ErrorCode.SYSTEM_ERROR;
  }
}

/**
 * Checks if an error is of a specific error type or any subclass of it
 */
export function isErrorType<T extends Error>(
  error: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ErrorType: new (...args: any[]) => T
): error is T {
  const normalizedError = normalizeError(error);
  return normalizedError instanceof ErrorType;
}

/**
 * Checks if an error is a worker-related error (any subclass of WorkerError)
 *
 * @param error - Any error value to check
 * @returns Boolean indicating whether the error is a worker error
 */
export function isWorkerErrorType(error: unknown): error is WorkerError {
  const normalizedError = normalizeError(error);
  return (
    normalizedError instanceof WorkerError ||
    normalizedError instanceof WorkerInitializationError ||
    normalizedError instanceof WorkerTimeoutError ||
    normalizedError instanceof WorkerCleanupError ||
    normalizedError instanceof WorkerCommunicationError ||
    normalizedError instanceof WorkerPoolError
  );
}

/**
 * Determines whether an operation should be retried based on the error type.
 *
 * @param error - The error that occurred during the operation
 * @returns Boolean indicating whether the operation should be retried
 */
export function shouldRetry(error: unknown): boolean {
  const typedError = normalizeError(error);

  // Don't retry if the operation was explicitly aborted
  if (typedError instanceof AbortError) {
    return false;
  }

  // Worker initialization errors might be recoverable
  if (typedError instanceof WorkerInitializationError) {
    // Only retry for non-critical initialization errors
    return (
      !typedError.message.includes("critical") &&
      !typedError.message.includes("missing module")
    );
  }

  // Worker timeout errors are good candidates for retry
  if (typedError instanceof WorkerTimeoutError) {
    return true;
  }

  // Communication errors might be temporary
  if (typedError instanceof WorkerCommunicationError) {
    return true;
  }

  // Worker cleanup errors shouldn't block retrying
  if (typedError instanceof WorkerCleanupError) {
    return true;
  }

  // For unknown error types, check common patterns in message
  const message = typedError.message.toLowerCase();

  // Network errors are typically retryable
  if (
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("timeout")
  ) {
    return true;
  }

  // Memory issues might be resolved after cleanup
  if (message.includes("memory") || message.includes("allocation")) {
    return true;
  }

  // Usually don't retry for worker pool errors (no workers available)
  if (typedError instanceof WorkerPoolError) {
    return false;
  }

  // By default, retry unknown errors
  return true;
}

export {
  AppError,
  SystemError,
  WorkerError,
  WorkerInitializationError,
  WorkerTimeoutError,
  WorkerCleanupError,
  WorkerCommunicationError,
  WorkerPoolError,
  AbortError,
};
