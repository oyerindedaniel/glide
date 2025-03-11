/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { ProcessingStatus } from "@/store/processed-files";
import { WorkerMessageType } from "@/types/processor";
import { PageProcessingConfig } from "@/types/processor";
import pLimit from "p-limit";
import { toast } from "sonner";

// Constants for file size management
const SIZE_LIMITS = {
  SINGLE_PDF_MAX_SIZE: 100 * 1024 * 1024, // 100MB
  BATCH_PDF_MAX_SIZE: 50 * 1024 * 1024, // 50MB
  TOTAL_BATCH_MAX_SIZE: 200 * 1024 * 1024, // 200MB
  MAX_FILES_IN_BATCH: 10,
};

interface ProcessingOptions {
  maxConcurrent: number;
  pageBufferSize: number;
  processingConfigs: {
    small: PageProcessingConfig;
    medium: PageProcessingConfig;
    large: PageProcessingConfig;
  };
  maxRetries: number;
  onError?: (error: Error, pageNumber?: number) => void;
}

const DEFAULT_OPTIONS: ProcessingOptions = {
  maxConcurrent: 2,
  pageBufferSize: 5,
  maxRetries: 3,
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
  private worker: Worker;
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

  constructor(
    options: Partial<ProcessingOptions> = {},
    abortSignal?: AbortSignal
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onError = options.onError;
    this.abortSignal = abortSignal;

    this.worker = new Worker(
      new URL("../worker/pdf.worker.ts", import.meta.url)
    );
    this.pageCache = new Map();
    this.processingQueue = [];
    this.activeProcessing = 0;
    this.processingConfig = this.options.processingConfigs.small;

    this.setupWorkerMessageHandler();
    this.startCacheCleanupInterval();

    if (abortSignal) {
      abortSignal.addEventListener("abort", this.handleAbort.bind(this));
    }

    this.worker.onerror = (event) => {
      const error = new Error(`Worker error: ${event.message}`);
      console.log(`Worker error: ${event.message}`);
      this.onError?.(error);
    };
  }

  private setupWorkerMessageHandler() {
    this.worker.onmessage = (e) => {
      if (e.data.type === WorkerMessageType.PageProcessed) {
        const { pageNumber, blobData, dimensions } = e.data;
        const blob = new Blob([blobData], { type: "image/webp" });
        const url = URL.createObjectURL(blob);

        this.pageCache.set(`page-${pageNumber}`, {
          url,
          lastAccessed: Date.now(),
          dimensions,
          pageNumber,
        });

        const queueItem = this.processingQueue.find(
          (item) => item.pageNumber === pageNumber
        );
        if (queueItem) {
          queueItem.resolve({ url, dimensions, pageNumber });
          this.processingQueue = this.processingQueue.filter(
            (item) => item.pageNumber !== pageNumber
          );
        }

        this.activeProcessing--;
        this.processNextInQueue();
      } else if (e.data.type === WorkerMessageType.Error) {
        const error = new Error(e.data.error);
        if (e.data.pageNumber !== undefined) {
          const queueItem = this.processingQueue.find(
            (item) => item.pageNumber === e.data.pageNumber
          );
          if (queueItem) {
            queueItem.reject(error);
            this.processingQueue = this.processingQueue.filter(
              (item) => item.pageNumber !== e.data.pageNumber
            );
          }
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
    setInterval(() => {
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes

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

  private async processNextInQueue() {
    if (
      this.activeProcessing >= this.options.maxConcurrent ||
      this.processingQueue.length === 0
    ) {
      return;
    }

    const nextItem = this.processingQueue[0];
    if (nextItem) {
      this.activeProcessing++;
      this.worker.postMessage({
        type: WorkerMessageType.ProcessPage,
        pageNumber: nextItem.pageNumber,
        config: this.processingConfig,
        displayInfo: nextItem.displayInfo,
      });
    }
  }

  private handleAbort() {
    this.processingQueue.forEach((item) => {
      item.reject(new Error("Processing aborted"));
    });
    this.processingQueue = [];
    this.activeProcessing = 0;

    this.worker.postMessage({
      type: WorkerMessageType.AbortProcessing,
    });
  }

  public async processFile(
    file: File
  ): Promise<{ totalPages: number; status: ProcessingStatus }> {
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
      const onMessage = (e: MessageEvent) => {
        if (e.data.type === WorkerMessageType.PDFInitialized) {
          this.worker.removeEventListener("message", onMessage);
          resolve({
            totalPages: e.data.totalPages,
            status: ProcessingStatus.PROCESSING,
          });
        } else if (e.data.type === WorkerMessageType.Error) {
          this.worker.removeEventListener("message", onMessage);
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
    if (this.abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

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

    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        this.processingQueue = this.processingQueue.filter((item) => {
          if (item.pageNumber === pageNumber) {
            item.reject(new Error("Processing aborted"));
            return false;
          }
          return true;
        });
      };

      this.processingQueue.push({
        pageNumber,
        resolve,
        reject,
        displayInfo,
      });

      if (this.abortSignal) {
        this.abortSignal.addEventListener("abort", abortHandler, {
          once: true,
        });
      }

      this.processNextInQueue();
    });
  }

  public abort() {
    this.handleAbort();
  }

  public cleanup() {
    if (this.abortSignal) {
      this.abortSignal.removeEventListener(
        "abort",
        this.handleAbort.bind(this)
      );
    }
    this.worker.terminate();
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
      onTotalPagesUpdate: (pages: number) => void;
      displayInfo: {
        devicePixelRatio: number;
        containerWidth: number;
        containerHeight?: number;
      };
    },
    abortSignal: AbortSignal
  ): Promise<void> {
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
        callbacks.onFileStatus(file.name, ProcessingStatus.PROCESSING);

        const { totalPages } = await processor.processFile(file);

        const abortListener = () => {
          processor.abort();
        };
        abortSignal.addEventListener("abort", abortListener);

        callbacks.onFileAdd(file.name, totalPages, {
          size: file.size,
          type: file.type,
        });
        callbacks.onTotalPagesUpdate(totalPages);

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
      options.maxConcurrent = 1;
    } else if (batchSize > 2) {
      options.maxConcurrent = 2;
    } else {
      options.maxConcurrent = 3;
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
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 500;

    function isOnline() {
      return navigator.onLine;
    }

    async function processPageWithRetry(pageNumber: number): Promise<boolean> {
      if (!failedPages.has(fileName)) {
        failedPages.set(fileName, []);
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
            await new Promise((r) => setTimeout(r, 5000));
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

          const data = await processor.getPage(
            pageNumber,
            callbacks.displayInfo
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

          if (attempt === MAX_RETRIES) {
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
          await new Promise((r) => setTimeout(r, delayTime));

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
}
