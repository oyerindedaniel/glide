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
