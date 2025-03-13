/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { WorkerMessageType, PageProcessingConfig } from "@/types/processor";
import { LibraryWorkerMessageType } from "@/types/processor";
import { v4 as uuidv4 } from "uuid";
import { isProduction, SCALE_CACHE_SIZE } from "@/config/app";

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof Worker !== "undefined";

// Create a unique client ID
const CLIENT_ID = uuidv4();

// Reference to the shared library worker
let libraryWorker: Worker | null = null;

// Track pending requests
const pendingRequests = new Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }
>();

// Cache for scale calculations to prevent redundant processing
const scaleCache = new Map<string, number>();
let cacheHits = 0;
let cacheMisses = 0;

// Setup the message handler for the library worker
function setupLibraryWorkerMessageHandler() {
  if (!libraryWorker || !isBrowser) return;

  libraryWorker.onmessage = (e: MessageEvent) => {
    const { type, requestId, clientId } = e.data;

    // Only process messages for this client
    if (clientId && clientId !== CLIENT_ID) {
      return;
    }

    // Get the pending request
    const pendingRequest = requestId ? pendingRequests.get(requestId) : null;

    if (type === WorkerMessageType.Error) {
      const error = new Error(e.data.error);
      if (pendingRequest) {
        pendingRequest.reject(error);
        pendingRequests.delete(requestId);
      } else {
        // Forward the error to the main thread
        self.postMessage({
          type: WorkerMessageType.Error,
          error: e.data.error,
          pageNumber: e.data.pageNumber,
        });
      }
      return;
    }

    // Handle specific response types
    switch (type) {
      case WorkerMessageType.PDFInitialized:
        // Forward to main thread
        self.postMessage({
          type: WorkerMessageType.PDFInitialized,
          totalPages: e.data.totalPages,
        });

        console.log("PDF initialized", e.data.totalPages);

        // Resolve the pending request
        if (pendingRequest) {
          pendingRequest.resolve(e.data);
          pendingRequests.delete(requestId);
        }
        break;

      case WorkerMessageType.PageProcessed:
        // Forward the processed page data
        self.postMessage(
          {
            type: WorkerMessageType.PageProcessed,
            pageNumber: e.data.pageNumber,
            blobData: e.data.blobData,
            dimensions: e.data.dimensions,
          },
          [e.data.blobData]
        );

        if (pendingRequest) {
          pendingRequest.resolve({
            pageNumber: e.data.pageNumber,
            dimensions: e.data.dimensions,
          });
          pendingRequests.delete(requestId);
        }
        break;

      case LibraryWorkerMessageType.GetPage:
        if (pendingRequest) {
          pendingRequest.resolve(e.data);
          pendingRequests.delete(requestId);
        }
        break;

      case LibraryWorkerMessageType.CleanupDocument:
      case LibraryWorkerMessageType.AbortProcessing:
        // These are just acknowledgments
        if (pendingRequest) {
          pendingRequest.resolve(e.data);
          pendingRequests.delete(requestId);
        }
        break;

      default:
        console.warn(`Unknown message type from library worker: ${type}`);
    }
  };
}

// Initialize the library worker connection
async function initializeLibraryWorker() {
  if (!isBrowser) return null;
  if (libraryWorker) return libraryWorker;

  // Dynamic import to avoid circular dependencies
  const { PDFWorkerPool } = await import("./pdf.worker-pool");
  libraryWorker = PDFWorkerPool.getSharedLibraryWorker();

  // Setup the message handler
  setupLibraryWorkerMessageHandler();

  return libraryWorker;
}

// Function to send request to library worker and track it
async function sendRequest(message: any): Promise<any> {
  if (!isBrowser) {
    return Promise.reject(
      new Error("Workers are only available in browser environments")
    );
  }

  // Make sure the library worker is initialized
  await initializeLibraryWorker();

  if (!libraryWorker) {
    throw new Error("Failed to initialize library worker");
  }

  return new Promise((resolve, reject) => {
    const requestId = uuidv4();

    pendingRequests.set(requestId, { resolve, reject });

    libraryWorker!.postMessage(
      {
        ...message,
        clientId: CLIENT_ID,
        requestId,
      },
      message.transferables || []
    );
  });
}

