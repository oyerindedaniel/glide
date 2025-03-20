import {
  LibraryWorkerMessageType,
  WorkerToPDFLibraryMessage,
  WorkerMessageType,
  createCoordinatorFallbackMessage,
  CleanupOptions,
} from "@/types/processor";
import {
  CoordinatorMessageType,
  InitCoordinatorMessage,
  CoordinatorStatusMessage,
  CoordinatorReadyMessage,
  CoordinatorMessage,
  RegisterWorkerMessage,
  CleanupMessage,
} from "@/types/coordinator";
import logger from "@/utils/logger";

// Initialize connection to the PDF.js library
// This worker acts as a coordinator between processing workers and the PDF library worker
let libraryWorker: MessagePort | null = null;
let coordinatorId = -1;

// Track pending requests to route responses back to correct processing workers
const pendingRequests = new Map<string, MessagePort>();

// Map to track which requests belong to which clients
const clientRequests = new Map<string, Set<string>>();

// Track active PDF documents by client ID
const activeClients = new Set<string>();

// Track clients that are in the process of being cleaned up
// This helps prevent unnecessary recovery events for in-flight responses
const cleaningUpClients = new Set<string>();

// Map to store direct communication ports to workers
const workerPorts = new Map<string, MessagePort>();

// Track timeouts for client cleanup
const clientCleanupTimeouts = new Map<string, NodeJS.Timeout>();

// Initialization when the worker starts
self.onmessage = (
  e: MessageEvent<CoordinatorMessage | WorkerToPDFLibraryMessage>
) => {
  const data = e.data;
  const { type } = data;

  // Handle initial coordinator setup
  if (type === CoordinatorMessageType.INIT_COORDINATOR) {
    const initMessage = data as InitCoordinatorMessage;

    // Initialize as a coordinator with the library worker and ID
    coordinatorId = initMessage.coordinatorId;

    if (e.ports && e.ports.length > 0) {
      libraryWorker = e.ports[0];

      // Set up message handler for the library worker
      libraryWorker.onmessage = handleLibraryMessage;
    } else {
      logger.error(
        `[Coordinator ${coordinatorId}] No port provided for library worker communication`
      );
    }

    // Acknowledge initialization
    const readyMessage: CoordinatorReadyMessage = {
      type: CoordinatorMessageType.COORDINATOR_READY,
      coordinatorId,
    };
    self.postMessage(readyMessage);

    // Replace the onmessage handler now that we're initialized
    self.onmessage = handleProcessingWorkerMessage;

    logger.log(`[Coordinator ${coordinatorId}] Initialized and ready`);
  } else if (type === CoordinatorMessageType.REGISTER_WORKER) {
    // For worker registration that might happen before initialization,
    // forward to the same handler we'll use after initialization
    handleProcessingWorkerMessage(e);
  }
};

