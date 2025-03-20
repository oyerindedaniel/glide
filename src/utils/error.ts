/**
 * Known error codes for better error classification.
 */
export enum ErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INVALID_INPUT = "INVALID_INPUT",
  AUTH_FAILED = "AUTH_FAILED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  // Worker-specific error codes
  WORKER_INIT_ERROR = "WORKER_INIT_ERROR",
  WORKER_TIMEOUT = "WORKER_TIMEOUT",
  WORKER_CLEANUP_ERROR = "WORKER_CLEANUP_ERROR",
  WORKER_COMMUNICATION_ERROR = "WORKER_COMMUNICATION_ERROR",
  WORKER_POOL_ERROR = "WORKER_POOL_ERROR",
  ABORT_ERROR = "ABORT_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * A mapping of error codes to user-friendly descriptions.
 */
const errorMessageMap: Record<ErrorCode, string> = {
  [ErrorCode.NETWORK_ERROR]:
    "Unable to connect to the server. Please check your internet connection and try again.",
  [ErrorCode.DATABASE_ERROR]:
    "There was a problem accessing the database. Please try again later.",
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
  [ErrorCode.UNKNOWN_ERROR]:
    "An unexpected error occurred. Please try again later.",
};

/**
 * Base error class for application-specific errors
 */
export class AppError extends Error {
  public code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN_ERROR) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base error class for worker-specific errors
 */
export class WorkerError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCode.WORKER_INIT_ERROR) {
    super(message, code);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker initialization failures
 */
export class WorkerInitializationError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_INIT_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker timeout failures
 */
export class WorkerTimeoutError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_TIMEOUT);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker cleanup failures
 */
export class WorkerCleanupError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_CLEANUP_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker communication failures
 */
export class WorkerCommunicationError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_COMMUNICATION_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for worker pool failures
 */
export class WorkerPoolError extends WorkerError {
  constructor(message: string) {
    super(message, ErrorCode.WORKER_POOL_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Specific error for operation abortion
 */
export class AbortError extends AppError {
  constructor(message: string = "Operation aborted") {
    super(message, ErrorCode.ABORT_ERROR);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type Result<T> = { data?: T; error?: { message: string; raw: unknown } };

/**
 * Executes an asynchronous operation and returns a standardized result object.
 *
 * @template T - The type of the expected successful result.
 * @param {Promise<T>} operation - The asynchronous operation to execute.
 * @returns {Promise<Result<T>>} A promise resolving to a `Result` object containing either the data or an error.
 */
export async function tryCatch<T>(operation: Promise<T>): Promise<Result<T>> {
  try {
    const data = await operation;
    return { data };
  } catch (err) {
    let errorMessage = "An unexpected error occurred.";
    let errorCode = ErrorCode.UNKNOWN_ERROR;

    if (err instanceof AppError) {
      errorMessage = errorMessageMap[err.code] || errorMessage;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      errorCode = err.code;
    } else if (err instanceof Error) {
      errorMessage = err.message;
    }

    return {
      error: {
        message: errorMessage,
        raw: err,
      },
    };
  }
}
