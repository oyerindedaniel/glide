import {
  DEFAULT_PDF_QUALITY,
  DEFAULT_PDF_SCALE,
  MAX_PDF_DIMENSION,
} from "@/config/app";
import { PageProcessingConfig } from "@/types/processor";

export const FILE_INPUT_TYPES = {
  PDF: "application/pdf",
  IMAGE: "image",
};

// File processing events to use with the fileProcessingEmitter
export const FILE_PROCESSING_EVENTS = {
  FILE_ADD: "FILE_ADD",
  FILE_STATUS: "FILE_STATUS",
  PAGE_PROCESSED: "PAGE_PROCESSED",
  PROCESSING_PROGRESS: "PROCESSING_PROGRESS",
  PROCESSING_COMPLETE: "PROCESSING_COMPLETE",
} as const;

const FILE_INPUT_TYPES_FULL = {
  IMAGE: "image/",
  JPEG: "image/jpeg",
  PNG: "image/png",
  GIF: "image/gif",
  SVG: "image/svg+xml",
  TIFF: "image/tiff",
  WEBP: "image/webp",
  BMP: "image/bmp",
  ICO: "image/x-icon",
  AUDIO: "audio/*",
  VIDEO: "video/*",
  PDF: "application/pdf",
  TEXT: "text/plain",
  CSV: "text/csv",
  HTML: "text/html",
  CSS: "text/css",
  JS: "text/javascript",
  JSON: "application/json",
  XML: "application/xml",
  ZIP: "application/zip",
  TAR: "application/x-tar",
  GZIP: "application/gzip",
  DOC: "application/msword",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  XLS: "application/vnd.ms-excel",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PPT: "application/vnd.ms-powerpoint",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ANY: "*/*",
} as const;

export type FileInputType =
  (typeof FILE_INPUT_TYPES_FULL)[keyof typeof FILE_INPUT_TYPES_FULL];

const DEFAULT_PAGE_PROCESSING_CONFIG: PageProcessingConfig = {
  scale: DEFAULT_PDF_SCALE,
  maxDimension: MAX_PDF_DIMENSION,
  quality: DEFAULT_PDF_QUALITY,
};

export { DEFAULT_PAGE_PROCESSING_CONFIG, FILE_INPUT_TYPES_FULL };
