/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */
"use client";

import * as React from "react";
import {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useCallback,
  startTransition,
} from "react";
import { FileUploadIcons } from "./file-upload-icons";
import * as pdfjsLib from "pdfjs-dist";
import { toast } from "sonner";
import {
  ProcessingStatus,
  useProcessedFilesStore,
} from "@/store/processed-files";
import { delay } from "@/utils/app";
import { useDropAnimationStore } from "@/store/drop-animation-store";
import { ANIMATION_DURATION } from "@/constants/drop-animation";
import { cn } from "@/lib/utils";
import { mergeRefs } from "@/utils/react";
import { PanelAbortProcessing } from "./panels/abort-processing";
import { usePanelStore, PanelType } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import { fileProcessingEmitter } from "@/classes/file-processing-emitter";
import {
  FILE_INPUT_TYPES,
  FILE_PROCESSING_EVENTS,
  MAX_CONCURRENT_FILES,
} from "@/constants/processing";
import { useShallow } from "zustand/shallow";
import { sanitizeFileName, validateFile } from "@/utils/file-validation";
import { PDFBatchProcessor } from "@/classes/pdf-processor";
import { ImageBatchProcessor } from "@/classes/image-processor";

const ALLOWED_IMAGE_TYPES = [
  FILE_INPUT_TYPES.PNG,
  FILE_INPUT_TYPES.JPEG,
  FILE_INPUT_TYPES.WEBP,
];
const ALLOWED_FILE_TYPES = [...ALLOWED_IMAGE_TYPES, FILE_INPUT_TYPES.PDF];

