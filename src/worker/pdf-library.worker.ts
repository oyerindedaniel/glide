/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  getDocument,
  GlobalWorkerOptions,
  PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { tryCatch, WorkerError, WorkerCommunicationError } from "@/utils/error";
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
  CleanupMessage as CoordinatorCleanupMessage,
} from "@/types/coordinator";
import logger from "@/utils/logger";
import { isBrowserWithWorker } from "@/utils/app";
import { DEFAULT_PAGE_PROCESSING_CONFIG } from "@/constants/processing";
import { SCALE_CACHE_SIZE } from "@/config/app";

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
// Client-specific - a map of (clientId -> scale cache map)
const scaleCache = new Map<string, Map<string, number>>();

// Maximum entries per client's scale cache (from config)
const MAX_SCALE_CACHE_ENTRIES = SCALE_CACHE_SIZE;

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
  clientId: string,
  displayInfo?: DisplayInfo
): number {
  // Create a cache key from all input parameters
  const cacheKey = `${pdfWidth}-${pdfHeight}-${config.scale}-${config.maxDimension}-${displayInfo?.devicePixelRatio}-${displayInfo?.containerWidth}-${displayInfo?.containerHeight}`;

  // Get or create client-specific cache
  let clientCache = scaleCache.get(clientId);
  if (!clientCache) {
    clientCache = new Map<string, number>();
    scaleCache.set(clientId, clientCache);
  }

  // Check for cache hit and provide more detailed logging
  if (clientCache.has(cacheKey)) {
    const cachedValue = clientCache.get(cacheKey)!;
    logger.log(
      `CACHE HIT ✓ Client: ${clientId}, Key: ${cacheKey}, Value: ${cachedValue}, Cache size: ${clientCache.size}`
    );
    return cachedValue;
  }

  logger.log(
    `CACHE MISS ✗ Client: ${clientId}, Key: ${cacheKey}, Computing new scale...`
  );

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

  // Enforce cache size limit per client
  if (clientCache.size >= MAX_SCALE_CACHE_ENTRIES) {
    // Remove oldest entry (first key in the map)
    const firstKey = clientCache.keys().next().value;
    if (firstKey !== undefined) {
      clientCache.delete(firstKey);
      logger.log(
        `Cache full for client ${clientId}, removed oldest entry: ${firstKey}`
      );
    }
  }

  clientCache.set(cacheKey, optimalScale);

  logger.log(
    `Calculated new scale: ${optimalScale}, Client cache size: ${clientCache.size}, Total clients: ${scaleCache.size}`
  );
  return optimalScale;
}

// Clear cache for a specific client
function clearClientScaleCache(clientId: string): void {
  if (scaleCache.has(clientId)) {
    const cacheSize = scaleCache.get(clientId)!.size;
    scaleCache.delete(clientId);
    logger.log(
      `Cleared scale cache for client ${clientId} (${cacheSize} entries)`
    );
  }
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
    // Handle special case for coordinator registration which doesn't need clientId
    if (type === CoordinatorMessageType.REGISTER_COORDINATOR) {
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
      return;
    }

    // Handle coordinator cleanup request - may be for specific client or all clients
    if (type === CoordinatorMessageType.CLEANUP) {
      const cleanupMessage = data as CoordinatorCleanupMessage;
      const cleanupRequestId = cleanupMessage.requestId || "";
      const cleanupOptions = cleanupMessage.options || {};

      logger.log(`Performing complete library worker cleanup`);

      try {
        // Clean up all PDF documents
        const documentCleanupPromises: Promise<void>[] = [];
        for (const [id, doc] of pdfDocuments.entries()) {
          documentCleanupPromises.push(
            doc
              .cleanup()
              .catch((err) =>
                logger.warn(`Error cleaning document for client ${id}:`, err)
              )
          );
        }

        await Promise.all(documentCleanupPromises);

        pdfDocuments.clear();
        scaleCache.clear();

        const shouldCloseChannels = cleanupOptions.closeChannels !== false; // Default to true if not specified

        if (shouldCloseChannels) {
          for (const [id, port] of coordinators.entries()) {
            try {
              logger.log(`Closing coordinator port ${id}`);
              port.close();
            } catch (err) {
              logger.warn(`Error closing coordinator port ${id}:`, err);
            }
          }
        } else {
          logger.log(`Keeping coordinator ports open as requested by options`);
        }

        if (!cleanupMessage.clientId || shouldCloseChannels) {
          coordinators.clear();
        }

        // Send success response directly to the main thread, not via coordinator port
        // This response will be caught by the worker pool's
        self.postMessage({
          type: CoordinatorMessageType.CLEANUP,
          requestId: cleanupRequestId,
          success: true,
          isLibraryWorkerResponse: true,
        });

        logger.log(`Library worker cleanup complete`);
      } catch (error) {
        logger.error(`Error during library worker cleanup:`, error);
        self.postMessage({
          type: CoordinatorMessageType.CLEANUP,
          requestId: cleanupRequestId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          isLibraryWorkerResponse: true,
        });
      }

      return;
    }

    // For all other message types, validate clientId is present
    if (!clientId) {
      throw new WorkerCommunicationError(
        `Client ID is required for operation type: ${type}`
      );
    }

    switch (type) {
      case LibraryWorkerMessageType.InitPDF: {
        const { pdfData } = data;

        // Clear the scale cache for this client
        clearClientScaleCache(clientId);

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
          throw new WorkerError(
            `PDF document not found for client: ${clientId}`
          );
        }

        const page = await pdfDocument.getPage(pageNumber);

        // Create a viewport based on configuration
        const config = getPageMessage.config || DEFAULT_PAGE_PROCESSING_CONFIG;

        // Get initial page dimensions
        const baseViewport = page.getViewport({ scale: 1.0 });
        const width = baseViewport.width;
        const height = baseViewport.height;
        const rotation = baseViewport.rotation;

        // Calculate optimal scale using the cached function with clientId
        const scale = calculateOptimalScale(
          width,
          height,
          config,
          clientId,
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

        if (error) throw new WorkerError("Failed to render PDF page.");

        // Convert to blob with quality settings
        const blob = await canvasContext.canvas.convertToBlob({
          type: "image/webp",
          quality: config.quality,
        });

        // Convert to array buffer for transfer
        const arrayBuffer = await blob.arrayBuffer();

        // Clean up the page
        page.cleanup();

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
          try {
            await pdfDocument.cleanup();
            pdfDocuments.delete(clientId);
          } catch (error) {
            logger.warn(
              `Error cleaning up PDF document for client ${clientId}:`,
              error
            );
          }
        }

        clearClientScaleCache(clientId);

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

        clearClientScaleCache(clientId);

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
        throw new WorkerError(`Unknown message type: ${type}`);
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

self.onmessage = processMessage;
