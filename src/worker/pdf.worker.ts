import * as pdfjsLib from "pdfjs-dist";
import { WorkerMessageType, PageProcessingConfig } from "@/types/processor";

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

export type WorkerMessage =
  | {
      type: WorkerMessageType.InitPDF;
      pdfData: ArrayBuffer;
    }
  | {
      type: WorkerMessageType.ProcessPage;
      pageNumber: number;
      config: PageProcessingConfig;
    };

export type WorkerResponse =
  | {
      type: WorkerMessageType.PageProcessed;
      pageNumber: number;
      blob: Blob;
      dimensions: { width: number; height: number };
    }
  | {
      type: WorkerMessageType.PDFInitialized;
      totalPages: number;
    }
  | {
      type: WorkerMessageType.Error;
      pageNumber?: number;
      error: string;
    };

let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  try {
    switch (e.data.type) {
      case WorkerMessageType.InitPDF:
        try {
          // Initializes the PDF document with the provided pdfData
          pdfDocument = await pdfjsLib.getDocument({ data: e.data.pdfData })
            .promise;

          self.postMessage({
            type: WorkerMessageType.PDFInitialized,
            totalPages: pdfDocument.numPages,
          });
        } catch (error) {
          self.postMessage({
            type: WorkerMessageType.Error,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
        break;

      case WorkerMessageType.ProcessPage:
        if (!pdfDocument) {
          throw new Error("PDF document is not initialized");
        }

        const { pageNumber, config } = e.data;
        const page = await pdfDocument.getPage(pageNumber);
        if (!page) throw new Error(`Page ${pageNumber} could not be retrieved`);

        // Adjust viewport scale based on maxDimension constraintx
        const originalViewport = page.getViewport({ scale: 1.0 });
        const scale = Math.min(
          config.maxDimension /
            Math.max(originalViewport.width, originalViewport.height),
          config.scale
        );

        const viewport = page.getViewport({ scale });
        const canvas = new OffscreenCanvas(viewport.width, viewport.height);
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
          alpha: false,
        });

        if (!context) throw new Error("Failed to get canvas context");

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        await page.render({ canvasContext: context, viewport }).promise;

        const blob = await canvas.convertToBlob({
          type: "image/webp",
          quality: config.quality,
        });

        const response: WorkerResponse = {
          type: WorkerMessageType.PageProcessed,
          pageNumber,
          blob,
          dimensions: { width: viewport.width, height: viewport.height },
        };

        self.postMessage(response, [blob]);
        break;

      default:
        throw new Error("Unknown message type");
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const response: WorkerResponse = {
      type: WorkerMessageType.Error,
      error: errorMessage,
      pageNumber:
        e.data.type === WorkerMessageType.ProcessPage
          ? e.data.pageNumber
          : undefined,
    };
    self.postMessage(response);
  }
};
