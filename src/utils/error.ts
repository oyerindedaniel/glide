/**
 * Known error codes for better error classification.
 */
enum ErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INVALID_INPUT = "INVALID_INPUT",
  AUTH_FAILED = "AUTH_FAILED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
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
  [ErrorCode.UNKNOWN_ERROR]:
    "An unexpected error occurred. Please try again later.",
};

export class AppError extends Error {
  public code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN_ERROR) {
    super(message);
    this.code = code;
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
