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
    const processingRef = useRef(false);
    const objectUrlsRef = useRef<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const [showAbortDialog, setShowAbortDialog] = useState(false);
    const pendingFiles = useRef<FileList | null>(null);

    /** Cleanup object URLs when component unmounts */
    useEffect(() => {
      return () => {
        objectUrlsRef.current.forEach(URL.revokeObjectURL);
        objectUrlsRef.current = [];
      };
    }, []);

    // Add cleanup for abort controller
    useEffect(() => {
      return () => {
        abortControllerRef.current?.abort();
      };
    }, []);

    /** Handle new file upload while processing */
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
      if (pendingFiles.current) {
        handleFiles(pendingFiles.current);
        pendingFiles.current = null;
      }
    };

    /** Handles drag events to show overlay */
    const handleDrag = useCallback((event: React.DragEvent) => {
      event.preventDefault();
      console.log(processingRef.current);
      setIsDragging(event.type === "dragover");
    }, []);

    /** Processes file list */
    const handleFiles = useCallback(
      async (files: FileList) => {
        if (processingRef.current) return;
        processingRef.current = true;

        const uploadedFiles = Array.from(files);

        // Ensure all files are one of the allowed types.
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

        // new abort controller
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        const processPromise = new Promise<void>(async (resolve, reject) => {
          try {
            const filesArray = Array.from(files);
            const [firstFile] = filesArray;
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
                filesArray,
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
              totalPages = filesArray.length;
              filesArray
                .sort((a, b) =>
                  a.name.localeCompare(b.name, undefined, { numeric: true })
                )
                .forEach((file) => {
                  results.push(URL.createObjectURL(file));
                  processedPages++;
                  onFilesProcessed([...results]);
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
            objectUrlsRef.current = [];
            return "All files processed successfully! 🎉";
          },
          error: (error) => {
            console.error("Processing error:", error);
            objectUrlsRef.current.forEach(URL.revokeObjectURL);
            return error instanceof Error
              ? `Processing failed: ${error.message}`
              : "Failed to process files. Please try again.";
          },
          id: "file-processing",
        });
      },
      [ALLOWED_FILE_TYPES, onFilesProcessed]
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
          <UploadArea ref={ref} onClick={() => fileInputRef.current?.click()} />
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

  for (const file of filesArray) {
    if (abortSignal?.aborted) {
      throw new Error("Processing aborted");
    }

    const pdf = await pdfjsLib.getDocument({
      data: await file.arrayBuffer(),
    }).promise;
    totalPages += pdf.numPages;

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

      // Handles results
      for (const dataUrl of chunkResults) {
        if (abortSignal?.aborted) break;
        results.push(dataUrl);
        onPageProcessed([...results]);
        processedPages++;
        onProgressUpdate(processedPages, totalPages);
      }

      // Adds small delay between chunks to prevent UI freezing
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
>(({ isDragging, onDragEvent, onFilesDropped }, ref) => (
  <div
    ref={ref}
    role="region"
    aria-label="File drop zone"
    className={`drop-overlay absolute inset-0 transition-opacity duration-300 ${
      isDragging ? "opacity-100 bg-primary/20" : "opacity-0"
    } border-2 border-dashed border-primary rounded-lg`}
    onDragOver={onDragEvent}
    onDragLeave={onDragEvent}
    onDrop={(e) => {
      onDragEvent(e);
      if (e.dataTransfer.files.length > 0) {
        onFilesDropped(e.dataTransfer.files);
      }
    }}
  />
));

DropOverlay.displayName = "DropOverlay";

/** Upload Area Component */
const UploadArea = forwardRef<HTMLDivElement, { onClick: () => void }>(
  ({ onClick }, ref) => (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      className="w-fit left-2/4 -translate-x-2/4 absolute top-[30%] cursor-pointer"
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
  )
);

UploadArea.displayName = "UploadArea";
