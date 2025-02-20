"use client";

import React, { memo } from "react";
import Image from "next/image";
import { useProcessedFilesStore } from "@/store/processed-files";
import { useDraggingStore } from "@/store/dragging-store";

/**
 * ProgressUpload Component
 * Displays an upload progress bar.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProgressUploadProps {}

export function ProgressUpload(props: ProgressUploadProps) {
  const totalFiles = useProcessedFilesStore((state) => state.totalFiles);
  const { isDragging, dropPosition } = useDraggingStore();

  return (
    isDragging && (
      <div className="absolute bottom-12 left-12 font-[family-name:var(--font-manrope)] cursor-pointer">
        <div className="relative">
          <Image
            className="w-12"
            src="/uploads-icon.svg"
            alt="upload progress"
            priority
            unoptimized
            width={78}
            height={84}
          />
          <span className="absolute top-0 right-0 -translate-y-2/4 translate-x-2/4 bg-white w-5 h-5 text-xs inline-flex items-center justify-center aspect-square rounded-full border border-primary text-primary font-bold">
            {totalFiles}
          </span>
        </div>
      </div>
    )
  );
}

export default memo(ProgressUpload);
