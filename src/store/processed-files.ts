import { create } from "zustand";

export enum ProcessingStatus {
  NOT_STARTED = "not_started",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Represents the state for tracking processed files and their statuses.
 */
interface ProcessedFileState {
  /**
   * A map of processed files, where each file name maps to a nested map
   * of page numbers and their corresponding processed URLs.
   *
   * @example
   * processedFiles.get("file1.pdf")?.get(1) // Returns the URL of page 1
   */
  processedFiles: Map<string, Map<number, string>>;

  /**
   * A map storing the processing status of each file.
   *
   * @example
   * fileStatus.get("file1.pdf") // Returns ProcessingStatus.PROCESSING
   */
  fileStatus: Map<string, ProcessingStatus>;

  /**
   * The total number of files to be processed.
   */
  totalFiles: number;

  /**
   * Indicates whether all files have been completely processed.
   * This is true when all files are either completed or failed.
   */
  allFilesProcessed: boolean;

  /**
   * An object containing counts of files in each processing status.
   *
   * @example
   * statusCounts[ProcessingStatus.PROCESSING] // Returns the number of files currently being processed
   */
  statusCounts: Record<ProcessingStatus, number>;

  /**
   * Adds a new file to the store with an initial status of `NOT_STARTED`.
   *
   * @param fileName - The name of the file to be added.
   */
  addFile: (fileName: string) => void;

  /**
   * Associates a processed page with a file by storing its generated URL.
   *
   * @param fileName - The name of the file.
   * @param pageNumber - The page number being processed.
   * @param url - The URL of the processed page.
   */
  addPageToFile: (fileName: string, pageNumber: number, url: string) => void;

  /**
   * Updates the processing status of a file.
   *
   * @param fileName - The name of the file.
   * @param status - The new processing status.
   */
  setFileStatus: (fileName: string, status: ProcessingStatus) => void;

  /**
   * Sets the total number of files to be processed.
   *
   * @param total - The total file count.
   */
  setTotalFiles: (total: number) => void;

  /**
   * Computes and updates the count of files in each processing status.
   */
  computeStatusCounts: () => void;

  /**
   * Checks if all files have been processed (either completed or failed)
   * and updates the `allFilesProcessed` flag.
   */
  checkAllFilesProcessed: () => void;

  /**
   * Resets the store by clearing all processed files, statuses,
   * and revoking any created object URLs to prevent memory leaks.
   */
  reset: () => void;
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

    addFile: (fileName) => {
      set((state) => {
        const newProcessedFiles = new Map(state.processedFiles);
        const newFileStatus = new Map(state.fileStatus);

        if (!newProcessedFiles.has(fileName)) {
          newProcessedFiles.set(fileName, new Map());
          newFileStatus.set(fileName, ProcessingStatus.NOT_STARTED);
        }

        return { processedFiles: newProcessedFiles, fileStatus: newFileStatus };
      });

      get().computeStatusCounts();
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

      get().checkAllFilesProcessed();
    },

    setFileStatus: (fileName, status) => {
      set((state) => {
        const newFileStatus = new Map(state.fileStatus);
        newFileStatus.set(fileName, status);
        return { fileStatus: newFileStatus };
      });

      get().computeStatusCounts();
      // Checks if all files are processed
      if (
        status === ProcessingStatus.COMPLETED ||
        status === ProcessingStatus.FAILED
      ) {
        get().checkAllFilesProcessed();
      }
    },

    setTotalFiles: (total) => set({ totalFiles: total }),

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

    checkAllFilesProcessed: () => {
      const { fileStatus, totalFiles } = get();
      const completedFiles = Array.from(fileStatus.values()).filter(
        (status) =>
          status === ProcessingStatus.COMPLETED ||
          status === ProcessingStatus.FAILED
      ).length;

      set({ allFilesProcessed: completedFiles === totalFiles });
    },

    reset: () => {
      set((state) => {
        // Revokes all object URLs
        state.processedFiles.forEach((pages) => {
          pages.forEach((url) => URL.revokeObjectURL(url));
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