// Handle messages from processing workers
function handleProcessingWorkerMessage(
  e: MessageEvent<CoordinatorMessage | WorkerToPDFLibraryMessage>
) {
  if (!libraryWorker) {
    logger.error(`[Coordinator ${coordinatorId}] Library worker not connected`);
    return;
  }

  const { data, ports } = e;
  const { type, requestId } = data;

  // Handle worker registration (direct communication)
  if (type === CoordinatorMessageType.REGISTER_WORKER) {
    if (ports && ports.length > 0) {
      const registerWorkerMessage = data as RegisterWorkerMessage;
      const workerId = registerWorkerMessage.workerId;
      const workerPort = ports[0];

      logger.log(
        `[Coordinator ${coordinatorId}] Registered direct communication with worker ${workerId}`
      );

      workerPort.onmessage = (
        workerEvent: MessageEvent<WorkerToPDFLibraryMessage>
      ) => {
        if (!libraryWorker) {
          logger.error(
            `[Coordinator ${coordinatorId}] Library worker not connected, cannot process worker request`
          );
          return;
        }

        const workerData = workerEvent.data;
        const {
          requestId,
          type: libraryType,
          clientId: workerClientId,
        } = workerData;

        if (requestId) {
          pendingRequests.set(requestId, workerPort);

          if (workerClientId) {
            if (!clientRequests.has(workerClientId)) {
              clientRequests.set(workerClientId, new Set<string>());
            }
            clientRequests.get(workerClientId)?.add(requestId);

            logger.log(
              `[Coordinator ${coordinatorId}] Associated request ${requestId} with client ${workerClientId}`
            );
          }
        }

        // Track active clients
        if (
          workerClientId &&
          libraryType === LibraryWorkerMessageType.InitPDF
        ) {
          logger.log(
            `[Coordinator ${coordinatorId}] Tracking new client: ${workerClientId}`
          );
          activeClients.add(workerClientId);
        }

        // Forward to library worker
        libraryWorker.postMessage(workerData, workerData.transfer || []);
      };

      workerPort.start();

      workerPorts.set(workerId, workerPort);
      return;
    }
    return; // Exit after handling worker registration
  }

  // Handle messages that don't require a port first
  if (type === CoordinatorMessageType.CLEANUP) {
    const cleanupMessage = data as CleanupMessage;
    const clientIdToClean = cleanupMessage.clientId;
    const cleanupOptions = cleanupMessage.options || {};
    const responseRequired = cleanupMessage.responseRequired || false;
    const cleanupRequestId = cleanupMessage.requestId || "";

    // If clientId is provided, do client-specific cleanup
    if (clientIdToClean) {
      logger.log(
        `[Coordinator ${coordinatorId}] Received cleanup request for client ${clientIdToClean}`
      );

      const cleanupSuccess = cleanupClientResources(clientIdToClean, {
        silent: cleanupOptions.silent || false,
        force: cleanupOptions.force || false,
        delayRequestRemoval: cleanupOptions.delayRequestRemoval || false,
        requestRemovalDelay: cleanupOptions.requestRemovalDelay || 5000,
      });

      // Send response
      if (responseRequired) {
        // If we have a port to respond to
        if (ports && ports.length > 0) {
          const responsePort = ports[0];
          const response: CleanupMessage = {
            type: CoordinatorMessageType.CLEANUP,
            clientId: clientIdToClean,
            requestId: cleanupRequestId,
            success: cleanupSuccess,
          };
          responsePort.postMessage(response);
        } else {
          // Respond via main thread
          const response: CleanupMessage = {
            type: CoordinatorMessageType.CLEANUP,
            clientId: clientIdToClean,
            requestId: cleanupRequestId,
            success: cleanupSuccess,
          };
          self.postMessage(response);
        }
      }
    } else {
      // Full coordinator cleanup
      logger.log(
        `[Coordinator ${coordinatorId}] Received full cleanup request, cleaning up resources`
      );

      // Clean up all clients first
      const allClients = [...activeClients, ...cleaningUpClients];

      // Clean up each client's resources
      allClients.forEach((clientId) => {
        cleanupClientResources(clientId, {
          silent: true, // No need to log each client cleanup during full coordinator cleanup
          force: true, // Force cleanup even if not found in active list
          delayRequestRemoval: false, // Immediate cleanup
        });
      });

      pendingRequests.clear();
      activeClients.clear();
      clientRequests.clear();
      cleaningUpClients.clear();
      clientCleanupTimeouts.clear();

      // Close worker ports if requested
      if (cleanupOptions.closeChannels !== false) {
        workerPorts.forEach((port, id) => {
          try {
            logger.log(
              `[Coordinator ${coordinatorId}] Closing port for worker ${id}`
            );
            port.close();
          } catch (err) {
            logger.warn(
              `[Coordinator ${coordinatorId}] Error closing port for worker ${id}:`,
              err
            );
          }
        });
        workerPorts.clear();
      }

      // Send success response
      if (responseRequired && ports && ports.length > 0) {
        const responsePort = ports[0];
        const response: CleanupMessage = {
          type: CoordinatorMessageType.CLEANUP,
          requestId: cleanupRequestId,
          success: true,
        };
        responsePort.postMessage(response);
      } else {
        // Respond via main thread
        const response: CleanupMessage = {
          type: CoordinatorMessageType.CLEANUP,
          requestId: cleanupRequestId,
          success: true,
        };
        self.postMessage(response);
      }
    }

    return;
  }

  // For other message types, ensure a port is provided
  if (!ports || ports.length === 0) {
    logger.error(
      `[Coordinator ${coordinatorId}] No port provided for communication ${type}`
    );
    return;
  }

  const processingPort = ports[0];

  switch (type) {
    case CoordinatorMessageType.COORDINATOR_STATUS: {
      const statusMessage: CoordinatorStatusMessage = {
        type: CoordinatorMessageType.COORDINATOR_STATUS,
        coordinatorId,
        activeRequests: pendingRequests.size,
        activeClients: Array.from(activeClients),
      };
      processingPort.postMessage(statusMessage);
      break;
    }

    default:
      if (requestId) {
        pendingRequests.set(requestId, processingPort);

        // If we have a client ID, track this request-client relationship
        const clientIdFromMessage = data.clientId;
        if (clientIdFromMessage) {
          if (!clientRequests.has(clientIdFromMessage)) {
            clientRequests.set(clientIdFromMessage, new Set<string>());
          }
          clientRequests.get(clientIdFromMessage)?.add(requestId);

          logger.log(
            `[Coordinator ${coordinatorId}] Associated direct request ${requestId} with client ${clientIdFromMessage}`
          );
        }
      } else {
        break;
      }

      // Forward all other requests to the library worker
      if ("transfer" in data) {
        libraryWorker.postMessage(data, data.transfer || []);
      } else {
        libraryWorker.postMessage(data);
      }
      break;
  }
}

