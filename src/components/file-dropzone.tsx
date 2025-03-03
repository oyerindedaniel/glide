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
import { PDFProcessor } from "@/classes/pdf-processor";
import { fileProcessingEmitter } from "@/classes/file-processing-emitter";
import {
  BASE_DELAY_MS,
  FILE_PROCESSING_EVENTS,
  MAX_CONCURRENT_FILES,
  MAX_PAGE_RETRIES,
} from "@/constants/processing";
import pLimit from "p-limit";

// if (typeof window !== "undefined") {
//   pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
//     "pdfjs-dist/build/pdf.worker.min.mjs",
//     import.meta.url
//   ).toString(); // Required for pdf.js worker
// }

// useEffect(() => {
//   const loadPdfWorker = async () => {
//     const worker = await import("pdfjs-dist/build/pdf.worker.min");
//     pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
//   };

//   loadPdfWorker().catch((error) => {
//     console.error("Failed to load PDF worker:", error);
//   });
// }, []);

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface FileDropZoneProps {}

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ALLOWED_FILE_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];

export const FileDropZone = forwardRef<HTMLDivElement, FileDropZoneProps>(
  function FileDropZone({}, ref) {
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
    } = useProcessedFilesStore();
    const {
      setIsDragging: setIsDraggingStore,
      isDragging: newDraggingState,
      animateToSnapPosition,
      setDropPosition,
      cleanup,
    } = useDropAnimationStore();

    const { closePanel, openPanel } = usePanelStore();

    /** Cleanup when component unmounts */
    useEffect(() => {
      return () => {
        // TOD0: Consider resetting the store a better way
        // reset();
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        cleanup();
      };
    }, [cleanup, reset]);

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

    // 3 cases
    // single (redirect) or multiple images (allow for rearrangement before redirect)
    // single pdf upload (allow for rearrangement before redirect) -> if new pdf are to be added restart
    // muliple pdf upload (two options) (immediately is noticed redirect to start reading) (shallow level)
    // or (indepth level)
    // after indepth down show all files then allow for rearrangement

    const processPdfsWithConcurrency = useCallback(async function (
      files: File[],
      abortSignal: AbortSignal
    ) {
      // Initialize concurrency limit
      const limit = pLimit(MAX_CONCURRENT_FILES);

      // Function to check if the user is online
      function isOnline() {
        return navigator.onLine;
      }

      setTimeout(() => {
        toast.loading("Processing PDFs...", { id: "file-processing" });
      }, 500);

      // Retry failed pages with exponential backoff and online check
      async function processPageWithRetry(
        fileName: string,
        pageNumber: number,
        processor: PDFProcessor
      ) {
        for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
          if (abortSignal.aborted) {
            throw new Error("Processing aborted");
          }

          try {
            // Check if user is online before retrying
            while (!isOnline()) {
              console.warn(
                `User offline. Pausing retries for ${fileName} page ${pageNumber}`
              );
              // TODO: Consider debouncing or limiting toast notifications
              toast.warning(
                `User offline. Pausing retries for ${fileName} page ${pageNumber}`,
                { id: "is-online" }
              );
              await delay(5000); // Check again after 5 seconds
            }

            // Emit PAGE_PROCESSED event for processing
            fileProcessingEmitter.emit(
              FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
              fileName,
              pageNumber,
              null,
              ProcessingStatus.PROCESSING
            );

            const data = await processor.getPage(pageNumber);

            if (abortSignal.aborted) {
              throw new Error("Processing aborted");
            }

            // Success: Emit PAGE_PROCESSED event
            fileProcessingEmitter.emit(
              FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
              fileName,
              pageNumber,
              data.url,
              ProcessingStatus.COMPLETED
            );
            return false; // Page processed successfully
          } catch {
            console.warn(
              `Page ${pageNumber} of ${fileName} failed (Attempt: ${attempt})`
            );

            // Track failed pages for retry
            const failedPages = new Map<
              string,
              { pageNumber: number; attempts: number }[]
            >();
            if (!failedPages.has(fileName)) {
              failedPages.set(fileName, []);
            }

            const pageRetries = failedPages.get(fileName)!;
            const existingPage = pageRetries.find(
              (p) => p.pageNumber === pageNumber
            );

            if (existingPage) {
              existingPage.attempts++;
            } else {
              pageRetries.push({ pageNumber, attempts: 1 });
            }

            // If max retries reached, mark page as failed
            if (attempt === MAX_PAGE_RETRIES) {
              fileProcessingEmitter.emit(
                FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
                fileName,
                pageNumber,
                null,
                ProcessingStatus.FAILED
              );
              return true; // Page failed after max retries
            }

            // Apply exponential backoff before the next attempt
            const delayTime = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            await delay(delayTime);
          }
        }
        return true;
      }

      // Process a single PDF file
      const processPdf = async (file: File) => {
        if (abortSignal.aborted) {
          throw new Error("Processing aborted");
        }

        const processor = new PDFProcessor({
          maxConcurrent: 2,
          pageBufferSize: 5,
        });

        try {
          // Process the file to get total pages
          const { totalPages } = await processor.processFile(file);

          // Emit initial file events
          fileProcessingEmitter.emit(
            FILE_PROCESSING_EVENTS.FILE_ADD,
            file.name,
            totalPages,
            { size: file.size, type: file.type }
          );
          fileProcessingEmitter.emit(
            FILE_PROCESSING_EVENTS.TOTAL_PAGES_UPDATE,
            totalPages
          );
          fileProcessingEmitter.emit(
            FILE_PROCESSING_EVENTS.FILE_STATUS,
            file.name,
            ProcessingStatus.PROCESSING
          );

          // Prepare pages to process
          const totalPagesArr = Array.from(
            { length: totalPages },
            (_, i) => i + 1
          );

          // Process all pages with retry logic, respecting concurrency
          const pageResults = await Promise.allSettled(
            totalPagesArr.map((pageNum) =>
              processPageWithRetry(file.name, pageNum, processor)
            )
          );

          // Check for failed pages
          const hasPageFailure = pageResults.some(
            (result) => result.status === "rejected" || result.value === true
          );

          // If all pages failed, throw an error
          const failedPagesCount = pageResults.filter(
            (result) => result.status === "rejected" || result.value === true
          ).length;
          if (failedPagesCount === totalPages) {
            throw new Error(
              "An unexpected error occurred. Please try again later."
            );
          }

          // Emit file status
          fileProcessingEmitter.emit(
            FILE_PROCESSING_EVENTS.FILE_STATUS,
            file.name,
            hasPageFailure
              ? ProcessingStatus.FAILED
              : ProcessingStatus.COMPLETED
          );
        } catch (error) {
          fileProcessingEmitter.emit(
            FILE_PROCESSING_EVENTS.FILE_STATUS,
            file.name,
            ProcessingStatus.FAILED
          );
          throw error;
        } finally {
          processor.cleanup();
        }
      };

      // Create promises for each file, wrapped with concurrency limit
      const processingPromises = files.map((file) =>
        limit(() => processPdf(file))
      );

      try {
        const results = await Promise.allSettled(processingPromises);

        const errors = results.filter((r) => r.status === "rejected");
        if (errors.length > 0) {
          throw new Error("One or more files failed during processing.");
        }
      } catch (error) {
        throw error;
      }
    },
    []);

    /**
     * Process Image Files Sequentially
     */
    const processImages = useCallback(
      async function processImages(
        files: File[],
        abortSignal: AbortSignal,
        updateProgress: () => void,
        state: { totalPages: number; processedPages: number }
      ) {
        state.totalPages = files.length;

        for (const file of files) {
          if (abortSignal.aborted) {
            throw new Error("Processing aborted");
          }

          fileProcessingEmitter.emit(
            FILE_PROCESSING_EVENTS.FILE_STATUS,
            file.name,
            ProcessingStatus.PROCESSING
          );

          try {
            const url = URL.createObjectURL(file);
            addFile(file.name, 1, { size: file.size, type: file.type });
            addPageToFile(file.name, 1, url);

            state.processedPages++;

            fileProcessingEmitter.emit(
              FILE_PROCESSING_EVENTS.FILE_STATUS,
              file.name,
              ProcessingStatus.COMPLETED
            );

            updateProgress();
          } catch (error) {
            fileProcessingEmitter.emit(
              FILE_PROCESSING_EVENTS.FILE_STATUS,
              file.name,
              ProcessingStatus.FAILED
            );
            throw error;
          }
        }
      },
      [addFile, addPageToFile]
    );

    /** Processes file list */
    const handleFiles = useCallback(
      async (files: FileList) => {
        console.log("in you are suyy1");
        if (processingRef.current) return;

        console.log("in you are suyy2");

        processingRef.current = true;

        const uploadedFiles = Array.from(files);

        // Ensures all files are one of the allowed types.
        const invalidFiles = uploadedFiles.filter(
          (file) => !ALLOWED_FILE_TYPES.includes(file.type)
        );
        if (invalidFiles.length > 0) {
          toast("Only PNG, JPG, and PDF files are allowed.");
          return;
        }

        // Ensures all files are of the same type.
        const fileTypes = new Set(uploadedFiles.map((file) => file.type));
        if (fileTypes.size > 1) {
          toast("Please upload files of the same type (either images or PDF).");
          return;
        }

        for (const file of uploadedFiles) {
          if (processedFiles.has(file.name)) {
            const pages = processedFiles.get(file.name);
            if (pages && Array.from(pages.values()).every((page) => page.url)) {
              toast(`File "${file.name}" is already uploaded.`);
              return;
            }
          }
        }

        // animation
        await animate(uploadedFiles.length);

        // new abort controller
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();
        const { signal: abortSignal } = abortControllerRef.current;

        const state = { totalPages: 0, processedPages: 0 };

        const isPDF = fileTypes.has("application/pdf");

        const updateProgress = () => {
          if (abortSignal.aborted) return;
          const { totalPages, processedPages } = state;
          const progress =
            totalPages > 0
              ? Math.round((processedPages / totalPages) * 100)
              : 0;
          toast.loading(
            isPDF
              ? `Processing PDF: ${progress}% (page ${processedPages} of ${totalPages})`
              : `Processing images: ${progress}% (${processedPages} of ${totalPages})`,
            { id: "file-processing" }
          );
        };

        // Event listeners
        const onFileAdd = (
          fileName: string,
          totalPages: number,
          { size, type }: { size: number; type: string }
        ) => {
          startTransition(() => {
            addFile(fileName, totalPages, { size, type });
          });
        };

        const onPageProcessed = function (
          fileName: string,
          pageNumber: number,
          url: string | null,
          status: ProcessingStatus
        ) {
          state.processedPages++;
          if (status === ProcessingStatus.COMPLETED && url) {
            startTransition(() => {
              addPageToFile(fileName, pageNumber, url);
            });
          }

          startTransition(() => {
            setPageStatus(fileName, pageNumber, status);
          });
          // updateProgress();
        };

        const onFileStatus = (fileName: string, status: ProcessingStatus) => {
          startTransition(() => {
            setFileStatus(fileName, status);
          });
        };

        const onTotalPagesUpdate = (pages: number) => {
          state.totalPages += pages;
          // updateProgress();
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
        fileProcessingEmitter.on(
          FILE_PROCESSING_EVENTS.TOTAL_PAGES_UPDATE,
          onTotalPagesUpdate
        );

        const processPromise = new Promise<void>(async (resolve, reject) => {
          try {
            if (isPDF) {
              if (uploadedFiles.length === 1) {
                await processPdfsWithConcurrency(uploadedFiles, abortSignal);
                // await processSinglePdf(uploadedFiles[0], abortSignal);
              } else {
                await processPdfsWithConcurrency(uploadedFiles, abortSignal);
              }
            } else {
              await processImages(
                uploadedFiles,
                abortSignal,
                updateProgress,
                state
              );
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
            fileProcessingEmitter.off(
              FILE_PROCESSING_EVENTS.FILE_ADD,
              onFileAdd
            );
            fileProcessingEmitter.off(
              FILE_PROCESSING_EVENTS.PAGE_PROCESSED,
              onPageProcessed
            );
            fileProcessingEmitter.off(
              FILE_PROCESSING_EVENTS.TOTAL_PAGES_UPDATE,
              onTotalPagesUpdate
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
        processPdfsWithConcurrency,
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
  }
);

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
