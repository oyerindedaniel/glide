import { create } from "zustand";

interface ProcessedFileState {
  processedFiles: Map<string, Map<number, string>>;
  totalFiles: number;
  addFile: (fileName: string) => void;
  addPageToFile: (fileName: string, pageNumber: number, url: string) => void;
  setTotalFiles: (total: number) => void;
  reset: () => void;
}

export const useProcessedFilesStore = create<ProcessedFileState>((set) => ({
  processedFiles: new Map(),
  totalFiles: 0,
  addFile: (fileName) => {
    set((state) => {
      const newProcessedFiles = new Map(state.processedFiles);
      if (!newProcessedFiles.has(fileName)) {
        newProcessedFiles.set(fileName, new Map());
      }
      return { processedFiles: newProcessedFiles };
    });
  },
  addPageToFile: (fileName, pageNumber, url) => {
    set((state) => {
      const newProcessedFiles = new Map(state.processedFiles);
      const filePages = newProcessedFiles.get(fileName) || new Map();
      const newFilePages = new Map(filePages);
      newFilePages.set(pageNumber, url);
      newProcessedFiles.set(fileName, newFilePages);
      return { processedFiles: newProcessedFiles };
    });
  },
  setTotalFiles: (total) => set({ totalFiles: total }),
  reset: () => {
    set((state) => {
      // Revokes all object URLs
      state.processedFiles.forEach((pages) => {
        pages.forEach((url) => URL.revokeObjectURL(url));
      });
      return { processedFiles: new Map(), totalFiles: 0 };
    });
  },
}));
