import { toBytes } from "@/utils/app";

const SCALE_CACHE_SIZE = process.env.NEXT_PUBLIC_SCALE_CACHE_SIZE
  ? parseInt(process.env.NEXT_PUBLIC_SCALE_CACHE_SIZE)
  : 1000; // Max entries per client in PDF library worker scale cache

const isProduction = process.env.NODE_ENV === "production";

// PDF Worker Pool Configuration
const MAX_WORKERS = process.env.NEXT_PUBLIC_MAX_PDF_WORKERS
  ? parseInt(process.env.NEXT_PUBLIC_MAX_PDF_WORKERS)
  : 3;

const COORDINATOR_COUNT = process.env.NEXT_PUBLIC_PDF_COORDINATOR_COUNT
  ? parseInt(process.env.NEXT_PUBLIC_PDF_COORDINATOR_COUNT)
  : 2;

// PDF Processing Configuration
const DEFAULT_PDF_QUALITY = process.env.NEXT_PUBLIC_DEFAULT_PDF_QUALITY
  ? parseFloat(process.env.NEXT_PUBLIC_DEFAULT_PDF_QUALITY)
  : 0.8;

const DEFAULT_PDF_SCALE = process.env.NEXT_PUBLIC_DEFAULT_PDF_SCALE
  ? parseFloat(process.env.NEXT_PUBLIC_DEFAULT_PDF_SCALE)
  : 1.0;

const MAX_PDF_DIMENSION = process.env.NEXT_PUBLIC_MAX_PDF_DIMENSION
  ? parseInt(process.env.NEXT_PUBLIC_MAX_PDF_DIMENSION)
  : 2000;

// Timeout in milliseconds for orphaned results
const ORPHANED_RESULT_EXPIRATION = process.env
  .NEXT_PUBLIC_ORPHANED_RESULT_EXPIRATION
  ? parseInt(process.env.NEXT_PUBLIC_ORPHANED_RESULT_EXPIRATION)
  : 30 * 60 * 1000; // Default: 30 minutes

// PDF Processor Configuration
const PDF_CACHE_MAX_AGE = process.env.NEXT_PUBLIC_PDF_CACHE_MAX_AGE
  ? parseInt(process.env.NEXT_PUBLIC_PDF_CACHE_MAX_AGE)
  : 10 * 60 * 1000; // Default: 10 minutes

const PDF_CACHE_CLEANUP_INTERVAL = process.env
  .NEXT_PUBLIC_PDF_CACHE_CLEANUP_INTERVAL
  ? parseInt(process.env.NEXT_PUBLIC_PDF_CACHE_CLEANUP_INTERVAL)
  : 60 * 1000; // Default: 1 minute

const DEFAULT_MAX_CONCURRENT_FILES = process.env
  .NEXT_PUBLIC_DEFAULT_MAX_CONCURRENT_FILES
  ? parseInt(process.env.NEXT_PUBLIC_DEFAULT_MAX_CONCURRENT_FILES)
  : 3;

// Default page processing slots
const DEFAULT_PAGE_PROCESSING_SLOTS = process.env
  .NEXT_PUBLIC_DEFAULT_PAGE_PROCESSING_SLOTS
  ? parseInt(process.env.NEXT_PUBLIC_DEFAULT_PAGE_PROCESSING_SLOTS)
  : 2;

// PDF processing quality configurations
const PDF_CONFIG_SMALL = {
  scale: process.env.NEXT_PUBLIC_PDF_CONFIG_SMALL_SCALE
    ? parseFloat(process.env.NEXT_PUBLIC_PDF_CONFIG_SMALL_SCALE)
    : 2.0,
  quality: process.env.NEXT_PUBLIC_PDF_CONFIG_SMALL_QUALITY
    ? parseFloat(process.env.NEXT_PUBLIC_PDF_CONFIG_SMALL_QUALITY)
    : 0.85,
  maxDimension: process.env.NEXT_PUBLIC_PDF_CONFIG_SMALL_MAX_DIMENSION
    ? parseInt(process.env.NEXT_PUBLIC_PDF_CONFIG_SMALL_MAX_DIMENSION)
    : 2500,
};

