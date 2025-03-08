import { create } from "zustand";

enum ProcessingStatus {
  NOT_STARTED = "not_started",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Represents the processing state for each page in a file.
 */
export interface PageStatus {
  url: string;
  status: ProcessingStatus;
}

/**
 * Represents the state for tracking processed files and their statuses.
 */
interface ProcessedFileState {
  processedFiles: Map<string, Map<number, PageStatus>>;
  fileStatus: Map<string, ProcessingStatus>;
  fileMetadata: Map<string, { size: number; type: string }>;
  totalFiles: number;
  allFilesProcessed: boolean;
  statusCounts: Record<ProcessingStatus, number>;
  allPages: Array<{
    fileName: string;
    pageNumber: number;
    url: string;
    status: ProcessingStatus;
  }>;

  // Methods to manage the store
  addFile: (
    fileName: string,
    totalPages: number,
    metadata: { size: number; type: string }
  ) => void;
  addPageToFile: (
    fileName: string,
    pageNumber: number,
    url: string,
    status?: ProcessingStatus
  ) => void;
  setPageStatus: (
    fileName: string,
    pageNumber: number,
    status: ProcessingStatus
  ) => void;
  setFileStatus: (fileName: string, status: ProcessingStatus) => void;
  setTotalFiles: (total: number) => void;
  computeStatusCounts: () => void;
  checkAllFilesProcessed: () => void;
  reset: () => void;
  updateAllPages: () => void;

  // For sorting
  reorderFiles: (newOrder: string[]) => void;
  reorderPages: (fileName: string, newPageOrder: number[]) => void;

