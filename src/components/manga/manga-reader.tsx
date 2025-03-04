"use client";

import { useEffect, useRef } from "react";
import { ProcessingStatus } from "@/store/processed-files";
import { MangaReaderRenderer } from "@/classes/manga-reader-renderer";
import { useIsMounted } from "@/hooks/use-is-mounted";

interface MangaReaderProps {
  mangaId?: string;
  allPages: Array<{
    fileName: string;
    pageNumber: number;
    url: string;
    status: ProcessingStatus;
  }>;
}

export function MangaReader({ mangaId, allPages }: MangaReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MangaReaderRenderer | null>(null);

  console.log(allPages);

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

  useEffect(() => {
    // if (rendererRef.current) {
    //   if (allPages.length === 0) return;
    //   rendererRef.current.updatePages(allPages);
    // }
  }, [allPages]);

  return (
    <div
      id="manga-container"
      ref={containerRef}
      className="w-full h-svh relative overflow-auto"
    />
  );
}
