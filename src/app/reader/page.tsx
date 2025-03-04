"use client";

import { useProcessedFilesStore } from "@/store/processed-files";
import { MangaReader } from "@/components/manga/manga-reader";
import { MangaEmptyState } from "@/components/manga/manga-empty-state";
import Image from "next/image";
import Link from "next/link";
import { useShallow } from "zustand/shallow";

export default function Reader() {
  const allPages = useProcessedFilesStore(
    useShallow((state) => state.getAllPages())
  );

  return (
    <div className="flex h-svh">
      <div className="grow bg-[#0B0B0B] h-full overflow-hidden">
        {allPages.length === 0 ? (
          <MangaEmptyState />
        ) : (
          <MangaReader mangaId="1" allPages={allPages} />
        )}
      </div>
      <div className="w-[25%] bg-black p-6">
        <Link className="" href="/">
          <Image
            className="w-28"
            src="/manga-glide.svg"
            alt="logo"
            width={133}
            height={30}
            unoptimized
            priority
          />
        </Link>
      </div>
    </div>
  );
}
