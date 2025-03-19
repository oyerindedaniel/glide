import { FILE_INPUT_TYPES } from "@/constants/processing";

export const MAX_FILENAME_LENGTH = 255; // Maximum safe filename length
export const FILENAME_SAFE_REGEX = /^[a-zA-Z0-9-_. ]+$/; // Only allow alphanumeric, dash, underscore, dot, and space

/**
 * Sanitizes a filename by removing unsafe characters and ensuring proper length
 */
export function sanitizeFileName(fileName: string): string {
  // Remove any path components
  const name = fileName.replace(/^.*[\\\/]/, "");

  // Get file extension
  const ext = name.split(".").pop() || "";
  const baseName = name.slice(
    0,
    name.length - (ext.length ? ext.length + 1 : 0)
  );

  // Sanitize base name
  const sanitizedBase = baseName
    .replace(/[^a-zA-Z0-9-_. ]/g, "_") // Replace unsafe chars with underscore
    .trim()
    .slice(0, MAX_FILENAME_LENGTH - (ext.length + 1)); // Ensure final length is within limits

  return ext ? `${sanitizedBase}.${ext}` : sanitizedBase;
}

/**
 * Determines if a file is an image based on its MIME type
 */
export function isImageFile(fileType: string): boolean {
  return fileType.startsWith(FILE_INPUT_TYPES.IMAGE);
}

/**
 * Determines if a file is a PDF based on its MIME type
 */
export function isPdfFile(fileType: string): boolean {
  return fileType === FILE_INPUT_TYPES.PDF;
}

/**
 * Gets the category of a file (image or pdf)
 */
export function getFileCategory(fileType: string): "image" | "pdf" | "other" {
  if (isImageFile(fileType)) return "image";
  if (isPdfFile(fileType)) return "pdf";
  return "other";
}

/**
 * Validates a file for size, name length, and file type
 */
export function validateFile(
  file: File,
  allowedTypes: string[]
): { isValid: boolean; error?: string } {
  // Check filename length
  if (file.name.length > MAX_FILENAME_LENGTH) {
    return { isValid: false, error: "File name is too long" };
  }

  // Check for safe characters in filename and identify invalid ones
  if (!FILENAME_SAFE_REGEX.test(file.name)) {
    const invalidChars =
      file.name.replace(/^.*[\\\/]/, "").match(/[^a-zA-Z0-9-_. ]/g) || [];

    const uniqueInvalidChars = [...new Set(invalidChars)].join(" ");

    return {
      isValid: false,
      error: `File name contains invalid characters: "${uniqueInvalidChars}". Only letters, numbers, spaces, dash (-), underscore (_), and period (.) are allowed.`,
    };
  }

  // Validate file type
  if (!allowedTypes.includes(file.type)) {
    return { isValid: false, error: "Invalid file type" };
  }

  return { isValid: true };
}

/**
 * Checks if a PDF file has proper header structure to detect corruption
 * Only reads the first few bytes for quick validation
 */
