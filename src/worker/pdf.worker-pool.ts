import {
  WorkerMessageType,
  CleanupMessage,
  PDFInitializedMessage,
  WorkerMessage,
  PageProcessedMessage,
  ErrorMessage,
  AbortProcessingMessage,
  RecoveryEventType,
  RecoveryDataForType,
  CoordinatorFallbackMessage,
  isCoordinatorFallbackMessage,
} from "@/types/processor";
import {
  CoordinatorMessageType,
  RegisterCoordinatorMessage,
  AssignCoordinatorMessage,
  InitCoordinatorMessage,
  RegisterWorkerMessage,
  CoordinatorStatusMessage,
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

// Reference to the shared PDF.js library worker
let sharedLibraryWorker: Worker | null = null;

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
  private activeClients = new Set<string>();
  private workerHandlers = new Map<
    Worker,
    (e: MessageEvent<WorkerMessage>) => void
  >();

  // Recovery system properties
  private orphanedResults = new Map<string, WorkerMessage>();

  private terminationTimeouts: NodeJS.Timeout[] = [];

  private constructor(
    maxWorkers = MAX_WORKERS,
    coordinatorCount = COORDINATOR_COUNT
  ) {
    this.maxWorkers = maxWorkers;
    this.coordinatorCount = coordinatorCount;

    // Initialize the shared library worker if not already done
    if (isBrowserWithWorker() && !sharedLibraryWorker) {
      sharedLibraryWorker = new Worker(
        new URL("./pdf-library.worker.ts", import.meta.url)
      );
    }
  }

  /**
   * Initialize the worker pool instance
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized || !isBrowserWithWorker()) return;

    await this.initializeCoordinators();
  }

  private async initializeCoordinators() {
    if (!sharedLibraryWorker || !isBrowserWithWorker() || this.isInitialized)
      return;

    logger.log(`Initializing ${this.coordinatorCount} coordinator workers...`);

    // Create coordinator workers
    for (let i = 0; i < this.coordinatorCount; i++) {
      const coordinator = new Worker(
        new URL("./pdf-coordinator.worker.ts", import.meta.url)
      );

      // Set up event listener for fallback messages from coordinator
      coordinator.addEventListener(
        "message",
        this.handleCoordinatorFallbackMessage.bind(this)
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

      this.coordinators.push(coordinator);
      this.coordinatorChannels.push(channel);
    }

    // Wait for all coordinators to be ready
    await Promise.all(
      this.coordinators.map(
        (coordinator, index) =>
          new Promise<void>((resolve) => {
            const handler = (e: MessageEvent) => {
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
  }

  /**
   * Handle fallback messages from coordinators when they can't find a worker recipient
   * @param event The message event from the coordinator
   */
  private handleCoordinatorFallbackMessage(event: MessageEvent) {
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
          data as CoordinatorFallbackMessage<CleanupMessage>
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
    data: CoordinatorFallbackMessage<CleanupMessage>
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
    maxWorkers = MAX_WORKERS,
    coordinatorCount = COORDINATOR_COUNT
  ): Promise<PDFWorkerPool> {
    if (PDFWorkerPool.instance) {
      if (!PDFWorkerPool.instance.isInitialized) {
        await PDFWorkerPool.instance.initialize();
      }
      return PDFWorkerPool.instance;
    }

    const instance = new PDFWorkerPool(maxWorkers, coordinatorCount);
    PDFWorkerPool.instance = instance;
    await instance.initialize();
    return instance;
  }

  /**
   * Get the PDFWorkerPool singleton instance synchronously without waiting for initialization
   * WARNING: This should only be used when the caller can handle an uninitialized instance
   * or when it's known that the instance is already initialized
   */
  public static getInstanceSync(
    maxWorkers = MAX_WORKERS,
    coordinatorCount = COORDINATOR_COUNT
  ): PDFWorkerPool {
    if (!PDFWorkerPool.instance) {
      PDFWorkerPool.instance = new PDFWorkerPool(maxWorkers, coordinatorCount);

      if (isBrowserWithWorker()) {
        void PDFWorkerPool.instance.initialize();
      }
    }

    return PDFWorkerPool.instance;
  }

  public async getWorker(): Promise<Worker> {
    if (!isBrowserWithWorker()) {
      return Promise.reject(
        new Error("Workers are only available in browser environments")
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

      // Create a message channel for direct worker-coordinator communication
      const workerCoordinatorChannel = new MessageChannel();
      const workerId = uuidv4();

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
          const cleanupMessage = data as CleanupMessage;
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
      throw new Error("Workers are only available in browser environments");
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
      return Promise.reject(
        new Error("Workers are only available in browser environments")
      );
    }

    // Wait for coordinators to initialize if they haven't
    if (!this.isInitialized) {
      await this.initializeCoordinators();
    }

    // If no specific coordinator is requested, use the next coordinator in round-robin
    const targetIndex =
      coordinatorIndex !== undefined
        ? coordinatorIndex
        : this.nextCoordinatorIndex % this.coordinatorCount;

    const coordinator = this.coordinators[targetIndex];
    if (!coordinator) {
      logger.error(`No coordinator found at index ${targetIndex}`);
      return null;
    }

    return new Promise((resolve) => {
      const statusRequestId = uuidv4();

      // Create a message channel for the response
      const channel = new MessageChannel();

      // Set up the listener for the response
      channel.port1.onmessage = (event) => {
        const data = event.data;
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

      // Send the request with the port
      coordinator.postMessage(statusRequest, [channel.port2]);

      setTimeout(() => {
        channel.port1.close();
        logger.warn(`Status request to coordinator ${targetIndex} timed out`);
        resolve(null);
      }, 3000);
    });
  }

  /**
   * Clean up resources for a specific client
   * @param clientId The client ID to clean up
   * @returns Promise that resolves when cleanup is complete
   */
  public async cleanupClient(clientId: string): Promise<boolean> {
    if (!isBrowserWithWorker() || !clientId) {
      return false;
    }

    if (!this.activeClients.has(clientId)) {
      logger.log(
        `Client ${clientId} not found in active clients, skipping cleanup`
      );
      return true;
    }

    logger.log(`Cleaning up resources for client: ${clientId}`);
    this.activeClients.delete(clientId);

    // Create a cleanup message
    const cleanupMessage = {
      type: CoordinatorMessageType.CLEANUP_CLIENT,
      clientId: clientId,
      requestId: uuidv4(),
    };

    // Send cleanup messages to all coordinators directly
    for (const coordinator of this.coordinators) {
      try {
        coordinator.postMessage(cleanupMessage);
      } catch (error) {
        logger.warn(`Error sending cleanup message to coordinator:`, error);
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
    if (keysToDelete.length > 0) {
      logger.log(
        `Cleaned up ${keysToDelete.length} orphaned results for client ${clientId}`
      );
    }

    return true;
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

    // Clear any existing termination timeouts first
    this.clearTerminationTimeouts();

    // Set a flag to prevent new initializations during cleanup
    this.isInitialized = false;

    // Clear active clients tracking
    logger.log(`Cleaning up ${this.activeClients.size} active clients`);
    this.activeClients.clear();

    // First terminate the coordinator workers
    for (const coordinator of this.coordinators) {
      try {
        // Send a properly typed coordinator cleanup message
        const cleanupMessage = {
          type: CoordinatorMessageType.CLEANUP,
        };
        coordinator.postMessage(cleanupMessage);

        // Remove message event listeners to prevent memory leaks
        coordinator.removeEventListener(
          "message",
          this.handleCoordinatorFallbackMessage
        );

        // Add a small delay before termination to allow postMessage to complete
        const timeoutId = setTimeout(() => {
          try {
            coordinator.terminate();
          } catch (err) {
            logger.warn("Error terminating coordinator worker", err);
          }
        }, 200);

        // Track the timeout for cleanup
        this.terminationTimeouts.push(timeoutId);
      } catch (error) {
        logger.warn("Error cleaning up coordinator worker", error);
      }
    }

    // Then terminate the processing workers
    for (const worker of this.workers) {
      try {
        // Remove client tracking event listener
        const handler = this.workerHandlers.get(worker);
        if (handler) {
          logger.log(`Removing message handler for worker`);
          worker.removeEventListener("message", handler);
          this.workerHandlers.delete(worker);
        }

        const cleanupMessage: CleanupMessage = {
          type: WorkerMessageType.Cleanup,
        };
        worker.postMessage(cleanupMessage);

        // Terminate with delay to ensure cleanup message is processed
        const timeoutId = setTimeout(() => {
          try {
            worker.terminate();
          } catch (err) {
            logger.warn("Error terminating worker", err);
          }
        }, 200);

        // Track the timeout for cleanup
        this.terminationTimeouts.push(timeoutId);
      } catch (error) {
        logger.warn("Error cleaning up worker", error);
      }
    }

    // Properly close all message channels before clearing them
    logger.log("Closing all communication channels...");

    // Close coordinator channels
    this.coordinatorChannels.forEach((channel, index) => {
      try {
        // Close any ports that haven't been transferred
        if (channel.port1) {
          logger.log(`Closing coordinator channel ${index} port1`);
          channel.port1.close();
        }
        if (channel.port2) {
          logger.log(`Closing coordinator channel ${index} port2`);
          channel.port2.close();
        }
      } catch (error) {
        logger.warn(`Error closing coordinator channel ${index}:`, error);
      }
    });

    // Close worker-coordinator channels
    this.workerCoordinatorChannels.forEach((channel, index) => {
      try {
        // Close any ports that haven't been transferred
        if (channel.port1) {
          logger.log(`Closing worker-coordinator channel ${index} port1`);
          channel.port1.close();
        }
        if (channel.port2) {
          logger.log(`Closing worker-coordinator channel ${index} port2`);
          channel.port2.close();
        }
      } catch (error) {
        logger.warn(
          `Error closing worker-coordinator channel ${index}:`,
          error
        );
      }
    });

    // Clear internal structures
    this.workers = [];
    this.availableWorkers = [];
    this.coordinators = [];
    this.coordinatorChannels = [];
    this.workerCoordinatorChannels = [];
    this.taskQueue = [];

    // Clear orphaned results
    this.orphanedResults.clear();

    // Finally, terminate the shared library worker
    if (sharedLibraryWorker) {
      try {
        const timeoutId = setTimeout(() => {
          try {
            sharedLibraryWorker!.terminate();
            sharedLibraryWorker = null;
            logger.log("Shared library worker terminated successfully");
          } catch (error) {
            logger.warn("Error terminating shared library worker", error);
          }
        }, 200);

        // Track the timeout for cleanup
        this.terminationTimeouts.push(timeoutId);
      } catch (error) {
        logger.warn(
          "Error setting up shared library worker termination",
          error
        );
      }
    }
  }

  // Add a public method to ensure cleanup and reset the singleton instance
  public static resetInstance(): void {
    if (PDFWorkerPool.instance) {
      PDFWorkerPool.instance.terminateAll();
      // @ts-expect-error - We're intentionally resetting the singleton instance
      PDFWorkerPool.instance = null;
    }
  }
}
