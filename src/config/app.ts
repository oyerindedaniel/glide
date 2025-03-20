const SCALE_CACHE_SIZE = process.env.SCALE_CACHE_SIZE
  ? parseInt(process.env.SCALE_CACHE_SIZE)
  : 1000; // Max entries per client in PDF library worker scale cache

const isProduction = process.env.NODE_ENV === "production";

// PDF Worker Pool Configuration
const MAX_WORKERS = process.env.MAX_PDF_WORKERS
  ? parseInt(process.env.MAX_PDF_WORKERS)
  : 3;

const COORDINATOR_COUNT = process.env.PDF_COORDINATOR_COUNT
  ? parseInt(process.env.PDF_COORDINATOR_COUNT)
  : 2;

// PDF Processing Configuration
const DEFAULT_PDF_QUALITY = process.env.DEFAULT_PDF_QUALITY
  ? parseFloat(process.env.DEFAULT_PDF_QUALITY)
  : 0.8;

const DEFAULT_PDF_SCALE = process.env.DEFAULT_PDF_SCALE
  ? parseFloat(process.env.DEFAULT_PDF_SCALE)
  : 1.0;

const MAX_PDF_DIMENSION = process.env.MAX_PDF_DIMENSION
  ? parseInt(process.env.MAX_PDF_DIMENSION)
  : 2000;

// Recovery System Configuration
const MAX_RECOVERY_ATTEMPTS = process.env.MAX_RECOVERY_ATTEMPTS
  ? parseInt(process.env.MAX_RECOVERY_ATTEMPTS)
  : 3;

// Timeout in milliseconds for orphaned results
const ORPHANED_RESULT_EXPIRATION = process.env.ORPHANED_RESULT_EXPIRATION
  ? parseInt(process.env.ORPHANED_RESULT_EXPIRATION)
  : 30 * 60 * 1000; // Default: 30 minutes

// PDF Processor Configuration
const PDF_CACHE_MAX_AGE = process.env.PDF_CACHE_MAX_AGE
  ? parseInt(process.env.PDF_CACHE_MAX_AGE)
  : 10 * 60 * 1000; // Default: 10 minutes

const PDF_CACHE_CLEANUP_INTERVAL = process.env.PDF_CACHE_CLEANUP_INTERVAL
  ? parseInt(process.env.PDF_CACHE_CLEANUP_INTERVAL)
  : 60 * 1000; // Default: 1 minute

const DEFAULT_MAX_CONCURRENT_FILES = process.env.DEFAULT_MAX_CONCURRENT_FILES
  ? parseInt(process.env.DEFAULT_MAX_CONCURRENT_FILES)
  : 3;

// Default page processing slots
const DEFAULT_PAGE_PROCESSING_SLOTS = process.env.DEFAULT_PAGE_PROCESSING_SLOTS
  ? parseInt(process.env.DEFAULT_PAGE_PROCESSING_SLOTS)
  : 2;

// PDF processing quality configurations
const PDF_CONFIG_SMALL = {
  scale: process.env.PDF_CONFIG_SMALL_SCALE
    ? parseFloat(process.env.PDF_CONFIG_SMALL_SCALE)
    : 2.0,
  quality: process.env.PDF_CONFIG_SMALL_QUALITY
    ? parseFloat(process.env.PDF_CONFIG_SMALL_QUALITY)
    : 0.85,
  maxDimension: process.env.PDF_CONFIG_SMALL_MAX_DIMENSION
    ? parseInt(process.env.PDF_CONFIG_SMALL_MAX_DIMENSION)
    : 2500,
};

const PDF_CONFIG_MEDIUM = {
  scale: process.env.PDF_CONFIG_MEDIUM_SCALE
    ? parseFloat(process.env.PDF_CONFIG_MEDIUM_SCALE)
    : 1.5,
  quality: process.env.PDF_CONFIG_MEDIUM_QUALITY
    ? parseFloat(process.env.PDF_CONFIG_MEDIUM_QUALITY)
    : 0.8,
  maxDimension: process.env.PDF_CONFIG_MEDIUM_MAX_DIMENSION
    ? parseInt(process.env.PDF_CONFIG_MEDIUM_MAX_DIMENSION)
    : 2000,
};

const PDF_CONFIG_LARGE = {
  scale: process.env.PDF_CONFIG_LARGE_SCALE
    ? parseFloat(process.env.PDF_CONFIG_LARGE_SCALE)
    : 1.2,
  quality: process.env.PDF_CONFIG_LARGE_QUALITY
    ? parseFloat(process.env.PDF_CONFIG_LARGE_QUALITY)
    : 0.75,
  maxDimension: process.env.PDF_CONFIG_LARGE_MAX_DIMENSION
    ? parseInt(process.env.PDF_CONFIG_LARGE_MAX_DIMENSION)
    : 1600,
};

// Retry configuration
const MAX_PAGE_RETRIES = process.env.MAX_PAGE_RETRIES
  ? parseInt(process.env.MAX_PAGE_RETRIES)
  : 3;

const BASE_DELAY_MS = process.env.BASE_DELAY_MS
  ? parseInt(process.env.BASE_DELAY_MS)
  : 1000;

export {
  SCALE_CACHE_SIZE,
  isProduction,
  MAX_WORKERS,
  COORDINATOR_COUNT,
  DEFAULT_PDF_QUALITY,
  DEFAULT_PDF_SCALE,
  MAX_PDF_DIMENSION,
  MAX_RECOVERY_ATTEMPTS,
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
};
