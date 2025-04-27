import {
  AppError,
  ErrorCode,
  errorMessageMap,
  getErrorCode,
  getErrorMessage,
  normalizeError,
} from "@/utils/error";

/**
 * PDF processing specific error record type
 */
export interface ErrorRecord {
  fileName: string;
  reason: string;
  code: ErrorCode;
  pageNumber?: number;
}

/**
 * Specialized error class for batch PDF processing failures
 */
export class BatchProcessingError extends AppError {
  public failedFiles: ErrorRecord[];

  constructor(message: string, failedFiles: ErrorRecord[]) {
    super(message, ErrorCode.PDF_BATCH_FAILURE);
    this.failedFiles = failedFiles;
    Object.setPrototypeOf(this, BatchProcessingError.prototype);
  }

  /**
   * Factory method for creating from a single error
   */
  static fromError(fileName: string, error: unknown): BatchProcessingError {
    const errorRecord = BatchProcessingError.createErrorRecord(fileName, error);
    return new BatchProcessingError(
      `Failed to process ${fileName}: ${errorRecord.reason}`,
      [errorRecord]
    );
  }

  /**
   * Factory method for creating from multiple errors
   */
  static fromErrors(errors: ErrorRecord[]): BatchProcessingError {
    return new BatchProcessingError(
      BatchProcessingError.summarize(errors),
      errors
    );
  }

  /**
   * Create a standardized error record from any error
   */
  static createErrorRecord(
    fileName: string,
    error: unknown,
    pageNumber?: number
  ): ErrorRecord {
    const code = determinePDFErrorCode(error);

    const reason = getErrorMessage(error, () => errorMessageMap[code]);

    return { fileName, reason, code, pageNumber };
  }

  /**
   * Generate a human-readable summary from multiple error records
   */
  static summarize(errors: ErrorRecord[]): string {
    if (errors.length === 0) return "Unknown processing error";
    if (errors.length === 1)
      return `Failed to process ${errors[0].fileName}: ${errors[0].reason}`;

    return `Failed to process ${errors.length} file(s). Check the upload panel for more details.`;
  }
}

/**
 * PDF specific error with additional page information
 */
class PDFError extends AppError {
  public pageNumber?: number;
  public fileName?: string;
  public failedPages?: Map<number, string>;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.PDF_PROCESSING_FAILED,
    options?: {
      pageNumber?: number;
      fileName?: string;
      failedPages?: Map<number, string>;
    }
  ) {
    super(message, code);
    this.pageNumber = options?.pageNumber;
    this.fileName = options?.fileName;
    this.failedPages = options?.failedPages;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error for when some PDF pages failed to process
 */
class PDFSomePagesFailedError extends PDFError {
  constructor(
    message: string,
    options?: {
      pageNumber?: number;
      fileName?: string;
      failedPages?: Map<number, string>;
    }
  ) {
    super(message, ErrorCode.PDF_SOME_PAGES_FAILED, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error for when all PDF pages failed to process
 */
class PDFAllPagesFailedError extends PDFError {
  constructor(
    message: string,
    options?: {
      fileName?: string;
      failedPages?: Map<number, string>;
    }
  ) {
    super(message, ErrorCode.PDF_ALL_PAGES_FAILED, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Determines the most appropriate error code based on an error message or error object
 * Centralizes PDF error detection logic for consistent categorization
 *
 * @param errorInput - Either an error object or error message string
 * @returns The most specific matching error code
 */
function determinePDFErrorCode(error: unknown): ErrorCode {
  const normalizedError = normalizeError(error);
  const message = normalizedError.message.toLowerCase();

  const errorCode = getErrorCode(error, () => {
    // Pattern matching in order of specificity

    // Authentication / permissions
    if (message.includes("password")) {
      return ErrorCode.PDF_PASSWORD_PROTECTED;
    }
    if (message.includes("permission") || message.includes("access denied")) {
      return ErrorCode.PERMISSION_DENIED;
    }

    // File integrity issues
    if (message.includes("corrupt") || message.includes("malformed")) {
      return ErrorCode.PDF_CORRUPTED;
    }
    if (
      message.includes("invalid format") ||
      message.includes("not a valid pdf")
    ) {
      return ErrorCode.PDF_FORMAT_ERROR;
    }
    if (message.includes("unsupported")) {
      return ErrorCode.PDF_FORMAT_ERROR;
    }

    // Resource issues
    if (message.includes("memory") || message.includes("allocation")) {
      return ErrorCode.PDF_MEMORY_ERROR;
    }

    // Timing issues
    if (message.includes("timeout") || message.includes("timed out")) {
      return ErrorCode.TIMEOUT_ERROR;
    }

    // Connectivity issues
    if (message.includes("network") || message.includes("connection")) {
      return ErrorCode.NETWORK_ERROR;
    }

    // Rendering issues
    if (message.includes("render")) {
      return ErrorCode.PDF_PAGE_RENDER_ERROR;
    }

    // Default fallback
    return ErrorCode.PDF_PROCESSING_FAILED;
  });

  return errorCode;
}

/**
 * Create appropriate PDF error from failed pages
 */
function createPDFErrorFromFailedPages(
  fileName: string,
  totalPages: number,
  failedPages: Map<number, string>
): PDFError {
  if (failedPages.size === 0) {
    return new PDFError(
      "No errors were reported but operation failed",
      ErrorCode.PDF_PROCESSING_FAILED,
      {
        fileName,
      }
    );
  }

  if (failedPages.size === totalPages) {
    return new PDFAllPagesFailedError(
      `All ${totalPages} pages failed to process in file ${fileName}`,
      {
        fileName,
        failedPages,
      }
    );
  }

  return new PDFSomePagesFailedError(
    `${failedPages.size} out of ${totalPages} pages failed to process in file ${fileName}`,
    {
      fileName,
      failedPages,
    }
  );
}

export {
  PDFError,
  PDFAllPagesFailedError,
  PDFSomePagesFailedError,
  createPDFErrorFromFailedPages,
  determinePDFErrorCode,
};
