export enum WorkerMessageType {
  InitPDF = "INIT_PDF",
  ProcessPage = "PROCESS_PAGE",
  PDFInitialized = "PDF_INITIALIZED",
  PageProcessed = "PAGE_PROCESSED",
  Error = "ERROR",
  Cleanup = "CLEANUP",
  AbortProcessing = "ABORT_PROCESSING",
}

export interface PageProcessingConfig {
  scale: number;
  maxDimension: number;
  quality: number;
}

export interface DisplayInfo {
  devicePixelRatio: number;
  containerWidth: number;
  containerHeight?: number;
}

export enum LibraryWorkerMessageType {
  InitPDF = "LIB_INIT_PDF",
  GetPage = "LIB_GET_PAGE",
  CleanupDocument = "LIB_CLEANUP_DOCUMENT",
  AbortProcessing = "LIB_ABORT_PROCESSING",
}

export interface BaseWorkerMessage {
  type: WorkerMessageType | LibraryWorkerMessageType;
  clientId?: string;
  requestId?: string;
}

export interface InitPDFMessage extends BaseWorkerMessage {
  type: WorkerMessageType.InitPDF;
  pdfData: ArrayBuffer;
}

export interface ProcessPageMessage extends BaseWorkerMessage {
  type: WorkerMessageType.ProcessPage;
  pageNumber: number;
  config: PageProcessingConfig;
  displayInfo?: DisplayInfo;
}

export interface PDFInitializedMessage extends BaseWorkerMessage {
  type: WorkerMessageType.PDFInitialized;
  totalPages: number;
}

export interface PageProcessedMessage extends BaseWorkerMessage {
  type: WorkerMessageType.PageProcessed;
  pageNumber: number;
  blobData: ArrayBuffer;
  dimensions: { width: number; height: number };
}

export interface ErrorMessage extends BaseWorkerMessage {
  type: WorkerMessageType.Error;
  error: string;
  pageNumber?: number;
}

export interface CleanupMessage extends BaseWorkerMessage {
  type: WorkerMessageType.Cleanup | LibraryWorkerMessageType.CleanupDocument;
  success?: boolean;
}

export interface AbortProcessingMessage extends BaseWorkerMessage {
  type:
    | WorkerMessageType.AbortProcessing
    | LibraryWorkerMessageType.AbortProcessing;
  success?: boolean;
}

export interface GetPageMessage extends BaseWorkerMessage {
  type: LibraryWorkerMessageType.GetPage;
  pageNumber: number;
  config?: PageProcessingConfig;
  displayInfo?: DisplayInfo;
}

export type WorkerMessage =
  | InitPDFMessage
  | ProcessPageMessage
  | PDFInitializedMessage
  | PageProcessedMessage
  | ErrorMessage
  | CleanupMessage
  | AbortProcessingMessage
  | GetPageMessage;

/**
 * Represents a message sent from a worker to the PDF library worker.
 * This type includes all possible message types that can be sent through
 * the coordinator to the PDF library worker.
 */
export interface WorkerToPDFLibraryMessage extends BaseWorkerMessage {
  type: LibraryWorkerMessageType;
  clientId: string;
  requestId: string;
  transfer?: Transferable[];
  pageNumber?: number;
  pdfData?: ArrayBuffer;
  config?: PageProcessingConfig;
  displayInfo?: DisplayInfo;
  viewport?: {
    width: number;
    height: number;
    scale: number;
    rotation: number;
    offsetX?: number;
    offsetY?: number;
  };
}

/**
 * Represents metadata added to messages when they are sent as fallbacks from a coordinator
 */
export interface CoordinatorFallbackMetadata {
  coordinatorFallback: boolean;
  coordinatorId: number;
}

/**
 * A message that has been forwarded as a fallback from a coordinator
 * when the original recipient couldn't be found
 */
export type CoordinatorFallbackMessage<
  T extends WorkerMessage = WorkerMessage
> = T & CoordinatorFallbackMetadata;

/**
 * Type guard to check if a message is a coordinator fallback message
 */
