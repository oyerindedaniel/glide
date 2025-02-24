/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { ProcessingStatus } from "@/store/processed-files";
import { WorkerMessageType } from "@/types/processor";

import * as pdfjsLib from "pdfjs-dist";
import { PageProcessingConfig } from "@/types/processor";

interface ProcessingOptions {
  maxConcurrent: number;
  pageBufferSize: number;
  maxFileSizeMB: number;
  processingConfigs: {
    small: PageProcessingConfig;
    medium: PageProcessingConfig;
    large: PageProcessingConfig;
  };
}

const DEFAULT_OPTIONS: ProcessingOptions = {
  maxConcurrent: 2,
  pageBufferSize: 5,
  maxFileSizeMB: 50,
  processingConfigs: {
    small: { scale: 1.5, quality: 0.8, maxDimension: 2000 },
    medium: { scale: 1.2, quality: 0.7, maxDimension: 1500 },
    large: { scale: 1.0, quality: 0.6, maxDimension: 1200 },
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
};

export class PDFProcessor {
  private worker: Worker;
  private pageCache: Map<string, CacheItem>;
  private options: ProcessingOptions;
  private processingQueue: Array<{
    pageNumber: number;
    resolve: Function;
    reject: Function;
  }>;
  private activeProcessing: number;
  private abortController: AbortController | null;
  private processingConfig: PageProcessingConfig;
  private pdf: pdfjsLib.PDFDocumentProxy | null = null;
  private pdfData: Promise<ArrayBuffer>;

  constructor(options: Partial<ProcessingOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.worker = new Worker(
      new URL("../worker/pdf.worker.ts", import.meta.url)
    );
    this.pageCache = new Map();
    this.processingQueue = [];
    this.activeProcessing = 0;
    this.abortController = null;

    this.processingConfig = this.options.processingConfigs.small;
    this.pdfData = Promise.resolve(new ArrayBuffer(0));

    this.setupWorkerMessageHandler();
    this.startCacheCleanupInterval();
  }

  private setupWorkerMessageHandler() {
    this.worker.onmessage = (e) => {
      if (e.data.type === WorkerMessageType.PageProcessed) {
        const { pageNumber, blob, dimensions } = e.data;
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
        const queueItem = this.processingQueue.find(
          (item) => item.pageNumber === e.data.pageNumber
        );
        if (queueItem) {
          queueItem.reject(new Error(e.data.error));
          this.processingQueue = this.processingQueue.filter(
            (item) => item.pageNumber !== e.data.pageNumber
          );
        }
        this.activeProcessing--;
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
    if (sizeMB >= this.options.maxFileSizeMB) {
      return this.options.processingConfigs.large;
    } else if (sizeMB > this.options.maxFileSizeMB / 2) {
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
        pageData: await this.pdfData,
        config: this.processingConfig,
      });
    }
  }

  public async processFile(
    file: File
  ): Promise<{ totalPages: number; status: ProcessingStatus }> {
    if (file.size > this.options.maxFileSizeMB * 1024 * 1024) {
      throw new Error(
        `File size exceeds ${this.options.maxFileSizeMB}MB limit`
      );
    }

    this.abortController = new AbortController();
    this.processingConfig = this.getProcessingConfig(file.size);
    this.pdfData = file.arrayBuffer();

    this.pdf = await pdfjsLib.getDocument({ data: await this.pdfData }).promise;

    this.worker.postMessage(
      {
        type: WorkerMessageType.InitPDF,
        pdfData: this.pdfData,
      },
      [this.pdfData]
    );

    return {
      totalPages: this.pdf.numPages,
      status: ProcessingStatus.PROCESSING,
    };
  }

  public async getPage(pageNumber: number): Promise<{
    pageNumber: number;
    url: string;
    dimensions: { width: number; height: number };
  }> {
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
      this.processingQueue.push({ pageNumber, resolve, reject });
      this.processNextInQueue();
    });
  }

  public abort() {
    this.abortController?.abort();
    this.processingQueue = [];
    this.activeProcessing = 0;
  }

  public cleanup() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_, value] of this.pageCache.entries()) {
      URL.revokeObjectURL(value.url);
    }
    this.pageCache.clear();
    this.worker.terminate();
  }
}