const FileDropZone = forwardRef<HTMLDivElement, object>(function FileDropZone(
  {},
  ref
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropOverlayRef = useRef<HTMLDivElement>(null);
  const uploadAreaRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingFiles = useRef<FileList | null>(null);

  const {
    addFile,
    addPageToFile,
    setTotalFiles,
    setFileStatus,
    setPageStatus,
    reset,
    processedFiles,
  } = useProcessedFilesStore(
    useShallow((state) => ({
      addFile: state.addFile,
      addPageToFile: state.addPageToFile,
      setTotalFiles: state.setTotalFiles,
      setFileStatus: state.setFileStatus,
      setPageStatus: state.setPageStatus,
      reset: state.reset,
      processedFiles: state.processedFiles,
    }))
  );
  const {
    setIsDragging: setIsDraggingStore,
    isDragging: newDraggingState,
    animateToSnapPosition,
    setDropPosition,
  } = useDropAnimationStore(
    useShallow((state) => ({
      setIsDragging: state.setIsDragging,
      isDragging: state.isDragging,
      animateToSnapPosition: state.animateToSnapPosition,
      setDropPosition: state.setDropPosition,
    }))
  );
  const { closePanel, openPanel } = usePanelStore();

  /** Cleanup when component unmounts */
  useEffect(() => {
    return () => {
      // TOD0: Consider resetting the store a better way
      // reset();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  /** Setup up drop position when upload file is trigger via click */
  useEffect(() => {
    const element = uploadAreaRef.current;
    if (!element) return;

    const { x, width, top } = element.getBoundingClientRect();

    const newX = Math.round(x + width);
    const newY = Math.round(top);

    setDropPosition(newX, newY);
  }, [setDropPosition]);

  /** Handles drag events to show overlay */
  const handleDrag = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const isDragging = event.type === "dragover";

      setIsDragging(isDragging);
      if (isDragging !== newDraggingState) {
        setIsDraggingStore(isDragging);
      }
    },
    [newDraggingState, setIsDraggingStore]
  );

  /** Handles animation to snap position */
  const animate = useCallback(
    async function (filesLength: number) {
      animateToSnapPosition();

      setTimeout(() => {
        setTotalFiles(filesLength);
      }, ANIMATION_DURATION - 50);

      // Delays processing (progress animation duration)
      await delay(ANIMATION_DURATION);
    },
    [animateToSnapPosition, setTotalFiles]
  );

  const getDisplayInfo = useCallback(() => {
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

  /** Handles PDF processing with concurrency */
  const processPdfs = useCallback(
    async function (files: File[], abortSignal: AbortSignal) {
      const batchProcessor = new PDFBatchProcessor({
        maxConcurrentFiles: MAX_CONCURRENT_FILES,
      });

      setTimeout(() => {
        toast.loading("Processing PDFs...", { id: "file-processing" });
      }, 500);

      try {
        await batchProcessor.processBatch(
          files,
          {
            onFileAdd: (fileName, totalPages, metadata) => {
              fileProcessingEmitter.emit(
                FILE_PROCESSING_EVENTS.FILE_ADD,
                fileName,
                totalPages,
                metadata
              );
            },
            onFileStatus: (fileName, status) => {
              fileProcessingEmitter.emit(
                FILE_PROCESSING_EVENTS.FILE_STATUS,
                fileName,
                status
              );
            },
            onPageProcessed: (fileName, pageNumber, url, status) => {
              fileProcessingEmitter.emit(
                FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
                fileName,
                pageNumber,
                url,
                status
              );
            },
            displayInfo: getDisplayInfo(),
          },
          abortSignal
        );
      } catch (error) {
        // Error is already handled by Promise.allSettled inside the batch processor
        // We just need to re-throw it for the toast to catch it
        throw error;
      }
    },
    [getDisplayInfo]
  );

  /** Handles Image processing with batch processor */
  const processImages = useCallback(async function (
    files: File[],
    abortSignal: AbortSignal
  ) {
    const batchProcessor = new ImageBatchProcessor({
      allowedImageTypes: ALLOWED_IMAGE_TYPES,
    });

    setTimeout(() => {
      toast.loading("Processing images...", { id: "file-processing" });
    }, 500);

    try {
      await batchProcessor.processBatch(
        files,
        {
          onFileAdd: (fileName, totalPages, metadata) => {
            fileProcessingEmitter.emit(
              FILE_PROCESSING_EVENTS.FILE_ADD,
              fileName,
              totalPages,
              metadata
            );
          },
          onFileStatus: (fileName, status) => {
            fileProcessingEmitter.emit(
              FILE_PROCESSING_EVENTS.FILE_STATUS,
              fileName,
              status
            );
          },
          onImageProcessed: (fileName, url, status) => {
            if (status === ProcessingStatus.COMPLETED && url) {
              fileProcessingEmitter.emit(
                FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
                fileName,
                1, // Images always have 1 page
                url,
                status
              );
            }
          },
        },
        abortSignal
      );
    } catch (error) {
      throw error;
    }
  },
  []);

  /** Handles file list */
  const handleFiles = useCallback(
    async (files: FileList) => {
      if (processingRef.current) return;

      processingRef.current = true;

      const uploadedFiles = Array.from(files);

      // Validate general file types first
      for (const file of uploadedFiles) {
        const validation = validateFile(file, ALLOWED_FILE_TYPES);
        if (!validation.isValid) {
          toast.error(`${file.name}: ${validation.error}`);
          processingRef.current = false;
          return;
        }
      }

      // Create sanitized files array
      const sanitizedFiles = uploadedFiles.map((file) => {
        const sanitizedName = sanitizeFileName(file.name);
        return new File([file], sanitizedName, { type: file.type });
      });

      // Check for duplicate sanitized names
      const fileNames = new Set<string>();
      for (const file of sanitizedFiles) {
        if (fileNames.has(file.name)) {
          toast.error("Duplicate file names detected");
          processingRef.current = false;
          return;
        }
        fileNames.add(file.name);
      }

      // Check file types
      const fileTypes = new Set(sanitizedFiles.map((file) => file.type));
      if (fileTypes.size > 1) {
        toast("Please upload files of the same type (either images or PDF).");
        processingRef.current = false;
        return;
      }

      // Check for already processed files
      for (const file of sanitizedFiles) {
        if (processedFiles.has(file.name)) {
          const pages = processedFiles.get(file.name);
          if (pages && Array.from(pages.values()).every((page) => page.url)) {
            toast(`File "${file.name}" is already uploaded.`);
            return;
          }
        }
      }

      // Animation
      await animate(sanitizedFiles.length);

      // New abort controller
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const { signal: abortSignal } = abortControllerRef.current;

      const isPDF = fileTypes.has(FILE_INPUT_TYPES.PDF);
      const isImage =
        fileTypes.has(FILE_INPUT_TYPES.PNG) ||
        fileTypes.has(FILE_INPUT_TYPES.JPEG) ||
        fileTypes.has(FILE_INPUT_TYPES.WEBP);

      // Event listeners
      const onFileAdd = (
        fileName: string,
        totalPages: number,
        { size, type }: { size: number; type: string }
      ) => {
        // startTransition(() => {
        addFile(fileName, totalPages, { size, type });
        // });
      };

      const onPageProcessed = function (
        fileName: string,
        pageNumber: number,
        url: string | null,
        status: ProcessingStatus
      ) {
        if (status === ProcessingStatus.COMPLETED && url) {
          startTransition(() => {
            addPageToFile(fileName, pageNumber, url);
          });
        }

        startTransition(() => {
          setPageStatus(fileName, pageNumber, status);
        });
      };

      const onFileStatus = (fileName: string, status: ProcessingStatus) => {
        startTransition(() => {
          setFileStatus(fileName, status);
        });
      };

      fileProcessingEmitter.on(FILE_PROCESSING_EVENTS.FILE_ADD, onFileAdd);
      fileProcessingEmitter.on(
        FILE_PROCESSING_EVENTS.FILE_STATUS,
        onFileStatus
      );
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
          if ((error as Error).message === "Processing aborted") {
            toast.dismiss("file-processing");
            toast.error("Processing cancelled");
          } else {
            reject(error);
          }
        } finally {
          processingRef.current = false;
          closePanel(PANEL_IDS.ABORT_PROCESSING, PanelType.CENTER);
          fileProcessingEmitter.off(
            FILE_PROCESSING_EVENTS.FILE_STATUS,
            onFileStatus
          );
          fileProcessingEmitter.off(FILE_PROCESSING_EVENTS.FILE_ADD, onFileAdd);
          fileProcessingEmitter.off(
            FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
            onPageProcessed
          );
        }
      });

      toast.promise(processPromise, {
        loading: "Initializing processor...",
        success: () => {
          return "All files processed successfully! 🎉";
        },
        error: (error) => {
          console.error("Processing error:", error);
          return error instanceof Error
            ? `Processing failed: ${error.message}`
            : "Failed to process files. Please try again.";
        },
        id: "file-processing",
      });
    },
    [
      addFile,
      addPageToFile,
      animate,
      closePanel,
      processImages,
      processPdfs,
      processedFiles,
      setFileStatus,
      setPageStatus,
    ]
  );

  /** Handles new file upload while processing */
  const handleNewUploadRequest = useCallback(
    (files: FileList) => {
      if (processingRef.current) {
        pendingFiles.current = files;
        openPanel(PANEL_IDS.ABORT_PROCESSING, PanelType.CENTER);
      } else {
        handleFiles(files);
      }
    },
    [handleFiles, openPanel]
  );

  /** Abort current processing and start new */
  const handleAbortAndProcess = useCallback(() => {
    abortControllerRef.current?.abort();
    processingRef.current = false;
    closePanel(PANEL_IDS.ABORT_PROCESSING, PanelType.CENTER);
    reset();
    if (pendingFiles.current) {
      handleFiles(pendingFiles.current);
      pendingFiles.current = null;
    }
  }, [closePanel, handleFiles, reset]);

  return (
    <>
      <PanelAbortProcessing handleAbortAndProcess={handleAbortAndProcess} />
      <div>
        {/* Drag Overlay for detecting file drag */}
        <DropOverlay
          ref={dropOverlayRef}
          isDragging={isDragging}
          onDragEvent={handleDrag}
          onFilesDropped={handleNewUploadRequest}
        />

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={ALLOWED_FILE_TYPES.join(",")}
          onChange={(e) =>
            e.target.files?.length && handleFiles(e.target.files)
          }
        />

        {/* Upload Icon & Clickable Area */}
        <UploadArea
          ref={ref}
          uploadAreaRef={uploadAreaRef}
          isDragging={isDragging}
          onClick={() => fileInputRef.current?.click()}
        />
      </div>
    </>
  );
});

