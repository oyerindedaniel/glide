import { create } from "zustand";

export enum ProcessingStatus {
  NOT_STARTED = "not_started",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Represents the processing state for each page in a file.
 */
interface PageStatus {
  url: string;
  status: ProcessingStatus;
  size: number;
  type: string;
}

/**
 * Represents the state for tracking processed files and their statuses.
 */
interface ProcessedFileState {
  processedFiles: Map<string, Map<number, PageStatus>>;
  fileStatus: Map<string, ProcessingStatus>;
  totalFiles: number;
  allFilesProcessed: boolean;
  statusCounts: Record<ProcessingStatus, number>;

  // Methods to manage the store
  addFile: (
    fileName: string,
    totalPages: number,
    { size, type }: Pick<PageStatus, "size" | "type">
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
}

/**
 * Represents the processing state for each page in a file.
 */
interface PageStatus {
  url: string;
  status: ProcessingStatus;
}

export const useProcessedFilesStore = create<ProcessedFileState>(
  (set, get) => ({
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

    /**
     * Adds a new file with a NOT_STARTED status and prepares its pages.
     */
    addFile: (fileName, totalPages, { size, type }) => {
      set((state) => {
        const newProcessedFiles = new Map(state.processedFiles);
        const newFileStatus = new Map(state.fileStatus);

        if (!newProcessedFiles.has(fileName)) {
          const pages = new Map<number, PageStatus>();
          for (let i = 1; i <= totalPages; i++) {
            pages.set(i, {
              url: "",
              type,
              size,
              status: ProcessingStatus.NOT_STARTED,
            });
          }
          newProcessedFiles.set(fileName, pages);
          newFileStatus.set(fileName, ProcessingStatus.NOT_STARTED);
        }

        return { processedFiles: newProcessedFiles, fileStatus: newFileStatus };
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

        const existingPage = newFilePages.get(pageNumber);

        newFilePages.set(pageNumber, {
          url,
          status,
          size: existingPage?.size || 0,
          type: existingPage?.type || "",
        });
        newProcessedFiles.set(fileName, newFilePages);

        return { processedFiles: newProcessedFiles };
      });

      get().checkAllFilesProcessed();
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
     * Computes and updates the counts for each processing status.
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

    /**
     * Resets the store and revokes all object URLs to prevent memory leaks.
     */
    reset: () => {
      set((state) => {
        state.processedFiles.forEach((pages) => {
          pages.forEach((page) => URL.revokeObjectURL(page.url));
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
  })
);