// Handle messages from the library worker
function handleLibraryMessage(e: MessageEvent) {
  const data = e.data;
  const { requestId, clientId, type: responseType } = data;

  // Find which processing worker is waiting for this response
  if (requestId && pendingRequests.has(requestId)) {
    const processingPort = pendingRequests.get(requestId)!;

    // Forward the response
    try {
      processingPort.postMessage(data, data.transfer ? [data.transfer] : []);
    } catch (error) {
      logger.error(
        `[Coordinator ${coordinatorId}] Error sending response to worker:`,
        error
      );
    }

    // Handle client cleanup for cleanup/abort responses
    if (
      clientId &&
      (responseType === WorkerMessageType.Cleanup ||
        responseType === WorkerMessageType.AbortProcessing)
    ) {
      logger.log(
        `[Coordinator ${coordinatorId}] Library worker completed cleanup for client: ${clientId}`
      );

      // Use cleanup function with immediate request removal
      // We don't need to delay since we're already processing the final response
      cleanupClientResources(clientId, {
        silent: false, // Log the cleanup
        force: false, // Only clean up if it exists
        delayRequestRemoval: false, // Remove requests immediately
        excludeRequestId: requestId, // Skip the current request since we'll handle it separately below
      });
    }

    // Clean up the pending request
    pendingRequests.delete(requestId);

    // Remove request from client tracking if client ID is available
    if (clientId) {
      const clientRequestSet = clientRequests.get(clientId);
      if (clientRequestSet) {
        clientRequestSet.delete(requestId);
        // If this was the last request for this client, remove the client entry
        if (clientRequestSet.size === 0) {
          clientRequests.delete(clientId);
          logger.log(
            `[Coordinator ${coordinatorId}] Client ${clientId} has no more pending requests`
          );
        }
      }
    }
  } else {
    // If we can't find the requester for this specific request ID, implement tiered fallback:
    // 1. Broadcast to all directly connected workers
    // 2. If no direct workers, send to main thread as fallback
    logger.warn(
      `[Coordinator ${coordinatorId}] Received message with no matching request ID: ${requestId}, type: ${responseType}`
    );

    // Check if this is for a client being cleaned up - if so, we can skip recovery
    if (clientId && cleaningUpClients.has(clientId)) {
      logger.log(
        `[Coordinator ${coordinatorId}] Message for client ${clientId} that's being cleaned up, skipping recovery`
      );
      return;
    }

    // Keep track of successful deliveries
    let deliveredToAnyWorker = false;

    // First attempt: Broadcast to all connected worker ports
    if (workerPorts.size > 0) {
      logger.log(
        `[Coordinator ${coordinatorId}] Broadcasting to ${workerPorts.size} connected workers`
      );

      workerPorts.forEach((port, id) => {
        try {
          // Since WorkerMessage doesn't always have transfer, check if it exists as a property
          // and use type assertion to access it safely
          const messageData = data;
          const mayHaveTransfer = messageData as { transfer?: Transferable };

          if (mayHaveTransfer.transfer) {
            port.postMessage(messageData, [mayHaveTransfer.transfer]);
          } else {
            port.postMessage(messageData);
          }

          deliveredToAnyWorker = true;
          logger.log(
            `[Coordinator ${coordinatorId}] Broadcast to worker ${id} successful`
          );
        } catch (err) {
          logger.error(
            `[Coordinator ${coordinatorId}] Error broadcasting to worker ${id}:`,
            err
          );
        }
      });
    }

    // Second fallback: If no direct workers or delivery failed, send to main thread
    if (!deliveredToAnyWorker) {
      logger.log(
        `[Coordinator ${coordinatorId}] No direct workers available, sending to main thread as fallback`
      );
      const fallbackData = createCoordinatorFallbackMessage(
        data,
        coordinatorId
      );
      self.postMessage(fallbackData);
    }
  }
}

/**
 * Performs a complete cleanup of resources associated with a client
 * This is a composable function that can be called from different scenarios
 * @param clientId The client ID to clean up
 * @param options Additional cleanup options
 * @returns true if cleanup was performed, false if client wasn't found
 */
