export enum WorkerMessageType {
  InitPDF = "init-pdf",
  ProcessPage = "process-page",
  PageProcessed = "page-processed",
  PDFInitialized = "pdf-initialized",
  Error = "error",
  AbortProcessing = "abort-processing",
  Cleanup = "cleanup",
}

export interface PageProcessingConfig {
  scale: number;
  quality: number;
  maxDimension: number;
}

export enum LibraryWorkerMessageType {
  InitPDF = "INIT_PDF",
  GetPage = "GET_PAGE",
  RenderPage = "RENDER_PAGE",
  CleanupDocument = "CLEANUP_DOCUMENT",
  AbortProcessing = "ABORT_PROCESSING",
}
