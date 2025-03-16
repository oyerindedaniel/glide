/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  getDocument,
  GlobalWorkerOptions,
  PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { tryCatch } from "@/utils/error";
import {
  WorkerMessageType,
  LibraryWorkerMessageType,
  PDFInitializedMessage,
  PageProcessedMessage,
  GetPageMessage,
  ErrorMessage,
  CleanupMessage,
  AbortProcessingMessage,
  PageProcessingConfig,
  DisplayInfo,
} from "@/types/processor";
import {
  CoordinatorMessageType,
  RegisterCoordinatorMessage,
} from "@/types/coordinator";
import logger from "@/utils/logger";
import { isBrowserWithWorker } from "@/utils/app";
import { DEFAULT_PAGE_PROCESSING_CONFIG } from "@/constants/processing";

// Create a single worker for PDF.js library
let pdfJsWorker: Worker | null = null;
if (isBrowserWithWorker() && !pdfJsWorker) {
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

// Track coordinator workers
const coordinators = new Map<number, MessagePort>();

// Cache for scale calculations to prevent redundant processing
const scaleCache = new Map<string, number>();

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

// Calculate optimal scale
function calculateOptimalScale(
  pdfWidth: number,
  pdfHeight: number,
  config: PageProcessingConfig,
  displayInfo?: DisplayInfo
): number {
  // Create a cache key from all input parameters
  const cacheKey = `${pdfWidth}-${pdfHeight}-${config.scale}-${config.maxDimension}-${displayInfo?.devicePixelRatio}-${displayInfo?.containerWidth}-${displayInfo?.containerHeight}`;

  // Check for cache hit and provide more detailed logging
  if (scaleCache.has(cacheKey)) {
    const cachedValue = scaleCache.get(cacheKey)!;
    logger.log(
      `CACHE HIT ✓ Key: ${cacheKey}, Value: ${cachedValue}, Cache size: ${scaleCache.size}`
    );
    return cachedValue; // This should exit the function immediately
  }

  logger.log(`CACHE MISS ✗ Key: ${cacheKey}, Computing new scale...`);

  const baseScale = config.scale || 1.0;
  const pixelRatio = displayInfo?.devicePixelRatio || 1;

  // Consider device pixel ratio for high-DPI displays
  const dprAdjustedScale = baseScale * Math.min(pixelRatio, 2);

  // Calculate container-based scale if container width is provided
  let containerScale = baseScale;
  if (displayInfo?.containerWidth) {
    // Target 98% of container width to allow for some margin
    const targetWidth = displayInfo.containerWidth * 0.98;

    // Calculate scale needed to fit PDF width to target width
    containerScale = targetWidth / pdfWidth;

    // Consider height constraint if provided
    if (displayInfo.containerHeight) {
      const targetHeight = displayInfo.containerHeight;
      const heightScale = targetHeight / pdfHeight;
      containerScale = Math.min(containerScale, heightScale);
    }
    // Ensure containerScale is at least the minimum quality scale
    containerScale = Math.max(containerScale, 1.0);
  }

  let candidateScale = Math.max(dprAdjustedScale, containerScale);
  const maxDimensionScale = config.maxDimension / Math.max(pdfWidth, pdfHeight);

  // Ensure we don't exceed the maxDimension constraint
  candidateScale = Math.min(candidateScale, maxDimensionScale);

  // Set minimum scale to ensure quality doesn't drop too low
  // Higher minimum for high-DPI displays
  const minScale = pixelRatio > 1.5 ? 1.2 : 1.0;
  const optimalScale = Math.max(candidateScale, minScale);

  // Store result in cache
  scaleCache.set(cacheKey, optimalScale);

  // At the end, before returning
  logger.log(
    `Calculated new scale: ${optimalScale}, Cache size: ${scaleCache.size}`
  );
  return optimalScale;
}

// Process a message from a coordinator
const processMessage = async (
  e: MessageEvent,
  coordinatorPort?: MessagePort
) => {
  const data = e.data;
  const { type, clientId, requestId } = data;

  // Use the port that sent this message or the one from our coordinators map
  const targetPort = coordinatorPort || (e.ports && e.ports[0]);

  if (!targetPort && type !== CoordinatorMessageType.REGISTER_COORDINATOR) {
    logger.error("No message port available for communication");
    return;
  }

  try {
    switch (type) {
      case CoordinatorMessageType.REGISTER_COORDINATOR: {
        if (!e.ports || e.ports.length === 0) {
          logger.error("No port provided for coordinator registration");
          return;
        }

        const registerMessage = data as RegisterCoordinatorMessage;
        const { coordinatorId } = registerMessage;
        const port = e.ports[0];

        // Set up message handler for this coordinator
        port.onmessage = (event) => processMessage(event, port);

        coordinators.set(coordinatorId, port);
        logger.log(
          `Registered coordinator ${coordinatorId}, total coordinators: ${coordinators.size}`
        );
        break;
      }

      case LibraryWorkerMessageType.InitPDF: {
        const { pdfData } = data;

        // Clear the scale cache when initializing a new PDF
        scaleCache.clear();

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

        // Return properly typed success message with page count
        const initMessage: PDFInitializedMessage = {
          type: WorkerMessageType.PDFInitialized,
          clientId,
          requestId,
          totalPages: pdfDocument.numPages,
        };
        targetPort.postMessage(initMessage);
        break;
      }

      case LibraryWorkerMessageType.GetPage: {
        const getPageMessage = data as GetPageMessage;
        const { pageNumber } = getPageMessage;
        const pdfDocument = pdfDocuments.get(clientId);

        if (!pdfDocument) {
          throw new Error(`PDF document not found for client: ${clientId}`);
        }

        const page = await pdfDocument.getPage(pageNumber);

        // Create a viewport based on configuration
        const config = getPageMessage.config || DEFAULT_PAGE_PROCESSING_CONFIG;

        // Get initial page dimensions
        const baseViewport = page.getViewport({ scale: 1.0 });
        const width = baseViewport.width;
        const height = baseViewport.height;
        const rotation = baseViewport.rotation;

        // Calculate optimal scale using the cached function
        const scale = calculateOptimalScale(
          width,
          height,
          config,
          getPageMessage.displayInfo
        );

        // Create viewport with calculated scale
        const pageViewport = page.getViewport({
          scale: scale,
          rotation: rotation,
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

        // Directly return a PageProcessed message, skipping the intermediate GetPage response
        const pageProcessedMessage: PageProcessedMessage = {
          type: WorkerMessageType.PageProcessed,
          clientId,
          requestId,
          pageNumber,
          blobData: arrayBuffer,
          dimensions: {
            width: pageViewport.width,
            height: pageViewport.height,
          },
        };

        targetPort.postMessage(pageProcessedMessage, [arrayBuffer]);
        break;
      }

      case LibraryWorkerMessageType.CleanupDocument: {
        const pdfDocument = pdfDocuments.get(clientId);
        if (pdfDocument) {
          await pdfDocument.cleanup();
          pdfDocuments.delete(clientId);
        }

        // Clear the scale cache
        scaleCache.clear();

        const cleanupMessage: CleanupMessage = {
          type: WorkerMessageType.Cleanup,
          clientId,
          requestId,
          success: true,
        };
        targetPort.postMessage(cleanupMessage);
        break;
      }

      case LibraryWorkerMessageType.AbortProcessing: {
        const pdfDocument = pdfDocuments.get(clientId);
        if (pdfDocument) {
          await pdfDocument.destroy();
          pdfDocuments.delete(clientId);
        }

        // Clear the scale cache
        scaleCache.clear();

        const abortMessage: AbortProcessingMessage = {
          type: WorkerMessageType.AbortProcessing,
          clientId,
          requestId,
          success: true,
        };
        targetPort.postMessage(abortMessage);
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    if (targetPort) {
      const errorMessage: ErrorMessage = {
        type: WorkerMessageType.Error,
        clientId,
        requestId,
        error: error instanceof Error ? error.message : "Unknown error",
        pageNumber: data.pageNumber,
      };
      targetPort.postMessage(errorMessage);
    } else {
      logger.error(
        "Error occurred but no port available to send response:",
        error
      );
    }
  }
};

// Set up main message handler
self.onmessage = processMessage;