  removeFile: (fileName: string) => void;
  removePage: (fileName: string, pageNumber: number) => void;
}

const useProcessedFilesStore = create<ProcessedFileState>((set, get) => ({
  processedFiles: new Map(),
  fileStatus: new Map(),
  fileMetadata: new Map(),
  totalFiles: 0,
  allFilesProcessed: false,
  statusCounts: {
    [ProcessingStatus.NOT_STARTED]: 0,
    [ProcessingStatus.PROCESSING]: 0,
    [ProcessingStatus.COMPLETED]: 0,
    [ProcessingStatus.FAILED]: 0,
  },
  allPages: [],

  /**
   * Adds a new file with a NOT_STARTED status and prepares its pages.
   */
  addFile: (fileName, totalPages, metadata) => {
    set((state) => {
      const newProcessedFiles = new Map(state.processedFiles);
      const newFileStatus = new Map(state.fileStatus);
      const newFileMetadata = new Map(state.fileMetadata);

      if (!newProcessedFiles.has(fileName)) {
        const pages = new Map<number, PageStatus>();
        for (let i = 1; i <= totalPages; i++) {
          pages.set(i, {
            url: "",
            status: ProcessingStatus.NOT_STARTED,
          });
        }
        newProcessedFiles.set(fileName, pages);
        newFileStatus.set(fileName, ProcessingStatus.NOT_STARTED);
        newFileMetadata.set(fileName, metadata);
      }

      return {
        processedFiles: newProcessedFiles,
        fileStatus: newFileStatus,
        fileMetadata: newFileMetadata,
      };
    });

    get().computeStatusCounts();
  },
  /**
   * Adds or updates a page URL and its status (default is COMPLETED).
   */
  addPageToFile: (
    fileName,
    pageNumber,
    url,
    status = ProcessingStatus.COMPLETED
  ) => {
    set((state) => {
      const newProcessedFiles = new Map(state.processedFiles);
      const filePages =
        newProcessedFiles.get(fileName) ?? new Map<number, PageStatus>();
      const newFilePages = new Map<number, PageStatus>(filePages);

      newFilePages.set(pageNumber, { url, status });
      newProcessedFiles.set(fileName, newFilePages);

      return { processedFiles: newProcessedFiles };
    });

    get().checkAllFilesProcessed();
    get().updateAllPages();
  },

  /**
   * Updates the status of a specific page within a file.
   */
  setPageStatus: (fileName, pageNumber, status) => {
    set((state) => {
      const newProcessedFiles = new Map(state.processedFiles);
      const filePages = newProcessedFiles.get(fileName);
      if (filePages && filePages.has(pageNumber)) {
        const page = filePages.get(pageNumber)!;
        filePages.set(pageNumber, { ...page, status });
        newProcessedFiles.set(fileName, filePages);
      }
      return { processedFiles: newProcessedFiles };
    });

    get().checkAllFilesProcessed();
  },

  /**
   * Updates the overall file processing status.
   */
  setFileStatus: (fileName, status) => {
    set((state) => {
      const newFileStatus = new Map(state.fileStatus);
      newFileStatus.set(fileName, status);
      return { fileStatus: newFileStatus };
    });

    get().computeStatusCounts();
    if (
      status === ProcessingStatus.COMPLETED ||
      status === ProcessingStatus.FAILED
    ) {
      get().checkAllFilesProcessed();
    }
  },

  /**
   * Sets or updates the total number of files to process.
   * If totalFiles already exists, it adds to it.
   */
  setTotalFiles: (total: number) =>
    set((state) => ({ totalFiles: (state.totalFiles || 0) + total })),

  /**
   * Computes and updates the counts for each file processing status.
   */
  computeStatusCounts: () => {
    const { fileStatus } = get();
    const statusCounts = {
      [ProcessingStatus.NOT_STARTED]: 0,
      [ProcessingStatus.PROCESSING]: 0,
      [ProcessingStatus.COMPLETED]: 0,
      [ProcessingStatus.FAILED]: 0,
    };

    fileStatus.forEach((status) => {
      statusCounts[status]++;
    });

    set({ statusCounts });
  },

  /**
   * Checks whether all files (and their pages) have completed processing.
   */
  checkAllFilesProcessed: () => {
    const { processedFiles, totalFiles } = get();

    let completedFiles = 0;

    processedFiles.forEach((pages) => {
      const allPagesCompleted = Array.from(pages.values()).every(
        (page) =>
          page.status === ProcessingStatus.COMPLETED ||
          page.status === ProcessingStatus.FAILED
      );

      if (allPagesCompleted) completedFiles++;
    });

    set({ allFilesProcessed: completedFiles === totalFiles });
  },

  updateAllPages: () => {
    const { processedFiles } = get();
    const pages = Array.from(processedFiles.entries()).flatMap(
      ([fileName, pageMap]) =>
        Array.from(pageMap.entries()).map(([pageNumber, { url, status }]) => ({
          fileName,
          pageNumber,
          url,
          status,
        }))
    );

    set({ allPages: pages });
  },

  /**
   * Resets the store and revokes all object URLs to prevent memory leaks.
   */
  reset: () => {
    set((state) => {
      state.processedFiles.forEach((pages) => {
        pages.forEach((page) => {
          if (page.url && page.url.startsWith("blob:")) {
            URL.revokeObjectURL(page.url);
          }
        });
      });

      return {
        processedFiles: new Map(),
        fileStatus: new Map(),
        totalFiles: 0,
        allFilesProcessed: false,
        statusCounts: {
          [ProcessingStatus.NOT_STARTED]: 0,
          [ProcessingStatus.PROCESSING]: 0,
          [ProcessingStatus.COMPLETED]: 0,
          [ProcessingStatus.FAILED]: 0,
        },
      };
    });
  },

  reorderFiles: (newOrder: string[]) => {
    set((state) => {
      const newProcessedFiles = new Map();
      const newFileStatus = new Map();
      const newFileMetadata = new Map();

      newOrder.forEach((fileName) => {
        newProcessedFiles.set(fileName, state.processedFiles.get(fileName));
        newFileStatus.set(fileName, state.fileStatus.get(fileName));
        newFileMetadata.set(fileName, state.fileMetadata.get(fileName));
      });

      return {
        processedFiles: newProcessedFiles,
        fileStatus: newFileStatus,
        fileMetadata: newFileMetadata,
      };
    });

    get().updateAllPages();
  },

  reorderPages: (fileName: string, newPageOrder: number[]) => {
    set((state) => {
      const pages = state.processedFiles.get(fileName);
      if (!pages) return state;

      const newPages = new Map();
      newPageOrder.forEach((pageNumber) => {
        newPages.set(pageNumber, pages.get(pageNumber));
      });

      const newProcessedFiles = new Map(state.processedFiles);
      newProcessedFiles.set(fileName, newPages);

      return { processedFiles: newProcessedFiles };
    });

    get().updateAllPages();
  },

  removeFile: (fileName: string) => {
    set((state) => {
      const newProcessedFiles = new Map(state.processedFiles);
      const newFileStatus = new Map(state.fileStatus);
      const newFileMetadata = new Map(state.fileMetadata);

      // Revoke blob URLs for all pages of the file before deletion
      const pages = newProcessedFiles.get(fileName);
      if (pages) {
        pages.forEach((page) => {
          if (page.url && page.url.startsWith("blob:")) {
            URL.revokeObjectURL(page.url);
          }
        });
      }

      newProcessedFiles.delete(fileName);
      newFileStatus.delete(fileName);
      newFileMetadata.delete(fileName);

      return {
        processedFiles: newProcessedFiles,
        fileStatus: newFileStatus,
        fileMetadata: newFileMetadata,
        totalFiles: Math.max(0, state.totalFiles - 1),
      };
    });
    get().computeStatusCounts();
    get().checkAllFilesProcessed();
    get().updateAllPages();
  },

  removePage: (fileName: string, pageNumber: number) => {
    set((state) => {
      const newProcessedFiles = new Map(state.processedFiles);
      const pages = newProcessedFiles.get(fileName);
      if (pages) {
        // Revoke blob URL for the specific page before deletion
        const page = pages.get(pageNumber);
        if (page && page.url && page.url.startsWith("blob:")) {
          URL.revokeObjectURL(page.url);
        }
        pages.delete(pageNumber);
        newProcessedFiles.set(fileName, pages);
      }
      return { processedFiles: newProcessedFiles };
    });
    get().checkAllFilesProcessed();
    get().updateAllPages();
  },
}));

export { useProcessedFilesStore, ProcessingStatus };
