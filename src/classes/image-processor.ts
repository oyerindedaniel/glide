/* eslint-disable @typescript-eslint/no-unused-vars */
import { ProcessingStatus } from "@/store/processed-files";
import { delay, isBrowserWithWorker } from "@/utils/app";
import { toast } from "sonner";
import { unstable_batchedUpdates as batchedUpdates } from "react-dom";
import pLimit from "p-limit";
import {
  ConcurrencyConfig,
  ConcurrencyOptions,
  createConcurrencyConfig,
} from "@/utils/concurrency";
import { DEFAULT_MAX_CONCURRENT_FILES } from "@/config/app";
import logger from "@/utils/logger";

export interface ImageProcessingCallbacks {
  onFileAdd: (
    fileName: string,
    totalPages: number,
    metadata: { size: number; type: string }
  ) => void;
  onFileStatus: (fileName: string, status: ProcessingStatus) => void;
  onImageProcessed: (
    fileName: string,
    url: string | null,
    status: ProcessingStatus
  ) => void;
}

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

export interface ImageBatchProcessorOptions {
  allowedImageTypes?: string[];
  maxConcurrentFiles?: number;
  detectOptimalConcurrency?: boolean;
  concurrencyOptions?: ConcurrencyOptions;
}

export class ImageBatchProcessor {
  private maxConcurrentFiles: number;
  private usedOptimalConcurrency: boolean = false;
  private allowedImageTypes: string[] = [];

  constructor({
    allowedImageTypes = [],
    maxConcurrentFiles = DEFAULT_MAX_CONCURRENT_FILES,
    detectOptimalConcurrency = true,
    concurrencyOptions = {},
  }: ImageBatchProcessorOptions = {}) {
    this.allowedImageTypes = allowedImageTypes;

    if (detectOptimalConcurrency && isBrowserWithWorker()) {
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
            `Using optimal concurrency for image processing: ${this.maxConcurrentFiles} concurrent files based on system capabilities`
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
   * Process a batch of images
   */
  public async processBatch(
    files: File[],
    callbacks: ImageProcessingCallbacks,
    abortSignal: AbortSignal
  ) {
    const state = { totalPages: 0, processedPages: 0 };
    state.totalPages = files.length;

    logger.log(
      `Processing ${files.length} images with concurrency: ${this.maxConcurrentFiles}` +
        (this.usedOptimalConcurrency ? " (auto-detected)" : "")
    );

    await delay(750);

    try {
      const limit = pLimit(this.maxConcurrentFiles);

      const results = await Promise.all(
        files.map((file) =>
          limit(() => this.processImage(file, callbacks, abortSignal, state))
        )
      );

      const failedCount = results.filter((result) => !result).length;
      if (failedCount > 0) {
        logger.warn(`${failedCount} images failed to process`);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Process a single image file
   */
  private async processImage(
    file: File,
    callbacks: ImageProcessingCallbacks,
    abortSignal: AbortSignal,
    state: { totalPages: number; processedPages: number }
  ): Promise<boolean> {
    if (abortSignal.aborted) {
      throw new Error("Processing aborted");
    }

    try {
      batchedUpdates(() => {
        callbacks.onFileStatus(file.name, ProcessingStatus.PROCESSING);
        callbacks.onFileAdd(file.name, 1, {
          size: file.size,
          type: file.type,
        });
      });

      const url = URL.createObjectURL(file);

      if (abortSignal.aborted) {
        URL.revokeObjectURL(url);
        throw new Error("Processing aborted");
      }

      batchedUpdates(() => {
        callbacks.onImageProcessed(file.name, url, ProcessingStatus.COMPLETED);
        callbacks.onFileStatus(file.name, ProcessingStatus.COMPLETED);
      });

      state.processedPages++;
      this.updateProgress(state.processedPages, state.totalPages);
      return true;
    } catch (error) {
      callbacks.onFileStatus(file.name, ProcessingStatus.FAILED);
      return false;
    }
  }

  /**
   * Update progress toast
   */
  private updateProgress(processedPages: number, totalPages: number) {
    if (totalPages === 0) return;

    const progress = Math.round((processedPages / totalPages) * 100);
    toast.loading(
      `Processing images: ${progress}% (${processedPages} of ${totalPages})`,
      { id: "file-processing" }
    );
  }

  /**
   * Clean up resources
   */
  public cleanup(files: File[]) {}
}
