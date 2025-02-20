"use client";

import Image from "next/image";
import { useProcessedFilesStore } from "@/store/processed-files";

export function DisplayProcessedFiles() {
  const { processedFiles, totalFiles } = useProcessedFilesStore();

  return (
    <div>
      <h2>Total Files: {totalFiles}</h2>
      {Array.from(processedFiles.entries()).map(([fileName, pages]) => (
        <div key={fileName}>
          <h3>{fileName}</h3>
          {Array.from(pages.entries()).map(([page, url]) => (
            <Image key={page} src={url} alt={`Page ${page}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
