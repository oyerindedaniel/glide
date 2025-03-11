/* eslint-disable @typescript-eslint/no-unused-vars */
import { ProcessingStatus } from "@/store/processed-files";
import { toast } from "sonner";

// Constants for image size management
const SIZE_LIMITS = {
  SINGLE_IMAGE_MAX_SIZE: 8 * 1024 * 1024, // 8MB per image
  TOTAL_BATCH_MAX_SIZE: 500 * 1024 * 1024, // 500MB total
  MAX_FILES_IN_BATCH: 100, // Maximum 100 images
};

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
  onTotalImagesUpdate: (count: number) => void;
}

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

export class ImageBatchProcessor {
  private maxFilesInBatch: number;
  private singleImageMaxSize: number;
  private totalBatchMaxSize: number;
  private allowedImageTypes: string[];

  constructor({
    maxFilesInBatch = SIZE_LIMITS.MAX_FILES_IN_BATCH,
    singleImageMaxSize = SIZE_LIMITS.SINGLE_IMAGE_MAX_SIZE,
    totalBatchMaxSize = SIZE_LIMITS.TOTAL_BATCH_MAX_SIZE,
    allowedImageTypes = ["image/png", "image/jpeg", "image/webp"],
  } = {}) {
    this.maxFilesInBatch = maxFilesInBatch;
    this.singleImageMaxSize = singleImageMaxSize;
    this.totalBatchMaxSize = totalBatchMaxSize;
    this.allowedImageTypes = allowedImageTypes;
  }

  /**
   * Validates a batch of images
   */
  public validateFiles(files: File[]): FileValidationResult {
    // Check if we're exceeding the max number of files
    if (files.length > this.maxFilesInBatch) {
      return {
        isValid: false,
        error: `Maximum of ${this.maxFilesInBatch} images allowed per batch`,
      };
    }

    // Check total batch size
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > this.totalBatchMaxSize) {
      return {
        isValid: false,
        error: `Total batch size exceeds ${Math.round(
          this.totalBatchMaxSize / (1024 * 1024)
        )}MB limit`,
      };
    }

    // Check individual file sizes and types
    for (const file of files) {
      if (file.size > this.singleImageMaxSize) {
        return {
          isValid: false,
          error: `File "${file.name}" exceeds ${Math.round(
            this.singleImageMaxSize / (1024 * 1024)
          )}MB limit`,
        };
      }

      if (!this.allowedImageTypes.includes(file.type)) {
        return {
          isValid: false,
          error: `File "${file.name}" is not a supported image type`,
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Process a batch of images
   */
  public async processBatch(
    files: File[],
    callbacks: ImageProcessingCallbacks,
    abortSignal: AbortSignal,
    state: { totalPages: number; processedPages: number }
  ): Promise<void> {
    // Validate files first
    const validation = this.validateFiles(files);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Update total count
    state.totalPages = files.length;
    callbacks.onTotalImagesUpdate(files.length);

    // Process each image
    for (const file of files) {
      if (abortSignal.aborted) {
        throw new Error("Processing aborted");
      }

      try {
        callbacks.onFileStatus(file.name, ProcessingStatus.PROCESSING);
        callbacks.onFileAdd(file.name, 1, { size: file.size, type: file.type });

        const url = URL.createObjectURL(file);

        // await new Promise((resolve) => setTimeout(resolve, 100));

        if (abortSignal.aborted) {
          URL.revokeObjectURL(url);
          throw new Error("Processing aborted");
        }

        callbacks.onImageProcessed(file.name, url, ProcessingStatus.COMPLETED);
        callbacks.onFileStatus(file.name, ProcessingStatus.COMPLETED);

        state.processedPages++;
        this.updateProgress(state.processedPages, state.totalPages);
      } catch (error) {
        if ((error as Error).message === "Processing aborted") {
          throw error;
        }

        console.error(`Failed to process image ${file.name}:`, error);
        callbacks.onFileStatus(file.name, ProcessingStatus.FAILED);
        callbacks.onImageProcessed(file.name, null, ProcessingStatus.FAILED);
      }
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
  public cleanup(files: File[]) {
    // cleanup logic here
  }
}
