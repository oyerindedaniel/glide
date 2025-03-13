/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  getDocument,
  GlobalWorkerOptions,
  PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { tryCatch } from "@/utils/error";
import { WorkerMessageType, LibraryWorkerMessageType } from "@/types/processor";

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof Worker !== "undefined";

// Create a single worker for PDF.js library
let pdfJsWorker: Worker | null = null;
if (isBrowser && !pdfJsWorker) {
  pdfJsWorker = new Worker(
    new URL(
      "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url
    )
  );
  GlobalWorkerOptions.workerPort = pdfJsWorker;
}

const CMAP_URL = "../../node_modules/pdfjs-dist/cmaps";
const CMAP_PACKED = true;
const STANDARD_FONT_DATA_URL = "../../node_modules/pdfjs-dist/standard_fonts";

// Store active PDF documents by client ID
const pdfDocuments = new Map<string, PDFDocumentProxy>();

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

const canvasFactory = new WorkerCanvasFactory();

const document = {
  fonts: self.fonts,
  createElement: (name: string) => {
    if (name === "canvas") {
      return new OffscreenCanvas(1, 1);
    }
    return null;
  },
};

self.onmessage = async (e: MessageEvent) => {
  const { type, clientId, requestId } = e.data;

  try {
    switch (type) {
      case LibraryWorkerMessageType.InitPDF: {
        const { pdfData } = e.data;

        // Initialize the PDF document
        const pdfDocument = await getDocument({
          data: pdfData,
          // @ts-ignore
          ownerDocument: document,
          useWorkerFetch: true,
          cMapUrl: CMAP_URL,
          cMapPacked: CMAP_PACKED,
          standardFontDataUrl: STANDARD_FONT_DATA_URL,
        }).promise;

        // Store the document reference
        pdfDocuments.set(clientId, pdfDocument);

        // Return success with page count
        self.postMessage({
          type: WorkerMessageType.PDFInitialized,
          clientId,
          requestId,
          totalPages: pdfDocument.numPages,
        });
        break;
      }

      case LibraryWorkerMessageType.GetPage: {
        const { pageNumber } = e.data;
        const pdfDocument = pdfDocuments.get(clientId);

        if (!pdfDocument) {
          throw new Error(`PDF document not found for client: ${clientId}`);
        }

        const page = await pdfDocument.getPage(pageNumber);

        // Return basic page info, not the actual page object
        // since it can't be transferred between workers
        self.postMessage({
          type: LibraryWorkerMessageType.GetPage,
          clientId,
          requestId,
          pageNumber,
          width: page._pageInfo.view[2],
          height: page._pageInfo.view[3],
          rotation: page._pageInfo.rotate,
        });
        break;
      }

      case LibraryWorkerMessageType.RenderPage: {
        const { pageNumber, viewport, config } = e.data;
        const pdfDocument = pdfDocuments.get(clientId);

        if (!pdfDocument) {
          throw new Error(`PDF document not found for client: ${clientId}`);
        }

        const page = await pdfDocument.getPage(pageNumber);

        // Create a viewport with the provided parameters
        const pageViewport = page.getViewport({
          scale: viewport.scale,
          rotation: viewport.rotation || 0,
          offsetX: viewport.offsetX || 0,
          offsetY: viewport.offsetY || 0,
        });

        // Create canvas context
        const canvasContext = canvasFactory.create(
          pageViewport.width,
          pageViewport.height
        );

        // Render the page
        const { error } = await tryCatch(
          page.render({
            // @ts-ignore
            canvasContext: canvasContext.context,
            viewport: pageViewport,
          }).promise
        );

        if (error?.raw) throw new Error("Failed to render PDF page.");

        // Convert to blob with quality settings
        const blob = await canvasContext.canvas.convertToBlob({
          type: "image/webp",
          quality: config.quality,
        });

        // Convert to array buffer for transfer
        const arrayBuffer = await blob.arrayBuffer();

        // Clean up the page
        page.cleanup();

        // Return rendered page
        self.postMessage(
          {
            type: WorkerMessageType.PageProcessed,
            clientId,
            requestId,
            pageNumber,
            blobData: arrayBuffer,
            dimensions: {
              width: pageViewport.width,
              height: pageViewport.height,
            },
          },
          [arrayBuffer]
        );
        break;
      }

      case LibraryWorkerMessageType.CleanupDocument: {
        const pdfDocument = pdfDocuments.get(clientId);
        if (pdfDocument) {
          await pdfDocument.cleanup();
          pdfDocuments.delete(clientId);
        }
        self.postMessage({
          type: LibraryWorkerMessageType.CleanupDocument,
          clientId,
          requestId,
          success: true,
        });
        break;
      }

      case LibraryWorkerMessageType.AbortProcessing: {
        const pdfDocument = pdfDocuments.get(clientId);
        if (pdfDocument) {
          await pdfDocument.destroy();
          pdfDocuments.delete(clientId);
        }
        self.postMessage({
          type: LibraryWorkerMessageType.AbortProcessing,
          clientId,
          requestId,
          success: true,
        });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    // Return error to client
    self.postMessage({
      type: WorkerMessageType.Error,
      clientId,
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
      pageNumber: e.data.pageNumber,
    });
  }
};
