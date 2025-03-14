/* eslint-disable @typescript-eslint/no-unused-vars */
import { ProcessingStatus } from "@/store/processed-files";
import { delay } from "@/utils/app";
import { toast } from "sonner";
import { unstable_batchedUpdates as batchedUpdates } from "react-dom";

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
   * Process a batch of images
   */
  public async processBatch(
    files: File[],
    callbacks: ImageProcessingCallbacks,
    abortSignal: AbortSignal
  ) {
    const state = { totalPages: 0, processedPages: 0 };

    state.totalPages = files.length;

    await delay(1000);

    try {
      for (const file of files) {
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
            callbacks.onImageProcessed(
              file.name,
              url,
              ProcessingStatus.COMPLETED
            );
            callbacks.onFileStatus(file.name, ProcessingStatus.COMPLETED);
          });

          state.processedPages++;
          this.updateProgress(state.processedPages, state.totalPages);
        } catch (error) {
          callbacks.onFileStatus(file.name, ProcessingStatus.FAILED);
          throw error;
        }
      }
    } catch (error) {
      throw error;
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