// Calculate the optimal scale for rendering
function calculateOptimalScale(
  pdfWidth: number,
  pdfHeight: number,
  config: PageProcessingConfig,
  displayInfo?: {
    devicePixelRatio: number;
    containerWidth: number;
    containerHeight?: number;
  }
): number {
  // Create a cache key from all input parameters
  const cacheKey = `${pdfWidth}-${pdfHeight}-${config.scale}-${config.maxDimension}-${displayInfo?.devicePixelRatio}-${displayInfo?.containerWidth}-${displayInfo?.containerHeight}`;

  // Check for cache hit and provide more detailed logging
  if (scaleCache.has(cacheKey)) {
    const cachedValue = scaleCache.get(cacheKey)!;
    cacheHits++;
    console.log(
      `CACHE HIT #${cacheHits} ✓ Key: ${cacheKey}, Value: ${cachedValue}, Cache size: ${scaleCache.size}`
    );
    return cachedValue; // This should exit the function immediately
  }

  cacheMisses++;
  console.log(
    `CACHE MISS #${cacheMisses} ✗ Key: ${cacheKey}, Computing new scale...`
  );

  const baseScale = config.scale;
  const pixelRatio = displayInfo?.devicePixelRatio || 1;

  // Consider device pixel ratio for high-DPI displays
  const dprAdjustedScale = baseScale * Math.min(pixelRatio, 2);

  // Calculate container-based scale if container width is provided
  let containerScale = baseScale;
  if (displayInfo?.containerWidth) {
    // Target 95% of container width to allow for some margin
    const targetWidth = displayInfo.containerWidth * 0.95;

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

  console.log("Optimal scale", optimalScale);

  // At the end, before returning
  console.log(
    `Calculated new scale: ${optimalScale}, Cache stats - Hits: ${cacheHits}, Misses: ${cacheMisses}, Size: ${scaleCache.size}`
  );
  return optimalScale;
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
      displayInfo?: {
        devicePixelRatio: number;
        containerWidth: number;
        containerHeight?: number;
      };
    }
  | {
      type: WorkerMessageType.AbortProcessing;
    }
  | {
      type: WorkerMessageType.Cleanup;
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

// Main worker message handler - only set up in browser environments
if (isBrowser && typeof self !== "undefined") {
  self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    try {
      // Add message ID for tracking
      const msgId = Math.random().toString(36).substring(2, 8);
      console.log(
        `[${msgId}] Worker received message: ${
          e.data.type
        } (${Date.now()}), Cache size: ${scaleCache.size}`
      );

      // Clean up scale cache if it gets too large
      if (scaleCache.size > SCALE_CACHE_SIZE) {
        if (!isProduction) {
          console.log(
            `[${msgId}] Cleaning up scale cache, size: ${scaleCache.size}`
          );
        }
        scaleCache.clear();
        cacheHits = 0;
        cacheMisses = 0;
      }

      switch (e.data.type) {
        case WorkerMessageType.InitPDF:
          // Forward the PDF initialization request to the library worker
          await sendRequest({
            type: LibraryWorkerMessageType.InitPDF,
            pdfData: e.data.pdfData,
            transferables: [e.data.pdfData],
          });
          break;

        case WorkerMessageType.ProcessPage:
          {
            const { pageNumber, config, displayInfo } = e.data;

            console.log(
              `START ProcessPage: Page ${pageNumber} (${Date.now()})`
            );

            // First get the page information
            const pageInfo = await sendRequest({
              type: LibraryWorkerMessageType.GetPage,
              pageNumber,
            });

            console.log(
              `Got page info: Page ${pageNumber}, Dimensions: ${pageInfo.width}x${pageInfo.height}`
            );

            // Calculate the optimal scale
            const optimalScale = calculateOptimalScale(
              pageInfo.width,
              pageInfo.height,
              config,
              displayInfo
            );

            console.log(
              `Scale calculated: Page ${pageNumber}, Scale: ${optimalScale}`
            );

            // Request the page rendering
            await sendRequest({
              type: LibraryWorkerMessageType.RenderPage,
              pageNumber,
              viewport: {
                scale: optimalScale,
                rotation: pageInfo.rotation,
              },
              config,
            });

            console.log(`END ProcessPage: Page ${pageNumber} (${Date.now()})`);
          }
          break;

        case WorkerMessageType.AbortProcessing:
          // Forward the abort request
          await sendRequest({
            type: LibraryWorkerMessageType.AbortProcessing,
          });
          // Clear scale cache on abort
          scaleCache.clear();
          break;

        case WorkerMessageType.Cleanup:
          // Forward the cleanup request
          await sendRequest({
            type: LibraryWorkerMessageType.CleanupDocument,
          });
          // Clear scale cache on cleanup
          scaleCache.clear();
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
}
