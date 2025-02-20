/* eslint-disable @typescript-eslint/ban-ts-comment */
"use client";

import * as React from "react";
import { forwardRef, useRef, useState, useEffect, useCallback } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileUploadIcons } from "./file-upload-icons";
import * as pdfjsLib from "pdfjs-dist";
import { toast } from "sonner";
import { useProcessedFilesStore } from "@/store/processed-files";
import { delay } from "@/utils/app";
import { useDropAnimationStore } from "@/store/drop-animation-store";
import { ANIMATION_DURATION } from "@/constants/drop-animation";
import { cn } from "@/lib/utils";
import { mergeRefs } from "@/utils/react";

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString(); // Required for pdf.js worker
}

// useEffect(() => {
//   const loadPdfWorker = async () => {
//     const worker = await import("pdfjs-dist/build/pdf.worker.min");
//     pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
//   };

//   loadPdfWorker().catch((error) => {
//     console.error("Failed to load PDF worker:", error);
//   });
// }, []);

interface FileDropZoneProps {
  onFilesProcessed: (images: string[]) => void;
}

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ALLOWED_FILE_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];

export const FileDropZone = forwardRef<HTMLDivElement, FileDropZoneProps>(
  function FileDropZone({ onFilesProcessed }, ref) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropOverlayRef = useRef<HTMLDivElement>(null);
    const uploadAreaRef = useRef<HTMLDivElement>(null);
    const processingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const [showAbortDialog, setShowAbortDialog] = useState(false);
    const pendingFiles = useRef<FileList | null>(null);

    const { addFile, addPageToFile, setTotalFiles, reset } =
      useProcessedFilesStore();
    const setIsDraggingStore = useDropAnimationStore(
      (state) => state.setIsDragging
    );
    const newDraggingState = useDropAnimationStore((state) => state.isDragging);
    const animateToSnapPosition = useDropAnimationStore(
      (state) => state.animateToSnapPosition
    );
    const setDropPosition = useDropAnimationStore(
      (state) => state.setDropPosition
    );

    /** Cleanup when component unmounts */
    useEffect(() => {
      return () => {
        reset();
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }, [reset]);

    /** Setup up drop position when upload file is trigger via click */
    useEffect(() => {
      const element = uploadAreaRef.current;
      if (!element) return;

      const { x, width, top } = element.getBoundingClientRect();

      const newX = Math.round(x + width);
      const newY = Math.round(top);

      setDropPosition(newX, newY);
    }, [setDropPosition]);

    /** Handles new file upload while processing */
    const handleNewUploadRequest = (files: FileList) => {
      if (processingRef.current) {
        pendingFiles.current = files;
        setShowAbortDialog(true);
      } else {
        handleFiles(files);
      }
    };

    /** Abort current processing and start new */
    const handleAbortAndProcess = () => {
      abortControllerRef.current?.abort();
      processingRef.current = false;
      setShowAbortDialog(false);
      reset();
      if (pendingFiles.current) {
        handleFiles(pendingFiles.current);
        pendingFiles.current = null;
      }
    };

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

    /** Processes file list */
    const handleFiles = useCallback(
      async (files: FileList) => {
        if (processingRef.current) return;

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

        // Enforce that all files are of the same type.
        const fileTypes = new Set(uploadedFiles.map((file) => file.type));
        if (fileTypes.size > 1) {
          toast("Please upload files of the same type (either images or PDF).");
          return;
        }

        // animation
        await animate(uploadedFiles.length);

        // new abort controller
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        const processPromise = new Promise<void>(async (resolve, reject) => {
          try {
            const [firstFile] = uploadedFiles;
            const isPDF = firstFile?.type === "application/pdf";
            let totalPages = 0;
            let processedPages = 0;

            const updateProgress = () => {
              const progress =
                totalPages > 0
                  ? Math.round((processedPages / totalPages) * 100)
                  : 0;
              toast.loading(
                isPDF
                  ? `Processing PDF: ${progress}% (page ${processedPages} of ${totalPages})`
                  : "Processing images...",
                { id: "file-processing" }
              );
            };

            const results: string[] = [];

            if (isPDF) {
              await processPDF(
                uploadedFiles,
                results,
                () => {
                  onFilesProcessed([...results]);
                },
                (pagesProcessed, pagesTotal) => {
                  processedPages = pagesProcessed;
                  totalPages = pagesTotal;
                  updateProgress();
                },
                abortControllerRef.current?.signal
              );
            } else {
              totalPages = uploadedFiles.length;
              uploadedFiles
                .sort((a, b) =>
                  a.name.localeCompare(b.name, undefined, { numeric: true })
                )
                .forEach((file) => {
                  const url = URL.createObjectURL(file);
                  processedPages++;
                  addFile(file.name);
                  addPageToFile(file.name, 1, url);
                  updateProgress();
                });
            }

            processingRef.current = false;
            resolve();
          } catch (error) {
            if ((error as Error).message === "Processing aborted") {
              toast.dismiss("file-processing");
              toast("Processing cancelled");
            } else {
              reject(error);
            }
          } finally {
            processingRef.current = false;
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
      [addFile, addPageToFile, animate, onFilesProcessed]
    );

    return (
      <>
        <AlertDialog open={showAbortDialog} onOpenChange={setShowAbortDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Current Processing?</AlertDialogTitle>
            </AlertDialogHeader>
            <p>
              Do you want to cancel the current file processing to handle new
              files?
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>Continue Current</AlertDialogCancel>
              <AlertDialogAction onClick={handleAbortAndProcess}>
                Process New Files
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
  results: string[],
  onPageProcessed: (results: string[]) => void,
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
    addFile(file.name);

    // Processes pages in chunks
    for (let i = 1; i <= pdf.numPages; i += CHUNK_SIZE) {
      if (abortSignal?.aborted) {
        throw new Error("Processing aborted");
      }

      const pagePromises = [];
      const end = Math.min(i + CHUNK_SIZE - 1, pdf.numPages);

      // Creates promises for chunk of pages
      for (let j = i; j <= end; j++) {
        pagePromises.push(processPage(pdf, j));
      }

      // Processes chunk of pages concurrently
      const chunkResults = await Promise.all(pagePromises);

      for (let j = 0; j < chunkResults.length; j++) {
        if (abortSignal?.aborted) break;
        const pageNumber = i + j;
        addPageToFile(file.name, pageNumber, chunkResults[j]);
        processedPages++;
        onProgressUpdate(processedPages, totalPages);
      }

      // Delay between chunks to prevent UI freezing
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/** Drag Overlay Component */
const DropOverlay = forwardRef<
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
});

DropOverlay.displayName = "DropOverlay";

/** Upload Area Component */
const UploadArea = forwardRef<
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
    <div className="space-y-2 font-[family-name:var(--font-manrope)] text-center text-sm mt-5">
      <p className="font-medium">Drag & drop files here</p>
      <p className="text-sm text-muted-foreground">
        Supported formats: PNG, JPG, PDF
      </p>
    </div>
  </div>
));

UploadArea.displayName = "UploadArea";
