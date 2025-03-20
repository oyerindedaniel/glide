/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { ProcessingStatus } from "@/store/processed-files";
import {
  DisplayInfo,
  WorkerMessageType,
  PageProcessingConfig,
  ProcessorEventType,
  OperationName,
  RecoveryEventType,
  PageProcessedRecoveryData,
  PDFInitializedRecoveryData,
} from "@/types/processor";
import {
  delay,
  isBrowserWithWorker,
  isWindowDefined,
  generateRandomId,
} from "@/utils/app";
import pLimit from "p-limit";
import { toast } from "sonner";
import { unstable_batchedUpdates as batchedUpdates } from "react-dom";
import { PDFWorkerPool } from "../worker/pdf.worker-pool";
import logger from "@/utils/logger";
import {
  PDF_CACHE_MAX_AGE,
  PDF_CACHE_CLEANUP_INTERVAL,
  DEFAULT_MAX_CONCURRENT_FILES,
  DEFAULT_PAGE_PROCESSING_SLOTS,
  PDF_CONFIG_SMALL,
  PDF_CONFIG_MEDIUM,
  PDF_CONFIG_LARGE,
  MAX_PAGE_RETRIES,
  BASE_DELAY_MS,
} from "@/config/app";
import recoveryEmitter from "@/utils/recovery-event-emitter";
import { v4 as uuidv4 } from "uuid";

// Check if we're in a browser environment with Web Workers
const isBrowser = isBrowserWithWorker();

interface ProcessingOptions {
  pageProcessingSlots: number;
  processingConfigs: {
    small: PageProcessingConfig;
    medium: PageProcessingConfig;
    large: PageProcessingConfig;
  };
  onError?: (error: Error, pageNumber?: number) => void;
}

const DEFAULT_OPTIONS: ProcessingOptions = {
  pageProcessingSlots: DEFAULT_PAGE_PROCESSING_SLOTS,
  processingConfigs: {
    small: PDF_CONFIG_SMALL,
    medium: PDF_CONFIG_MEDIUM,
    large: PDF_CONFIG_LARGE,
  },
};

type CacheItem = {
  url: string;
  dimensions: {
    width: number;
    height: number;
  };
  pageNumber: number;
  lastAccessed: number;
  displayInfo?: {
    devicePixelRatio: number;
    containerWidth: number;
    containerHeight?: number;
  };
};

// File validation types
export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

// PDF Processor for individual files
export class PDFProcessor {
  private worker?: Worker;
  private pageCache: Map<string, CacheItem>;
  private options: ProcessingOptions;
  private processingQueue: Array<{
    pageNumber: number;
    resolve: Function;
    reject: Function;
    displayInfo?: DisplayInfo;
  }>;
  private activeProcessing: number;
  private processingConfig: PageProcessingConfig;
  private onError?: (error: Error, pageNumber?: number) => void;
  private fileSize: number = 0;
  private abortSignal?: AbortSignal;
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  private processingPages: Set<number> = new Set();
  private pageRecoveryUnsubscribe: (() => void) | undefined;
  private pdfInitRecoveryUnsubscribe: (() => void) | undefined;
  private errorRecoveryUnsubscribe: (() => void) | undefined;
  private cleanupRecoveryUnsubscribe: (() => void) | undefined;
  private abortRecoveryUnsubscribe: (() => void) | undefined;
  private workerMessageHandler: ((e: MessageEvent) => void) | undefined;
  // Unique client ID for this processor instance
  private clientId: string;
  // Track processing state for recovery purposes
  private isAborted: boolean = false;
  private expectingResponses: boolean = false;
  private onStatusUpdate?: (status: {
    status: ProcessingStatus;
    totalPages?: number;
    recoveredInit?: boolean;
  }) => void;
  private timeoutIds: number[] = [];

  constructor(
    options: Partial<ProcessingOptions> = {},
    abortSignal?: AbortSignal,
    statusCallback?: (status: {
      status: ProcessingStatus;
      totalPages?: number;
      recoveredInit?: boolean;
    }) => void
  ) {
    // Generate a unique client ID for this processor instance
    this.clientId = uuidv4();

    this.abortSignal = abortSignal;

    this.onStatusUpdate = statusCallback;

    // If a previous instance with this ID somehow exists (unlikely), clean it up
    if (isBrowser) {
      try {
        // Use the sync version since we're just checking if cleanup is needed
        PDFWorkerPool.getInstanceSync().cleanupClient(this.clientId);
      } catch {
        // Silent - just a precaution
      }
    }

    // Initialize state flags
    this.isAborted = false;
    this.expectingResponses = false;

    // In server-side rendering, create a stub processor
    if (!isBrowser) {
      this.options = { ...DEFAULT_OPTIONS, ...options };
      this.onError = options.onError;
      this.abortSignal = abortSignal;
      this.pageCache = new Map();
      this.processingQueue = [];
      this.activeProcessing = 0;
      this.processingConfig = this.options.processingConfigs.small;
      return;
    }

    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onError = options.onError;
    this.abortSignal = abortSignal;

    // // Initialize the worker (async)
    this.initializeWorker();

    this.pageCache = new Map();
    this.processingQueue = [];
    this.activeProcessing = 0;
    this.processingConfig = this.options.processingConfigs.small;

    this.startCacheCleanupInterval();

    if (abortSignal) {
      abortSignal.addEventListener("abort", this.handleAbort.bind(this));
    }
  }

