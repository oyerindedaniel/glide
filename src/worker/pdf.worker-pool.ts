import {
  WorkerMessageType,
  CleanupMessage as WorkerCleanupMessage,
  PDFInitializedMessage,
  WorkerMessage,
  PageProcessedMessage,
  ErrorMessage,
  AbortProcessingMessage,
  RecoveryEventType,
  RecoveryDataForType,
  CoordinatorFallbackMessage,
  isCoordinatorFallbackMessage,
  CleanupOptions,
  CleanupResponse,
} from "@/types/processor";
import {
  CoordinatorMessageType,
  AssignCoordinatorMessage,
  InitCoordinatorMessage,
  RegisterWorkerMessage,
  CoordinatorStatusMessage,
  CleanupMessage as CoordinatorCleanupMessage,
  RegisterCoordinatorMessage,
} from "@/types/coordinator";
import { v4 as uuidv4 } from "uuid";
import {
  MAX_WORKERS,
  COORDINATOR_COUNT,
  ORPHANED_RESULT_EXPIRATION,
} from "@/config/app";
import logger from "@/utils/logger";
import { isBrowserWithWorker } from "@/utils/app";
import recoveryEmitter from "@/utils/recovery-event-emitter";
import {
  createConcurrencyConfig,
  ConcurrencyOptions,
  calculateOptimalCoordinatorCount,
} from "@/utils/concurrency";
import {
  WorkerInitializationError,
  WorkerTimeoutError,
  WorkerCleanupError,
  WorkerCommunicationError,
  WorkerPoolError,
  tryCatch,
  normalizeError,
} from "@/utils/error";

// Reference to the shared PDF.js library worker
let sharedLibraryWorker: Worker | null = null;

export interface WorkerPoolOptions {
  maxWorkers?: number;
  coordinatorCount?: number;
  detectOptimalConcurrency?: boolean;
  concurrencyOptions?: ConcurrencyOptions;
}

/**
 * PDF Worker Pool manages a collection of worker threads for PDF processing
 * with a tiered fallback communication system:
 *
 * Communication Flow:
 * 1. Main Thread → Worker Pool → Workers/Coordinators (direct messaging)
 * 2. Worker → Coordinator (via MessagePort)
 * 3. Coordinator → Library Worker (via MessagePort)
 * 4. Library Worker → Coordinator → Worker (response path)
 *
 * Fallback Messaging:
 * If a coordinator receives a message from the library worker but cannot find
 * the worker that made the request (based on requestId), it:
 * 1. First tries to broadcast to all connected workers
 * 2. If no workers are connected or broadcasts fail, it sends the message back to the main thread
 * 3. The worker pool receives these fallback messages and logs/handles them appropriately
 *
 * This ensures messages aren't lost even in edge cases where the original requestor
 * is no longer available or the requestId can't be matched.
 */