function cleanupClientResources(
  clientId: string,
  options: CleanupOptions & {
    /** Clear any pending cleanup timeout for this client */
    clearTimeout?: boolean;
    /** Specific request ID to exclude from cleanup (e.g., current request being processed) */
    excludeRequestId?: string;
    /** Whether this is a worker termination request */
    isWorkerTermination?: boolean;
  } = {}
): boolean {
  // Default options
  const {
    silent = false,
    force = false,
    clearTimeout: shouldClearTimeout = true,
    delayRequestRemoval = false,
    requestRemovalDelay = 5000,
    excludeRequestId,
    isWorkerTermination = false,
  } = options;

  // Check if client exists in our tracking
  if (
    !force &&
    !activeClients.has(clientId) &&
    !cleaningUpClients.has(clientId)
  ) {
    if (!silent) {
      logger.log(
        `[Coordinator ${coordinatorId}] Client ${clientId} not found for cleanup`
      );
    }
    return false;
  }

  // Clear any pending cleanup timeout
  if (shouldClearTimeout && clientCleanupTimeouts.has(clientId)) {
    const timeoutId = clientCleanupTimeouts.get(clientId)!;
    clearTimeout(timeoutId);
    clientCleanupTimeouts.delete(clientId);

    if (!silent) {
      logger.log(
        `[Coordinator ${coordinatorId}] Cleared pending cleanup timeout for client ${clientId}`
      );
    }
  }

  // Remove from active clients
  activeClients.delete(clientId);

  // Special handling for worker termination requests
  if (isWorkerTermination && !silent) {
    logger.log(
      `[Coordinator ${coordinatorId}] Processing worker termination request`
    );
  }

  // Handle requests cleanup based on delay option
  if (clientRequests.has(clientId)) {
    const requests = clientRequests.get(clientId)!;
    const requestCount = requests.size;

    if (!silent) {
      logger.log(
        `[Coordinator ${coordinatorId}] Cleaning up ${requestCount} requests for client ${clientId}`
      );
    }

    if (delayRequestRemoval) {
      // Mark client as being cleaned up
      cleaningUpClients.add(clientId);

      if (!silent) {
        logger.log(
          `[Coordinator ${coordinatorId}] Delayed cleanup for ${requestCount} requests from client ${clientId}`
        );
      }

      // Set timeout to remove requests later
      const timeoutId = setTimeout(() => {
        if (cleaningUpClients.has(clientId)) {
          // Now remove the pending requests
          if (clientRequests.has(clientId)) {
            const pendingRequests = clientRequests.get(clientId)!;

            // Remove each request from the pendingRequests map
            pendingRequests.forEach((reqId) => {
              // Skip the excluded request ID if specified
              if (excludeRequestId && reqId === excludeRequestId) {
                return;
              }
              pendingRequests.delete(reqId);
            });

            // Only remove the client's entry if there are no more requests
            if (pendingRequests.size === 0) {
              clientRequests.delete(clientId);
            }

            logger.log(
              `[Coordinator ${coordinatorId}] Completed delayed cleanup for client ${clientId}`
            );
          }

          // Remove from cleaning up set
          cleaningUpClients.delete(clientId);

          // Remove from timeout tracking
          clientCleanupTimeouts.delete(clientId);
        }
      }, requestRemovalDelay);

      // Track the timeout for potential cancellation
      clientCleanupTimeouts.set(clientId, timeoutId);
    } else {
      // Immediately remove all requests
      requests.forEach((reqId) => {
        // Skip the excluded request ID if specified
        if (excludeRequestId && reqId === excludeRequestId) {
          return;
        }
        pendingRequests.delete(reqId);
      });

      // Only remove the client's entry if there are no more requests or only the excluded request is left
      if (
        requests.size === 0 ||
        (excludeRequestId &&
          requests.size === 1 &&
          requests.has(excludeRequestId))
      ) {
        clientRequests.delete(clientId);
      }

      // Remove from cleaning up list if it was there
      cleaningUpClients.delete(clientId);
    }
  } else {
    // No requests to clean up, remove from cleaning up list if it was there
    cleaningUpClients.delete(clientId);

    if (!silent) {
      logger.log(
        `[Coordinator ${coordinatorId}] No pending requests found for client ${clientId}`
      );
    }
  }

  // Notify that this resource is cleaned up and the worker could be reused
  if (!silent) {
    logger.log(
      `[Coordinator ${coordinatorId}] Client ${clientId} resources cleaned up, worker ready for reuse`
    );
  }

  return true;
}
