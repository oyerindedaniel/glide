export enum WorkerMessageType {
  InitPDF = "init-pdf",
  PDFInitialized = "pfd-initialized",
  ProcessPage = "process-page",
  PageProcessed = "page-processed",
  Error = "error",
}

export interface PageProcessingConfig {
  scale: number;
  quality: number;
  maxDimension: number;
}
