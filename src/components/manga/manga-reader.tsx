"use client";

import { useEffect, useRef } from "react";
import { useProcessedFilesStore } from "@/store/processed-files";
import { MangaReaderRenderer } from "@/classes/manga-reader-renderer";

interface MangaReaderProps {
  mangaId?: string;
}

export function MangaReader({ mangaId }: MangaReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MangaReaderRenderer | null>(null);

  const allPages = useProcessedFilesStore((state) => state.getAllPages());

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
    if (rendererRef.current) {
      rendererRef.current.updatePages(allPages);
    }
  }, [allPages]);

  return (
    <div
      id="manga-container"
      ref={containerRef}
      className="w-full h-svh relative overflow-hidden"
    />
  );
}
