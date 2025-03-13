import { WorkerMessageType } from "@/types/processor";
// import { pdfJsWorker } from "./pdf-library.worker";

const DEFAULT_MAX_WORKERS = 3;

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof Worker !== "undefined";

// Reference to the shared PDF.js library worker
let sharedLibraryWorker: Worker | null = null;

export class PDFWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: Array<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    task: any;
    resolve: (worker: Worker) => void;
  }> = [];
  private maxWorkers: number;
  private static instance: PDFWorkerPool;

  private constructor(maxWorkers = DEFAULT_MAX_WORKERS) {
    this.maxWorkers = maxWorkers;

    // Initialize the shared library worker if not already done
    if (isBrowser && !sharedLibraryWorker) {
      sharedLibraryWorker = new Worker(
        new URL("./pdf-library.worker.ts", import.meta.url)
      );
    }
  }

  public static getInstance(maxWorkers = DEFAULT_MAX_WORKERS): PDFWorkerPool {
    if (!PDFWorkerPool.instance) {
      PDFWorkerPool.instance = new PDFWorkerPool(maxWorkers);
    }
    return PDFWorkerPool.instance;
  }

  public async getWorker(): Promise<Worker> {
    // Ensure we're in a browser environment
    if (!isBrowser) {
      return Promise.reject(
        new Error("Workers are only available in browser environments")
      );
    }

    if (this.availableWorkers.length > 0) {
      const worker = this.availableWorkers.pop()!;
      console.log(
        `Reusing existing worker (${this.workers.length} total, ${this.availableWorkers.length} available)`
      );
      return Promise.resolve(worker);
    }

    if (this.workers.length < this.maxWorkers) {
      console.log(
        `Creating new worker (will be ${this.workers.length + 1} total workers)`
      );
      const worker = new Worker(new URL("./pdf.worker.ts", import.meta.url));
      this.workers.push(worker);
      return worker;
    }

    // If we've reached max workers, queue the request
    console.log(
      `Maximum workers (${this.maxWorkers}) reached, queueing request (${
        this.taskQueue.length + 1
      } waiting)`
    );
    return new Promise((resolve) => {
      this.taskQueue.push({ task: null, resolve });
    });
  }

  public releaseWorker(worker: Worker) {
    if (!isBrowser) return;

    if (this.taskQueue.length > 0) {
      // If tasks are waiting, assign this worker directly
      const nextTask = this.taskQueue.shift()!;
      console.log(
        `Reassigning worker to waiting task (${this.taskQueue.length} still waiting)`
      );
      nextTask.resolve(worker);
    } else {
      // Otherwise mark it as available
      console.log(
        `Returning worker to available pool (now ${
          this.availableWorkers.length + 1
        } available)`
      );
      this.availableWorkers.push(worker);
    }
  }

  /**
   * Get the shared library worker (singleton)
   * This worker handles the actual PDF.js operations
   */
  public static getSharedLibraryWorker(): Worker {
    if (!isBrowser) {
      throw new Error("Workers are only available in browser environments");
    }

    if (!sharedLibraryWorker) {
      sharedLibraryWorker = new Worker(
        new URL("./pdf-library.worker.ts", import.meta.url)
      );
    }
    return sharedLibraryWorker;
  }

  public terminateAll() {
    if (!isBrowser) return;

    // First send cleanup message to all workers
    for (const worker of this.workers) {
      try {
        worker.postMessage({
          type: WorkerMessageType.Cleanup,
        });

        // Then terminate them
        setTimeout(() => {
          worker.terminate();
        }, 100);
      } catch (error) {
        console.warn("Error cleaning up worker", error);
      }
    }

    // Clear internal structures
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];

    // Finally, terminate the shared library worker
    if (sharedLibraryWorker) {
      try {
        setTimeout(() => {
          sharedLibraryWorker?.terminate();
          sharedLibraryWorker = null;
        }, 200);
      } catch (error) {
        console.warn("Error terminating shared library worker", error);
      }
    }

    // Also terminate the PDF.js worker
    if (isBrowser) {
      try {
        setTimeout(() => {
          //   pdfJsWorker?.terminate();
        }, 300);
      } catch (error) {
        console.warn("Error terminating PDF.js worker", error);
      }
    }
  }
}