const PDF_CONFIG_MEDIUM = {
  scale: process.env.NEXT_PUBLIC_PDF_CONFIG_MEDIUM_SCALE
    ? parseFloat(process.env.NEXT_PUBLIC_PDF_CONFIG_MEDIUM_SCALE)
    : 1.5,
  quality: process.env.NEXT_PUBLIC_PDF_CONFIG_MEDIUM_QUALITY
    ? parseFloat(process.env.NEXT_PUBLIC_PDF_CONFIG_MEDIUM_QUALITY)
    : 0.8,
  maxDimension: process.env.NEXT_PUBLIC_PDF_CONFIG_MEDIUM_MAX_DIMENSION
    ? parseInt(process.env.NEXT_PUBLIC_PDF_CONFIG_MEDIUM_MAX_DIMENSION)
    : 2000,
};

const PDF_CONFIG_LARGE = {
  scale: process.env.NEXT_PUBLIC_PDF_CONFIG_LARGE_SCALE
    ? parseFloat(process.env.NEXT_PUBLIC_PDF_CONFIG_LARGE_SCALE)
    : 1.2,
  quality: process.env.NEXT_PUBLIC_PDF_CONFIG_LARGE_QUALITY
    ? parseFloat(process.env.NEXT_PUBLIC_PDF_CONFIG_LARGE_QUALITY)
    : 0.75,
  maxDimension: process.env.NEXT_PUBLIC_PDF_CONFIG_LARGE_MAX_DIMENSION
    ? parseInt(process.env.NEXT_PUBLIC_PDF_CONFIG_LARGE_MAX_DIMENSION)
    : 1600,
};

// Retry configuration
const MAX_PAGE_RETRIES = process.env.NEXT_PUBLIC_MAX_PAGE_RETRIES
  ? parseInt(process.env.NEXT_PUBLIC_MAX_PAGE_RETRIES)
  : 3;

const BASE_DELAY_MS = process.env.NEXT_PUBLIC_BASE_DELAY_MS
  ? parseInt(process.env.NEXT_PUBLIC_BASE_DELAY_MS)
  : 1000;

// PDF Timeout and Heartbeat Configuration
const PDF_MAX_TIMEOUT = process.env.NEXT_PUBLIC_PDF_MAX_TIMEOUT
  ? parseInt(process.env.NEXT_PUBLIC_PDF_MAX_TIMEOUT)
  : 300000; // 5 minutes absolute maximum

const PDF_HEARTBEAT_INTERVAL = process.env.NEXT_PUBLIC_PDF_HEARTBEAT_INTERVAL
  ? parseInt(process.env.NEXT_PUBLIC_PDF_HEARTBEAT_INTERVAL)
  : 5000; // 5 seconds between checks

const PDF_INACTIVITY_WARNING_THRESHOLD = process.env
  .NEXT_PUBLIC_PDF_INACTIVITY_WARNING_THRESHOLD
  ? parseInt(process.env.NEXT_PUBLIC_PDF_INACTIVITY_WARNING_THRESHOLD)
  : PDF_HEARTBEAT_INTERVAL * 2; // Default: 10s warning

const PDF_INACTIVITY_ERROR_THRESHOLD = process.env
  .NEXT_PUBLIC_PDF_INACTIVITY_ERROR_THRESHOLD
  ? parseInt(process.env.NEXT_PUBLIC_PDF_INACTIVITY_ERROR_THRESHOLD)
  : PDF_HEARTBEAT_INTERVAL * 6; // Default: 30s timeout

// File Validation Configuration
const MAX_FILENAME_LENGTH = process.env.NEXT_PUBLIC_MAX_FILENAME_LENGTH
  ? parseInt(process.env.NEXT_PUBLIC_MAX_FILENAME_LENGTH)
  : 255; // Maximum safe filename length

