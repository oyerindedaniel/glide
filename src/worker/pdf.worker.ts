/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  WorkerMessageType,
  LibraryWorkerMessageType,
  PageProcessingConfig,
  DisplayInfo,
  InitPDFMessage,
  ProcessPageMessage,
  ErrorMessage,
} from "@/types/processor";
import { v4 as uuidv4 } from "uuid";
import { CoordinatorMessageType } from "@/types/coordinator";
import logger from "@/utils/logger";
import { isBrowserWithWorker } from "@/utils/app";

// Create a unique client ID
const CLIENT_ID = uuidv4();

// Default worker ID (will be overridden by pool's ID if provided)
const DEFAULT_WORKER_ID =
  "worker_" + Math.random().toString(36).substring(2, 8);
let workerId = DEFAULT_WORKER_ID;

// Coordinator tracker variable
let assignedCoordinatorIndex = -1;
let coordinatorPort: MessagePort | null = null;

// Listen for coordinator assignment
self.addEventListener(
  "message",
  function coordinatorSetup(e) {
    if (e.data.type === CoordinatorMessageType.ASSIGN_COORDINATOR) {
      assignedCoordinatorIndex = e.data.coordinatorIndex;

      // Use the workerId passed from the pool if available
      if (e.data.workerId) {
        workerId = e.data.workerId;
      }

      logger.log(
        `[${workerId}] Worker assigned to coordinator ${assignedCoordinatorIndex}`
      );

      // Access port sent from worker pool
      if (e.ports && e.ports.length > 0) {
        coordinatorPort = e.ports[0];

        // Set up message handler for the coordinator port
        coordinatorPort.onmessage = handleCoordinatorMessage;

        // Start the port to receive messages
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
function handleCoordinatorMessage(e: MessageEvent) {
  // Process the response from the coordinator/library
  const { type, clientId } = e.data;

  logger.log(
    `[${workerId}] Worker received response from coordinator: ${type}${
      clientId ? `, client: ${clientId}` : ""
    }`
  );

  // Make sure the clientId is passed through
  const messageToMain = {
    ...e.data,
    clientId: clientId || CLIENT_ID,
  };

  // Forward the message to the main thread
  self.postMessage(messageToMain);
}

// Function to send messages to the coordinator
function sendToCoordinator(message: any, transfer: Transferable[] = []) {
  if (!coordinatorPort) {
    logger.error(
      `[${workerId}] No coordinator port available, cannot send message`
    );
    return false;
  }

  try {
    coordinatorPort.postMessage(message, transfer);
    return true;
  } catch (error) {
    logger.error(`[${workerId}] Error sending message to coordinator:`, error);
    return false;
  }
}

// Main worker message handler
if (isBrowserWithWorker() && typeof self !== "undefined") {
  self.onmessage = async (e: MessageEvent) => {
    const data = e.data;
    const { type } = data;

    logger.log(
      `[${workerId}] Worker received message: ${type} (${Date.now()})`
    );

    try {
      switch (type) {
        case WorkerMessageType.InitPDF: {
          // Message type: InitPDFMessage - Contains PDF data to be initialized
          const initMessage = data as InitPDFMessage;
          await initPDF(initMessage.pdfData);
          break;
        }

        case WorkerMessageType.ProcessPage: {
          // Message type: ProcessPageMessage - Contains page number, config and display info
          const processMessage = data as ProcessPageMessage;
          await processPage(
            processMessage.pageNumber,
            processMessage.config,
            processMessage.displayInfo
          );
          break;
        }

        case WorkerMessageType.Cleanup:
        case WorkerMessageType.AbortProcessing: {
          // Message type: CleanupMessage or AbortProcessingMessage
          if (coordinatorPort) {
            // Send the appropriate coordinator message type
            sendToCoordinator({
              // Map worker message types to coordinator message types
              type:
                type === WorkerMessageType.Cleanup
                  ? LibraryWorkerMessageType.CleanupDocument
                  : LibraryWorkerMessageType.AbortProcessing,
              clientId: CLIENT_ID,
              requestId: uuidv4(),
            });
          }
          break;
        }

        default:
          logger.warn(`[${workerId}] Unknown message type: ${type}`);
      }
    } catch (error) {
      logger.error(`[${workerId}] Error processing message:`, error);
      // Send error message back to main thread
      const errorMessage: ErrorMessage = {
        type: WorkerMessageType.Error,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(errorMessage);
    }
  };
}

// Initialize a PDF document
async function initPDF(pdfData: ArrayBuffer) {
  logger.log(`[${workerId}] Initializing PDF document`);

  return sendToCoordinator(
    {
      type: LibraryWorkerMessageType.InitPDF,
      pdfData,
      clientId: CLIENT_ID,
      requestId: uuidv4(),
    },
    [pdfData]
  );
}

// Process a page
async function processPage(
  pageNumber: number,
  config: PageProcessingConfig,
  displayInfo?: DisplayInfo
) {
  // Send a direct page rendering request to the library worker
  return sendToCoordinator({
    type: LibraryWorkerMessageType.GetPage,
    clientId: CLIENT_ID,
    pageNumber,
    requestId: uuidv4(),
    config,
    displayInfo,
  });
}
