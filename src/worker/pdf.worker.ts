import {
  WorkerMessageType,
  LibraryWorkerMessageType,
  PageProcessingConfig,
  DisplayInfo,
  InitPDFMessage,
  ProcessPageMessage,
  ErrorMessage,
  WorkerMessage,
  CleanupOptions,
} from "@/types/processor";
import {
  CoordinatorMessageType,
  CleanupMessage as CoordinatorCleanupMessage,
} from "@/types/coordinator";
import { v4 as uuidv4 } from "uuid";
import logger from "@/utils/logger";
import { generateRandomId, isBrowserWithWorker } from "@/utils/app";

// Create a unique client ID for fallback purposes only
// This should only be used if no clientId is provided in the message
const WORKER_FALLBACK_ID = uuidv4();

// Default worker ID (will be overridden by pool's ID if provided)
const DEFAULT_WORKER_ID = "worker_" + generateRandomId();
let workerId = DEFAULT_WORKER_ID;

// Coordinator tracker variable
let assignedCoordinatorIndex = -1;
let coordinatorPort: MessagePort | null = null;

// Worker heartbeat to indicate processing activity
let heartbeatInterval: NodeJS.Timeout | null = null;

function startHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  heartbeatInterval = setInterval(() => {
    self.postMessage({
      type: WorkerMessageType.WorkerHeartbeat,
      timestamp: Date.now(),
      workerId,
    });
  }, 3000);
}

// Listen for coordinator assignment
self.addEventListener(
  "message",
  function coordinatorSetup(e) {
    if (e.data.type === CoordinatorMessageType.ASSIGN_COORDINATOR) {
      assignedCoordinatorIndex = e.data.coordinatorIndex;

      if (e.data.workerId) {
        workerId = e.data.workerId;
      }

      logger.log(
        `[${workerId}] Worker assigned to coordinator ${assignedCoordinatorIndex}`
      );

      if (e.ports && e.ports.length > 0) {
        coordinatorPort = e.ports[0];

        // Set up message handler for the coordinator port
        coordinatorPort.onmessage = handleCoordinatorMessage;

        coordinatorPort.start();

        logger.log(
          `[${workerId}] Direct communication with coordinator established`
        );
      } else {
        logger.error(
          `[${workerId}] No coordinator port provided in ASSIGN_COORDINATOR message`
        );
      }

      // One-time listener
      self.removeEventListener("message", coordinatorSetup);
    }
  },
  { once: true }
);

// Handle messages from the coordinator
function handleCoordinatorMessage(e: MessageEvent<WorkerMessage>): void {
  // Process the response from the coordinator/library
  const { type, clientId } = e.data;

  logger.log(
    `[${workerId}] Worker received response from coordinator: ${type}${
      clientId ? `, client: ${clientId}` : ""
    }`
  );

  // Forward the message to the main thread
  self.postMessage(e.data);
}

// Function to send messages to the coordinator
function sendToCoordinator(
  message: {
    type: WorkerMessageType | LibraryWorkerMessageType;
    clientId: string;
    requestId?: string;
    [key: string]: unknown;
  },
  transfer: Transferable[] = []
): boolean {
  if (!coordinatorPort) {
    logger.error(
      `[${workerId}] No coordinator port available, cannot send message`
    );
    return false;
  }

  try {
    // Ensure we're not overriding an existing client ID
    if (!message.clientId) {
      // Only use fallback ID if no client ID was provided
      message.clientId = WORKER_FALLBACK_ID;
    }

    coordinatorPort.postMessage(message, transfer);
    return true;
  } catch (error) {
    logger.error(`[${workerId}] Error sending message to coordinator:`, error);
    return false;
  }
}