export default FileDropZone;

/** Process single page */
async function processPage(pdf: pdfjsLib.PDFDocumentProxy, pageNumber: number) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2 });

  // Uses OffscreenCanvas if available for better performance
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(viewport.width, viewport.height)
      : document.createElement("canvas");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
    alpha: false, // Optimizes for non-transparent images
  })!;

  await page.render({
    //@ts-ignore
    canvasContext: context,
    viewport,
  }).promise;

  // Converts to data URL with optimized quality
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({
      type: "image/webp",
      quality: 0.8,
    });
    return URL.createObjectURL(blob);
  } else {
    const dataUrl = (canvas as HTMLCanvasElement).toDataURL("image/webp", 0.8);
    (canvas as HTMLCanvasElement).remove();
    return dataUrl;
  }
}

/** Handles PDF processing */
async function processPDF(
  filesArray: File[],
  onProgressUpdate: (processedPages: number, totalPages: number) => void,
  abortSignal?: AbortSignal
) {
  let totalPages = 0;
  let processedPages = 0;
  const CHUNK_SIZE = 3; // Processes 3 pages at a time
  const { addFile, addPageToFile } = useProcessedFilesStore.getState();

  for (const file of filesArray) {
    if (abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

    const pdf = await pdfjsLib.getDocument({
      data: await file.arrayBuffer(),
    }).promise;
    totalPages += pdf.numPages;
    // addFile(file.name, totalPages);

    // Processes pages in chunks
    for (let i = 1; i <= pdf.numPages; i += CHUNK_SIZE) {
      if (abortSignal?.aborted) {
        throw new Error("Processing aborted");
      }

      const pagePromises = [];
      const end = Math.min(i + CHUNK_SIZE - 1, pdf.numPages);

      // Creates promises for chunk of pages
      for (let j = i; j <= end; j++) {
        useProcessedFilesStore
          .getState()
          .setFileStatus(file.name, ProcessingStatus.PROCESSING);
        pagePromises.push(processPage(pdf, j));
      }

      // Processes chunk of pages concurrently
      const chunkResults = await Promise.allSettled(pagePromises);

      for (let j = 0; j < chunkResults.length; j++) {
        if (abortSignal?.aborted) break;

        const pageNumber = i + j;
        const result = chunkResults[j];

        if (result.status === "fulfilled") {
          useProcessedFilesStore
            .getState()
            .setFileStatus(file.name, ProcessingStatus.COMPLETED);
          addPageToFile(file.name, pageNumber, result.value);
        } else {
          console.error(
            `Failed to process page ${pageNumber} of ${file.name}:`,
            result.reason
          );
          useProcessedFilesStore
            .getState()
            .setFileStatus(file.name, ProcessingStatus.FAILED);
        }

        processedPages++;
        onProgressUpdate(processedPages, totalPages);
      }

      // Delay between chunks to prevent UI freezing
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/** Drag Overlay Component */
const DropOverlay = React.memo(
  forwardRef<
    HTMLDivElement,
    {
      isDragging: boolean;
      onDragEvent: (e: React.DragEvent) => void;
      onFilesDropped: (files: FileList) => void;
    }
  >(({ isDragging, onDragEvent, onFilesDropped }, ref) => {
    const setDropPosition = useDropAnimationStore(
      (state) => state.setDropPosition
    );

    return (
      <div
        ref={ref}
        role="region"
        aria-label="File drop zone"
        className={cn(
          `drop-overlay absolute inset-0 transition-opacity duration-300 
          border-2 border-dashed border-primary rounded-lg`,
          isDragging ? "opacity-100 bg-primary/20" : "opacity-0"
        )}
        onDragOver={onDragEvent}
        onDragLeave={onDragEvent}
        onDrop={(e) => {
          onDragEvent(e);
          if (e.dataTransfer.files.length > 0) {
            const { clientX: x, clientY: y } = e;
            setDropPosition(x, y);
            onFilesDropped(e.dataTransfer.files);
          }
        }}
      />
    );
  })
);

DropOverlay.displayName = "DropOverlay";

/** Upload Area Component */
const UploadArea = React.memo(
  forwardRef<
    HTMLDivElement,
    {
      onClick: () => void;
      isDragging: boolean;
      uploadAreaRef: React.RefObject<HTMLDivElement | null>;
    }
  >(({ onClick, isDragging, uploadAreaRef }, ref) => (
    <div
      ref={mergeRefs(ref, uploadAreaRef)}
      role="button"
      tabIndex={0}
      className={cn(
        "w-fit left-2/4 -translate-x-2/4 absolute top-[30%] cursor-pointer",
        isDragging ? "pointer-events-none hidden" : "pointer-events-auto"
      )}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <FileUploadIcons />
      <div className="space-y-2 text-center text-sm mt-5">
        <p className="font-medium">Drag & drop files here</p>
        <p className="text-sm text-muted-foreground">
          Supported formats: PNG, JPG, PDF
        </p>
      </div>
    </div>
  ))
);

UploadArea.displayName = "UploadArea";