export class PDFWorkerPool {
  private workers: Worker[] = [];
  private workerCoordinatorChannels: MessageChannel[] = [];
  private availableWorkers: Worker[] = [];
  private coordinators: Worker[] = [];
  private coordinatorChannels: MessageChannel[] = [];
  private nextCoordinatorIndex = 0;
  private taskQueue: Array<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    task: any;
    resolve: (worker: Worker) => void;
  }> = [];
  private maxWorkers: number;
  private coordinatorCount: number;
  private static instance: PDFWorkerPool;
  public isInitialized = false;
  private activeClients: Set<string> = new Set();
  private workerHandlers = new Map<
    Worker,
    (e: MessageEvent<WorkerMessage>) => void
  >();

  // Recovery system properties
  private orphanedResults = new Map<string, WorkerMessage>();

  private terminationTimeouts: NodeJS.Timeout[] = [];

  private coordinatorHandlers: Map<Worker, EventListener> = new Map();
  private coordinatorStatusInterval: NodeJS.Timeout | null = null;

  private usedOptimalConcurrency: boolean = false;

  private constructor(options: WorkerPoolOptions = {}) {
    const {
      maxWorkers: initialMaxWorkers = MAX_WORKERS,
      coordinatorCount: initialCoordinatorCount = COORDINATOR_COUNT,
      detectOptimalConcurrency = true,
      concurrencyOptions = {},
    } = options;

    if (detectOptimalConcurrency && isBrowserWithWorker()) {
      try {
        const concurrencyConfig = createConcurrencyConfig({
          customConcurrency:
            options.maxWorkers !== undefined &&
            options.maxWorkers !== MAX_WORKERS
              ? options.maxWorkers
              : undefined,
          ...concurrencyOptions,
        });

        this.maxWorkers = concurrencyConfig.maxConcurrentFiles;
        this.usedOptimalConcurrency = concurrencyConfig.usedOptimalDetection;

        // Scale coordinators with worker count but keep it reasonable
        // This ensures we have enough coordinators for the workers without excessive overhead
        if (
          this.usedOptimalConcurrency &&
          options.coordinatorCount === undefined
        ) {
          this.coordinatorCount = calculateOptimalCoordinatorCount(
            this.maxWorkers
          );
        } else {
          this.coordinatorCount = initialCoordinatorCount;
        }

        if (this.usedOptimalConcurrency) {
          logger.log(
            `WorkerPool configured with ${this.maxWorkers} workers and ${this.coordinatorCount} coordinators based on system capabilities`
          );
        }
      } catch (error) {
        // Fallback to defaults if detection fails
        logger.warn(
          "Failed to detect optimal worker pool settings, using default",
          error
        );
        this.maxWorkers = initialMaxWorkers;
        this.coordinatorCount = initialCoordinatorCount;
      }
    } else {
      // Use the provided values
      this.maxWorkers = initialMaxWorkers;
      this.coordinatorCount = initialCoordinatorCount;
    }

    // Initialize the shared library worker if not already done
    if (isBrowserWithWorker() && !sharedLibraryWorker) {
      sharedLibraryWorker = new Worker(
        new URL("./pdf-library.worker.ts", import.meta.url)
      );
    }
  }

  /**
   * Get the worker pool configuration including concurrency settings
   */
  public getPoolConfiguration(): {
    maxWorkers: number;
    coordinatorCount: number;
    usedOptimalDetection: boolean;
    activeWorkers: number;
    availableWorkers: number;
  } {
    return {
      maxWorkers: this.maxWorkers,
      coordinatorCount: this.coordinatorCount,
      usedOptimalDetection: this.usedOptimalConcurrency,
      activeWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
    };
  }

  /**
   * Initialize the worker pool instance
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized || !isBrowserWithWorker()) return;

    const { error: initializeError } = await tryCatch<
      void,
      WorkerInitializationError
    >(this.initializeCoordinators());

    if (initializeError) {
      throw initializeError.raw;
    }
  }

  private async initializeCoordinators(): Promise<void> {
    if (!sharedLibraryWorker || !isBrowserWithWorker() || this.isInitialized) {
      if (!sharedLibraryWorker) {
        throw new WorkerInitializationError(
          "Failed to initialize shared library worker"
        );
      }

      if (!isBrowserWithWorker()) {
        throw new WorkerInitializationError(
          "Workers are only available in browser environments"
        );
      }

      if (this.isInitialized) {
        logger.log("Worker pool already initialized");
      }

      return;
    }

    logger.log(`Initializing ${this.coordinatorCount} coordinator workers...`);

    // Create coordinator workers
    for (let i = 0; i < this.coordinatorCount; i++) {
      try {
        const coordinator = new Worker(
          new URL("./pdf-coordinator.worker.ts", import.meta.url)
        );
        // Create a message channel for this coordinator
        const channel = new MessageChannel();

        // Set up communication between library worker and coordinator
        const registerMessage: RegisterCoordinatorMessage = {
          type: CoordinatorMessageType.REGISTER_COORDINATOR,
          coordinatorId: i,
        };

        sharedLibraryWorker.postMessage(registerMessage, [channel.port1]);

        // Initialize the coordinator with its port and ID
        const initMessage: InitCoordinatorMessage = {
          type: CoordinatorMessageType.INIT_COORDINATOR,
          coordinatorId: i,
        };

        coordinator.postMessage(initMessage, [channel.port2]);

        const fallbackHandler = ((
          e: MessageEvent<CoordinatorFallbackMessage>
        ) => {
          this.handleCoordinatorFallbackMessage(e);
        }) as EventListener;

        // Set up event listener for fallback messages from coordinator
        coordinator.addEventListener("message", fallbackHandler);

        this.coordinators.push(coordinator);
        this.coordinatorChannels.push(channel);

        this.coordinatorHandlers.set(coordinator, fallbackHandler);

        logger.log(`Initialized coordinator worker ${i}`);
      } catch (error) {
        logger.error(
          `Error initializing coordinator worker ${i}:`,
          normalizeError(error)
        );
        throw new WorkerInitializationError(
          `Failed to initialize coordinator worker ${i}: ${normalizeError(
            error
          )}`
        );
      }
    }

    // Wait for all coordinators to be ready
    await Promise.all(
      this.coordinators.map(
        (coordinator, index) =>
          new Promise<void>((resolve) => {
            const handler = (
              e: MessageEvent<{ type: string; coordinatorId: number }>
            ) => {
              const data = e.data;

              if (
                data.type === CoordinatorMessageType.COORDINATOR_READY &&
                data.coordinatorId === index
              ) {
                coordinator.removeEventListener("message", handler);
                resolve();
              }
            };
            coordinator.addEventListener("message", handler);
          })
      )
    );

    logger.log(`All ${this.coordinatorCount} coordinators initialized`);
    this.isInitialized = true;

    if (this.coordinatorStatusInterval) {
      clearInterval(this.coordinatorStatusInterval);
      this.coordinatorStatusInterval = null;
    }

    // TODO: Revisit this not needed for now a port is needed for messages
    // this.coordinatorStatusInterval = setInterval(() => {
    //   this.coordinators.forEach((coordinator, index) => {
    //     try {
    //       const statusMessage = {
    //         type: CoordinatorMessageType.COORDINATOR_STATUS,
    //       };
    //       coordinator.postMessage(statusMessage);
    //     } catch (err) {
    //       logger.error(`Error sending heartbeat to coordinator ${index}:`, err);
    //     }
    //   });
    // }, 30000) as NodeJS.Timeout;
  }

  /**
   * Handle fallback messages from coordinators when they can't find a worker recipient
   * @param event The message event from the coordinator
   */
  private handleCoordinatorFallbackMessage(
    event: MessageEvent<WorkerMessage>
  ): void {
    // Check if this is actually a coordinator fallback message
    if (!isCoordinatorFallbackMessage(event.data)) {
      return;
    }

    const data = event.data as CoordinatorFallbackMessage;

    logger.log(
      `[WorkerPool] Received fallback message from coordinator ${data.coordinatorId}: ${data.type}`
    );

    switch (data.type) {
      case WorkerMessageType.PageProcessed:
        this.handleOrphanedPageProcessed(
          data as CoordinatorFallbackMessage<PageProcessedMessage>
        );
        break;

      case WorkerMessageType.PDFInitialized:
        this.handleOrphanedPDFInitialized(
          data as CoordinatorFallbackMessage<PDFInitializedMessage>
        );
        break;

      case WorkerMessageType.Error:
        this.handleOrphanedError(
          data as CoordinatorFallbackMessage<ErrorMessage>
        );
        break;

      case WorkerMessageType.Cleanup:
        this.handleOrphanedCleanup(
          data as CoordinatorFallbackMessage<WorkerCleanupMessage>
        );
        break;

      case WorkerMessageType.AbortProcessing:
        this.handleOrphanedAbortProcessing(
          data as CoordinatorFallbackMessage<AbortProcessingMessage>
        );
        break;

      default:
        logger.warn(`[WorkerPool] Unknown fallback message type: ${data.type}`);
        this.storeOrphanedResult(data);
        break;
    }
  }

  /**
   * Handle orphaned PageProcessed messages with recovery attempts
   */
  private handleOrphanedPageProcessed(
    data: CoordinatorFallbackMessage<PageProcessedMessage>
  ): void {
    if (!data.clientId || !data.pageNumber) {
      logger.warn(
        `[WorkerPool] Cannot recover PageProcessed message without clientId or pageNumber`
      );
      return;
    }

    // Unique recovery key
    const recoveryKey = `${data.clientId}-PageProcessed-${data.pageNumber}`;

    // Store the result for later retrieval
    this.storeOrphanedResult(data, recoveryKey);

    // Notify main thread about the orphaned result
    this.notifyMainThread<WorkerMessageType.PageProcessed>(
      RecoveryEventType.PageProcessed,
      {
        type: WorkerMessageType.PageProcessed,
        clientId: data.clientId,
        pageNumber: data.pageNumber,
        dimensions: data.dimensions,
        recoveryKey,
        timestamp: Date.now(),
      }
    );

    logger.warn(
      `[WorkerPool] Undeliverable PageProcessed for page ${data.pageNumber}, client ${data.clientId}. Recovery event emitted.`
    );
  }

  /**
   * Handle orphaned PDFInitialized messages
   */
  private handleOrphanedPDFInitialized(
    data: CoordinatorFallbackMessage<PDFInitializedMessage>
  ): void {
    if (!data.clientId) {
      logger.warn(
        `[WorkerPool] Cannot recover PDFInitialized message without clientId`
      );
      return;
    }

    // Unique recovery key
    const recoveryKey = `${data.clientId}-PDFInitialized-${
      data.totalPages || 0
    }`;

    // Store the result for later retrieval
    this.storeOrphanedResult(data, recoveryKey);

    // Notify main thread about the orphaned result
    this.notifyMainThread<WorkerMessageType.PDFInitialized>(
      RecoveryEventType.PDFInitialized,
      {
        type: WorkerMessageType.PDFInitialized,
        clientId: data.clientId,
        totalPages: data.totalPages,
        recoveryKey,
        timestamp: Date.now(),
      }
    );

    logger.warn(
      `[WorkerPool] Undeliverable PDFInitialized for client ${data.clientId}. Recovery event emitted.`
    );
  }

  /**
   * Handle orphaned Error messages
   */
  private handleOrphanedError(
    data: CoordinatorFallbackMessage<ErrorMessage>
  ): void {
    if (!data.clientId) {
      logger.warn(`[WorkerPool] Cannot recover Error message without clientId`);
      return;
    }

    // Unique recovery key
    const recoveryKey = `${data.clientId}-Error-${Date.now()}`;

    // Store the result for later retrieval
    this.storeOrphanedResult(data, recoveryKey);

    // Notify main thread about the orphaned error
    this.notifyMainThread<WorkerMessageType.Error>(RecoveryEventType.Error, {
      type: WorkerMessageType.Error,
      clientId: data.clientId,
      error: data.error,
      recoveryKey,
      timestamp: Date.now(),
    });

    logger.warn(
      `[WorkerPool] Undeliverable Error for client ${data.clientId}: ${data.error}. Recovery event emitted.`
    );
  }

  /**
   * Handle orphaned Cleanup messages
   */
  private handleOrphanedCleanup(
    data: CoordinatorFallbackMessage<WorkerCleanupMessage>
  ): void {
    if (!data.clientId) {
      logger.warn(
        `[WorkerPool] Cannot recover Cleanup message without clientId`
      );
      return;
    }

    // Process cleanup for this client
    this.clearClientRecoveryEntries(data.clientId);
    this.activeClients.delete(data.clientId);

    // Unique recovery key for tracking
    const recoveryKey = `${data.clientId}-Cleanup-${Date.now()}`;

    // Store the result for potential introspection
    this.storeOrphanedResult(data, recoveryKey);

    // Notify main thread about the cleanup
    this.notifyMainThread<WorkerMessageType.Cleanup>(
      RecoveryEventType.Cleanup,
      {
        type: WorkerMessageType.Cleanup,
        clientId: data.clientId,
        recoveryKey,
        timestamp: Date.now(),
      }
    );

    logger.warn(
      `[WorkerPool] Undeliverable Cleanup for client ${data.clientId}. Client resources cleaned up.`
    );
  }

  /**
   * Handle orphaned AbortProcessing messages
   */
  private handleOrphanedAbortProcessing(
    data: CoordinatorFallbackMessage<AbortProcessingMessage>
  ): void {
    if (!data.clientId) {
      logger.warn(
        `[WorkerPool] Cannot recover AbortProcessing message without clientId`
      );
      return;
    }

    // Process cleanup for this client
    this.clearClientRecoveryEntries(data.clientId);
    this.activeClients.delete(data.clientId);

    // Unique recovery key for tracking
    const recoveryKey = `${data.clientId}-Abort-${Date.now()}`;

    // Store the result for potential introspection
    this.storeOrphanedResult(data, recoveryKey);

    // Notify main thread about the abort
    this.notifyMainThread<WorkerMessageType.AbortProcessing>(
      RecoveryEventType.AbortProcessing,
      {
        type: WorkerMessageType.AbortProcessing,
        clientId: data.clientId,
        recoveryKey,
        timestamp: Date.now(),
      }
    );

    logger.warn(
      `[WorkerPool] Undeliverable AbortProcessing for client ${data.clientId}. Client resources cleaned up.`
    );
  }

  /**
   * Store an orphaned result for potential retrieval
   */
  private storeOrphanedResult(message: WorkerMessage, key?: string): void {
    const storageKey =
      key || `${message.clientId || "unknown"}-${message.type}-${Date.now()}`;
    this.orphanedResults.set(storageKey, message);

    // Set expiration for orphaned results
    setTimeout(() => {
      this.orphanedResults.delete(storageKey);
    }, ORPHANED_RESULT_EXPIRATION);
  }

  /**
   * Clear any recovery entries for a client
   */
  private clearClientRecoveryEntries(clientId: string): void {
    logger.log(
      `[WorkerPool] Cleaning up recovery entries for client ${clientId}`
    );

    // Remove any orphaned results for this client
    for (const [key, result] of this.orphanedResults.entries()) {
      if (result.clientId === clientId) {
        this.orphanedResults.delete(key);
        logger.log(
          `[WorkerPool] Removed orphaned result ${key} for client ${clientId}`
        );
      }
    }
  }

  /**
   * Notify the main thread about recovery events
   * @param eventName The recovery event type
   * @param data data specific to the event type
   */
  private notifyMainThread<T extends WorkerMessageType>(
    eventName: RecoveryEventType | string,
    data: RecoveryDataForType<T>
  ): void {
    // Use the recovery event emitter
    recoveryEmitter.emit(eventName as RecoveryEventType, data);

    // For backward compatibility during transition, we'll also log the event
    logger.log(
      `[WorkerPool] Emitted recovery event: ${eventName}`,
      data.clientId ? `for client: ${data.clientId}` : ""
    );
  }

  /**
   * Get an orphaned result by recovery key
   * @param recoveryKey The key for looking up the orphaned result
   * @returns The recovered message or null if not found
   */
  public getOrphanedResult(recoveryKey: string): WorkerMessage | null {
    const result = this.orphanedResults.get(recoveryKey);
    return result || null;
  }

  /**
   * Get all orphaned results for a specific client
   * @param clientId The client ID to get orphaned results for
   * @returns An array of orphaned results for the client
   */
  public getClientOrphanedResults(clientId: string): WorkerMessage[] {
    if (!clientId) return [];

    const results: WorkerMessage[] = [];

    for (const result of this.orphanedResults.values()) {
      if (result.clientId === clientId) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Get recovery statistics for monitoring
   */
  public getRecoveryStats(): {
    orphanedResultsCount: number;
    recoveryByType: Record<string, number>;
  } {
    // Count recovery attempts by message type
    const typeCount: Record<string, number> = {};
    for (const result of this.orphanedResults.values()) {
      const type = result.type;
      typeCount[type] = (typeCount[type] || 0) + 1;
    }

    return {
      orphanedResultsCount: this.orphanedResults.size,
      recoveryByType: typeCount,
    };
  }

  /**
   * Get or create the PDFWorkerPool singleton instance,
   * ensuring it's properly initialized before returning
   */
  public static async getInstance(
    options: WorkerPoolOptions = {}
  ): Promise<PDFWorkerPool> {
    if (PDFWorkerPool.instance) {
      if (!PDFWorkerPool.instance.isInitialized) {
        const { error: initializeError } = await tryCatch(
          PDFWorkerPool.instance.initialize()
        );

        if (initializeError) {
          throw initializeError.raw;
        }
      }
      return PDFWorkerPool.instance;
    }

    const instance = new PDFWorkerPool(options);
    PDFWorkerPool.instance = instance;
    const { error: initializeError } = await tryCatch(instance.initialize());

    if (initializeError) {
      throw initializeError.raw;
    }

    return instance;
  }

  /**
   * Get the PDFWorkerPool singleton instance synchronously without waiting for initialization
   * WARNING: This should only be used when the caller can handle an uninitialized instance
   * or when it's known that the instance is already initialized
   */
  public static getInstanceSync(
    options: WorkerPoolOptions = {}
  ): PDFWorkerPool {
    if (!PDFWorkerPool.instance) {
      PDFWorkerPool.instance = new PDFWorkerPool(options);

      if (isBrowserWithWorker()) {
        void PDFWorkerPool.instance.initialize();
      }
    }

    return PDFWorkerPool.instance;
  }

  public async getWorker(): Promise<Worker> {
    if (!isBrowserWithWorker()) {
      throw new WorkerInitializationError(
        "Workers are only available in browser environments"
      );
    }

    // Make sure initialization is complete before proceeding
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.availableWorkers.length > 0) {
      const worker = this.availableWorkers.pop()!;
      logger.log(
        `Reusing existing worker (${this.workers.length} total, ${this.availableWorkers.length} available)`
      );
      return Promise.resolve(worker);
    }

    if (this.workers.length < this.maxWorkers) {
      logger.log(
        `Creating new worker (will be ${this.workers.length + 1} total workers)`
      );
      const worker = new Worker(new URL("./pdf.worker.ts", import.meta.url));

      // Assign the worker to a coordinator (round-robin)
      const coordinatorIndex = this.workers.length % this.coordinatorCount;
      const coordinator = this.coordinators[coordinatorIndex];

      if (!coordinator) {
        throw new WorkerPoolError(
          `No coordinator available at index ${coordinatorIndex}`
        );
      }

      // Create a message channel for direct worker-coordinator communication
      const workerCoordinatorChannel = new MessageChannel();
      const workerId = uuidv4();

      try {
        // Initialize the worker with its coordinator information and port1
        const assignMessage: AssignCoordinatorMessage = {
          type: CoordinatorMessageType.ASSIGN_COORDINATOR,
          coordinatorIndex,
          workerId: workerId,
        };

        worker.postMessage(assignMessage, [workerCoordinatorChannel.port1]);

        // Send port2 to the coordinator with a reference to this worker
        const registerWorkerMessage: RegisterWorkerMessage = {
          type: CoordinatorMessageType.REGISTER_WORKER,
          workerId: workerId,
        };

        coordinator.postMessage(registerWorkerMessage, [
          workerCoordinatorChannel.port2,
        ]);

        // Create a message handler for client tracking
        const clientTrackingHandler = (e: MessageEvent<WorkerMessage>) => {
          const data = e.data;

          // Listen for PDFInitialized messages (response to InitPDF)
          if (data.type === WorkerMessageType.PDFInitialized) {
            const initMessage = data as PDFInitializedMessage;
            if (initMessage.clientId) {
              logger.log(
                `Worker sent PDFInitialized for client ${initMessage.clientId}, with ${initMessage.totalPages} pages`
              );
              this.trackClient(initMessage.clientId);
            }
          }

          // Listen for cleanup and abort messages
          if (
            data.type === WorkerMessageType.Cleanup ||
            data.type === WorkerMessageType.AbortProcessing
          ) {
            const cleanupMessage = data as WorkerCleanupMessage;
            if (cleanupMessage.clientId) {
              logger.log(
                `Worker sent cleanup for client ${cleanupMessage.clientId}`
              );
              this.activeClients.delete(cleanupMessage.clientId);
            }
          }
        };

        // Set up a listener for client tracking
        worker.addEventListener("message", clientTrackingHandler);

        // Store the handler for cleanup later
        this.workerHandlers.set(worker, clientTrackingHandler);

        this.workers.push(worker);
        this.workerCoordinatorChannels.push(workerCoordinatorChannel);
        return worker;
      } catch (error) {
        // Clean up the worker if initialization fails
        try {
          worker.terminate();
        } catch (terminateError) {
          logger.warn("Error terminating failed worker:", terminateError);
        }
        throw new WorkerInitializationError(
          `Failed to initialize worker: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    // If we've reached max workers, queue the request
    logger.log(
      `Maximum workers (${this.maxWorkers}) reached, queueing request (${
        this.taskQueue.length + 1
      } waiting)`
    );
    return new Promise((resolve) => {
      this.taskQueue.push({ task: null, resolve });
    });
  }

  public releaseWorker(worker: Worker) {
    if (!isBrowserWithWorker()) return;

    if (this.taskQueue.length > 0) {
      // If tasks are waiting, assign this worker directly
      const nextTask = this.taskQueue.shift()!;
      logger.log(
        `Reassigning worker to waiting task (${this.taskQueue.length} still waiting)`
      );
      nextTask.resolve(worker);
    } else {
      // Otherwise mark it as available
      logger.log(
        `Returning worker to available pool (now ${
          this.availableWorkers.length + 1
        } available)`
      );

      // Note: We don't remove event listeners when releasing workers to the pool
      // We only remove them when terminating workers

      this.availableWorkers.push(worker);
    }
  }

  /**
   * Get the coordinator worker by index
   */
  public getCoordinatorWorker(index: number): Worker | null {
    if (index < 0 || index >= this.coordinators.length) {
      return null;
    }
    return this.coordinators[index];
  }

  /**
   * Get the next available coordinator worker in round-robin fashion
   */
  public getNextCoordinatorWorker(): Worker | null {
    if (this.coordinators.length === 0) return null;

    const coordinator = this.coordinators[this.nextCoordinatorIndex];
    this.nextCoordinatorIndex =
      (this.nextCoordinatorIndex + 1) % this.coordinators.length;
    return coordinator;
  }

  /**
   * Get the shared library worker (singleton)
   * This worker handles the actual PDF.js operations
   */
  public static getSharedLibraryWorker(): Worker {
    if (!isBrowserWithWorker()) {
      throw new WorkerInitializationError(
        "Workers are only available in browser environments"
      );
    }

    if (!sharedLibraryWorker) {
      sharedLibraryWorker = new Worker(
        new URL("./pdf-library.worker.ts", import.meta.url)
      );
    }
    return sharedLibraryWorker;
  }

  /**
   * Get status information from a specific coordinator
   * @param coordinatorIndex The index of the coordinator to query
   * @returns Promise that resolves with the coordinator status
   */
  public async getCoordinatorStatus(
    coordinatorIndex?: number
  ): Promise<CoordinatorStatusMessage | null> {
    if (!isBrowserWithWorker()) {
      throw new WorkerInitializationError(
        "Workers are only available in browser environments"
      );
    }

    // Wait for coordinators to initialize if they haven't
    if (!this.isInitialized) {
      const { error: initializeError } = await tryCatch(
        this.initializeCoordinators()
      );

      if (initializeError) {
        throw initializeError.raw;
      }
    }

    // If no specific coordinator is requested, use the next coordinator in round-robin
    const targetIndex =
      coordinatorIndex !== undefined
        ? coordinatorIndex
        : this.nextCoordinatorIndex % this.coordinatorCount;

    const coordinator = this.coordinators[targetIndex];
    if (!coordinator) {
      throw new WorkerPoolError(`No coordinator found at index ${targetIndex}`);
    }

    return new Promise((resolve, reject) => {
      const statusRequestId = uuidv4();

      // Create a message channel for the response
      const channel = new MessageChannel();

      // Set up the listener for the response
      channel.port1.onmessage = (
        event: MessageEvent<CoordinatorStatusMessage>
      ) => {
        const data = event.data;
        // TODO: ensure transfered port is closed
        if (data.type === CoordinatorMessageType.COORDINATOR_STATUS) {
          channel.port1.close();
          resolve(data);
        }
      };

      // Request the status
      const statusRequest = {
        type: CoordinatorMessageType.COORDINATOR_STATUS,
        requestId: statusRequestId,
      };

      try {
        // Send the request with the port
        coordinator.postMessage(statusRequest, [channel.port2]);
      } catch (error) {
        channel.port1.close();
        reject(
          new WorkerCommunicationError(
            `Failed to communicate with coordinator ${targetIndex}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          )
        );
      }

      setTimeout(() => {
        channel.port1.close();
        reject(
          new WorkerTimeoutError(
            `Status request to coordinator ${targetIndex} timed out`
          )
        );
      }, 3000);
    });
  }

  /**
   * Clean up resources for a specific client
   * @param clientId The client ID to clean up
   * @param options Additional cleanup options
   * @returns Promise that resolves when cleanup is complete or timeout occurs
   */
  public async cleanupClient(
    clientId: string,
    options: CleanupOptions & {
      targetWorkers?: Worker[]; // Specific workers to send cleanup to (default: all)
      targetCoordinators?: number[]; // Specific coordinator indices to clean (default: all)
      timeout?: number; // Timeout for cleanup operation in ms
      skipResponseCheck?: boolean; // Skip waiting for responses (fire and forget)
    } = {}
  ): Promise<CleanupResponse> {
    if (!isBrowserWithWorker() || !clientId) {
      throw new WorkerCleanupError(
        "Cleanup operation failed: Invalid environment or client ID"
      );
    }

    const {
      force = false,
      silent = false,
      targetWorkers,
      targetCoordinators,
      timeout = 500,
      skipResponseCheck = false,
      delayRequestRemoval = false,
      requestRemovalDelay = 5000,
      closeChannels = false,
    } = options;

    if (!this.activeClients.has(clientId) && !force) {
      if (!silent) {
        logger.log(
          `Client ${clientId} not found in active clients, skipping cleanup`
        );
      }
      return {
        success: true,
        workerResponses: 0,
        coordinatorResponses: 0,
        timedOut: false,
      } satisfies CleanupResponse;
    }

    if (!silent) {
      logger.log(`Cleaning up resources for client: ${clientId}`);
    }

    // Mark client as inactive immediately
    this.activeClients.delete(clientId);

    // Create a cleanup request ID for tracking responses
    const cleanupRequestId = uuidv4();

    // Create a message channel for response listening
    const responseChannel = new MessageChannel();
    const responsePort = responseChannel.port1;

    let workerResponses = 0;
    let coordinatorResponses = 0;

    // Start response listener if we're not skipping response checks
    const responsePromise = !skipResponseCheck
      ? new Promise<{
          workerResponses: number;
          coordinatorResponses: number;
          timedOut: boolean;
        }>((resolve) => {
          let timeoutId: NodeJS.Timeout | null = null;

          // Set up response listener
          responsePort.onmessage = (event) => {
            const data = event.data;

            if (
              data.type === CoordinatorMessageType.CLEANUP &&
              data.requestId === cleanupRequestId
            ) {
              if (data.isWorkerCleanupResponse) {
                workerResponses++;
                if (!silent) {
                  logger.log(
                    `Received worker cleanup response for client ${clientId} (${workerResponses} total)`
                  );
                }
              } else {
                coordinatorResponses++;
                if (!silent) {
                  logger.log(
                    `Received coordinator cleanup response for client ${clientId} (${coordinatorResponses} total)`
                  );
                }
              }

              // Check if we've received all expected responses
              const workersToCheck = targetWorkers
                ? targetWorkers.length
                : this.workers.length;
              const coordinatorsToCheck = targetCoordinators
                ? targetCoordinators.length
                : this.coordinators.length;

              if (
                workerResponses >= workersToCheck &&
                coordinatorResponses >= coordinatorsToCheck
              ) {
                // We got all responses, clean up and resolve
                if (timeoutId) {
                  clearTimeout(timeoutId);
                }

                responsePort.close();
                resolve({
                  workerResponses,
                  coordinatorResponses,
                  timedOut: false,
                });
              }
            }
          };

          responsePort.start();

          // Set timeout for response waiting
          timeoutId = setTimeout(() => {
            if (!silent) {
              logger.warn(
                `Cleanup operation for client ${clientId} timed out after ${timeout}ms`
              );
            }

            responsePort.close();
            resolve({ workerResponses, coordinatorResponses, timedOut: true });
          }, timeout);
        })
      : Promise.resolve({
          workerResponses: 0,
          coordinatorResponses: 0,
          timedOut: false,
        });

    // Create cleanup options
    const cleanupOptions = {
      force,
      silent,
      delayRequestRemoval,
      requestRemovalDelay,
      closeChannels,
    };

    // Create a specialized cleanup message for coordinators
    const cleanupMessage: CoordinatorCleanupMessage = {
      type: CoordinatorMessageType.CLEANUP,
      clientId: clientId,
      requestId: cleanupRequestId,
      options: cleanupOptions,
      responseRequired: !skipResponseCheck,
    };

    // Determine which workers to send cleanup to
    const workersToClean = targetWorkers || this.workers;

    // Send cleanup to selected workers
    for (const worker of workersToClean) {
      try {
        if (skipResponseCheck) {
          // Simple fire-and-forget
          worker.postMessage(cleanupMessage);
        } else {
          // Create a new channel for each worker since we can't clone MessagePorts
          const workerChannel = new MessageChannel();

          // Connect the worker's response port to our listener
          workerChannel.port1.onmessage = (event) => {
            responsePort.postMessage(event.data);
          };
          workerChannel.port1.start();

          // Send the cleanup with worker's port
          worker.postMessage(cleanupMessage, [workerChannel.port2]);
        }

        if (!silent) {
          logger.log(`Sent cleanup message to worker for client ${clientId}`);
        }
      } catch (error) {
        logger.warn(`Error sending cleanup message to worker:`, error);
      }
    }

    // Determine which coordinators to clean
    const coordinatorIndices =
      targetCoordinators ||
      Array.from({ length: this.coordinators.length }, (_, i) => i);

    // Send cleanup to selected coordinators
    for (const index of coordinatorIndices) {
      if (index < 0 || index >= this.coordinators.length) continue;

      try {
        const coordinator = this.coordinators[index];

        if (skipResponseCheck) {
          // Simple fire-and-forget
          coordinator.postMessage(cleanupMessage);
        } else {
          // Create a new channel for each coordinator
          const coordinatorChannel = new MessageChannel();

          // Connect the coordinator's response port to our listener
          coordinatorChannel.port1.onmessage = (event) => {
            responsePort.postMessage(event.data);
          };
          coordinatorChannel.port1.start();

          // Send the cleanup with coordinator's port
          coordinator.postMessage(cleanupMessage, [coordinatorChannel.port2]);
        }

        if (!silent) {
          logger.log(
            `Sent cleanup message to coordinator ${index} for client ${clientId}`
          );
        }
      } catch (error) {
        logger.warn(
          `Error sending cleanup message to coordinator ${index}:`,
          error
        );
      }
    }

    // Clean up any orphaned results for this client
    const keysToDelete: string[] = [];
    for (const [key, value] of this.orphanedResults.entries()) {
      if (value.clientId === clientId) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.orphanedResults.delete(key));

    if (!silent && keysToDelete.length > 0) {
      logger.log(
        `Cleaned up ${keysToDelete.length} orphaned results for client ${clientId}`
      );
    }

    // Wait for responses if we're tracking them
    if (!skipResponseCheck) {
      const results = await responsePromise;
      return {
        success:
          !results.timedOut ||
          results.workerResponses > 0 ||
          results.coordinatorResponses > 0,
        ...results,
      } satisfies CleanupResponse;
    }

    return {
      success: true,
      workerResponses: 0,
      coordinatorResponses: 0,
      timedOut: false,
    } satisfies CleanupResponse;
  }

  /**
   * Track a client directly when initializing a PDF from the main thread
   * This method should be called when sending an InitPDF message to a worker
   * @param clientId The client ID to track
   */
  public trackClient(clientId: string): void {
    if (!clientId || typeof clientId !== "string") {
      logger.warn("Attempted to track a client with an invalid client ID");
      return;
    }

    this.activeClients.add(clientId);
    logger.log(
      `Tracking new client: ${clientId}, total: ${this.activeClients.size}`
    );
  }

  /**
   * Get a list of all active client IDs
   * @returns Array of active client IDs tracked by the worker pool
   */
  public getActiveClients(): string[] {
    return Array.from(this.activeClients);
  }

  /**
   * Monitor PDF processing status
   * Display processing status
   */
  public async getProcessingStatus(): Promise<{
    totalWorkers: number;
    availableWorkers: number;
    activeClients: string[];
    coordinatorStatus: Array<CoordinatorStatusMessage | null>;
  }> {
    // Get status from all coordinators
    const coordinatorStatusPromises = Array.from(
      { length: this.coordinatorCount },
      (_, index) => this.getCoordinatorStatus(index)
    );

    const coordinatorStatus = await Promise.all(coordinatorStatusPromises);

    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      activeClients: this.getActiveClients(),
      coordinatorStatus,
    };
  }

  /**
   * Clear all termination timeouts
   */
  private clearTerminationTimeouts(): void {
    this.terminationTimeouts.forEach((id) => {
      clearTimeout(id);
    });
    this.terminationTimeouts = [];
  }

  public terminateAll() {
    if (!isBrowserWithWorker()) return;

    // Set a flag to prevent new initializations during cleanup
    this.isInitialized = false;

    // Clear any existing termination timeouts first (from previous incomplete terminations)
    this.clearTerminationTimeouts();

    logger.log("Starting termination of all PDF workers and coordinators...");

    // Track which workers have sent cleanup responses
    const workerCleanupResponses = new Set<Worker>();
    const coordinatorCleanupResponses = new Set<number>();

    // First send cleanup messages to the processing workers
    for (const worker of this.workers) {
      try {
        // Remove client tracking event listener
        const handler = this.workerHandlers.get(worker);
        if (handler) {
          logger.log(`Removing message handler for worker`);
          worker.removeEventListener("message", handler);
          this.workerHandlers.delete(worker);
        }

        // Set up a one-time listener for cleanup completion
        const workerCleanupListener = (event: MessageEvent) => {
          const data = event.data;
          if (
            data.type === CoordinatorMessageType.CLEANUP &&
            data.isWorkerCleanupResponse
          ) {
            logger.log(`Worker cleanup response received, terminating worker`);
            workerCleanupResponses.add(worker);
            try {
              worker.removeEventListener("message", workerCleanupListener);
              worker.terminate();
            } catch (error) {
              logger.warn("Error terminating worker after cleanup", error);
            }
          }
        };

        // Add the listener
        worker.addEventListener("message", workerCleanupListener);

        // Send special cleanup message
        const workerCleanupMessage: CoordinatorCleanupMessage = {
          type: CoordinatorMessageType.CLEANUP,
          options: {
            closeChannels: true,
            force: true,
          },
          responseRequired: true,
          requestId: uuidv4(),
        };
        worker.postMessage(workerCleanupMessage);

        // Set a timeout to terminate the worker even if no response is received
        const timeoutId = setTimeout(() => {
          if (!workerCleanupResponses.has(worker)) {
            try {
              logger.warn(
                "No cleanup response from worker, forcing termination"
              );
              worker.removeEventListener("message", workerCleanupListener);
              worker.terminate();
            } catch (err) {
              logger.warn("Error terminating worker during timeout", err);
            }
          }
        }, 300);

        // Track the timeout for cleanup
        this.terminationTimeouts.push(timeoutId);
      } catch (error) {
        logger.warn("Error cleaning up worker", error);
      }
    }

    // Then send cleanup messages to all coordinators
    for (const [index, coordinator] of this.coordinators.entries()) {
      try {
        // Set up a one-time listener for coordinator cleanup completion
        const coordinatorCleanupListener = (event: MessageEvent) => {
          const data = event.data;
          if (data.type === CoordinatorMessageType.CLEANUP && data.success) {
            logger.log(`Coordinator ${index} cleanup response received`);
            coordinatorCleanupResponses.add(index);

            try {
              coordinator.removeEventListener(
                "message",
                coordinatorCleanupListener
              );
            } catch (error) {
              logger.warn(
                `Error closing coordinator ${index} after cleanup`,
                error
              );
            }
          }
        };

        // Add the listener
        coordinator.addEventListener("message", coordinatorCleanupListener);

        // Create a message channel for the response (optional, can be removed if coordinators respond via postMessage)
        const coordinatorCleanupMessage: CoordinatorCleanupMessage = {
          type: CoordinatorMessageType.CLEANUP,
          options: {
            force: true, // Force cleanup even if clients not found
            silent: false, // Log cleanup operations
            closeChannels: true, // Close all channel references
            delayRequestRemoval: false, // Immediate cleanup
          },
          responseRequired: true,
          requestId: uuidv4(),
        };
        coordinator.postMessage(coordinatorCleanupMessage);

        // Remove existing message event listeners
        const handler = this.coordinatorHandlers.get(coordinator);
        if (handler) {
          coordinator.removeEventListener("message", handler);
          this.coordinatorHandlers.delete(coordinator);
        }

        // Set a timeout to force close the coordinator if no response is received
        const timeoutId = setTimeout(() => {
          if (!coordinatorCleanupResponses.has(index)) {
            try {
              logger.warn(
                `No cleanup response from coordinator ${index}, forcing close`
              );
              coordinator.removeEventListener(
                "message",
                coordinatorCleanupListener
              );
            } catch (err) {
              logger.warn(
                `Error closing coordinator ${index} during timeout`,
                err
              );
            }
          }
        }, 500);

        // Track the timeout for cleanup
        this.terminationTimeouts.push(timeoutId);
      } catch (error) {
        logger.warn(`Error during coordinator ${index} cleanup`, error);
      }
    }

    // Similarly handle the shared library worker
    if (sharedLibraryWorker) {
      try {
        const libraryCleanupListener = (event: MessageEvent) => {
          const data = event.data;
          if (
            data.type === CoordinatorMessageType.CLEANUP &&
            data.isLibraryWorkerResponse
          ) {
            logger.log("Library worker cleanup completed, terminating worker");
            try {
              sharedLibraryWorker!.removeEventListener(
                "message",
                libraryCleanupListener
              );
              sharedLibraryWorker!.terminate();
              sharedLibraryWorker = null;
            } catch (error) {
              logger.warn("Error terminating shared library worker", error);
            }
          }
        };

        sharedLibraryWorker.addEventListener("message", libraryCleanupListener);

        sharedLibraryWorker.postMessage({
          type: CoordinatorMessageType.CLEANUP,
          requestId: uuidv4(),
          options: {
            closeChannels: true,
            force: true,
          },
          responseRequired: true,
        });

        const timeoutId = setTimeout(() => {
          if (sharedLibraryWorker) {
            logger.warn(
              "No cleanup response from library worker, forcing termination"
            );
            try {
              sharedLibraryWorker.removeEventListener(
                "message",
                libraryCleanupListener
              );
              sharedLibraryWorker.terminate();
              sharedLibraryWorker = null;
            } catch (error) {
              logger.warn(
                "Error terminating shared library worker during timeout",
                error
              );
            }
          }
        }, 1000);

        this.terminationTimeouts.push(timeoutId);
      } catch (error) {
        logger.warn("Error setting up library worker cleanup", error);
      }
    }

    // Final cleanup after all workers and coordinators have been given a chance to respond
    const finalCleanupId = setTimeout(() => {
      // Clear all internal structures
      this.activeClients.clear();
      this.workers = [];
      this.availableWorkers = [];
      this.coordinators = [];
      this.coordinatorChannels = [];
      this.workerCoordinatorChannels = [];
      this.taskQueue = [];
      this.orphanedResults.clear();

      if (this.coordinatorStatusInterval) {
        clearInterval(this.coordinatorStatusInterval);
        this.coordinatorStatusInterval = null;
      }

      logger.log("All termination processes completed");
    }, 1500);

    this.terminationTimeouts.push(finalCleanupId);
  }

  public static resetInstance(): void {
    if (PDFWorkerPool.instance) {
      PDFWorkerPool.instance.terminateAll();
      // @ts-expect-error - We're intentionally resetting the singleton instance
      PDFWorkerPool.instance = null;
    }
  }
}
