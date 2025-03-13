/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { ProcessingStatus } from "@/store/processed-files";
import { WorkerMessageType } from "@/types/processor";
import { PageProcessingConfig } from "@/types/processor";
import { delay } from "@/utils/app";
import pLimit from "p-limit";
import { toast } from "sonner";
import { MAX_PAGE_RETRIES, BASE_DELAY_MS } from "@/constants/processing";
import { unstable_batchedUpdates as batchedUpdates } from "react-dom";
import { PDFWorkerPool } from "../worker/pdf.worker-pool";

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof Worker !== "undefined";

// Constants for file size management
const SIZE_LIMITS = {
  SINGLE_PDF_MAX_SIZE: 100 * 1024 * 1024, // 100MB
  BATCH_PDF_MAX_SIZE: 50 * 1024 * 1024, // 50MB
  TOTAL_BATCH_MAX_SIZE: 500 * 1024 * 1024, // 500MB
  MAX_FILES_IN_BATCH: 10, // 10 files
};

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
  pageProcessingSlots: 2,
  processingConfigs: {
    small: {
      scale: 2.0,
      quality: 0.85,
      maxDimension: 2500,
    },
    medium: {
      scale: 1.5,
      quality: 0.8,
      maxDimension: 2000,
    },
    large: {
      scale: 1.2,
      quality: 0.75,
      maxDimension: 1600,
    },
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
    displayInfo?: {
      devicePixelRatio: number;
      containerWidth: number;
      containerHeight?: number;
    };
  }>;
  private activeProcessing: number;
  private processingConfig: PageProcessingConfig;
  private onError?: (error: Error, pageNumber?: number) => void;
  private fileSize: number = 0;
  private abortSignal?: AbortSignal;
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  private processingPages: Set<number> = new Set();

  constructor(
    options: Partial<ProcessingOptions> = {},
    abortSignal?: AbortSignal
  ) {
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

    PDFWorkerPool.getInstance()
      .getWorker()
      .then((worker) => {
        this.worker = worker;
        this.setupWorkerMessageHandler();

        worker.onerror = (event) => {
          const error = new Error(`Worker error: ${event.message}`);
          console.log(`Worker error: ${event.message}`);
          this.onError?.(error);
        };
      })
      .catch((error) => {
        if (this.onError) {
          this.onError(
            new Error(`Failed to initialize worker: ${error.message}`)
          );
        }
      });

    this.pageCache = new Map();
    this.processingQueue = [];
    this.activeProcessing = 0;
    this.processingConfig = this.options.processingConfigs.small;

    this.startCacheCleanupInterval();

    if (abortSignal) {
      abortSignal.addEventListener("abort", this.handleAbort.bind(this));
    }
  }

  private setupWorkerMessageHandler() {
    if (!this.worker) return;

    this.worker.onmessage = (e) => {
      // Add debugging for each message received
      const msgId = Math.random().toString(36).substring(2, 8);
      console.log(
        `[${msgId}] PDFProcessor received message: ${e.data.type}, Page: ${
          e.data.pageNumber || "N/A"
        }`
      );

      if (e.data.type === WorkerMessageType.PageProcessed) {
        const { pageNumber, blobData, dimensions } = e.data;
        console.log(
          `[${msgId}] Processing page ${pageNumber}, creating blob URL...`
        );

        const blob = new Blob([blobData], { type: "image/webp" });
        const url = URL.createObjectURL(blob);

        this.pageCache.set(`page-${pageNumber}`, {
          url,
          lastAccessed: Date.now(),
          dimensions,
          pageNumber,
        });

        // Find all queue items for this page
        const queueItems = this.processingQueue.filter(
          (item) => item.pageNumber === pageNumber
        );

        if (queueItems.length > 0) {
          console.log(
            `[${msgId}] Found ${queueItems.length} queue items for page ${pageNumber}, resolving all...`
          );

          // Resolve all queue items for this page
          queueItems.forEach((item) => {
            item.resolve({ url, dimensions, pageNumber });
          });

          // Remove all resolved items from the queue
          this.processingQueue = this.processingQueue.filter(
            (item) => item.pageNumber !== pageNumber
          );
        } else {
          console.warn(
            `[${msgId}] No queue items found for page ${pageNumber}!`
          );
        }

        // Clean up processing tracking
        this.processingPages.delete(pageNumber);
        this.activeProcessing--;
        console.log(
          `[${msgId}] Active processing: ${
            this.activeProcessing
          }, Queue length: ${
            this.processingQueue.length
          }, Processing pages: ${Array.from(this.processingPages).join(", ")}`
        );
        this.processNextInQueue();
      } else if (e.data.type === WorkerMessageType.Error) {
        const error = new Error(e.data.error);
        if (e.data.pageNumber !== undefined) {
          // Find all queue items for this page and reject them
          const queueItems = this.processingQueue.filter(
            (item) => item.pageNumber === e.data.pageNumber
          );

          if (queueItems.length > 0) {
            console.log(
              `Rejecting ${queueItems.length} queue items for page ${e.data.pageNumber} due to error`
            );
            queueItems.forEach((item) => {
              item.reject(error);
            });

            // Remove all rejected items from the queue
            this.processingQueue = this.processingQueue.filter(
              (item) => item.pageNumber !== e.data.pageNumber
            );
          }

          // Clean up processing tracking
          this.processingPages.delete(e.data.pageNumber);
          this.activeProcessing--;
          this.onError?.(error, e.data.pageNumber);
        } else {
          this.onError?.(error);
        }
        this.processNextInQueue();
      }
    };
  }

  private startCacheCleanupInterval() {
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      const maxAge = 10 * 60 * 1000; // 10 minutes

      for (const [key, value] of this.pageCache.entries()) {
        if (now - value.lastAccessed > maxAge) {
          URL.revokeObjectURL(value.url);
          this.pageCache.delete(key);
        }
      }
    }, 60 * 1000); // Checks every minute
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
    if (this.processingQueue.length === 0 || !this.worker) {
      return;
    }

    // Process as many items as we have slots available
    while (
      this.activeProcessing < this.options.pageProcessingSlots &&
      this.processingQueue.length > 0
    ) {
      // Find next page not currently being processed
      const nextItemIndex = this.processingQueue.findIndex(
        (item) => !this.processingPages.has(item.pageNumber)
      );

      // If no pages are available for processing, exit the loop
      if (nextItemIndex === -1) break;

      const nextItem = this.processingQueue[nextItemIndex];
      // Mark this page as being processed but keep it in the queue
      this.processingPages.add(nextItem.pageNumber);

      this.activeProcessing++;

      // Log that we're starting to process this page
      console.log(
        `Starting to process page ${nextItem.pageNumber}, active: ${this.activeProcessing}, queue: ${this.processingQueue.length}`
      );

      this.worker.postMessage({
        type: WorkerMessageType.ProcessPage,
        pageNumber: nextItem.pageNumber,
        config: this.processingConfig,
        displayInfo: nextItem.displayInfo,
      });
    }
  }

  private handleAbort() {
    // Clear all processing pages
    this.processingPages.clear();

    // Reject all queue items
    this.processingQueue.forEach((item) => {
      item.reject(new Error("Processing aborted"));
    });
    this.processingQueue = [];
    this.activeProcessing = 0;

    if (this.worker) {
      this.worker.postMessage({
        type: WorkerMessageType.AbortProcessing,
      });
    }
  }

  public async processFile(
    file: File
  ): Promise<{ totalPages: number; status: ProcessingStatus }> {
    if (!isBrowser) {
      throw new Error(
        "PDF processing is only available in browser environments"
      );
    }

    if (this.abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

    this.fileSize = file.size;
    this.processingConfig = this.getProcessingConfig(file.size);

    const pdfData = await file.arrayBuffer();

    if (this.abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const onMessage = (e: MessageEvent) => {
        if (e.data.type === WorkerMessageType.PDFInitialized) {
          this.worker!.removeEventListener("message", onMessage);
          resolve({
            totalPages: e.data.totalPages,
            status: ProcessingStatus.PROCESSING,
          });
        } else if (e.data.type === WorkerMessageType.Error) {
          this.worker!.removeEventListener("message", onMessage);
          reject(new Error(e.data.error));
        }
      };

      this.worker.addEventListener("message", onMessage);

      this.worker.postMessage(
        {
          type: WorkerMessageType.InitPDF,
          pdfData,
        },
        [pdfData]
      );
    });
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

    if (this.abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

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

    // Create a promise that will be resolved when the page is processed
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        this.processingQueue = this.processingQueue.filter((item) => {
          if (item.pageNumber === pageNumber) {
            item.reject(new Error("Processing aborted"));
            return false;
          }
          return true;
        });
        // Remove from processing set if aborted
        this.processingPages.delete(pageNumber);
      };

      // Add to queue
      this.processingQueue.push({
        pageNumber,
        resolve: (result: {
          url: string;
          dimensions: { width: number; height: number };
          pageNumber: number;
        }) => {
          // Remove from processing set when done
          this.processingPages.delete(pageNumber);
          resolve(result);
        },
        reject: (error: Error) => {
          // Remove from processing set on error
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

      // Process next item in queue
      this.processNextInQueue();
    });
  }

  public abort() {
    this.handleAbort();
  }

  public cleanup() {
    // Clear tracking sets
    this.processingPages.clear();

    // Reject all pending queue items with a cleanup message to avoid hanging promises
    if (this.processingQueue.length > 0) {
      console.log(
        `Cleaning up ${this.processingQueue.length} pending page processing promises`
      );
      this.processingQueue.forEach((item) => {
        item.reject(new Error("Processing stopped during cleanup"));
      });
      this.processingQueue = [];
    }

    if (this.worker) {
      console.log("Sending cleanup message to worker");
      this.worker.postMessage({
        type: WorkerMessageType.Cleanup,
      });

      // Wait a bit to ensure the cleanup message is processed
      setTimeout(() => {
        PDFWorkerPool.getInstance().releaseWorker(this.worker!);
        console.log("Worker released back to pool");
      }, 100);
    }

    if (this.abortSignal) {
      this.abortSignal.removeEventListener(
        "abort",
        this.handleAbort.bind(this)
      );
    }

    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
  }
}

