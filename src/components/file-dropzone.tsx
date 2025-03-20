/* eslint-disable @typescript-eslint/ban-ts-comment */
"use client";

import * as React from "react";
import { forwardRef, useRef, useState, useCallback } from "react";
import { FileUploadIcons } from "./file-upload-icons";
import { useProcessedFilesStore } from "@/store/processed-files";
import { delay } from "@/utils/app";
import { useDropAnimationStore } from "@/store/drop-animation-store";
import { ANIMATION_DURATION } from "@/constants/drop-animation";
import { cn } from "@/lib/utils";
import { mergeRefs } from "@/utils/react";
import { FileUploadOptionsPanel } from "./panels/file-upload-options";
import { FILE_INPUT_TYPES } from "@/constants/processing";
import { useShallow } from "zustand/shallow";
import { useFileProcessing } from "@/hooks/use-file-processing";
import { unstable_batchedUpdates as batchedUpdates } from "react-dom";

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
  const [isDragging, setIsDragging] = useState(false);
  const animateTimeout = useRef<NodeJS.Timeout | null>(null);

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

  // Animation function for the file processing hook
  const animateFileUpload = useCallback(
    async (files: File[]) => {
      animateToSnapPosition();

      if (animateTimeout.current) {
        clearTimeout(animateTimeout.current);
      }

      animateTimeout.current = setTimeout(() => {
        batchedUpdates(() => {
          useProcessedFilesStore.getState().setTotalFiles(files.length);
          files.forEach((file) => {
            if (file.type === FILE_INPUT_TYPES.PDF) {
              // not necessary for images
              useProcessedFilesStore.getState().addFile(file.name);
            }
          });
        });
      }, Math.max(ANIMATION_DURATION - 100, 0));

      // Delays processing (progress animation duration)
      await delay(ANIMATION_DURATION);
    },
    [animateToSnapPosition]
  );

  const {
    handleNewFiles,
    handleAbortAndProcess,
    handleAddToQueue,
    getCurrentProcessingInfo,
  } = useFileProcessing(ALLOWED_FILE_TYPES, animateFileUpload);

  /** Setup up drop position when upload file is trigger via click */
  React.useEffect(() => {
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

  return (
    <>
      <FileUploadOptionsPanel
        handleAbortAndProcess={handleAbortAndProcess}
        handleAddToQueue={handleAddToQueue}
        currentProcessingInfo={getCurrentProcessingInfo() || undefined}
      />
      <div>
        {/* Drag Overlay for detecting file drag */}
        <DropOverlay
          ref={dropOverlayRef}
          isDragging={isDragging}
          onDragEvent={handleDrag}
          onFilesDropped={handleNewFiles}
        />

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={ALLOWED_FILE_TYPES.join(",")}
          onChange={(e) =>
            e.target.files?.length && handleNewFiles(e.target.files)
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