export function isCoordinatorFallbackMessage(
  message: unknown
): message is CoordinatorFallbackMessage {
  if (message === null || typeof message !== "object") {
    return false;
  }

  const msg = message as Record<string, unknown>;

  return (
    "coordinatorFallback" in msg &&
    msg.coordinatorFallback === true &&
    "coordinatorId" in msg &&
    typeof msg.coordinatorId === "number"
  );
}

export function isMessageType<T extends WorkerMessage>(
  message: unknown,
  type: WorkerMessageType | LibraryWorkerMessageType
): message is T {
  return (
    message !== null &&
    typeof message === "object" &&
    "type" in message &&
    (message as { type: string }).type === type
  );
}

/**
 * Represents an entry in the recovery queue for messages that couldn't be delivered
 */
export interface RecoveryQueueEntry {
  message: WorkerMessage;
  attempts: number;
  lastAttempt: number;
}

/**
 * Represents notification data sent to the main thread about recovery events
 */
// Base interface
export interface BaseRecoveryNotificationData {
  recoveryKey: string;
  timestamp: number;
  clientId?: string;
}

export interface PageProcessedRecoveryData
  extends BaseRecoveryNotificationData {
  type: WorkerMessageType.PageProcessed;
  pageNumber: number;
  dimensions?: { width: number; height: number };
}

export interface PDFInitializedRecoveryData
  extends BaseRecoveryNotificationData {
  type: WorkerMessageType.PDFInitialized;
  totalPages: number;
}

export interface ErrorRecoveryData extends BaseRecoveryNotificationData {
  type: WorkerMessageType.Error;
  error: string;
  pageNumber?: number;
}

export interface CleanupRecoveryData extends BaseRecoveryNotificationData {
  type: WorkerMessageType.Cleanup;
}

export interface AbortProcessingRecoveryData
  extends BaseRecoveryNotificationData {
  type: WorkerMessageType.AbortProcessing;
}

export type RecoveryNotificationData =
  | PageProcessedRecoveryData
  | PDFInitializedRecoveryData
  | ErrorRecoveryData
  | CleanupRecoveryData
  | AbortProcessingRecoveryData;

// Generic helper type for retrieving the correct recovery data type for a given message type
export type RecoveryDataForType<T extends WorkerMessageType> =
  T extends WorkerMessageType.PageProcessed
    ? PageProcessedRecoveryData
    : T extends WorkerMessageType.PDFInitialized
    ? PDFInitializedRecoveryData
    : T extends WorkerMessageType.Error
    ? ErrorRecoveryData
    : T extends WorkerMessageType.Cleanup
    ? CleanupRecoveryData
    : T extends WorkerMessageType.AbortProcessing
    ? AbortProcessingRecoveryData
    : never;

/**
 * Enum for recovery event types sent to the main thread
 */
export enum RecoveryEventType {
  PageProcessed = "pdf-recovery-page-processed",
  PDFInitialized = "pdf-recovery-initialized",
  Error = "pdf-worker-error",
  Cleanup = "pdf-client-cleaned",
  AbortProcessing = "pdf-processing-aborted",
  RecoveryAttempt = "pdf-recovery-attempt",
  RecoverySuccess = "pdf-recovery-success",
  RecoveryFailed = "pdf-recovery-failed",
}

/**
 * Event message sent from worker pool to main thread for recovery events
 */
export interface WorkerPoolRecoveryEvent<
  T extends WorkerMessageType = WorkerMessageType
> {
  type: "WORKER_POOL_RECOVERY_EVENT";
  eventName: RecoveryEventType | string;
  data: RecoveryDataForType<T>;
}

/**
 * Helper function to create a properly typed coordinator fallback message
 * @param message The original worker message
 * @param coordinatorId The ID of the coordinator forwarding the message
 * @returns A properly typed coordinator fallback message
 */
export function createCoordinatorFallbackMessage<T extends WorkerMessage>(
  message: T,
  coordinatorId: number
): CoordinatorFallbackMessage<T> {
  return {
    ...message,
    coordinatorFallback: true,
    coordinatorId,
  };
}
