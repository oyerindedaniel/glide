/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  getDocument,
  GlobalWorkerOptions,
  PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageType, PageProcessingConfig } from "@/types/processor";
import { tryCatch } from "@/utils/error";

const worker = new Worker(
  new URL(
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url
  )
);
GlobalWorkerOptions.workerPort = worker;

const CMAP_URL = "../../node_modules/pdfjs-dist/cmaps";
const CMAP_PACKED = true;
const STANDARD_FONT_DATA_URL = "../../node_modules/pdfjs-dist/standard_fonts";

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
      blobData: ArrayBuffer;
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

class WorkerCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(
    canvasAndContext: { canvas: OffscreenCanvas },
    width: number,
    height: number
  ) {
    const { canvas } = canvasAndContext;
    canvas.width = width;
    canvas.height = height;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  destroy(canvasContext: { canvas: OffscreenCanvas }) {
    // No-op; OffscreenCanvas cleanup is handled by garbage collection
  }
}

let pdfDocument: PDFDocumentProxy | null = null;

const canvasFactory = new WorkerCanvasFactory();

const document = {
  fonts: self.fonts,
  createElement: (name: any) => {
    if (name == "canvas") {
      return new OffscreenCanvas(1, 1);
    }
    return null;
  },
};

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  try {
    switch (e.data.type) {
      case WorkerMessageType.InitPDF:
        try {
          // Initialize the PDF document with the provided pdfData
          pdfDocument = await getDocument({
            data: e.data.pdfData,
            // @ts-ignore
            ownerDocument: document,
            useWorkerFetch: true,
            cMapUrl: CMAP_URL,
            cMapPacked: CMAP_PACKED,
            standardFontDataUrl: STANDARD_FONT_DATA_URL,
          }).promise;
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

        // Adjust viewport scale based on maxDimension constraint
        const originalViewport = page.getViewport({ scale: 1.0 });
        const scale = Math.min(
          config.maxDimension /
            Math.max(originalViewport.width, originalViewport.height),
          config.scale
        );

        const viewport = page.getViewport({ scale });

        const canvasContext = canvasFactory.create(
          viewport.width,
          viewport.height
        );

        if (!canvasContext) throw new Error("Failed to get canvas context");

        const { error } = await tryCatch(
          page.render({
            // @ts-ignore
            canvasContext: canvasContext.context,
            viewport,
          }).promise
        );

        if (error?.raw) throw new Error("Failed to render PDF page.");

        const blob = await canvasContext.canvas.convertToBlob({
          type: "image/webp",
          quality: config.quality,
        });

        const arrayBuffer = await blob.arrayBuffer();

        const response: WorkerResponse = {
          type: WorkerMessageType.PageProcessed,
          pageNumber,
          blobData: arrayBuffer,
          dimensions: { width: viewport.width, height: viewport.height },
        };

        self.postMessage(response, [arrayBuffer]);
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