export async function validatePDFContent(
  file: File
): Promise<{ isValid: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Only check files that claim to be PDFs
    if (!isPdfFile(file.type)) {
      resolve({ isValid: true });
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = new Uint8Array(e.target?.result as ArrayBuffer);

        // Check for PDF header signature (%PDF-)
        // This is the minimal check for a valid PDF file
        if (
          content.length < 5 ||
          content[0] !== 0x25 || // %
          content[1] !== 0x50 || // P
          content[2] !== 0x44 || // D
          content[3] !== 0x46 || // F
          content[4] !== 0x2d
        ) {
          // -
          resolve({
            isValid: false,
            error:
              "The PDF file appears to be corrupted (invalid header signature)",
          });
        } else {
          resolve({ isValid: true });
        }
      } catch (err) {
        resolve({
          isValid: false,
          error: `Failed to read file content for validation: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        });
      }
    };

    reader.onerror = () => {
      resolve({
        isValid: false,
        error: "Failed to read file for corruption check",
      });
    };

    // Only read the first 1KB to check header
    reader.readAsArrayBuffer(file.slice(0, 1024));
  });
}

/**
 * Validates a file for size, name length, and file type
 * For PDFs, also checks for content validity
 */
export async function validateFileWithContent(
  file: File,
  allowedTypes: string[]
): Promise<{ isValid: boolean; error?: string }> {
  // Basic validation first (filename, type, etc)
  const basicValidation = validateFile(file, allowedTypes);

  if (!basicValidation.isValid) {
    return basicValidation;
  }

  // For PDFs, perform content validation
  if (isPdfFile(file.type)) {
    return await validatePDFContent(file);
  }

  return { isValid: true };
}

/**
 * Optimized batch validation for multiple files with content validation
 * Enhanced version that can perform content checks for corruption detection
 */
export async function validateFileBatchWithContent(
  files: File[],
  allowedTypes: string[],
  options?: {
    maxFilesInBatch?: number;
    totalBatchMaxSize?: number;
    singleFileMaxSize?: number;
    pdfMaxFilesInBatch?: number;
    pdfSingleFileMaxSize?: number;
    pdfBatchFileMaxSize?: number;
    imageMaxFilesInBatch?: number;
    imageSingleFileMaxSize?: number;
    fileTypeValidation?: boolean;
    checkForCorruption?: boolean;
  }
): Promise<{
  isValid: boolean;
  error?: string;
  sanitizedFiles?: File[];
  hasDuplicates?: boolean;
  hasProcessedFiles?: boolean;
  processedFileNames?: string[];
  fileCategory?: "image" | "pdf" | "mixed";
}> {
  // First perform the standard batch validation
  const basicValidation = validateFileBatch(files, allowedTypes, options);

  // If basic validation fails, return immediately
  if (!basicValidation.isValid) {
    return basicValidation;
  }

  // If content validation is enabled and we have PDFs, check each PDF file
  if (
    options?.checkForCorruption !== false &&
    basicValidation.sanitizedFiles &&
    basicValidation.fileCategory === "pdf"
  ) {
    // Check each PDF for corruption
    for (const file of basicValidation.sanitizedFiles) {
      const contentValidation = await validatePDFContent(file);
      if (!contentValidation.isValid) {
        return {
          isValid: false,
          error: `File "${file.name}": ${contentValidation.error}`,
          fileCategory: "pdf",
        };
      }
    }
  }

  // All validations passed
  return basicValidation;
}

/**
 * Optimized batch validation for multiple files
 * Validates all files in a single pass and checks for mixed file categories
 */
export function validateFileBatch(
  files: File[],
  allowedTypes: string[],
  options?: {
    maxFilesInBatch?: number;
    totalBatchMaxSize?: number; // in bytes
    singleFileMaxSize?: number; // in bytes
    pdfMaxFilesInBatch?: number;
    pdfSingleFileMaxSize?: number;
    pdfBatchFileMaxSize?: number;
    imageMaxFilesInBatch?: number;
    imageSingleFileMaxSize?: number;
    fileTypeValidation?: boolean; // whether to enforce PDF/image type separation
  }
): {
  isValid: boolean;
  error?: string;
  sanitizedFiles?: File[];
  hasDuplicates?: boolean;
  hasProcessedFiles?: boolean;
  processedFileNames?: string[];
  fileCategory?: "image" | "pdf" | "mixed";
} {
  if (files.length === 0) {
    return { isValid: false, error: "No files provided" };
  }

  // PDF constants
  const PDF_LIMITS = {
    MAX_FILES_IN_BATCH: 10,
    SINGLE_FILE_MAX_SIZE: 100 * 1024 * 1024, // 100MB
    BATCH_FILE_MAX_SIZE: 50 * 1024 * 1024, // 50MB
    TOTAL_BATCH_MAX_SIZE: 500 * 1024 * 1024, // 500MB
  };

  // Image constants
  const IMAGE_LIMITS = {
    MAX_FILES_IN_BATCH: 100,
    SINGLE_FILE_MAX_SIZE: 8 * 1024 * 1024, // 8MB
    TOTAL_BATCH_MAX_SIZE: 500 * 1024 * 1024, // 500MB
  };

  // Detect file category first to apply appropriate limits
  let hasImages = false;
  let hasPdfs = false;

  for (const file of files) {
    if (isImageFile(file.type)) {
      hasImages = true;
    } else if (isPdfFile(file.type)) {
      hasPdfs = true;
    }

    // If we find both types and mixing is not allowed, fail early
    if (hasImages && hasPdfs && options?.fileTypeValidation !== false) {
      return {
        isValid: false,
        error: "Cannot mix image and PDF files in the same upload",
        fileCategory: "mixed",
      };
    }
  }

  // Determine file category for limit selection
  const fileCategory = hasImages ? "image" : hasPdfs ? "pdf" : "other";

  const {
    maxFilesInBatch = fileCategory === "pdf"
      ? options?.pdfMaxFilesInBatch || PDF_LIMITS.MAX_FILES_IN_BATCH
      : options?.imageMaxFilesInBatch || IMAGE_LIMITS.MAX_FILES_IN_BATCH,
    totalBatchMaxSize = fileCategory === "pdf"
      ? PDF_LIMITS.TOTAL_BATCH_MAX_SIZE
      : IMAGE_LIMITS.TOTAL_BATCH_MAX_SIZE,
    singleFileMaxSize = fileCategory === "pdf"
      ? options?.pdfSingleFileMaxSize ||
        (files.length > 1
          ? options?.pdfBatchFileMaxSize || PDF_LIMITS.BATCH_FILE_MAX_SIZE
          : PDF_LIMITS.SINGLE_FILE_MAX_SIZE)
      : options?.imageSingleFileMaxSize || IMAGE_LIMITS.SINGLE_FILE_MAX_SIZE,
  } = options || {};

  // Check if we're exceeding the max number of files
  if (files.length > maxFilesInBatch) {
    return {
      isValid: false,
      error: `Maximum of ${maxFilesInBatch} ${fileCategory} files allowed per batch`,
    };
  }

  // Check total batch size
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > totalBatchMaxSize) {
    return {
      isValid: false,
      error: `Total batch size exceeds ${Math.round(
        totalBatchMaxSize / (1024 * 1024)
      )}MB limit`,
    };
  }

  const sanitizedFiles: File[] = [];
  const fileNames = new Set<string>();
  const processedFileNames: string[] = [];

  // Single pass through all files
  for (const file of files) {
    // 1. Check individual file validity
    const validation = validateFile(file, allowedTypes);
    if (!validation.isValid) {
      return { isValid: false, error: `${file.name}: ${validation.error}` };
    }

    // 2. Check individual file size
    if (file.size > singleFileMaxSize) {
      return {
        isValid: false,
        error: `File "${file.name}" exceeds ${Math.round(
          singleFileMaxSize / (1024 * 1024)
        )}MB limit${
          fileCategory === "pdf" && files.length > 1
            ? " for batch processing"
            : ""
        }`,
      };
    }

    // 3. Sanitize filename
    const sanitizedName = sanitizeFileName(file.name);
    const sanitizedFile = new File([file], sanitizedName, { type: file.type });

    // 4. Check for duplicates
    if (fileNames.has(sanitizedName)) {
      return {
        isValid: false,
        error: `Duplicate file name: ${sanitizedName}`,
        hasDuplicates: true,
      };
    }
    fileNames.add(sanitizedName);

    sanitizedFiles.push(sanitizedFile);
  }

  return {
    isValid: true,
    sanitizedFiles,
    fileCategory: fileCategory as "image" | "pdf",
    processedFileNames,
  };
}
