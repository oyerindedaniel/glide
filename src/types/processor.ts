export enum WorkerMessageType {
  InitPDF = "init-pdf",
  ProcessPage = "process-page",
  PageProcessed = "page-processed",
  PDFInitialized = "pdf-initialized",
  Error = "error",
  AbortProcessing = "abort-processing",
}

export interface PageProcessingConfig {
  scale: number;
  quality: number;
  maxDimension: number;
}
