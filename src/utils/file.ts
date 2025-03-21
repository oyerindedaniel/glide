/**
 * Converts a file size from bytes to a human-readable format (KB, MB, GB, or TB).
 *
 * @param {number} bytes - The file size in bytes.
 * @returns {string} - The formatted file size with the appropriate unit.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const value = bytes / Math.pow(k, i);
  const isWholeNumber = value % 1 === 0;

  return (isWholeNumber ? value : value.toFixed(1)) + " " + sizes[i];
}

/**
 * File size units in bytes
 */
export const FILE_SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
} as const;

export type FileSizeUnit = keyof typeof FILE_SIZE_UNITS;

/**
 * Converts a file size from one unit to another
 *
 * @param value - The value to convert
 * @param fromUnit - The source unit (B, KB, MB, GB, TB)
 * @param toUnit - The target unit (B, KB, MB, GB, TB)
 * @returns The converted value
 *
 * @example
 * // Convert 5MB to bytes
 * convertFileSize(5, 'MB', 'B'); // Returns 5242880
 *
 * @example
 * // Convert 5242880 bytes to MB
 * convertFileSize(5242880, 'B', 'MB'); // Returns 5
 */
export function convertFileSize(
  value: number,
  fromUnit: FileSizeUnit,
  toUnit: FileSizeUnit
): number {
  const bytesValue = value * FILE_SIZE_UNITS[fromUnit];
  return bytesValue / FILE_SIZE_UNITS[toUnit];
}

/**
 * Converts a value from a specified unit to bytes
 *
 * @param value - The value to convert to bytes
 * @param unit - The source unit (B, KB, MB, GB, TB)
 * @returns The value in bytes
 *
 * @example
 * // Convert 5MB to bytes
 * toBytes(5, 'MB'); // Returns 5242880
 */
export function toBytes(value: number, unit: FileSizeUnit = "B"): number {
  return convertFileSize(value, unit, "B");
}

/**
 * Converts bytes to the specified unit
 *
 * @param bytes - The bytes value to convert
 * @param unit - The target unit (B, KB, MB, GB, TB)
 * @returns The converted value in the specified unit
 *
 * @example
 * // Convert 5242880 bytes to MB
 * fromBytes(5242880, 'MB'); // Returns 5
 */
export function fromBytes(bytes: number, unit: FileSizeUnit = "MB"): number {
  return convertFileSize(bytes, "B", unit);
}

/**
 * Checks if a URL is a blob URL
 * @param url - The URL to check
 * @returns boolean indicating if the URL is a blob URL
 */
export function isBlobUrl(url?: string): boolean {
  return Boolean(url?.startsWith("blob:"));
}

/**
 * Safely revokes a blob URL if it exists
 * @param url - The blob URL to revoke
 */
export function revokeBlobUrl(url?: string): void {
  if (isBlobUrl(url)) {
    URL.revokeObjectURL(url!);
  }
}

/**
 * Safely revokes multiple blob URLs
 * @param urls - Array of URLs to check and revoke
 */
export function revokeBlobUrls(urls: (string | undefined)[]): void {
  urls.forEach(revokeBlobUrl);
}
