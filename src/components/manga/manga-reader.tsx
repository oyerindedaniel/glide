"use client";

import { ViewMode } from "@/types/manga-reader";
import { ProcessingStatus } from "@/store/processed-files";
import { memo, useRef, useEffect, RefObject } from "react";
import { MangaReaderRenderer } from "@/classes/manga-reader-renderer";
import { cn } from "@/lib/utils";

interface MangaReaderProps {
  mangaId?: string;
  allPages: Array<{
    fileName: string;
    pageNumber: number;
    url: string;
    status: ProcessingStatus;
  }>;
  viewMode: ViewMode;
  rendererRef: RefObject<MangaReaderRenderer | null>;
}

export const MangaReader = memo(function MangaReader({
  mangaId,
  allPages,
  viewMode,
  rendererRef,
}: MangaReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && !rendererRef.current) {
      rendererRef.current = new MangaReaderRenderer(containerRef.current);
      rendererRef.current.render(allPages);
    }
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);

  //   useEffect(() => {
  //     if (rendererRef.current) {
  //      rendererRef.current.updatePages(allPages);
  //     }
  //   }, [allPages]);

  return (
    <div
      id="manga-container"
      ref={containerRef}
      className={cn(
        `w-full h-full relative`,
        viewMode === ViewMode.SCROLL
          ? "overflow-y-auto overflow-x-hidden"
          : "overflow-hidden"
      )}
    />
  );
});
