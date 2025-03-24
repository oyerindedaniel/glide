import { useCallback, useRef } from "react";
import {
  ProcessingStatus,
  useProcessedFilesStore,
} from "@/store/processed-files";
import { PDFBatchProcessor } from "@/classes/pdf-processor";
import { ImageBatchProcessor } from "@/classes/image-processor";
import { validateFileBatchWithContent } from "@/utils/file-validation";
import { toast } from "sonner";
import {
  FileAddPayload,
  fileProcessingEmitter,
  FileStatusPayload,
  PageProcessedPayload,
} from "@/classes/file-processing-emitter";
import { FILE_PROCESSING_EVENTS } from "@/constants/processing";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { usePanelHelpers } from "./use-panel-helpers";
import { useShallow } from "zustand/shallow";
import { DisplayInfo } from "@/types/processor";
import logger from "@/utils/logger";
import { AbortError, isErrorType, normalizeError } from "@/utils/error";
import { PDFError, BatchProcessingError } from "@/utils/pdf-errors";

export type ProcessingInfo = {
  fileName: string;
  totalFiles: number;
  progress: number;
};

/**
 * Custom hook to manage file processing with queue management
 */
export function useFileProcessing(
  allowedFileTypes: string[],
  animateFn?: (files: File[]) => Promise<void>
) {
  // Processing state
  const processingRef = useRef(false);
  const processingQueueRef = useRef<File[]>([]);
  const pendingFilesRef = useRef<FileList | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const processingInfoRef = useRef<ProcessingInfo | null>(null);

  // // Component-specific tracking for StrictMode detection
  // const isComponentMountedRef = useRef(false);
  // const isFirstCleanupRef = useRef(true);
  // const mountTimestampRef = useRef(0);

  // Get panel helpers
  const { openFileUploadOptionsPanel, closeFileUploadOptionsPanel } =
    usePanelHelpers();

  // Get store functions
  const {
    addFile,
    addPageToFile,
    setFileStatus,
    setPageStatus,
    reset,
    processedFiles,
  } = useProcessedFilesStore(
    useShallow((state) => ({
      addFile: state.addFile,
      addPageToFile: state.addPageToFile,
      setFileStatus: state.setFileStatus,
      setPageStatus: state.setPageStatus,
      reset: state.reset,
      processedFiles: state.processedFiles,
    }))
  );

  const { lastFileUploadAction, setLastFileUploadAction } =
    useUserPreferencesStore();

  /**
   * Get display info for the viewport
   */
  const getDisplayInfo = useCallback((): DisplayInfo => {
    const readerWidthPercent =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--reader-width"
        )
      ) || 75;

    return {
      devicePixelRatio: window.devicePixelRatio || 1,
      containerWidth: window.innerWidth * (readerWidthPercent / 100),
      containerHeight: window.innerHeight,
    };
  }, []);

  /**
   * Process PDFs with batch processor
   */
  const processPdfs = useCallback(
    async (files: File[], abortSignal: AbortSignal) => {
      const batchProcessor = new PDFBatchProcessor({
        detectOptimalConcurrency: true,
        concurrencyOptions: {
          cpuPercentage: files.length > 5 ? 0.6 : 0.75,
        },
      });

      const concurrencyInfo = batchProcessor.getConcurrencyInfo();
      logger.log(
        `PDF Processing using ${concurrencyInfo.maxConcurrentFiles} concurrent files` +
          (concurrencyInfo.usedOptimalDetection
            ? " (automatically determined)"
            : "")
      );

      setTimeout(() => {
        toast.loading("Processing PDFs...", { id: "file-processing" });
      }, 500);

      try {
        await batchProcessor.processBatch(files, getDisplayInfo(), abortSignal);
      } catch (error) {
        throw error;
      }
    },
    [getDisplayInfo]
  );

  /**
   * Process images with batch processor
   */
  const processImages = useCallback(
    async (files: File[], abortSignal: AbortSignal) => {
      const batchProcessor = new ImageBatchProcessor({
        allowedImageTypes: allowedFileTypes.filter((type) =>
          type.includes("image")
        ),
        detectOptimalConcurrency: true,
        concurrencyOptions: {
          cpuPercentage: files.length > 20 ? 0.5 : 0.7,
          minConcurrency: 2,
          maxConcurrency: files.length > 50 ? 10 : 16,
        },
      });

      const concurrencyInfo = batchProcessor.getConcurrencyInfo();
      logger.log(
        `Image Processing using ${concurrencyInfo.maxConcurrentFiles} concurrent files` +
          (concurrencyInfo.usedOptimalDetection
            ? " (automatically determined)"
            : "")
      );

      setTimeout(() => {
        toast.loading("Processing images...", { id: "file-processing" });
      }, 350);

      try {
        await batchProcessor.processBatch(files, abortSignal);
      } catch (error) {
        throw error;
      }
    },
    [allowedFileTypes]
  );

  /**
   * Process files in the queue
   */
  const processFilesInQueue = useCallback(async () => {
    if (processingQueueRef.current.length === 0 || processingRef.current)
      return;

    processingRef.current = true;
    processingInfoRef.current = {
      fileName: "",
      totalFiles: processingQueueRef.current.length,
      progress: 0,
    };

    // Take the files from the queue
    const filesToProcess = [...processingQueueRef.current];
    processingQueueRef.current = [];

    // validation with content checking for PDFs
    const validationResult = await validateFileBatchWithContent(
      filesToProcess,
      allowedFileTypes,
      {
        fileTypeValidation: true,
        checkForCorruption: true,
      }
    );

    if (!validationResult.isValid) {
      toast.error(validationResult.error);
      processingRef.current = false;
      processingInfoRef.current = null;
      return;
    }

    const sanitizedFiles = validationResult.sanitizedFiles!;

    // Check for already processed files
    const alreadyProcessedFiles = [];
    for (const file of sanitizedFiles) {
      if (processedFiles.has(file.name)) {
        const pages = processedFiles.get(file.name);
        if (pages && Array.from(pages.values()).every((page) => page.url)) {
          alreadyProcessedFiles.push(file.name);
        }
      }
    }

    if (alreadyProcessedFiles.length > 0) {
      toast(`Files already uploaded: ${alreadyProcessedFiles.join(", ")}`);
      if (alreadyProcessedFiles.length === sanitizedFiles.length) {
        processingRef.current = false;
        processingInfoRef.current = null;
        return;
      }
    }

    // Animation if provided
    if (animateFn) {
      await animateFn(sanitizedFiles);
    }

    console.log("Processing files in queue", sanitizedFiles);

    // New abort controller
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const { signal: abortSignal } = abortControllerRef.current;

    const fileCategory = validationResult.fileCategory;
    const isPDF = fileCategory === "pdf";
    const isImage = fileCategory === "image";

    // Event listeners
    const onFileAdd = (data: FileAddPayload) => {
      if (processingInfoRef.current) {
        processingInfoRef.current = {
          ...processingInfoRef.current,
          fileName: data.fileName,
        };
      }
      addFile(data.fileName, data.totalPages, data.metadata);
    };

    const onPageProcessed = function (data: PageProcessedPayload) {
      if (data.status === ProcessingStatus.COMPLETED && data.url) {
        addPageToFile(
          data.fileName,
          data.pageNumber,
          data.url,
          data.status,
          data.errorReason
        );
      } else {
        setPageStatus(
          data.fileName,
          data.pageNumber,
          data.status,
          data.errorReason
        );
      }
    };

    const onFileStatus = (data: FileStatusPayload) => {
      if (
        processingInfoRef.current &&
        (data.status === ProcessingStatus.COMPLETED ||
          data.status === ProcessingStatus.FAILED)
      ) {
        const newProgress = Math.min(
          100,
          (processingInfoRef.current.progress || 0) +
            100 / processingQueueRef.current.length
        );

        processingInfoRef.current = {
          ...processingInfoRef.current,
          fileName: data.fileName,
          progress: newProgress,
        };
      }
      setFileStatus(data.fileName, data.status);
    };

    fileProcessingEmitter.on(FILE_PROCESSING_EVENTS.FILE_ADD, onFileAdd);
    fileProcessingEmitter.on(FILE_PROCESSING_EVENTS.FILE_STATUS, onFileStatus);
    fileProcessingEmitter.on(
      FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
      onPageProcessed
    );

    const processPromise = new Promise<void>(async (resolve, reject) => {
      try {
        if (isPDF) {
          await processPdfs(sanitizedFiles, abortSignal);
        } else if (isImage) {
          await processImages(sanitizedFiles, abortSignal);
        } else {
          throw new Error("Invalid file type");
        }
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        processingRef.current = false;
        processingInfoRef.current = null;
        closeFileUploadOptionsPanel();

        // Clean up event listeners
        fileProcessingEmitter.off(FILE_PROCESSING_EVENTS.FILE_ADD, onFileAdd);
        fileProcessingEmitter.off(
          FILE_PROCESSING_EVENTS.FILE_STATUS,
          onFileStatus
        );
        fileProcessingEmitter.off(
          FILE_PROCESSING_EVENTS.FILE_STATUS,
          onFileStatus
        );
        fileProcessingEmitter.off(FILE_PROCESSING_EVENTS.FILE_ADD, onFileAdd);
        fileProcessingEmitter.off(
          FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
          onPageProcessed
        );

        // Process next batch if there are files in queue
        if (processingQueueRef.current.length > 0) {
          // Use setTimeout to prevent recursion stack overflows
          setTimeout(() => processFilesInQueue(), 0);
        }
      }
    });

    toast.promise(processPromise, {
      className:
        "border-border-success rounded-xl gap-2 text-base text-white font-semibold py-4 px-6",
      loading: "Initializing processor...",
      success: () => "All files processed successfully! 🎉",
      error: (error: unknown) => {
        if (isErrorType(error, AbortError)) {
          return "Processing cancelled";
        }

        if (isErrorType(error, PDFError)) {
          return error.message;
        }

        if (isErrorType(error, BatchProcessingError)) {
          return error.message;
        }

        return isErrorType(error, Error)
          ? `Processing failed: ${normalizeError(error).message}`
          : "Failed to process files. Please try again.";
      },
      id: "file-processing",
    });
  }, [
    addFile,
    addPageToFile,
    allowedFileTypes,
    animateFn,
    closeFileUploadOptionsPanel,
    processImages,
    processPdfs,
    processedFiles,
    setFileStatus,
    setPageStatus,
  ]);

  /**
   * Handle user's decision to abort current processing and start new
   */
  const handleAbortAndProcess = useCallback(() => {
    abortControllerRef.current?.abort();
    processingRef.current = false;
    processingInfoRef.current = null;
    closeFileUploadOptionsPanel();
    reset();

    // Clear the existing queue
    processingQueueRef.current = [];

    if (pendingFilesRef.current) {
      const newFiles = Array.from(pendingFilesRef.current);
      pendingFilesRef.current = null;
      processingQueueRef.current = newFiles;
      // Start processing immediately
      processFilesInQueue();
    }

    // Save preference
    setLastFileUploadAction("override");
  }, [
    closeFileUploadOptionsPanel,
    processFilesInQueue,
    reset,
    setLastFileUploadAction,
  ]);

  /**
   * Handle user's decision to add files to the processing queue
   */
  const handleAddToQueue = useCallback(() => {
    closeFileUploadOptionsPanel();

    if (pendingFilesRef.current) {
      const newFiles = Array.from(pendingFilesRef.current);
      pendingFilesRef.current = null;
      processingQueueRef.current = [...processingQueueRef.current, ...newFiles];

      toast.success(`Added ${newFiles.length} files to processing queue`);

      // If not currently processing, start processing the queue
      if (!processingRef.current) {
        processFilesInQueue();
      }
    }

    // Save preference
    setLastFileUploadAction("add-to-queue");
  }, [
    closeFileUploadOptionsPanel,
    processFilesInQueue,
    setLastFileUploadAction,
  ]);

  /**
   * Handle new files being added
   * - Determines whether to queue, process immediately, or show options dialog
   */
  const handleNewFiles = useCallback(
    (files: FileList) => {
      // Decision criteria:
      // 1. If already processing: check preferences, otherwise ask user
      // 2. If not processing: start processing immediately

      if (processingRef.current) {
        pendingFilesRef.current = files;

        // Auto-apply last preference if available
        if (lastFileUploadAction) {
          if (lastFileUploadAction === "add-to-queue") {
            handleAddToQueue();
          } else {
            handleAbortAndProcess();
          }
        } else {
          // No preference set, ask user
          openFileUploadOptionsPanel();
        }
      } else {
        // Not currently processing, add to queue and start processing
        const uploadedFiles = Array.from(files);
        processingQueueRef.current = [
          ...processingQueueRef.current,
          ...uploadedFiles,
        ];
        processFilesInQueue();
      }
    },
    [
      handleAbortAndProcess,
      handleAddToQueue,
      lastFileUploadAction,
      openFileUploadOptionsPanel,
      processFilesInQueue,
    ]
  );

  // // Track queue processing when component mounts
  // useEffect(() => {
  //   // Mark the component as mounted and record timestamp
  //   isComponentMountedRef.current = true;
  //   mountTimestampRef.current = Date.now();

  //   // Start processing queue if there are files and not currently processing
  //   if (processingQueueRef.current.length > 0 && !processingRef.current) {
  //     processFilesInQueue();
  //   }

  //   // Cleanup on unmount
  //   return () => {
  //     // Check if this is the first cleanup (StrictMode) based on component's own ref
  //     const unmountTimeDelta = Date.now() - mountTimestampRef.current;
  //     const isLikelyStrictModeUnmount =
  //       isFirstCleanupRef.current && unmountTimeDelta < 500;

  //     if (isLikelyStrictModeUnmount) {
  //       // This is likely StrictMode's initial unmount
  //       isFirstCleanupRef.current = false;
  //       isComponentMountedRef.current = false;

  //       // Don't abort or reset during StrictMode's first cleanup
  //       return;
  //     }

  //     // For real unmounts or second cycle in StrictMode, do the full cleanup
  //     if (abortControllerRef.current) {
  //       abortControllerRef.current.abort();
  //     }

  //     // Ensure PDFWorkerPool is reset on unmount to prevent issues with StrictMode
  //     resetPDFWorkerPoolInstance();
  //   };
  // }, [processFilesInQueue]);

  return {
    isProcessing: () => processingRef.current,
    getCurrentProcessingInfo: () => processingInfoRef.current,
    getQueueLength: () => processingQueueRef.current.length,
    handleNewFiles,
    handleAbortAndProcess,
    handleAddToQueue,
    abortProcessing: () => abortControllerRef.current?.abort(),
  };
}
