"use client";

import { useProcessedFilesStore } from "@/store/processed-files";
import { MangaReader } from "@/components/manga/manga-reader";
import { MangaEmptyState } from "@/components/manga/manga-empty-state";
import { useShallow } from "zustand/shallow";
import { MangaSidebar } from "@/components/manga/manga-sidebar";

export default function Reader() {
  const allPages = useProcessedFilesStore(
    useShallow((state) => state.allPages)
  );

  return (
    <div className="h-svh w-full">
      <div className="md:w-[75%] bg-[#0B0B0B] ease-in-out h-full overflow-hidden w-full transition-[width] duration-800 fixed top-0 left-0 z-10">
        {allPages.length === 0 ? (
          <MangaEmptyState />
        ) : (
          <MangaReader mangaId="1" allPages={allPages} />
        )}
      </div>
      <div className="w-[25%] h-svh bg-black p-3 lg:p-6 fixed right-0 top-0 z-5">
        <MangaSidebar />
      </div>
    </div>
  );
}
