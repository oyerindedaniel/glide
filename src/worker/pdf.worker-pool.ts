import { WorkerMessageType } from "@/types/processor";

const DEFAULT_MAX_WORKERS = 3;

// Worker pool options type
interface WorkerPoolOptions {
  numWorkers?: number;
  maxWorkers?: number;
}

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof Worker !== "undefined";

// We no longer need the shared library worker reference
// let sharedLibraryWorker: Worker | null = null;

// Register PDF Service Worker for handling PDF.js resources
async function registerPDFServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    console.error("Service Worker not supported in this browser");
    return null;
  }

  try {
    const swUrl = "/pdf-service-worker.js";
    console.log(`Registering PDF Service Worker from: ${swUrl}`);

    // Unregister any existing service worker first to ensure a clean state
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      if (registration.scope.includes(window.location.origin)) {
        await registration.unregister();
        console.log(
          "Unregistered existing service worker to ensure clean state"
        );
      }
    }

    // Register new service worker with controlling rights
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: "/",
      updateViaCache: "none", // Always fetch the newest version
    });

    // Check if installing or waiting
    if (registration.installing) {
      console.log("PDF Service Worker is installing...");
    } else if (registration.waiting) {
      console.log("PDF Service Worker is waiting...");
    } else if (registration.active) {
      console.log("PDF Service Worker is active");
    }

    // Wait for the service worker to be activated
    await new Promise<void>((resolve) => {
      if (registration.active) {
        // If already active, wait a moment to ensure it's fully initialized
        setTimeout(resolve, 100);
        return;
      }

      const onStateChange = () => {
        if (registration.active) {
          registration.installing?.removeEventListener(
            "statechange",
            onStateChange
          );
          registration.waiting?.removeEventListener(
            "statechange",
            onStateChange
          );
          // Give a moment for the service worker to initialize
          setTimeout(resolve, 100);
        }
      };

      registration.installing?.addEventListener("statechange", onStateChange);
      registration.waiting?.addEventListener("statechange", onStateChange);
    });

    console.log(
      `PDF Service Worker registered with scope: ${registration.scope}`
    );
    return registration;
  } catch (error) {
    console.error("Service Worker registration failed:", error);
    return null;
  }
}

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
  private serviceWorkerRegistered: boolean = false;

  private constructor(maxWorkers = DEFAULT_MAX_WORKERS) {
    this.maxWorkers = maxWorkers;

    // Register the Service Worker if in browser environment
    if (isBrowser) {
      this.registerServiceWorker();
    }
  }

  private async registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      console.warn("Service Worker not supported in this browser");
      return;
    }

    try {
      // Use the service worker in the public directory
      const swPath = "/pdf-service-worker.js";
      console.log(`Registering PDF Service Worker from: ${swPath}`);

      const registration = await navigator.serviceWorker.register(swPath, {
        scope: "/",
        // No need for type: "module" since it's a regular JS file
      });
      console.log(
        "PDF Service Worker registered with scope:",
        registration.scope
      );
      this.serviceWorkerRegistered = true;
    } catch (error) {
      console.error("PDF Service Worker registration failed:", error);
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
   * We no longer need the shared library worker since each worker now
   * gets the PDF.js library directly from the Service Worker
   */
  // public static getSharedLibraryWorker(): Worker {
  //   if (!isBrowser) {
  //     throw new Error("Workers are only available in browser environments");
  //   }
  //
  //   if (!sharedLibraryWorker) {
  //     sharedLibraryWorker = new Worker(
  //       new URL("./pdf-library.worker.ts", import.meta.url)
  //     );
  //   }
  //   return sharedLibraryWorker;
  // }

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

    // Clear the Service Worker cache if needed
    if (this.serviceWorkerRegistered && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "CLEAR_PDF_CACHE",
      });
    }
  }
}

// Initialize worker pool
export async function initializeWorkerPool(
  options: WorkerPoolOptions
): Promise<void> {
  // Register service worker first and wait for it to be ready
  const registration = await registerPDFServiceWorker();

  // Wait a bit to ensure service worker is ready to handle requests
  if (registration) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // Then create the worker pool
  const numWorkers = options.numWorkers || 1;
  const maxWorkers = options.maxWorkers || DEFAULT_MAX_WORKERS;
  console.log(
    `Initializing worker pool with ${numWorkers} workers, max: ${maxWorkers}`
  );

  // Get the worker pool instance but don't use it directly
  PDFWorkerPool.getInstance(maxWorkers);

  // Create initial workers
  for (let i = 0; i < numWorkers; i++) {
    await createWorker();
  }
}

// Create a new worker
async function createWorker(): Promise<Worker> {
  if (!isBrowser) {
    throw new Error("Workers are only available in browser environments");
  }

  console.log(`Creating new PDF worker`);
  const worker = new Worker(new URL("./pdf.worker.ts", import.meta.url));
  return worker;
}
