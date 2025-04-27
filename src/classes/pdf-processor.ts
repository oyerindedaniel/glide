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
  getExponentialBackoffDelay,
} from "@/utils/app";
import {
  createConcurrencyConfig,
  ConcurrencyOptions,
  ConcurrencyConfig,
  calculateOptimalCoordinatorCount,
} from "@/utils/concurrency";
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
  PDF_MAX_TIMEOUT,
  PDF_HEARTBEAT_INTERVAL,
  PDF_INACTIVITY_WARNING_THRESHOLD,
  PDF_INACTIVITY_ERROR_THRESHOLD,
} from "@/config/app";
import recoveryEmitter from "@/utils/recovery-event-emitter";
import { v4 as uuidv4 } from "uuid";
import {
  WorkerError,
  WorkerInitializationError,
  AbortError,
  normalizeError,
  ErrorCode,
  WorkerCommunicationError,
  tryCatch,
  isErrorType,
  SystemError,
  isWorkerErrorType,
  errorMessageMap,
  getErrorMessage,
} from "@/utils/error";
import {
  PDFError,
  PDFAllPagesFailedError,
  PDFSomePagesFailedError,
  determinePDFErrorCode,
} from "@/utils/pdf-errors";
import { BatchProcessingError, ErrorRecord } from "@/utils/pdf-errors";
import { formatFileSize } from "@/utils/file";
import { fileProcessingEmitter } from "@/classes/file-processing-emitter";
import { FILE_PROCESSING_EVENTS } from "@/constants/processing";

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
  public isAborted: boolean = false;
  public isCleanedUp: boolean = false;
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
        const typedError = normalizeError(error);

        if (!shouldRetry(typedError)) {
          throw typedError;
        }

        lastError = typedError;
        attempts++;

        logger.warn(
          `${operationName} attempt ${attempts}/${maxAttempts} failed: ${typedError.message}`
        );

        if (attempts < maxAttempts) {
          const backoffTime = getExponentialBackoffDelay(
            retryDelayMs,
            attempts
          );
          await delay(backoffTime);
        }
      }
    }

    throw (
      lastError ||
      new WorkerError(`${operationName} failed after ${maxAttempts} attempts`)
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
            throw new WorkerInitializationError(
              "Failed to get worker from pool"
            );
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
        const error = new WorkerError(`Worker error: ${event.message}`);
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
          isErrorType(error, WorkerError)
            ? error
            : new WorkerInitializationError(
                `Failed to initialize worker: ${
                  isErrorType(error, Error) ? error.message : String(error)
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
      item.reject(new AbortError("Processing aborted"));
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
      throw new WorkerError(
        "PDF processing is only available in browser environments",
        ErrorCode.WORKER_ERROR
      );
    }

    if (this.abortSignal?.aborted) {
      throw new AbortError("Processing aborted");
    }

    if (statusCallback) {
      this.onStatusUpdate = statusCallback;
    }

    this.expectingResponses = true;

    this.fileSize = file.size;
    this.processingConfig = this.getProcessingConfig(file.size);

    const pdfData = await file.arrayBuffer();

    if (this.abortSignal?.aborted) {
      throw new AbortError("Processing aborted");
    }

    try {
      return await this.withRetry(
        async () => {
          if (!this.worker) {
            await this.initializeWorker();
            if (!this.worker) {
              throw new WorkerInitializationError(
                "Failed to initialize worker"
              );
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

                const error = normalizeError(e.data.error);

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
      throw new WorkerError(
        "PDF processing is only available in browser environments",
        ErrorCode.WORKER_ERROR
      );
    }

    if (this.isAborted || this.abortSignal?.aborted) {
      throw new AbortError("Processing aborted");
    }

    if (!this.expectingResponses) {
      throw new WorkerCommunicationError(
        "Processor is no longer expecting responses"
      );
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
              throw new WorkerInitializationError(
                "Failed to initialize worker for page processing"
              );
            }
          }

          return await new Promise((resolve, reject) => {
            if (this.isAborted || this.abortSignal?.aborted) {
              reject(new AbortError("Processing aborted"));
              return;
            }

            if (!this.expectingResponses) {
              reject(
                new WorkerCommunicationError(
                  "Processor is no longer expecting responses"
                )
              );
              return;
            }

            const abortHandler = () => {
              this.processingQueue = this.processingQueue.filter((item) => {
                if (item.pageNumber === pageNumber) {
                  item.reject(new AbortError("Processing aborted"));
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
      this.isCleanedUp = true;
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
    if (this.worker) {
      this.sendWorkerMessageWithRelease(WorkerMessageType.Cleanup);
    }
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
  private usedOptimalConcurrency: boolean = false;

  constructor({
    maxConcurrentFiles = DEFAULT_MAX_CONCURRENT_FILES,
    processorOptions = {},
    detectOptimalConcurrency = true,
    concurrencyOptions = {},
  }: {
    maxConcurrentFiles?: number;
    processorOptions?: Partial<ProcessingOptions>;
    detectOptimalConcurrency?: boolean;
    concurrencyOptions?: ConcurrencyOptions;
  } = {}) {
    if (detectOptimalConcurrency && isBrowser) {
      try {
        const concurrencyConfig = createConcurrencyConfig({
          customConcurrency:
            maxConcurrentFiles !== DEFAULT_MAX_CONCURRENT_FILES
              ? maxConcurrentFiles
              : undefined,
          ...concurrencyOptions,
        });

        this.maxConcurrentFiles = concurrencyConfig.maxConcurrentFiles;
        this.usedOptimalConcurrency = concurrencyConfig.usedOptimalDetection;

        if (concurrencyConfig.usedOptimalDetection) {
          logger.log(
            `Using optimal concurrency: ${this.maxConcurrentFiles} concurrent files based on system capabilities`
          );
        }
      } catch (error) {
        logger.warn(
          "Failed to detect optimal concurrency, using default",
          error
        );
        this.maxConcurrentFiles = maxConcurrentFiles;
      }
    } else {
      this.maxConcurrentFiles = maxConcurrentFiles;
    }

    this.processorOptions = processorOptions;
  }

  /**
   * Get information about the current concurrency configuration
   */
  public getConcurrencyInfo(): ConcurrencyConfig {
    return {
      maxConcurrentFiles: this.maxConcurrentFiles,
      usedOptimalDetection: this.usedOptimalConcurrency,
    };
  }

  /**
   * Process a batch of files with concurrency management
   */
  public async processBatch(
    files: File[],
    displayInfo: DisplayInfo,
    abortSignal: AbortSignal
  ): Promise<void> {
    if (!isBrowser) {
      throw new WorkerError(
        "PDF processing is only available in browser environments",
        ErrorCode.WORKER_ERROR
      );
    }

    const { data: workerPool, error: workerPoolError } = await tryCatch(
      PDFWorkerPool.getInstance({
        detectOptimalConcurrency: true,
        concurrencyOptions: {
          customConcurrency: this.usedOptimalConcurrency
            ? this.maxConcurrentFiles
            : undefined,
        },
        coordinatorCount: this.usedOptimalConcurrency
          ? calculateOptimalCoordinatorCount(this.maxConcurrentFiles)
          : undefined,
      })
    );

    if (workerPoolError) {
      if (isWorkerErrorType(workerPoolError.raw)) {
        logger.error(`Failed to initialize PDF workers: ${workerPoolError}`);
        throw new SystemError();
      }

      throw workerPoolError.raw;
    }

    const poolConfig = workerPool.getPoolConfiguration();
    logger.log(
      `PDF Batch Processor: ${this.maxConcurrentFiles} concurrent files` +
        (this.usedOptimalConcurrency ? " (auto-detected)" : "") +
        `, Worker Pool: ${poolConfig.maxWorkers} workers, ${poolConfig.coordinatorCount} coordinators` +
        (poolConfig.usedOptimalDetection ? " (auto-detected)" : "")
    );

    const limit = pLimit(this.maxConcurrentFiles);

    // Controller to allow aborting all concurrent operations
    const abortController = new AbortController();
    const localAbortSignal = abortController.signal;

    // Local abort controller linked to the provided abort signal
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        logger.log(
          "External abort signal detected, aborting all PDF processing"
        );
        abortController.abort();
      });
    }

    // Active processors for cleanup
    const activeProcessors: PDFProcessor[] = [];

    const processFile = async (file: File) => {
      if (localAbortSignal.aborted) {
        logger.log(`Skipping processing of ${file.name} due to abort`);
        fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
          fileName: file.name,
          status: ProcessingStatus.ABORTED,
        });
        throw new AbortError("Processing aborted");
      }

      const failedPages = new Map<
        string,
        {
          pageNumber: number;
          attempts: number;
          reason?: string;
          code?: ErrorCode;
        }[]
      >();

      const processorOptions = this.getProcessorOptionsForBatch(files.length);
      const processor = new PDFProcessor(processorOptions, localAbortSignal);
      activeProcessors.push(processor);

      const processorClientId = processor.getClientId();

      notifyProcessingActivity(processorClientId);

      let resolveTimeout: () => void = () => {};

      const abortListener = () => {
        processor.abort();
      };

      try {
        const result = createTimeoutPromise(
          file.name,
          file.size,
          processorClientId,
          localAbortSignal
        );

        const timeoutPromise = result.timeoutPromise;
        resolveTimeout = result.resolveTimeout;

        monitorProcessingTimeout(timeoutPromise).catch((error) => {
          logger.error(`Timeout monitor detected issue: ${error.message}`);
        });

        const { data: processFileResult, error: processFileError } =
          await tryCatch(processor.processFile(file));

        if (processFileError) {
          throw processFileError.raw;
        }

        const { totalPages } = processFileResult;

        localAbortSignal.addEventListener("abort", abortListener);

        batchedUpdates(() => {
          fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_ADD, {
            fileName: file.name,
            totalPages,
            metadata: { size: file.size, type: file.type },
          });
          fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
            fileName: file.name,
            status: ProcessingStatus.PROCESSING,
          });
        });

        logger.log(
          `Starting to process all pages for ${file.name} (${totalPages} pages)`
        );

        notifyProcessingActivity(processorClientId);

        try {
          await this.processAllPagesWithRetry(
            file.name,
            totalPages,
            processor,
            displayInfo,
            localAbortSignal,
            failedPages
          );

          if (localAbortSignal.aborted) {
            throw new AbortError("Processing aborted");
          }

          fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
            fileName: file.name,
            status: ProcessingStatus.COMPLETED,
          });
        } catch (error) {
          if (isErrorType(error, AbortError)) {
            if (!localAbortSignal.aborted) {
              logger.log(
                `Abort detected in ${file.name}, aborting all processing`
              );
              abortController.abort();

              for (const proc of activeProcessors) {
                if (proc !== processor && !proc.isAborted) {
                  proc.abort();
                }
              }
            }

            throw error;
          }

          if (isErrorType(error, PDFError)) {
            throw error;
          }

          logger.error(
            `Error processing file ${file.name}:`,
            normalizeError(error)
          );
          throw new SystemError();
        }

        notifyProcessingActivity(processorClientId);
        return processor;
      } catch (error) {
        if (isErrorType(error, AbortError)) {
          fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
            fileName: file.name,
            status: ProcessingStatus.ABORTED,
          });

          if (!localAbortSignal.aborted) {
            logger.log(
              `Abort detected in ${file.name}, aborting all processing`
            );
            abortController.abort();

            for (const proc of activeProcessors) {
              if (proc !== processor && !proc.isAborted) {
                proc.abort();
              }
            }
          }

          throw error;
        }

        fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
          fileName: file.name,
          status: ProcessingStatus.FAILED,
        });

        if (isErrorType(error, PDFError)) {
          if (!error.fileName) {
            error.fileName = file.name;
          }
          throw error;
        } else {
          throw BatchProcessingError.fromError(file.name, error);
        }
      } finally {
        localAbortSignal.removeEventListener("abort", abortListener);
        logger.log(
          `Processing complete for ${file.name}, cleaning up resources`
        );
        resolveTimeout();
        processor.cleanup();

        const index = activeProcessors.indexOf(processor);
        if (index > -1) {
          activeProcessors.splice(index, 1);
        }
      }
    };

    try {
      const processingPromises = files.map((file) =>
        limit(() => processFile(file))
      );

      const results = await Promise.allSettled(processingPromises);
      const hasErrors = results.some((result) => result.status === "rejected");

      if (hasErrors) {
        // Group errors by file
        const fileErrors: Record<string, unknown> = {};

        let abortDetected = false;
        let pdfErrorCount = 0;
        let allPagesFailedCount = 0;
        let firstPDFError: PDFError | null = null;
        let batchProcessingErrorDetected = false;
        let firstBatchProcessingError: BatchProcessingError | null = null;

        results.forEach((result, index) => {
          if (result.status === "rejected") {
            const fileName = files[index]?.name || "unknown";
            const error = result.reason as unknown;

            logger.error(
              `Error processing file ${fileName}:`,
              normalizeError(error)
            );

            // Checks for abort first as highest priority
            if (isErrorType(error, AbortError)) {
              abortDetected = true;
            } else if (isErrorType(error, PDFError)) {
              pdfErrorCount++;
              if (!firstPDFError) {
                firstPDFError = error;
              }
              if (isErrorType(error, PDFAllPagesFailedError)) {
                allPagesFailedCount++;
              }
            } else if (isErrorType(error, BatchProcessingError)) {
              batchProcessingErrorDetected = true;
              if (!firstBatchProcessingError) {
                firstBatchProcessingError = error;
              }
            }

            // Group by file
            fileErrors[fileName] = error;
          }
        });

        // Handles errors in priority order:
        // 1. Abort error (highest priority)
        // 2. PDF errors
        // 3. Existing BatchProcessingError instances
        // 4. Other errors (create new generic batch error)

        if (abortDetected) {
          throw new AbortError("Processing aborted by user");
        }

        if (pdfErrorCount > 0) {
          if (allPagesFailedCount === pdfErrorCount && firstPDFError) {
            throw firstPDFError;
          }

          throw new PDFError(
            `Failed to process ${pdfErrorCount} PDF file(s). Check the upload panel for more details.`,
            ErrorCode.PDF_BATCH_FAILURE
          );
        }

        if (batchProcessingErrorDetected && firstBatchProcessingError) {
          throw firstBatchProcessingError;
        }

        const errorRecords: ErrorRecord[] = Object.entries(fileErrors).map(
          ([fileName, error]) =>
            BatchProcessingError.createErrorRecord(fileName, error)
        );

        throw BatchProcessingError.fromErrors(errorRecords);
      }
    } catch (error) {
      if (!localAbortSignal.aborted && isErrorType(error, AbortError)) {
        abortController.abort();
      }

      for (const processor of activeProcessors) {
        if (localAbortSignal.aborted && !processor.isAborted) {
          processor.abort();
        }
      }

      for (const processor of activeProcessors) {
        if (!processor.isCleanedUp) {
          processor.cleanup();
        }
      }

      throw error;
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
    displayInfo: DisplayInfo,
    abortSignal: AbortSignal,
    failedPages: Map<
      string,
      {
        pageNumber: number;
        attempts: number;
        reason?: string;
        code?: ErrorCode;
      }[]
    >
  ) {
    function isOnline() {
      return navigator.onLine;
    }

    const processorClientId = processor.getClientId();

    async function processPageWithRetry(pageNumber: number): Promise<void> {
      notifyProcessingActivity(processorClientId);

      if (!failedPages.has(fileName)) {
        failedPages.set(fileName, []);
      }

      let currentAttempt = 1;
      let lastError: Error | null = null;

      while (currentAttempt <= MAX_PAGE_RETRIES) {
        try {
          if (abortSignal.aborted) {
            throw new AbortError("Processing aborted");
          }

          const pageAttempts = failedPages
            .get(fileName)!
            .find((p) => p.pageNumber === pageNumber);

          // If we already exceeded max retries, fail fast
          if (pageAttempts && pageAttempts.attempts >= MAX_PAGE_RETRIES) {
            const errorMsg =
              pageAttempts.reason ||
              `Failed to process page ${pageNumber} after ${MAX_PAGE_RETRIES} attempts`;
            fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.PAGE_PROCESSED, {
              fileName,
              pageNumber,
              url: null,
              status: ProcessingStatus.FAILED,
              errorReason: errorMsg,
            });
            throw new PDFError(
              errorMsg,
              pageAttempts?.code || ErrorCode.PDF_PROCESSING_FAILED,
              {
                pageNumber,
                fileName,
              }
            );
          }

          // Wait until we're online
          while (!isOnline()) {
            logger.warn(
              `User offline. Pausing retries for ${fileName} page ${pageNumber}`
            );
            if (pageAttempts && pageAttempts.attempts > 1) {
              toast.warning(
                `User offline. Pausing retries for ${fileName} page ${pageNumber}`,
                { id: "is-online" }
              );
            }
            const delayTime = getExponentialBackoffDelay(
              2500,
              pageAttempts ? pageAttempts.attempts : currentAttempt
            );
            await delay(delayTime);
            if (abortSignal.aborted) {
              throw new AbortError("Processing aborted");
            }
          }

          fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.PAGE_PROCESSED, {
            fileName,
            pageNumber,
            url: null,
            status: ProcessingStatus.PROCESSING,
          });

          logger.log(`Calling getPage for ${fileName} page ${pageNumber}`);
          const { data, error: getPageError } = await tryCatch(
            processor.getPage(pageNumber, displayInfo)
          );

          if (getPageError) {
            throw getPageError.raw;
          }

          logger.log(
            `Finished getPage for ${fileName} page ${pageNumber}, got URL: ${data.url.substring(
              0,
              30
            )}...`
          );

          if (abortSignal.aborted) {
            throw new AbortError("Processing aborted");
          }

          fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.PAGE_PROCESSED, {
            fileName,
            pageNumber,
            url: data.url,
            status: ProcessingStatus.COMPLETED,
          });

          const pageRetries = failedPages.get(fileName)!;
          const pageRetryIndex = pageRetries.findIndex(
            (p) => p.pageNumber === pageNumber
          );
          if (pageRetryIndex >= 0) {
            pageRetries.splice(pageRetryIndex, 1);
          }

          logger.log(`Successfully processed ${fileName} page ${pageNumber}`);
          return;
        } catch (error: unknown) {
          if (isErrorType(error, AbortError) || abortSignal.aborted) {
            throw new AbortError("Processing aborted");
          }

          const errorCode = determinePDFErrorCode(error);

          // reason for this so pdf error from pdfjs-dist library are handled with a unified for error code and error message
          // note this is not the throw error, that is handled above
          const errorMessage = getErrorMessage(
            error,
            () => errorMessageMap[errorCode]
          );

          const pageRetries = failedPages.get(fileName)!;
          const existingRetry = pageRetries.find(
            (p) => p.pageNumber === pageNumber
          );

          if (existingRetry) {
            existingRetry.attempts = currentAttempt;
            existingRetry.reason = errorMessage;
          } else {
            pageRetries.push({
              pageNumber,
              attempts: currentAttempt,
              reason: errorMessage,
              code: errorCode,
            });
          }

          logger.error(
            `Error processing page ${pageNumber} of ${fileName} (attempt ${currentAttempt}/${MAX_PAGE_RETRIES}):`,
            error
          );

          lastError = normalizeError(error);

          // If we still have retries left, delay and continue the loop
          if (currentAttempt < MAX_PAGE_RETRIES) {
            const delayMs = getExponentialBackoffDelay(
              BASE_DELAY_MS,
              currentAttempt
            );
            await delay(delayMs);
            currentAttempt++;
            continue;
          }

          // We've exhausted retries
          fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.PAGE_PROCESSED, {
            fileName,
            pageNumber,
            url: null,
            status: ProcessingStatus.FAILED,
            errorReason: errorMessage,
          });

          throw new PDFError(errorMessage, errorCode, {
            pageNumber,
            fileName,
          });
        }
      }

      // This should not be reached
      if (lastError) {
        logger.error(
          `Failed to process page ${pageNumber} of ${fileName} (unexpected condition):`,
          lastError
        );
        throw lastError;
      }

      throw new PDFError(
        `Failed to process page ${pageNumber} of ${fileName} (unexpected condition)`,
        ErrorCode.PDF_PROCESSING_FAILED,
        {
          pageNumber,
          fileName,
        }
      );
    }

    const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    const results = await Promise.allSettled(
      pageNumbers.map(processPageWithRetry)
    );

    let abortDetected = false;
    for (const result of results) {
      if (
        result.status === "rejected" &&
        isErrorType(result.reason, AbortError)
      ) {
        abortDetected = true;
        break;
      }
    }

    if (abortDetected) {
      throw new AbortError("Processing aborted");
    }

    // Collect all failed pages
    const failedPagesMap = new Map<number, string>();
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const pageNumber = index + 1;
        const error = result.reason;
        const errorMessage = normalizeError(error).message;
        failedPagesMap.set(pageNumber, errorMessage);
      }
    });

    if (failedPagesMap.size > 0) {
      // If all pages failed
      if (failedPagesMap.size === totalPages) {
        logger.error(
          `All ${totalPages} pages failed to process in file ${fileName}`,
          failedPagesMap
        );
        throw new PDFAllPagesFailedError(
          `All ${totalPages} pages failed to process in file ${fileName}`,
          { fileName, failedPages: failedPagesMap }
        );
      }

      // If some pages failed
      logger.error(
        `Some pages failed to process in file ${fileName}`,
        failedPagesMap
      );
      throw new PDFSomePagesFailedError(
        `${failedPagesMap.size} out of ${totalPages} pages failed to process in file ${fileName}`,
        { fileName, failedPages: failedPagesMap }
      );
    }

    return results;
  }

  /**
   * Terminates all workers in the pool
   * Call this when the application is shutting down or
   * when the PDF processing functionality is no longer needed
   */
  public static async terminateAllWorkers(): Promise<void> {
    try {
      const workerPool = await PDFWorkerPool.getInstance({
        detectOptimalConcurrency: false,
      });
      workerPool.terminateAll();
    } catch (error) {
      logger.error("Error terminating worker pool:", error);
    }
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
  const MAX_TIMEOUT = PDF_MAX_TIMEOUT;
  const HEARTBEAT_INTERVAL = PDF_HEARTBEAT_INTERVAL;
  const INACTIVITY_WARNING_THRESHOLD = PDF_INACTIVITY_WARNING_THRESHOLD;
  const INACTIVITY_ERROR_THRESHOLD = PDF_INACTIVITY_ERROR_THRESHOLD;

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
            `Processing timeout for file "${fileName}" (${formatFileSize(
              fileSize
            )}) - no activity for ${Math.round(inactiveTime / 1000)}s`
          ),
          "Processing timeout"
        );
      }
    }, HEARTBEAT_INTERVAL);

    // Create the max timeout to reject if processing takes too long
    resources.maxTimeoutId = setTimeout(() => {
      if (isPromiseSettled) return;

      safeReject(
        new Error(
          `Processing timeout for file "${fileName}" (${formatFileSize(
            fileSize
          )}) - processing took too long`
        ),
        "Processing timeout"
      );
    }, MAX_TIMEOUT);

    // Create an activity listener to keep the process active
    resources.activityListener = (e: Event) => {
      if (isPromiseSettled) return;

      const event = e as CustomEvent;
      if (event.detail && event.detail.clientId === processorClientId) {
        updateActivity();
      }
    };

    // Create an abort handler to reject if processing is aborted
    resources.abortHandler = () => {
      if (isPromiseSettled) return;

      safeReject(new AbortError("Processing aborted"), "Processing aborted");
    };

    // Create a cleanup listener to clean up resources on promise resolution
    resources.cleanupListener = () => {
      if (isPromiseSettled) return;

      isPromiseSettled = true;
      resources.cleanup();
      resolvePromise();
    };

    // Set up all event listeners
    if (isWindowDefined()) {
      document.addEventListener(
        ProcessorEventType.Activity,
        resources.activityListener
      );
      document.addEventListener(
        ProcessorEventType.Cleanup,
        resources.cleanupListener
      );
    }

    if (abortSignal) {
      abortSignal.addEventListener("abort", resources.abortHandler);
    }
  });

  return {
    timeoutPromise,
    resolveTimeout: () => {
      if (isPromiseSettled) return;

      isPromiseSettled = true;
      resources.cleanup();
      resolvePromise();
    },
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
