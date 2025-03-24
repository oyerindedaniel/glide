import mitt, { Emitter } from "mitt";
import { FILE_PROCESSING_EVENTS } from "@/constants/processing";
import { ProcessingStatus } from "@/store/processed-files";

export type FileAddPayload = {
  fileName: string;
  totalPages: number;
  metadata: { size: number; type: string };
};

export type FileStatusPayload = {
  fileName: string;
  status: ProcessingStatus;
};

export type PageProcessedPayload = {
  fileName: string;
  pageNumber: number;
  url: string | null;
  status: ProcessingStatus;
  errorReason?: string;
};

export type ProcessingProgressPayload = {
  progress: number;
  total: number;
};

export type ProcessingCompletePayload = {
  success: boolean;
  error?: Error;
};

type FileProcessingEvents = {
  [FILE_PROCESSING_EVENTS.FILE_ADD]: FileAddPayload;
  [FILE_PROCESSING_EVENTS.FILE_STATUS]: FileStatusPayload;
  [FILE_PROCESSING_EVENTS.PAGE_PROCESSED]: PageProcessedPayload;
  [FILE_PROCESSING_EVENTS.PROCESSING_PROGRESS]: ProcessingProgressPayload;
  [FILE_PROCESSING_EVENTS.PROCESSING_COMPLETE]: ProcessingCompletePayload;
};

class FileProcessingEmitter {
  private static instance: FileProcessingEmitter;
  private emitter: Emitter<FileProcessingEvents>;

  private constructor() {
    this.emitter = mitt<FileProcessingEvents>();
  }

  public static getInstance(): FileProcessingEmitter {
    if (!FileProcessingEmitter.instance) {
      FileProcessingEmitter.instance = new FileProcessingEmitter();
    }
    return FileProcessingEmitter.instance;
  }

  /**
   * Subscribe to an event
   */
  public on<K extends keyof FileProcessingEvents>(
    event: K,
    handler: (data: FileProcessingEvents[K]) => void
  ): void {
    this.emitter.on(event, handler);
  }

  /**
   * Unsubscribe from an event
   */
  public off<K extends keyof FileProcessingEvents>(
    event: K,
    handler: (data: FileProcessingEvents[K]) => void
  ): void {
    this.emitter.off(event, handler);
  }

  /**
   * Emit an event with typed data
   */
  public emit<K extends keyof FileProcessingEvents>(
    event: K,
    data: FileProcessingEvents[K]
  ): void {
    this.emitter.emit(event, data);
  }
}

export const fileProcessingEmitter = FileProcessingEmitter.getInstance();
