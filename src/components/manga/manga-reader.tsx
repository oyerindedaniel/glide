"use client";

import { memo, useEffect, useRef } from "react";
import { ProcessingStatus } from "@/store/processed-files";
import { MangaReaderRenderer } from "@/classes/manga-reader-renderer";

interface MangaReaderProps {
  mangaId?: string;
  allPages: Array<{
    fileName: string;
    pageNumber: number;
    url: string;
    status: ProcessingStatus;
  }>;
}

export const MangaReader = memo(function MangaReader({
  mangaId,
  allPages,
}: MangaReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MangaReaderRenderer | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.log({ allPages });

  //   useEffect(() => {
  //     if (rendererRef.current) {
  //      rendererRef.current.updatePages(allPages);
  //     }
  //   }, [allPages]);

  return (
    <div
      id="manga-container"
      ref={containerRef}
      className="w-full h-full relative overflow-y-auto overflow-x-hidden"
    />
  );
});
