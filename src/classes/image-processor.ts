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
import { AbortError } from "@/utils/error";
import { fileProcessingEmitter } from "@/classes/file-processing-emitter";
import { FILE_PROCESSING_EVENTS } from "@/constants/processing";

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
  public async processBatch(files: File[], abortSignal: AbortSignal) {
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
          limit(() => this.processImage(file, abortSignal, state))
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
    abortSignal: AbortSignal,
    state: { totalPages: number; processedPages: number }
  ): Promise<boolean> {
    if (abortSignal.aborted) {
      throw new AbortError("Processing aborted");
    }

    try {
      batchedUpdates(() => {
        fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
          fileName: file.name,
          status: ProcessingStatus.PROCESSING,
        });

        fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_ADD, {
          fileName: file.name,
          totalPages: 1,
          metadata: {
            size: file.size,
            type: file.type,
          },
        });
      });

      const url = URL.createObjectURL(file);

      if (abortSignal.aborted) {
        URL.revokeObjectURL(url);
        throw new AbortError("Processing aborted");
      }

      batchedUpdates(() => {
        fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.PAGE_PROCESSED, {
          fileName: file.name,
          pageNumber: 1, // Images always have 1 page
          url,
          status: ProcessingStatus.COMPLETED,
        });

        fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
          fileName: file.name,
          status: ProcessingStatus.COMPLETED,
        });
      });

      state.processedPages++;
      this.updateProgress(state.processedPages, state.totalPages);
      return true;
    } catch (error) {
      fileProcessingEmitter.emit(FILE_PROCESSING_EVENTS.FILE_STATUS, {
        fileName: file.name,
        status: ProcessingStatus.FAILED,
      });
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
