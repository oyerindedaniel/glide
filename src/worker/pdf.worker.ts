/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { WorkerMessageType, PageProcessingConfig } from "@/types/processor";
import { isProduction, SCALE_CACHE_SIZE } from "@/config/app";

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof Worker !== "undefined";

// We don't need CLIENT_ID anymore since we're not using shared worker
// const CLIENT_ID = uuidv4();

// We don't need pendingRequests anymore
// const pendingRequests = new Map<
//   string,
//   {
//     resolve: (value: any) => void;
//     reject: (error: Error) => void;
//   }
// >();

// Load PDF.js library from Service Worker
if (isBrowser) {
  // Create a function to load the PDF.js library with retry capability
  const loadPDFLibrary = async (
    retryCount = 0,
    maxRetries = 3,
    delayMs = 500
  ) => {
    try {
      // Use absolute URL with origin to ensure correct path resolution
      const pdfWorkerLibUrl = `${self.location.origin}/pdf-worker-lib`;
      console.log(
        `Attempt ${retryCount + 1}/${
          maxRetries + 1
        }: Loading PDF.js library from: ${pdfWorkerLibUrl}`
      );

      // We're loading the library through importScripts, which will make pdfjsLib available
      importScripts(pdfWorkerLibUrl);

      // Check if pdfjsLib was properly loaded
      if (self.pdfjsLib && self.pdfjsLib.getDocument) {
        console.log("PDF.js library successfully loaded");
        return true;
      } else {
        throw new Error(
          "PDF.js library not properly loaded from service worker"
        );
      }
    } catch (error) {
      console.warn(
        `PDF.js library load attempt ${retryCount + 1} failed:`,
        error
      );

      if (retryCount < maxRetries) {
        console.log(`Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return loadPDFLibrary(retryCount + 1, maxRetries, delayMs * 1.5);
      } else {
        console.error("All attempts to load PDF.js library failed");
        // Fallback to minimal implementation
        self.pdfjsLib = {
          getDocument: function (options: any) {
            // options parameter is required for API compatibility
            console.warn("PDF.js fallback: ignoring options", options);
            return {
              promise: Promise.reject(
                new Error(
                  "PDF.js library could not be loaded. Service worker may not be ready."
                )
              ),
            };
          },
        };
        self.OffscreenCanvasFactory = function () {};
        self.OffscreenCanvasFactory.prototype = {
          create: function () {
            return { canvas: null, context: null };
          },
          reset: function () {},
          destroy: function () {},
        };
        return false;
      }
    }
  };

  // Initialize the library
  loadPDFLibrary().then((success) => {
    console.log(
      `PDF.js library initialization ${
        success ? "succeeded" : "failed with fallback"
      }`
    );
  });
}

// Replace the current pdfjsLib initialization to avoid it being overwritten
self.pdfjsLib = self.pdfjsLib || {
  getDocument: function (options: any) {
    // This will be called only if the service worker loading failed
    // and we need to provide a fallback
    console.warn("Using fallback PDF.js implementation", options);
    return {
      promise: Promise.reject(
        new Error("PDF.js library not available. Try again later.")
      ),
    };
  },
};

// Define configuration for PDF.js
const CMAP_URL = "/pdfjs/cmaps/";
const CMAP_PACKED = true;
const STANDARD_FONT_DATA_URL = "/pdfjs/standard_fonts/";

// Cache for scale calculations to prevent redundant processing
const scaleCache = new Map<string, number>();
let cacheHits = 0;
let cacheMisses = 0;

// Store active PDF documents
let pdfDocument: any = null;

// Define types for items loaded from Service Worker
declare global {
  interface Window {
    pdfjsLib: any;
    OffscreenCanvasFactory: any;
    WorkerCanvasFactory: any;
  }
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
          // Instead of forwarding to the library worker, directly use PDF.js (from Service Worker)
          try {
            const pdfData = e.data.pdfData;

            // Use pdfjsLib directly from the Service Worker with proper configuration
            pdfDocument = await self.pdfjsLib.getDocument({
              data: pdfData,
              ownerDocument: self,
              useWorkerFetch: true,
              cMapUrl: CMAP_URL,
              cMapPacked: CMAP_PACKED,
              standardFontDataUrl: STANDARD_FONT_DATA_URL,
            }).promise;

            // Return success with page count
            self.postMessage({
              type: WorkerMessageType.PDFInitialized,
              totalPages: pdfDocument.numPages,
            });

            console.log(`PDF initialized with ${pdfDocument.numPages} pages`);
          } catch (error) {
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to initialize PDF";
            console.error("PDF initialization error:", errorMessage);
            throw error;
          }
          break;

        case WorkerMessageType.ProcessPage:
          {
            const { pageNumber, config, displayInfo } = e.data;

            console.log(
              `START ProcessPage: Page ${pageNumber} (${Date.now()})`
            );

            try {
              // Get the page directly (no need to request it from a shared worker)
              const page = await pdfDocument.getPage(pageNumber);

              // Get page dimensions
              const pageInfo = {
                width: page._pageInfo.view[2],
                height: page._pageInfo.view[3],
                rotation: page._pageInfo.rotate,
              };

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

              // Create viewport with the provided parameters
              const viewport = page.getViewport({
                scale: optimalScale,
                rotation: pageInfo.rotation || 0,
              });

              // More detailed logging
              console.log(
                `Created viewport: Page ${pageNumber}, Size: ${viewport.width}x${viewport.height}`
              );

              try {
                // Create canvas factory instance - try WorkerCanvasFactory first, then fall back to OffscreenCanvasFactory
                const CanvasFactoryClass =
                  self.WorkerCanvasFactory || self.OffscreenCanvasFactory;
                const canvasFactory = new CanvasFactoryClass();
                console.log(
                  `Created canvas factory: Page ${pageNumber}, using ${
                    self.WorkerCanvasFactory
                      ? "WorkerCanvasFactory"
                      : "OffscreenCanvasFactory"
                  }`
                );

                // Create canvas context
                const canvasAndContext = canvasFactory.create(
                  viewport.width,
                  viewport.height
                );

                if (
                  !canvasAndContext ||
                  !canvasAndContext.canvas ||
                  !canvasAndContext.context
                ) {
                  throw new Error(
                    `Failed to create canvas context for page ${pageNumber}`
                  );
                }

                console.log(
                  `Created canvas: Page ${pageNumber}, Size: ${canvasAndContext.canvas.width}x${canvasAndContext.canvas.height}`
                );

                // Render the page with better error handling
                try {
                  console.log(`Starting rendering: Page ${pageNumber}`);
                  const renderTask = page.render({
                    canvasContext: canvasAndContext.context,
                    viewport: viewport,
                  });

                  console.log(`Waiting for render promise: Page ${pageNumber}`);
                  await renderTask.promise;
                  console.log(`Rendering completed: Page ${pageNumber}`);
                } catch (renderError) {
                  console.error(
                    `Render error for page ${pageNumber}:`,
                    renderError
                  );
                  throw new Error(
                    `Render failed: ${
                      renderError instanceof Error
                        ? renderError.message
                        : "Unknown render error"
                    }`
                  );
                }

                // Convert to blob with quality settings
                console.log(`Converting to blob: Page ${pageNumber}`);
                let blob;
                try {
                  // First try the normal conversion
                  blob = await canvasAndContext.canvas.convertToBlob({
                    type: "image/webp",
                    quality: config.quality,
                  });
                  console.log(
                    `Blob created: Page ${pageNumber}, Size: ${blob.size} bytes`
                  );
                } catch (blobError) {
                  console.error(
                    `Blob conversion error for page ${pageNumber}:`,
                    blobError
                  );

                  // Try with a fallback method - create a minimal placeholder image
                  try {
                    console.log(
                      `Attempting fallback blob creation for page ${pageNumber}`
                    );

                    // Create a small placeholder image representing the page
                    const fallbackCanvas = new OffscreenCanvas(400, 500);
                    const ctx = fallbackCanvas.getContext("2d");

                    if (ctx) {
                      // Fill with white
                      ctx.fillStyle = "#ffffff";
                      ctx.fillRect(0, 0, 400, 500);

                      // Add border
                      ctx.strokeStyle = "#cccccc";
                      ctx.lineWidth = 2;
                      ctx.strokeRect(5, 5, 390, 490);

                      // Add text
                      ctx.fillStyle = "#666666";
                      ctx.font = "20px Arial";
                      ctx.fillText(`Page ${pageNumber} (Fallback)`, 50, 50);
                      ctx.font = "14px Arial";
                      ctx.fillText("Error processing original page", 50, 80);

                      // Create blob with lower quality since it's just a placeholder
                      blob = await fallbackCanvas.convertToBlob({
                        type: "image/webp",
                        quality: 0.5,
                      });

                      console.log(`Created fallback blob: ${blob.size} bytes`);
                    } else {
                      // If even this fails, create a minimal dummy blob
                      const dummyData = new Uint8Array([
                        // Minimal valid WebP image header and data
                        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57,
                        0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0x18, 0x00,
                        0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01,
                        0x00, 0x01, 0x00, 0x02, 0x00,
                      ]);
                      blob = new Blob([dummyData], { type: "image/webp" });
                      console.log(
                        `Created minimal dummy blob as last resort: ${blob.size} bytes`
                      );
                    }
                  } catch (fallbackError) {
                    console.error(
                      `Even fallback blob creation failed:`,
                      fallbackError
                    );
                    throw new Error(
                      `All blob conversion methods failed: ${
                        blobError instanceof Error
                          ? blobError.message
                          : "Primary error"
                      }, fallback: ${
                        fallbackError instanceof Error
                          ? fallbackError.message
                          : "Secondary error"
                      }`
                    );
                  }
                }

                // Convert to array buffer for transfer
                console.log(`Converting to array buffer: Page ${pageNumber}`);
                const arrayBuffer = await blob.arrayBuffer();

                // Clean up the page to free memory
                console.log(`Cleaning up page: ${pageNumber}`);
                page.cleanup();

                // Return the processed page
                console.log(`Sending processed page: ${pageNumber}`);
                self.postMessage(
                  {
                    type: WorkerMessageType.PageProcessed,
                    pageNumber,
                    blobData: arrayBuffer,
                    dimensions: {
                      width: viewport.width,
                      height: viewport.height,
                    },
                  },
                  [arrayBuffer]
                );

                console.log(
                  `END ProcessPage: Page ${pageNumber} (${Date.now()})`
                );

                // Explicitly signal completion
                const completionPromise = Promise.resolve();
                await completionPromise;
              } catch (canvasError) {
                console.error(
                  `Canvas operation error for page ${pageNumber}:`,
                  canvasError
                );
                throw new Error(
                  `Canvas operations failed: ${
                    canvasError instanceof Error
                      ? canvasError.message
                      : "Unknown canvas error"
                  }`
                );
              }
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              console.error(
                `Page processing error (${pageNumber}):`,
                errorMessage
              );
              throw new Error(
                `Failed to process page ${pageNumber}: ${errorMessage}`
              );
            }
          }
          break;

        case WorkerMessageType.AbortProcessing:
          // Directly abort processing
          if (pdfDocument) {
            await pdfDocument.destroy();
            pdfDocument = null;
          }
          // Clear scale cache on abort
          scaleCache.clear();
          break;

        case WorkerMessageType.Cleanup:
          // Clean up resources
          if (pdfDocument) {
            try {
              await pdfDocument.cleanup();
              console.log("PDF document cleanup completed successfully");
              pdfDocument = null;
            } catch (cleanupError) {
              console.error("Error during PDF document cleanup:", cleanupError);
              // Continue with cleanup even if there's an error
              pdfDocument = null;
            }
          }
          // Clear scale cache on cleanup
          scaleCache.clear();

          // Send a confirmation response to ensure promises resolve
          self.postMessage({
            type: WorkerMessageType.PDFInitialized, // Use an existing message type for simplicity
            totalPages: 0, // Indicates this is just a cleanup confirmation
          });
          break;

        default:
          throw new Error("Unknown message type");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`Worker error: ${errorMessage}`);

      // Always construct a complete response
      const response: WorkerResponse = {
        type: WorkerMessageType.Error,
        error: errorMessage,
        pageNumber:
          e.data.type === WorkerMessageType.ProcessPage
            ? e.data.pageNumber
            : undefined,
      };

      // Send the error
      self.postMessage(response);

      // Explicitly wait for any pending promises to resolve
      await Promise.resolve();
    }
  };
}