  /**
   * Utility function to retry an operation with exponential backoff
   * @param operation The async operation to retry
   * @param options Options for retry behavior
   * @returns Result of the operation
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxAttempts?: number;
      retryDelayMs?: number;
      operationName: string | OperationName;
      shouldRetry?: (error: Error) => boolean;
    }
  ): Promise<T> {
    const {
      maxAttempts = 3,
      retryDelayMs = 500,
      operationName = "Operation",
      shouldRetry = () => true,
    } = options;

    let attempts = 0;
    let lastError: Error | null = null;

    while (
      attempts < maxAttempts &&
      !this.isAborted &&
      !this.abortSignal?.aborted
    ) {
      try {
        return await operation();
      } catch (error) {
        const typedError =
          error instanceof Error ? error : new Error(String(error));

        if (!shouldRetry(typedError)) {
          throw typedError;
        }

        lastError = typedError;
        attempts++;

        logger.warn(
          `${operationName} attempt ${attempts}/${maxAttempts} failed: ${typedError.message}`
        );

        if (attempts < maxAttempts) {
          const backoffTime = retryDelayMs * Math.pow(2, attempts - 1);
          await delay(backoffTime);
        }
      }
    }

    throw (
      lastError ||
      new Error(`${operationName} failed after ${maxAttempts} attempts`)
    );
  }

  /**
   * Initialize the worker asynchronously
   * This is called from the constructor but doesn't block it
   */
  private async initializeWorker() {
    try {
      const workerPool = await PDFWorkerPool.getInstance();

      const worker = await this.withRetry(
        async () => {
          const worker = await workerPool.getWorker();
          if (!worker) {
            throw new Error("Failed to get worker from pool");
          }
          return worker;
        },
        {
          operationName: OperationName.WorkerInitialization,
          maxAttempts: 3,
          retryDelayMs: 500,
        }
      );

      if (this.isAborted) {
        // If we got aborted while waiting, release the worker immediately
        workerPool.releaseWorker(worker);
        return;
      }

      this.worker = worker;
      this.setupWorkerMessageHandler();
      this.setupRecoveryEventHandlers();

      worker.onerror = (event) => {
        const error = new Error(`Worker error: ${event.message}`);
        logger.error(`Worker error: ${event.message}`);
        this.onError?.(error);

        if (this.onStatusUpdate) {
          this.onStatusUpdate({
            status: ProcessingStatus.FAILED,
          });
        }

        // Mark as no longer expecting responses after worker error
        this.expectingResponses = false;
      };
    } catch (error) {
      logger.error("Failed to initialize worker:", error);
      if (this.onError) {
        this.onError(
          new Error(
            `Failed to initialize worker: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      }

      if (this.onStatusUpdate) {
        this.onStatusUpdate({
          status: ProcessingStatus.FAILED,
        });
      }
    }
  }

  private setupWorkerMessageHandler() {
    if (!this.worker) return;

    this.workerMessageHandler = (e: MessageEvent) => {
      const data = e.data;

      notifyProcessingActivity(this.clientId);

      if (data.type === WorkerMessageType.WorkerHeartbeat) {
        logger.log(
          `[PDFProcessor] Received worker message: ${data.type} for clientId ${this.clientId}`
        );
        notifyProcessingActivity(this.clientId);
        return;
      }

      logger.log(`[PDFProcessor] Received worker message: ${data.type}`);

      switch (data.type) {
        case WorkerMessageType.PDFInitialized:
          const result = {
            totalPages: data.totalPages,
            status: ProcessingStatus.PROCESSING,
          };

          if (this.onStatusUpdate) {
            this.onStatusUpdate(result);
          }

          notifyProcessingActivity(this.clientId);
          break;
        case WorkerMessageType.PageProcessed:
          const { pageNumber, blobData, dimensions } = data;
          logger.log(
            `[${generateRandomId()}] Processing page ${pageNumber}, creating blob URL...`
          );

          const blob = new Blob([blobData], { type: "image/webp" });
          const url = URL.createObjectURL(blob);

          this.pageCache.set(`page-${pageNumber}`, {
            url,
            lastAccessed: Date.now(),
            dimensions,
            pageNumber,
          });

          const queueItems = this.processingQueue.filter(
            (item) => item.pageNumber === pageNumber
          );

          if (queueItems.length > 0) {
            logger.log(
              `[${generateRandomId()}] Found ${
                queueItems.length
              } queue items for page ${pageNumber}, resolving all...`
            );

            queueItems.forEach((item) => {
              item.resolve({ url, dimensions, pageNumber });
            });

            this.processingQueue = this.processingQueue.filter(
              (item) => item.pageNumber !== pageNumber
            );
          } else {
            logger.warn(
              `[${generateRandomId()}] No queue items found for page ${pageNumber}!`
            );
          }

          this.processingPages.delete(pageNumber);
          this.activeProcessing--;

          if (this.onStatusUpdate) {
            this.onStatusUpdate({
              status: ProcessingStatus.PROCESSING,
            });
          }

          notifyProcessingActivity(this.clientId);

          logger.log(
            `[${generateRandomId()}] Active processing: ${
              this.activeProcessing
            }, Queue length: ${
              this.processingQueue.length
            }, Processing pages: ${Array.from(this.processingPages).join(", ")}`
          );
          this.processNextInQueue();
          break;
        case WorkerMessageType.Error:
          const error = new Error(data.error);

          if (this.onStatusUpdate) {
            this.onStatusUpdate({
              status: ProcessingStatus.FAILED,
            });
          }

          if (data.pageNumber !== undefined) {
            const queueItems = this.processingQueue.filter(
              (item) => item.pageNumber === data.pageNumber
            );

            if (queueItems.length > 0) {
              logger.log(
                `Rejecting ${queueItems.length} queue items for page ${data.pageNumber} due to error`
              );
              queueItems.forEach((item) => {
                item.reject(error);
              });

              this.processingQueue = this.processingQueue.filter(
                (item) => item.pageNumber !== data.pageNumber
              );
            }

            this.processingPages.delete(data.pageNumber);
            this.activeProcessing--;
            this.onError?.(error, data.pageNumber);
          } else {
            this.onError?.(error);
          }
          this.processNextInQueue();
          break;
      }
    };

    this.worker.addEventListener("message", this.workerMessageHandler);
  }

  private startCacheCleanupInterval() {
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [key, value] of this.pageCache.entries()) {
        if (now - value.lastAccessed > PDF_CACHE_MAX_AGE) {
          URL.revokeObjectURL(value.url);
          this.pageCache.delete(key);
        }
      }
    }, PDF_CACHE_CLEANUP_INTERVAL);
  }

  private getProcessingConfig(fileSize: number): PageProcessingConfig {
    const sizeMB = fileSize / (1024 * 1024);
    if (sizeMB >= 75) {
      return this.options.processingConfigs.large;
    } else if (sizeMB >= 30) {
      return this.options.processingConfigs.medium;
    }
    return this.options.processingConfigs.small;
  }

  private processNextInQueue() {
    if (this.isAborted || !this.expectingResponses) {
      logger.log(
        `[PDFProcessor] Skipping queue processing: isAborted=${this.isAborted}, expectingResponses=${this.expectingResponses}`
      );
      return;
    }

    if (this.processingQueue.length === 0 || !this.worker) {
      return;
    }

    notifyProcessingActivity(this.clientId);

    while (
      this.activeProcessing < this.options.pageProcessingSlots &&
      this.processingQueue.length > 0
    ) {
      const nextItemIndex = this.processingQueue.findIndex(
        (item) => !this.processingPages.has(item.pageNumber)
      );

      if (nextItemIndex === -1) break;

      const nextItem = this.processingQueue[nextItemIndex];
      this.processingPages.add(nextItem.pageNumber);

      this.activeProcessing++;

      logger.log(
        `Starting to process page ${nextItem.pageNumber}, active: ${this.activeProcessing}, queue: ${this.processingQueue.length}`
      );

      this.worker.postMessage({
        type: WorkerMessageType.ProcessPage,
        pageNumber: nextItem.pageNumber,
        config: this.processingConfig,
        displayInfo: nextItem.displayInfo,
        clientId: this.clientId,
      });
    }
  }

  /**
   * Track a timeout ID for later cleanup
   */
  private trackTimeout(timeoutId: number): number {
    this.timeoutIds.push(timeoutId);
    return timeoutId;
  }

  /**
   * Clear all tracked timeouts
   */
  private clearAllTimeouts(): void {
    this.timeoutIds.forEach((id) => {
      clearTimeout(id);
    });
    this.timeoutIds = [];

    // Also clear the interval if it exists
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
  }

  private handleAbort() {
    // Set aborted flag
    this.isAborted = true;
    // No longer expecting responses after abort
    this.expectingResponses = false;

    // Clear all processing pages
    this.processingPages.clear();

    // Reject all queue items
    this.processingQueue.forEach((item) => {
      item.reject(new Error("Processing aborted"));
    });
    this.processingQueue = [];
    this.activeProcessing = 0;

    // Clear all timeouts and intervals
    this.clearAllTimeouts();

    // Clean up recovery subscriptions to prevent stale event handling
    // But don't reset the isAborted flag
    this.unsubscribeFromRecoveryEvents();
    logger.log(
      `[PDFProcessor] Unsubscribed from all recovery events during abort for client ${this.clientId}`
    );

    // Remove worker message handler if it exists
    if (this.worker && this.workerMessageHandler) {
      this.worker.removeEventListener("message", this.workerMessageHandler);
      this.workerMessageHandler = undefined;
    }

    // Emit a custom cleanup event to cancel any associated timeouts
    if (isWindowDefined()) {
      logger.log(
        `[PDFProcessor] Dispatching cleanup event for aborted client ${this.clientId}`
      );
      const cleanupEvent = new CustomEvent(ProcessorEventType.Cleanup, {
        detail: { clientId: this.clientId },
      });
      document.dispatchEvent(cleanupEvent);
    }

    if (this.worker) {
      this.sendWorkerMessageWithRelease(WorkerMessageType.AbortProcessing);
    }
  }

  public async processFile(
    file: File,
    statusCallback?: (status: {
      status: ProcessingStatus;
      totalPages?: number;
      recoveredInit?: boolean;
    }) => void
  ): Promise<{ totalPages: number; status: ProcessingStatus }> {
    if (!isBrowser) {
      throw new Error(
        "PDF processing is only available in browser environments"
      );
    }

    if (this.abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

    if (statusCallback) {
      this.onStatusUpdate = statusCallback;
    }

    this.expectingResponses = true;

    this.fileSize = file.size;
    this.processingConfig = this.getProcessingConfig(file.size);

    const pdfData = await file.arrayBuffer();

    if (this.abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

    try {
      return await this.withRetry(
        async () => {
          if (!this.worker) {
            await this.initializeWorker();
            if (!this.worker) {
              throw new Error("Failed to initialize worker");
            }
          }

          return await new Promise((resolve, reject) => {
            notifyProcessingActivity(this.clientId);

            const onMessage = (e: MessageEvent) => {
              notifyProcessingActivity(this.clientId);

              if (e.data.type === WorkerMessageType.PDFInitialized) {
                this.worker!.removeEventListener("message", onMessage);

                const result = {
                  totalPages: e.data.totalPages,
                  status: ProcessingStatus.PROCESSING,
                };

                if (this.onStatusUpdate) {
                  this.onStatusUpdate(result);
                }

                resolve(result);
              } else if (e.data.type === WorkerMessageType.Error) {
                this.worker!.removeEventListener("message", onMessage);
                this.expectingResponses = false;

                const error = new Error(e.data.error);

                if (this.onStatusUpdate) {
                  this.onStatusUpdate({
                    status: ProcessingStatus.FAILED,
                    recoveredInit: false,
                  });
                }

                reject(error);
              }
            };

            this.worker!.addEventListener("message", onMessage);

            // Clone the PDF data for retry scenarios
            const pdfDataCopy = pdfData.slice(0);

            this.worker!.postMessage(
              {
                type: WorkerMessageType.InitPDF,
                pdfData: pdfDataCopy,
                clientId: this.clientId,
              },
              [pdfDataCopy]
            );
          });
        },
        {
          operationName: OperationName.PDFProcessing,
          maxAttempts: 3,
        }
      );
    } catch (error) {
      this.expectingResponses = false;

      if (this.onStatusUpdate) {
        this.onStatusUpdate({
          status: ProcessingStatus.FAILED,
          recoveredInit: false,
        });
      }

      throw error;
    }
  }

  public async getPage(
    pageNumber: number,
    displayInfo?: {
      devicePixelRatio: number;
      containerWidth: number;
      containerHeight?: number;
    }
  ): Promise<{
    pageNumber: number;
    url: string;
    dimensions: { width: number; height: number };
  }> {
    if (!isBrowser) {
      throw new Error(
        "PDF processing is only available in browser environments"
      );
    }

    if (this.isAborted || this.abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

    if (!this.expectingResponses) {
      throw new Error("Processor is no longer expecting responses");
    }

    notifyProcessingActivity(this.clientId);

    // Check cache first
    const cached = this.pageCache.get(`page-${pageNumber}`);
    if (cached) {
      cached.lastAccessed = Date.now();
      return {
        url: cached.url,
        dimensions: {
          width: cached.dimensions.width,
          height: cached.dimensions.height,
        },
        pageNumber: cached.pageNumber,
      };
    }

    try {
      return await this.withRetry(
        async () => {
          // Ensure worker is available
          if (!this.worker) {
            await this.initializeWorker();
            if (!this.worker) {
              throw new Error(
                "Failed to initialize worker for page processing"
              );
            }
          }

          return await new Promise((resolve, reject) => {
            if (this.isAborted || this.abortSignal?.aborted) {
              reject(new Error("Processing aborted"));
              return;
            }

            if (!this.expectingResponses) {
              reject(new Error("Processor is no longer expecting responses"));
              return;
            }

            const abortHandler = () => {
              this.processingQueue = this.processingQueue.filter((item) => {
                if (item.pageNumber === pageNumber) {
                  item.reject(new Error("Processing aborted"));
                  return false;
                }
                return true;
              });
              this.processingPages.delete(pageNumber);
            };

            this.processingQueue.push({
              pageNumber,
              resolve: (result: {
                url: string;
                dimensions: { width: number; height: number };
                pageNumber: number;
              }) => {
                this.processingPages.delete(pageNumber);
                resolve(result);
              },
              reject: (error: Error) => {
                this.processingPages.delete(pageNumber);
                reject(error);
              },
              displayInfo,
            });

            if (this.abortSignal) {
              this.abortSignal.addEventListener("abort", abortHandler, {
                once: true,
              });
            }

            this.processNextInQueue();
          });
        },
        {
          operationName: `${OperationName.GetPage} ${pageNumber}`,
          maxAttempts: 3,
        }
      );
    } catch (error) {
      // Let the error propagate after all retries failed
      throw error;
    }
  }

  public abort() {
    this.handleAbort();
  }

  public cleanup() {
    // Clear tracking sets
    this.processingPages.clear();
    this.processingQueue = [];
    this.activeProcessing = 0;

    // Clear all timeouts and intervals
    this.clearAllTimeouts();

    // Unsubscribe from recovery events
    this.cleanupRecoverySubscriptions();

    // Remove worker message handler if it exists
    if (this.worker && this.workerMessageHandler) {
      this.worker.removeEventListener("message", this.workerMessageHandler);
      this.workerMessageHandler = undefined;
    }

    if (this.worker) {
      this.cleanupWorker();
    }

    if (this.abortSignal) {
      this.abortSignal.removeEventListener(
        "abort",
        this.handleAbort.bind(this)
      );
    }

    // Emit a custom cleanup event to cancel any associated timeouts
    if (isWindowDefined()) {
      logger.log(
        `[PDFProcessor] Dispatching cleanup event for client ${this.clientId}`
      );
      const cleanupEvent = new CustomEvent(ProcessorEventType.Cleanup, {
        detail: { clientId: this.clientId },
      });
      document.dispatchEvent(cleanupEvent);
    }
  }

  /**
   * Handle worker cleanup with proper sequencing
   * This ensures the cleanup message is sent before releasing the worker
   */
  private cleanupWorker(): void {
    if (!this.worker) return;

    this.sendWorkerMessageWithRelease(WorkerMessageType.Cleanup);
  }

  /**
   * Sends a message to the worker and releases it after sending the cleanup message
   * @param messageType The type of message to send
   */
  private sendWorkerMessageWithRelease(messageType: WorkerMessageType): void {
    if (!this.worker) return;

    const worker = this.worker;

    this.worker = undefined;

    // Send the cleanup message
    worker.postMessage({
      type: messageType,
      clientId: this.clientId,
    });

    PDFWorkerPool.getInstance()
      .then((workerPool) => {
        logger.log(`Releasing worker for client ${this.clientId} back to pool`);
        workerPool.releaseWorker(worker);
      })
      .catch((error) => {
        logger.error("Error releasing worker:", error);
      });
  }

  /**
   * Set up recovery event handlers
   */
  private setupRecoveryEventHandlers(): void {
    // Handle recovered page processed events
    this.pageRecoveryUnsubscribe = recoveryEmitter.on(
      RecoveryEventType.PageProcessed,
      async (data) => {
        const pageData = data as PageProcessedRecoveryData;

        // Verify this recovery event belongs to this processor by matching client ID
        if (!pageData.clientId || pageData.clientId !== this.clientId) return;

        logger.log(
          `[RecoverySystem] Received orphaned PageProcessed event for page ${pageData.pageNumber}, client ${pageData.clientId}`
        );

        // If this is our client, try to recover the page result
        const workerPool = await PDFWorkerPool.getInstance();
        const orphanedResult = workerPool.getOrphanedResult(
          pageData.recoveryKey
        );

        if (
          orphanedResult &&
          "dimensions" in orphanedResult &&
          "blobData" in orphanedResult
        ) {
          const { pageNumber, blobData, dimensions } = orphanedResult;

          // If we already have this page in our cache, ignore the recovery
          if (this.pageCache.has(`page-${pageNumber}`)) {
            logger.log(
              `[RecoverySystem] Page ${pageNumber} already in cache, ignoring recovery`
            );
            return;
          }

          // Create a blob URL from the orphaned result
          try {
            const blob = new Blob([blobData], { type: "image/webp" });
            const url = URL.createObjectURL(blob);

            this.pageCache.set(`page-${pageNumber}`, {
              url,
              lastAccessed: Date.now(),
              dimensions,
              pageNumber,
            });

            // Find and resolve any queued items for this page
            const queueItems = this.processingQueue.filter(
              (item) => item.pageNumber === pageNumber
            );

            if (queueItems.length > 0) {
              logger.log(
                `[RecoverySystem] Resolving ${queueItems.length} queued items for recovered page ${pageNumber}`
              );

              queueItems.forEach((item) => {
                item.resolve({ url, dimensions, pageNumber });
              });

              // Remove resolved items from the queue
              this.processingQueue = this.processingQueue.filter(
                (item) => item.pageNumber !== pageNumber
              );

              // Update processing tracking
              this.processingPages.delete(pageNumber);
              this.activeProcessing = Math.max(0, this.activeProcessing - 1);
            }
          } catch (error) {
            logger.error(
              `[RecoverySystem] Error recovering page ${pageNumber}:`,
              error
            );
          }
        }
      }
    );

    // Handle recovered PDF initialized events
    this.pdfInitRecoveryUnsubscribe = recoveryEmitter.on(
      RecoveryEventType.PDFInitialized,
      async (data) => {
        // Type assertion to ensure we have the right data type
        const initData = data as PDFInitializedRecoveryData;

        // Verify this recovery event belongs to this processor by matching client ID
        if (!initData.clientId || initData.clientId !== this.clientId) return;

        logger.log(
          `[RecoverySystem] Received orphaned PDFInitialized event for client ${initData.clientId} with ${initData.totalPages} pages`
        );

        // Get the orphaned result to access any additional data
        const workerPool = await PDFWorkerPool.getInstance();
        const orphanedResult = workerPool.getOrphanedResult(
          initData.recoveryKey
        );

        if (orphanedResult && "totalPages" in orphanedResult) {
          // Notify about successful recovery if onStatusUpdate callback is provided
          if (this.onStatusUpdate) {
            this.onStatusUpdate({
              status: ProcessingStatus.PROCESSING,
              totalPages: orphanedResult.totalPages,
              recoveredInit: true,
            });
          }

          logger.log(
            `[RecoverySystem] Successfully recovered PDFInitialized event with ${orphanedResult.totalPages} pages`
          );
        }
      }
    );

    // Handle error recovery events
    this.errorRecoveryUnsubscribe = recoveryEmitter.on<WorkerMessageType.Error>(
      RecoveryEventType.Error,
      (data) => {
        // Verify this recovery event belongs to this processor by matching client ID
        if (!data.clientId || data.clientId !== this.clientId) return;

        logger.error(
          `[RecoverySystem] Received orphaned error event for client ${data.clientId}: ${data.error}`
        );

        // Forward the error to the error handler if registered
        if (this.onError) {
          this.onError(
            new Error(`Recovered error: ${data.error}`),
            data.pageNumber
          );
        }
      }
    );

    // Handle cleanup recovery events
    this.cleanupRecoveryUnsubscribe =
      recoveryEmitter.on<WorkerMessageType.Cleanup>(
        RecoveryEventType.Cleanup,
        (data) => {
          // Verify this recovery event belongs to this processor by matching client ID
          if (!data.clientId || data.clientId !== this.clientId) return;

          logger.log(
            `[RecoverySystem] Received orphaned cleanup event for client ${data.clientId}`
          );

          // Since this is a cleanup event, we can mark the processor as no longer expecting responses
          this.expectingResponses = false;
        }
      );

    // Handle abort recovery events
    this.abortRecoveryUnsubscribe =
      recoveryEmitter.on<WorkerMessageType.AbortProcessing>(
        RecoveryEventType.AbortProcessing,
        (data) => {
          // Verify this recovery event belongs to this processor by matching client ID
          if (!data.clientId || data.clientId !== this.clientId) return;

          logger.log(
            `[RecoverySystem] Received orphaned abort processing event for client ${data.clientId}`
          );

          // Since this is an abort event, we can mark processing as aborted
          this.isAborted = true;
        }
      );
  }

  /**
   * Cleans up all recovery event subscriptions and resets state
   * This method unsubscribes from all recovery events without performing full cleanup
   */
  private cleanupRecoverySubscriptions(): void {
    // Unsubscribe from all recovery events
    this.unsubscribeFromRecoveryEvents();

    // Reset state flags to ensure consistency
    this.resetState();

    logger.log(
      `[PDFProcessor] Unsubscribed from all recovery events for client ${this.clientId}`
    );
  }

  /**
   * Unsubscribes from all recovery events without resetting state
   */
  private unsubscribeFromRecoveryEvents(): void {
    if (this.pageRecoveryUnsubscribe) {
      this.pageRecoveryUnsubscribe();
      this.pageRecoveryUnsubscribe = undefined;
    }

    if (this.pdfInitRecoveryUnsubscribe) {
      this.pdfInitRecoveryUnsubscribe();
      this.pdfInitRecoveryUnsubscribe = undefined;
    }

    if (this.errorRecoveryUnsubscribe) {
      this.errorRecoveryUnsubscribe();
      this.errorRecoveryUnsubscribe = undefined;
    }

    if (this.cleanupRecoveryUnsubscribe) {
      this.cleanupRecoveryUnsubscribe();
      this.cleanupRecoveryUnsubscribe = undefined;
    }

    if (this.abortRecoveryUnsubscribe) {
      this.abortRecoveryUnsubscribe();
      this.abortRecoveryUnsubscribe = undefined;
    }
  }

  /**
   * Resets all state flags to their initial values
   *
   * State flags:
   * - expectingResponses: When true, the processor is actively expecting responses from the worker
   *   and will process queued operations. When false, no new operations will be processed.
   * - isAborted: When true, the processor has been aborted and will not process any new operations.
   *   This is used to prevent any further processing after an abort signal.
   */
  private resetState(): void {
    this.expectingResponses = false;
    this.isAborted = false;
  }

  /**
   * Get the unique client ID assigned to this processor instance
   * Used for activity tracking and worker communication
   */
  public getClientId(): string {
    return this.clientId;
  }
}

export class PDFBatchProcessor {
  private maxConcurrentFiles: number;
  private processorOptions: Partial<ProcessingOptions>;

  constructor({
    maxConcurrentFiles = DEFAULT_MAX_CONCURRENT_FILES,
    processorOptions = {},
  } = {}) {
    this.maxConcurrentFiles = maxConcurrentFiles;
    this.processorOptions = processorOptions;
  }

  /**
   * Process a batch of files with concurrency management
   */
  public async processBatch(
    files: File[],
    callbacks: {
      onFileAdd: (
        fileName: string,
        totalPages: number,
        metadata: { size: number; type: string }
      ) => void;
      onFileStatus: (fileName: string, status: ProcessingStatus) => void;
      onPageProcessed: (
        fileName: string,
        pageNumber: number,
        url: string | null,
        status: ProcessingStatus
      ) => void;
      displayInfo: DisplayInfo;
    },
    abortSignal: AbortSignal
  ): Promise<void> {
    if (!isBrowser) {
      throw new Error(
        "PDF processing is only available in browser environments"
      );
    }

    try {
      await PDFWorkerPool.getInstance();
    } catch (error) {
      logger.error("Error initializing worker", error);
      throw new Error("Failed to initialize PDF workers. Please try again.");
    }

    const limit = pLimit(this.maxConcurrentFiles);

    const processFile = async (file: File) => {
      if (abortSignal.aborted) {
        throw new Error("Processing aborted");
      }

      const failedPages = new Map<
        string,
        { pageNumber: number; attempts: number }[]
      >();

      const processorOptions = this.getProcessorOptionsForBatch(files.length);
      const processor = new PDFProcessor(processorOptions, abortSignal);

      const processorClientId = processor.getClientId();

      notifyProcessingActivity(processorClientId);

      let resolveTimeout: () => void = () => {};

      try {
        const result = createTimeoutPromise(
          file.name,
          file.size,
          processorClientId,
          abortSignal
        );

        const timeoutPromise = result.timeoutPromise;
        resolveTimeout = result.resolveTimeout;

        monitorProcessingTimeout(timeoutPromise).catch((error) => {
          logger.error(`Timeout monitor detected issue: ${error.message}`);
        });

        // (await PDFWorkerPool.getInstance()).trackClient(processorClientId);

        const initResult = await processor.processFile(file);

        const { totalPages, status } = initResult;

        const abortListener = () => {
          processor.abort();
        };
        abortSignal.addEventListener("abort", abortListener);

        batchedUpdates(() => {
          callbacks.onFileAdd(file.name, totalPages, {
            size: file.size,
            type: file.type,
          });
          callbacks.onFileStatus(file.name, status);
        });

        logger.log(
          `Starting to process all pages for ${file.name} (${totalPages} pages)`
        );

        notifyProcessingActivity(processorClientId);

        const pageResults = await this.processAllPagesWithRetry(
          file.name,
          totalPages,
          processor,
          {
            ...callbacks,
            displayInfo: callbacks.displayInfo,
          },
          abortSignal,
          failedPages
        );

        notifyProcessingActivity(processorClientId);

        logger.log(
          `Finished processing all pages for ${file.name}, result count: ${pageResults.length}`
        );

        const hasPageFailure = pageResults.some(
          (result) =>
            result.status === "rejected" ||
            (result.status === "fulfilled" && result.value === true)
        );

        callbacks.onFileStatus(
          file.name,
          hasPageFailure ? ProcessingStatus.FAILED : ProcessingStatus.COMPLETED
        );

        const failedPagesCount = pageResults.filter(
          (result) =>
            result.status === "rejected" ||
            (result.status === "fulfilled" && result.value === true)
        ).length;

        if (failedPagesCount === totalPages) {
          throw new Error(
            `Failed to process all pages in "${file.name}". Please try again.`
          );
        }

        abortSignal.removeEventListener("abort", abortListener);

        notifyProcessingActivity(processorClientId);

        return processor;
      } catch (error) {
        callbacks.onFileStatus(file.name, ProcessingStatus.FAILED);
        throw error;
      } finally {
        logger.log(
          `Processing complete for ${file.name}, cleaning up resources`
        );

        resolveTimeout();
        processor.cleanup();
      }
    };

    const processingPromises = files.map((file) =>
      limit(() => processFile(file))
    );

    const results = await Promise.allSettled(processingPromises);

    const errors = results.filter((r) => r.status === "rejected");
    if (errors.length > 0) {
      errors.forEach((error, index) => {
        if (error.status === "rejected") {
          const fileName =
            files[
              results.findIndex(
                (r) =>
                  r.status === "rejected" &&
                  errors.indexOf(r as PromiseRejectedResult) === index
              )
            ]?.name || "unknown";
          logger.error(`Error processing file ${fileName}:`, error.reason);
        }
      });

      throw new Error(
        "One or more files failed during processing. Check file panel for more details."
      );
    }
  }

  /**
   * Get processor options adjusted for batch size
   */
  private getProcessorOptionsForBatch(
    batchSize: number
  ): Partial<ProcessingOptions> {
    const options = { ...this.processorOptions };

    if (batchSize > 5) {
      options.pageProcessingSlots = 1;
    } else if (batchSize > 2) {
      options.pageProcessingSlots = 2;
    } else {
      options.pageProcessingSlots = 3;
    }

    return options;
  }

  /**
   * Process all pages in a file with retry logic, including online status checking
   */
  private async processAllPagesWithRetry(
    fileName: string,
    totalPages: number,
    processor: PDFProcessor,
    callbacks: {
      onPageProcessed: (
        fileName: string,
        pageNumber: number,
        url: string | null,
        status: ProcessingStatus
      ) => void;
      displayInfo?: DisplayInfo;
    },
    abortSignal: AbortSignal,
    failedPages: Map<string, { pageNumber: number; attempts: number }[]>
  ) {
    function isOnline() {
      return navigator.onLine;
    }

    const processorClientId = processor.getClientId();

    async function processPageWithRetry(pageNumber: number): Promise<boolean> {
      notifyProcessingActivity(processorClientId);

      if (!failedPages.has(fileName)) {
        failedPages.set(fileName, []);
      }

      logger.log(`Starting processing for ${fileName} page ${pageNumber}`);

      for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
        if (abortSignal.aborted) {
          throw new Error("Processing aborted");
        }

        try {
          while (!isOnline()) {
            logger.warn(
              `User offline. Pausing retries for ${fileName} page ${pageNumber}`
            );
            if (attempt > 1) {
              toast.warning(
                `User offline. Pausing retries for ${fileName} page ${pageNumber}`,
                { id: "is-online" }
              );
            }
            await delay(5000);
            if (abortSignal.aborted) {
              throw new Error("Processing aborted");
            }
          }

          callbacks.onPageProcessed(
            fileName,
            pageNumber,
            null,
            ProcessingStatus.PROCESSING
          );

          logger.log(`Calling getPage for ${fileName} page ${pageNumber}`);
          const data = await processor.getPage(
            pageNumber,
            callbacks.displayInfo
          );
          logger.log(
            `Finished getPage for ${fileName} page ${pageNumber}, got URL: ${data.url.substring(
              0,
              30
            )}...`
          );

          if (abortSignal.aborted) {
            throw new Error("Processing aborted");
          }

          callbacks.onPageProcessed(
            fileName,
            pageNumber,
            data.url,
            ProcessingStatus.COMPLETED
          );

          const pageRetries = failedPages.get(fileName)!;
          const pageRetryIndex = pageRetries.findIndex(
            (p) => p.pageNumber === pageNumber
          );
          if (pageRetryIndex >= 0) {
            pageRetries.splice(pageRetryIndex, 1);
          }

          logger.log(`Successfully processed ${fileName} page ${pageNumber}`);
          return false;
        } catch (error) {
          const isProduction = process.env.NODE_ENV === "production";

          logger.warn(
            `Page ${pageNumber} of ${fileName} failed (Attempt: ${attempt})`
          );

          const pageRetries = failedPages.get(fileName)!;
          const existingPage = pageRetries.find(
            (p) => p.pageNumber === pageNumber
          );

          if (existingPage) {
            existingPage.attempts++;
          } else {
            pageRetries.push({ pageNumber, attempts: 1 });
          }

          if (attempt === MAX_PAGE_RETRIES) {
            if (isProduction) {
              logger.error(error);
            }
            callbacks.onPageProcessed(
              fileName,
              pageNumber,
              null,
              ProcessingStatus.FAILED
            );
            return true;
          }

          const delayTime = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await delay(delayTime);

          if (abortSignal.aborted) {
            throw new Error("Processing aborted");
          }
        }
      }
      return true;
    }

    const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    return Promise.allSettled(pageNumbers.map(processPageWithRetry));
  }

  /**
   * Terminates all workers in the pool
   * Call this when the application is shutting down or
   * when the PDF processing functionality is no longer needed
   */
  public static async terminateAllWorkers(): Promise<void> {
    const workerPool = await PDFWorkerPool.getInstance();
    workerPool.terminateAll();
  }
}

/**
 * Start monitoring a timeout promise without letting it affect normal processing
 * This ensures we detect timeouts but don't interfere with normal operation
 */
async function monitorProcessingTimeout(
  timeoutPromise: Promise<void>
): Promise<void> {
  try {
    await timeoutPromise;
    // The promise can be resolved if processing completes normally,
    // which means we've already cleared timeouts
    logger.log("Processing completed normally, timeout promise resolved");
  } catch (error) {
    // Just propagate the error up - this is expected behavior for timeouts
    throw error;
  }
}

/**
 * Create a timeout promise that monitors processing activity
 * @param fileName Name of the file being processed
 * @param fileSize Size of the file in bytes
 * @param processorClientId Client ID for tracking (required)
 * @param abortSignal Optional abort signal to connect UI abort actions
 * @returns Promise and resolve function
 */
function createTimeoutPromise(
  fileName: string,
  fileSize: number,
  processorClientId: string,
  abortSignal?: AbortSignal
): { timeoutPromise: Promise<void>; resolveTimeout: () => void } {
  // TODO: move to config/env
  const MAX_TIMEOUT = 300000; // 5 minutes absolute maximum
  const HEARTBEAT_INTERVAL = 5000; // 5 seconds between checks
  const INACTIVITY_WARNING_THRESHOLD = HEARTBEAT_INTERVAL * 2; // 10s warning
  const INACTIVITY_ERROR_THRESHOLD = HEARTBEAT_INTERVAL * 6; // 30s timeout

  let lastActivityTimestamp = Date.now();
  let isProcessingActive = true;
  let warningIssued = false;

  let isPromiseSettled = false;

  // All timeouts and listeners that need to be cleaned up
  const resources = {
    heartbeatInterval: null as NodeJS.Timeout | null,
    maxTimeoutId: null as NodeJS.Timeout | null,
    activityListener: null as ((e: Event) => void) | null,
    abortHandler: null as (() => void) | null,
    cleanupListener: null as ((e: Event) => void) | null,

    // Clear all timeouts and remove all event listeners
    cleanup: () => {
      if (resources.heartbeatInterval) {
        clearInterval(resources.heartbeatInterval);
        resources.heartbeatInterval = null;
      }
      if (resources.maxTimeoutId) {
        clearTimeout(resources.maxTimeoutId);
        resources.maxTimeoutId = null;
      }
      if (resources.activityListener && isWindowDefined()) {
        document.removeEventListener(
          ProcessorEventType.Activity,
          resources.activityListener
        );
        resources.activityListener = null;
      }
      if (resources.cleanupListener && isWindowDefined()) {
        document.removeEventListener(
          ProcessorEventType.Cleanup,
          resources.cleanupListener
        );
        resources.cleanupListener = null;
      }
      if (resources.abortHandler && abortSignal) {
        abortSignal.removeEventListener("abort", resources.abortHandler);
        resources.abortHandler = null;
      }
      logger.log(`Cleaned up timeouts and listeners for file "${fileName}"`);
    },
  };

  let resolvePromise: () => void;

  const timeoutPromise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;

    // Update the activity timestamp to keep the process active
    const updateActivity = () => {
      lastActivityTimestamp = Date.now();
      isProcessingActive = true;
      warningIssued = false;
    };

    const safeReject = (error: Error, reason: string) => {
      if (isPromiseSettled) return;

      isPromiseSettled = true;
      logger.error(`${reason} for "${fileName}"`);
      resources.cleanup();
      reject(error);
    };

    // Create the heartbeat interval to monitor activity
    resources.heartbeatInterval = setInterval(() => {
      if (isPromiseSettled) return;

      const inactiveTime = Date.now() - lastActivityTimestamp;

      // First threshold: Just log a warning
      if (inactiveTime > INACTIVITY_WARNING_THRESHOLD && !warningIssued) {
        isProcessingActive = false;
        warningIssued = true;
        logger.warn(
          `Processing appears stuck for "${fileName}" - no activity for ${Math.round(
            inactiveTime / 1000
          )}s`
        );
      }

      // Second threshold: Actually reject with timeout error
      if (
        inactiveTime > INACTIVITY_ERROR_THRESHOLD &&
        !isProcessingActive &&
        !isPromiseSettled
      ) {
        safeReject(
          new Error(
            `Processing timeout for file "${fileName}" (${(
              fileSize /
              (1024 * 1024)
            ).toFixed(1)}MB) - no activity for ${Math.round(
              inactiveTime / 1000
            )}s`
          ),
          "Inactivity timeout exceeded"
        );
      }
    }, HEARTBEAT_INTERVAL);

    // Set absolute maximum timeout
    resources.maxTimeoutId = setTimeout(() => {
      if (isPromiseSettled) return;

      safeReject(
        new Error(
          `Maximum processing time (${
            MAX_TIMEOUT / 1000
          }s) exceeded for file "${fileName}"`
        ),
        "Maximum processing time exceeded"
      );
    }, MAX_TIMEOUT);

    // Set up activity tracking event listener
    if (global.EventTarget && isWindowDefined()) {
      resources.activityListener = (e: Event) => {
        const event = e as CustomEvent;
        if (event.detail && event.detail.clientId === processorClientId) {
          updateActivity();
        }
      };
      document.addEventListener(
        ProcessorEventType.Activity,
        resources.activityListener
      );
    }

    // Set up abort signal handling
    if (abortSignal) {
      resources.abortHandler = () => {
        if (isPromiseSettled) return;

        safeReject(new Error("Processing aborted"), "Abort signal received");
      };

      if (abortSignal.aborted) {
        resources.abortHandler();
      } else {
        abortSignal.addEventListener("abort", resources.abortHandler);
      }
    }

    // Listen for cleanup events
    if (isWindowDefined()) {
      resources.cleanupListener = (e: Event) => {
        const event = e as CustomEvent;
        if (event.detail && event.detail.clientId === processorClientId) {
          resources.cleanup();
          logger.log(
            `Received cleanup event for client ID ${event.detail.clientId}`
          );
          if (!isPromiseSettled) {
            safeReject(
              new Error(`Processing of "${fileName}" was manually cleaned up`),
              "Manual cleanup requested"
            );
          }
        }
      };
      document.addEventListener(
        ProcessorEventType.Cleanup,
        resources.cleanupListener
      );
    }

    updateActivity();
  });

  const resolveTimeout = () => {
    if (isPromiseSettled) return;

    logger.log(
      `Processing completed successfully for "${fileName}", resolving timeout`
    );
    isPromiseSettled = true;
    resources.cleanup();
    resolvePromise();
  };

  return {
    timeoutPromise,
    resolveTimeout,
  };
}

/**
 * Notify the activity system that processing is still happening
 */
export function notifyProcessingActivity(clientId: string): void {
  if (isWindowDefined()) {
    const event = new CustomEvent(ProcessorEventType.Activity, {
      detail: { clientId },
    });
    logger.log(`Dispatching activity event for client ${clientId}`);
    document.dispatchEvent(event);
  }
}
