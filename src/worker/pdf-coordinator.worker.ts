/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  LibraryWorkerMessageType,
  WorkerToPDFLibraryMessage,
  WorkerMessageType,
  createCoordinatorFallbackMessage,
} from "@/types/processor";
import {
  CoordinatorMessageType,
  InitCoordinatorMessage,
  CoordinatorStatusMessage,
  CoordinatorReadyMessage,
  CleanupClientMessage,
} from "@/types/coordinator";

// Import logger utility
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

// Map to store direct communication ports to workers
const workerPorts = new Map<string, MessagePort>();

// Initialization when the worker starts
self.onmessage = (e: MessageEvent) => {
  const data = e.data;
  const { type } = data;

  // Handle initial coordinator setup
  if (type === CoordinatorMessageType.INIT_COORDINATOR) {
    const initMessage = data as InitCoordinatorMessage;

    // Initialize as a coordinator with the library worker and ID
    coordinatorId = initMessage.coordinatorId;

    // Access the library worker port from the ports array
    if (e.ports && e.ports.length > 0) {
      libraryWorker = e.ports[0];

      // Set up message handler for the library worker
      libraryWorker.onmessage = handleLibraryMessage;
    } else {
      logger.error(
        `[Coordinator ${coordinatorId}] No port provided for library worker communication`
      );
    }

    // Acknowledge initialization with a properly typed message
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
function handleProcessingWorkerMessage(e: MessageEvent) {
  if (!libraryWorker) {
    logger.error(`[Coordinator ${coordinatorId}] Library worker not connected`);
    return;
  }

  const { data, ports } = e;
  const { type, requestId } = data;

  // Handle worker registration (direct communication)
  if (type === CoordinatorMessageType.REGISTER_WORKER) {
    if (ports && ports.length > 0) {
      const workerId = data.workerId;
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

        // Store port for the response if requestId exists
        if (requestId) {
          pendingRequests.set(requestId, workerPort);

          // Track which client this request belongs to
          if (workerClientId) {
            // Initialize a set for this client if it doesn't exist
            if (!clientRequests.has(workerClientId)) {
              clientRequests.set(workerClientId, new Set<string>());
            }
            // Add this request to the client's set
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

      // Start the port
      workerPort.start();

      // Store the port for future reference
      workerPorts.set(workerId, workerPort);
      return;
    }
    return; // Exit after handling worker registration
  }

  // Handle messages that don't require a port first
  if (type === CoordinatorMessageType.CLEANUP) {
    logger.log(
      `[Coordinator ${coordinatorId}] Received cleanup request, cleaning up resources`
    );

    // Clean up coordinator resources
    pendingRequests.clear();
    activeClients.clear();
    clientRequests.clear();

    // Close any open worker ports
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

    return;
  }

  // Handle client cleanup request
  if (type === CoordinatorMessageType.CLEANUP_CLIENT) {
    const clientIdToClean = data.clientId;

    logger.log(
      `[Coordinator ${coordinatorId}] Received cleanup request for client ${clientIdToClean}`
    );

    // Remove client from tracking
    if (clientIdToClean && activeClients.has(clientIdToClean)) {
      activeClients.delete(clientIdToClean);

      // Remove any pending requests for this client using our mapping
      if (clientRequests.has(clientIdToClean)) {
        const requests = clientRequests.get(clientIdToClean);
        logger.log(
          `[Coordinator ${coordinatorId}] Cleaning up ${
            requests?.size || 0
          } requests for client ${clientIdToClean}`
        );

        // Delete each associated request
        requests?.forEach((reqId) => {
          pendingRequests.delete(reqId);
        });

        // Remove the client's entry
        clientRequests.delete(clientIdToClean);
      }

      // If we have a port to respond to
      if (ports && ports.length > 0) {
        const responsePort = ports[0];
        const response: CleanupClientMessage = {
          type: CoordinatorMessageType.CLEANUP_CLIENT,
          clientId: clientIdToClean,
          requestId: requestId || "",
          success: true,
        };
        responsePort.postMessage(response);
      } else {
        // Respond via main thread
        const response: CleanupClientMessage = {
          type: CoordinatorMessageType.CLEANUP_CLIENT,
          clientId: clientIdToClean || "",
          requestId: requestId || "",
          success: true,
        };
        self.postMessage(response);
      }
    } else {
      // Client wasn't found or already cleaned up
      if (ports && ports.length > 0) {
        const responsePort = ports[0];
        const response: CleanupClientMessage = {
          type: CoordinatorMessageType.CLEANUP_CLIENT,
          clientId: clientIdToClean || "",
          requestId: requestId || "",
          success: false,
        };
        responsePort.postMessage(response);
      } else {
        self.postMessage({
          type: CoordinatorMessageType.CLEANUP_CLIENT,
          clientId: clientIdToClean || "",
          requestId: requestId || "",
          success: false,
        });
      }
    }

    return;
  }

  // For other message types, ensure a port is provided
  if (!ports || ports.length === 0) {
    logger.error(
      `[Coordinator ${coordinatorId}] No port provided for communication`
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
          // Initialize a set for this client if it doesn't exist
          if (!clientRequests.has(clientIdFromMessage)) {
            clientRequests.set(clientIdFromMessage, new Set<string>());
          }
          // Add this request to the client's set
          clientRequests.get(clientIdFromMessage)?.add(requestId);

          logger.log(
            `[Coordinator ${coordinatorId}] Associated direct request ${requestId} with client ${clientIdFromMessage}`
          );
        }
      } else {
        break;
      }

      // Forward all other requests to the library worker
      libraryWorker.postMessage(data, e.data.transfer || []);
      break;
  }
}

// Handle messages from the library worker
function handleLibraryMessage(e: MessageEvent) {
  const { requestId, clientId, type: responseType } = e.data;

  // Find which processing worker is waiting for this response
  if (requestId && pendingRequests.has(requestId)) {
    const processingPort = pendingRequests.get(requestId)!;

    // Forward the response
    try {
      processingPort.postMessage(
        e.data,
        e.data.transfer ? [e.data.transfer] : []
      );
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

      // Remove client from active tracking
      activeClients.delete(clientId);

      // Clean up all requests for this client
      if (clientRequests.has(clientId)) {
        const requests = clientRequests.get(clientId);
        logger.log(
          `[Coordinator ${coordinatorId}] Cleaning up ${
            requests?.size || 0
          } requests for client ${clientId} after library worker confirmation`
        );

        // Delete each associated request except the current one (we've already processed it)
        requests?.forEach((reqId) => {
          if (reqId !== requestId) {
            // Skip the current request, we'll clean it up below
            pendingRequests.delete(reqId);
          }
        });

        // Remove the client's entry from request tracking
        clientRequests.delete(clientId);
      }
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
      `[Coordinator ${coordinatorId}] Received message with no matching request ID: ${requestId}, type: ${e.data.type}`
    );

    // Keep track of successful deliveries
    let deliveredToAnyWorker = false;

    // First attempt: Broadcast to all connected worker ports
    if (workerPorts.size > 0) {
      logger.log(
        `[Coordinator ${coordinatorId}] Broadcasting to ${workerPorts.size} connected workers`
      );

      workerPorts.forEach((port, id) => {
        try {
          port.postMessage(e.data, e.data.transfer ? [e.data.transfer] : []);
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
        e.data,
        coordinatorId
      );
      self.postMessage(fallbackData);
    }
  }
}