// Main worker message handler
if (isBrowserWithWorker() && typeof self !== "undefined") {
  startHeartbeat();

  self.onmessage = async (e: MessageEvent) => {
    const data = e.data;
    const { type } = data;

    logger.log(
      `[${workerId}] Worker received message: ${type} (${Date.now()})`
    );

    try {
      if (type === CoordinatorMessageType.ASSIGN_COORDINATOR) {
        logger.log(
          `[${workerId}] Skipping ASSIGN_COORDINATOR in main handler as it's handled by coordinatorSetup`
        );
        return;
      }

      switch (type) {
        case WorkerMessageType.InitPDF: {
          const initMessage = data as InitPDFMessage;
          await initPDF(
            initMessage.pdfData,
            initMessage.clientId || WORKER_FALLBACK_ID
          );
          break;
        }

        case WorkerMessageType.ProcessPage: {
          const processMessage = data as ProcessPageMessage;
          await processPage(
            processMessage.pageNumber,
            processMessage.config,
            processMessage.displayInfo,
            processMessage.clientId
          );
          break;
        }

        case WorkerMessageType.Cleanup:
        case WorkerMessageType.AbortProcessing: {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }

          if (coordinatorPort) {
            // Choose the appropriate library worker message type based on the incoming message
            const libraryMsgType =
              type === WorkerMessageType.AbortProcessing
                ? LibraryWorkerMessageType.AbortProcessing
                : LibraryWorkerMessageType.CleanupDocument;

            sendToCoordinator({
              type: libraryMsgType,
              clientId: data.clientId || WORKER_FALLBACK_ID,
              requestId: uuidv4(),
            });
          }
          break;
        }

        // Special case for coordinator-initiated full cleanup
        case CoordinatorMessageType.CLEANUP: {
          const cleanupMessage = data as CoordinatorCleanupMessage;
          const cleanupOptions =
            cleanupMessage.options || ({} as CleanupOptions);
          const clientIdToClean = cleanupMessage.clientId;
          const responseRequired = cleanupMessage.responseRequired !== false; // Default to true
          const cleanupRequestId = cleanupMessage.requestId || "";
          const ports = e.ports;

          logger.log(
            `[${workerId}] Received cleanup request${
              clientIdToClean
                ? ` for client ${clientIdToClean}`
                : " for worker termination"
            }`
          );

          // Clear heartbeat immediately in all cases
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }

          const shouldCloseChannels = cleanupOptions.closeChannels !== false; // Default to true

          // Client-specific cleanup
          if (clientIdToClean) {
            logger.log(
              `[${workerId}] Performing client-specific cleanup for: ${clientIdToClean}`
            );

            // Send success response
            if (responseRequired) {
              const responseMessage = {
                type: CoordinatorMessageType.CLEANUP,
                clientId: clientIdToClean,
                requestId: cleanupRequestId,
                success: true,
                isWorkerCleanupResponse: true,
              };

              // If we have a port to respond to
              if (ports && ports.length > 0) {
                const responsePort = ports[0];
                responsePort.postMessage(responseMessage);
                logger.log(
                  `[${workerId}] Sent cleanup response via port for client ${clientIdToClean}`
                );
              } else {
                // Respond via main thread
                self.postMessage(responseMessage);
                logger.log(
                  `[${workerId}] Sent cleanup response via self.postMessage for client ${clientIdToClean}`
                );
              }
            }
          }
          // Full worker cleanup
          else {
            logger.log(`[${workerId}] Performing full worker cleanup`);

            // Close coordinator port if requested
            if (shouldCloseChannels && coordinatorPort) {
              try {
                logger.log(`[${workerId}] Closing coordinator port`);
                coordinatorPort.close();
                coordinatorPort = null;
                assignedCoordinatorIndex = -1;
              } catch (error) {
                logger.error(
                  `[${workerId}] Error closing coordinator port:`,
                  error
                );
              }
            }

            // Send the success response
            const responseMessage = {
              type: CoordinatorMessageType.CLEANUP,
              requestId: cleanupRequestId,
              success: true,
              isWorkerCleanupResponse: true,
            };

            // If we have a port to respond to
            if (ports && ports.length > 0) {
              const responsePort = ports[0];
              responsePort.postMessage(responseMessage);
              logger.log(
                `[${workerId}] Sent worker termination response via port`
              );
            } else {
              // Respond via main thread
              self.postMessage(responseMessage);
              logger.log(
                `[${workerId}] Sent worker termination response via self.postMessage`
              );
            }
          }

          logger.log(`[${workerId}] Worker cleanup process completed`);
          break;
        }

        default:
          logger.warn(`[${workerId}] Unknown message type: ${type}`);
      }
    } catch (error) {
      logger.error(`[${workerId}] Error processing message:`, error);
      const errorMessage: ErrorMessage = {
        type: WorkerMessageType.Error,
        clientId: data?.clientId || WORKER_FALLBACK_ID,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(errorMessage);
    }
  };
}

// Initialize a PDF document
async function initPDF(pdfData: ArrayBuffer, clientId: string) {
  logger.log(`[${workerId}] Initializing PDF document`);

  return sendToCoordinator(
    {
      type: LibraryWorkerMessageType.InitPDF,
      pdfData,
      requestId: uuidv4(),
      clientId,
    },
    [pdfData]
  );
}

// Process a page
async function processPage(
  pageNumber: number,
  config: PageProcessingConfig,
  displayInfo?: DisplayInfo,
  clientId: string = WORKER_FALLBACK_ID
) {
  return sendToCoordinator({
    type: LibraryWorkerMessageType.GetPage,
    pageNumber,
    requestId: uuidv4(),
    config,
    displayInfo,
    clientId,
  });
}
