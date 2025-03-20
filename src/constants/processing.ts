import {
  DEFAULT_PDF_QUALITY,
  DEFAULT_PDF_SCALE,
  MAX_PDF_DIMENSION,
} from "@/config/app";
import { PageProcessingConfig } from "@/types/processor";

const FILE_PROCESSING_EVENTS = Object.freeze({
  FILE_ADD: "fileAdd",
  PAGE_PROCESSED: "pageProcessed",
  //   FILE_PROCESSING: "fileProcessing",
  //   FILE_COMPLETED: "fileCompleted",
  FILE_STATUS: "fileStatus",
  //   FILE_FAILED: "fileFailed",
  TOTAL_PAGES_UPDATE: "totalPagesUpdate",
} as const);

const FILE_INPUT_TYPES = {
  IMAGE: "image/",
  JPEG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp",
  AUDIO: "audio/*",
  VIDEO: "video/*",
  PDF: "application/pdf",
  TEXT: "text/plain",
  CSV: "text/csv",
  JSON: "application/json",
  WORD: "application/msword",
  WORD_X:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  EXCEL: "application/vnd.ms-excel",
  EXCEL_X: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  POWERPOINT: "application/vnd.ms-powerpoint",
  POWERPOINT_X:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ZIP: "application/zip",
  RAR: "application/vnd.rar",
  GZIP: "application/gzip",
  XML: "application/xml",
  HTML: "text/html",
  MARKDOWN: "text/markdown",
  SVG: "image/svg+xml",
  ANY: "*/*",
} as const;

export type FileInputType =
  (typeof FILE_INPUT_TYPES)[keyof typeof FILE_INPUT_TYPES];

const DEFAULT_PAGE_PROCESSING_CONFIG: PageProcessingConfig = {
  scale: DEFAULT_PDF_SCALE,
  maxDimension: MAX_PDF_DIMENSION,
  quality: DEFAULT_PDF_QUALITY,
};

export {
  FILE_PROCESSING_EVENTS,
  DEFAULT_PAGE_PROCESSING_CONFIG,
  FILE_INPUT_TYPES,
};
