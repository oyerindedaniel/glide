"use client";

import { useProcessedFilesStore } from "@/store/processed-files";
import { MangaReader } from "@/components/manga/manga-reader";
import { MangaEmptyState } from "@/components/manga/manga-empty-state";
import { useShallow } from "zustand/shallow";
import { MangaSidebar } from "@/components/manga/manga-sidebar";
import { useState, useCallback, useRef } from "react";
import { ViewMode } from "@/types/manga-reader";
import { MangaReaderRenderer } from "@/classes/manga-reader-renderer";

export default function Reader() {
  const allPages = useProcessedFilesStore(
    useShallow((state) => state.allPages)
  );

  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.SCROLL);
  const rendererRef = useRef<MangaReaderRenderer | null>(null);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    rendererRef.current?.setViewMode(mode);
  }, []);

  const handlePanelControl = useCallback((action: "prev" | "next" | "play") => {
    if (!rendererRef.current) return;

    switch (action) {
      case "prev":
        rendererRef.current.previousPanel();
        break;
      case "next":
        rendererRef.current.nextPanel();
        break;
      case "play":
        rendererRef.current.togglePlayback();
        break;
    }
  }, []);

  return (
    <div className="h-svh w-full">
      <div className="md:w-[75%] bg-[#0B0B0B] ease-in-out h-full w-full overflow-x-hidden overflow-y-auto transition-[width] duration-800 fixed top-0 left-0 z-10">
        {allPages.length === 0 ? (
          <MangaEmptyState />
        ) : (
          <MangaReader
            mangaId="1"
            allPages={allPages}
            viewMode={viewMode}
            rendererRef={rendererRef}
          />
        )}
      </div>

      <div className="w-[25%] h-svh bg-black p-3 lg:p-6 fixed right-0 top-0 z-5">
        <MangaSidebar
          currentMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onPanelControl={handlePanelControl}
        />
      </div>
    </div>
  );
}