// PDF file validation limits
const PDF_MAX_FILES_IN_BATCH = process.env.NEXT_PUBLIC_PDF_MAX_FILES_IN_BATCH
  ? parseInt(process.env.NEXT_PUBLIC_PDF_MAX_FILES_IN_BATCH)
  : 10;

const PDF_SINGLE_FILE_MAX_SIZE = process.env
  .NEXT_PUBLIC_PDF_SINGLE_FILE_MAX_SIZE
  ? toBytes(parseInt(process.env.NEXT_PUBLIC_PDF_SINGLE_FILE_MAX_SIZE), "MB")
  : toBytes(100, "MB"); // 100MB

const PDF_BATCH_FILE_MAX_SIZE = process.env.NEXT_PUBLIC_PDF_BATCH_FILE_MAX_SIZE
  ? toBytes(parseInt(process.env.NEXT_PUBLIC_PDF_BATCH_FILE_MAX_SIZE), "MB")
  : toBytes(50, "MB"); // 50MB

const PDF_TOTAL_BATCH_MAX_SIZE = process.env
  .NEXT_PUBLIC_PDF_TOTAL_BATCH_MAX_SIZE
  ? toBytes(parseInt(process.env.NEXT_PUBLIC_PDF_TOTAL_BATCH_MAX_SIZE), "MB")
  : toBytes(500, "MB"); // 500MB

// Image file validation limits
const IMAGE_MAX_FILES_IN_BATCH = process.env
  .NEXT_PUBLIC_IMAGE_MAX_FILES_IN_BATCH
  ? parseInt(process.env.NEXT_PUBLIC_IMAGE_MAX_FILES_IN_BATCH)
  : 100;

const IMAGE_SINGLE_FILE_MAX_SIZE = process.env
  .NEXT_PUBLIC_IMAGE_SINGLE_FILE_MAX_SIZE
  ? toBytes(parseInt(process.env.NEXT_PUBLIC_IMAGE_SINGLE_FILE_MAX_SIZE), "MB")
  : toBytes(8, "MB"); // 8MB

const IMAGE_TOTAL_BATCH_MAX_SIZE = process.env
  .NEXT_PUBLIC_IMAGE_TOTAL_BATCH_MAX_SIZE
  ? toBytes(parseInt(process.env.NEXT_PUBLIC_IMAGE_TOTAL_BATCH_MAX_SIZE), "MB")
  : toBytes(500, "MB"); // 500MB

export {
  SCALE_CACHE_SIZE,
  isProduction,
  MAX_WORKERS,
  COORDINATOR_COUNT,
  DEFAULT_PDF_QUALITY,
  DEFAULT_PDF_SCALE,
  MAX_PDF_DIMENSION,
  ORPHANED_RESULT_EXPIRATION,
  PDF_CACHE_MAX_AGE,
  PDF_CACHE_CLEANUP_INTERVAL,
  DEFAULT_MAX_CONCURRENT_FILES,
  DEFAULT_PAGE_PROCESSING_SLOTS,
  PDF_CONFIG_SMALL,
  PDF_CONFIG_MEDIUM,
  PDF_CONFIG_LARGE,
  MAX_PAGE_RETRIES,
  BASE_DELAY_MS,
  PDF_MAX_TIMEOUT,
  PDF_HEARTBEAT_INTERVAL,
  PDF_INACTIVITY_WARNING_THRESHOLD,
  PDF_INACTIVITY_ERROR_THRESHOLD,

  // File validation exports
  MAX_FILENAME_LENGTH,
  PDF_MAX_FILES_IN_BATCH,
  PDF_SINGLE_FILE_MAX_SIZE,
  PDF_BATCH_FILE_MAX_SIZE,
  PDF_TOTAL_BATCH_MAX_SIZE,
  IMAGE_MAX_FILES_IN_BATCH,
  IMAGE_SINGLE_FILE_MAX_SIZE,
  IMAGE_TOTAL_BATCH_MAX_SIZE,
};
