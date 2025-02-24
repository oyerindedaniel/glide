const FILE_PROCESSING_EVENTS = Object.freeze({
  FILE_ADD: "fileAdd",
  PAGE_PROCESSED: "pageProcessed",
  //   FILE_PROCESSING: "fileProcessing",
  //   FILE_COMPLETED: "fileCompleted",
  FILE_STATUS: "fileStatus",
  //   FILE_FAILED: "fileFailed",
  TOTAL_PAGES_UPDATE: "totalPagesUpdate",
} as const);

const MAX_CONCURRENT_FILES = 2;
const MAX_PAGE_RETRIES = 3;
const BASE_DELAY_MS = 100;

export {
  FILE_PROCESSING_EVENTS,
  MAX_CONCURRENT_FILES,
  MAX_PAGE_RETRIES,
  BASE_DELAY_MS,
};