export class PDFBatchProcessor {
  private maxConcurrentFiles: number;
  private maxFilesInBatch: number;
  private singleFileMaxSize: number;
  private batchFileMaxSize: number;
  private totalBatchMaxSize: number;
  private processorOptions: Partial<ProcessingOptions>;

  constructor({
    maxConcurrentFiles = 3,
    maxFilesInBatch = SIZE_LIMITS.MAX_FILES_IN_BATCH,
    singleFileMaxSize = SIZE_LIMITS.SINGLE_PDF_MAX_SIZE,
    batchFileMaxSize = SIZE_LIMITS.BATCH_PDF_MAX_SIZE,
    totalBatchMaxSize = SIZE_LIMITS.TOTAL_BATCH_MAX_SIZE,
    processorOptions = {},
  } = {}) {
    this.maxConcurrentFiles = maxConcurrentFiles;
    this.maxFilesInBatch = maxFilesInBatch;
    this.singleFileMaxSize = singleFileMaxSize;
    this.batchFileMaxSize = batchFileMaxSize;
    this.totalBatchMaxSize = totalBatchMaxSize;
    this.processorOptions = processorOptions;
  }

  /**
   * Validates a file or batch of files against size limits
   */
  public validateFiles(files: File[]): FileValidationResult {
    if (files.length > this.maxFilesInBatch) {
      return {
        isValid: false,
        error: `Maximum of ${this.maxFilesInBatch} PDF files allowed per batch`,
      };
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > this.totalBatchMaxSize) {
      return {
        isValid: false,
        error: `Total batch size exceeds ${Math.round(
          this.totalBatchMaxSize / (1024 * 1024)
        )}MB limit`,
      };
    }

    const maxSizePerFile =
      files.length === 1 ? this.singleFileMaxSize : this.batchFileMaxSize;
    for (const file of files) {
      if (file.size > maxSizePerFile) {
        const maxSizeMB = Math.round(maxSizePerFile / (1024 * 1024));
        return {
          isValid: false,
          error: `File "${file.name}" exceeds ${maxSizeMB}MB limit${
            files.length > 1 ? " for batch processing" : ""
          }`,
        };
      }
    }

    return { isValid: true };
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
      displayInfo: {
        devicePixelRatio: number;
        containerWidth: number;
        containerHeight?: number;
      };
    },
    abortSignal: AbortSignal
  ): Promise<void> {
    if (!isBrowser) {
      throw new Error(
        "PDF processing is only available in browser environments"
      );
    }

    const validation = this.validateFiles(files);
    if (!validation.isValid) {
      throw new Error(validation.error);
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

      try {
        const { totalPages, status } = await processor.processFile(file);

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

        console.log(
          `Starting to process all pages for ${file.name} (${totalPages} pages)`
        );
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
        console.log(
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
      } catch (error) {
        callbacks.onFileStatus(file.name, ProcessingStatus.FAILED);
        throw error;
      } finally {
        processor.cleanup();
      }
    };

    const processingPromises = files.map((file) =>
      limit(() => processFile(file))
    );

    const results = await Promise.allSettled(processingPromises);

    const errors = results.filter((r) => r.status === "rejected");
    if (errors.length > 0) {
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
      displayInfo?: {
        devicePixelRatio: number;
        containerWidth: number;
        containerHeight?: number;
      };
    },
    abortSignal: AbortSignal,
    failedPages: Map<string, { pageNumber: number; attempts: number }[]>
  ) {
    function isOnline() {
      return navigator.onLine;
    }

    async function processPageWithRetry(pageNumber: number): Promise<boolean> {
      if (!failedPages.has(fileName)) {
        failedPages.set(fileName, []);
      }

      console.log(`Starting processing for ${fileName} page ${pageNumber}`);

      for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
        if (abortSignal.aborted) {
          throw new Error("Processing aborted");
        }

        try {
          while (!isOnline()) {
            console.warn(
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

          console.log(`Calling getPage for ${fileName} page ${pageNumber}`);
          const data = await processor.getPage(
            pageNumber,
            callbacks.displayInfo
          );
          console.log(
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

          console.log(`Successfully processed ${fileName} page ${pageNumber}`);
          return false;
        } catch (error) {
          const isProduction = process.env.NODE_ENV === "production";

          console.warn(
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
              console.error(error);
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
      return true; // should never reach here
    }

    const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    return Promise.allSettled(pageNumbers.map(processPageWithRetry));
  }

  /**
   * Terminates all workers in the pool
   * Call this when the application is shutting down or
   * when the PDF processing functionality is no longer needed
   */
  public static terminateAllWorkers(): void {
    PDFWorkerPool.getInstance().terminateAll();
  }
}
