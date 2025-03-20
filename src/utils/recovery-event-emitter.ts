import {
  RecoveryEventType,
  RecoveryDataForType,
  WorkerMessageType,
} from "@/types/processor";
import logger from "@/utils/logger";

/**
 * Type-safe event subscription callback
 */
type RecoveryEventCallback<T extends WorkerMessageType> = (
  data: RecoveryDataForType<T>
) => void;

/**
 * Type-safe subscription record with cleanup function
 */
interface SubscriptionRecord<T extends WorkerMessageType> {
  callback: RecoveryEventCallback<T>;
  once: boolean;
}

/**
 * Recovery Event Emitter - Singleton for managing PDF worker recovery events
 *
 * This provides a type-safe way to communicate recovery events between
 * the worker pool and the rest of the application.
 */
class RecoveryEventEmitter {
  private static instance: RecoveryEventEmitter;
  private eventListeners: Map<
    RecoveryEventType,
    Array<SubscriptionRecord<WorkerMessageType>>
  >;
  private isDebugMode: boolean;

  private constructor() {
    this.eventListeners = new Map();
    this.isDebugMode = process.env.NODE_ENV !== "production";
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): RecoveryEventEmitter {
    if (!RecoveryEventEmitter.instance) {
      RecoveryEventEmitter.instance = new RecoveryEventEmitter();
    }
    return RecoveryEventEmitter.instance;
  }

  /**
   * Subscribe to a recovery event
   * @param eventType The type of recovery event
   * @param callback Callback function that receives the event data
   * @returns Unsubscribe function
   */
  public on<T extends WorkerMessageType>(
    eventType: RecoveryEventType,
    callback: RecoveryEventCallback<T>
  ): () => void {
    return this.subscribe(eventType, callback, false);
  }

  /**
   * Subscribe to a recovery event once (auto-removes after first trigger)
   * @param eventType The type of recovery event
   * @param callback Callback function that receives the event data
   * @returns Unsubscribe function
   */
  public once<T extends WorkerMessageType>(
    eventType: RecoveryEventType,
    callback: RecoveryEventCallback<T>
  ): () => void {
    return this.subscribe(eventType, callback, true);
  }

  /**
   * Internal subscription method
   */
  private subscribe<T extends WorkerMessageType>(
    eventType: RecoveryEventType,
    callback: RecoveryEventCallback<T>,
    once: boolean
  ): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }

    const listeners = this.eventListeners.get(eventType)!;
    const subscription: SubscriptionRecord<T> = { callback, once };
    listeners.push(subscription);

    if (this.isDebugMode) {
      logger.log(
        `[RecoveryEmitter] Added ${
          once ? "one-time " : ""
        }listener for ${eventType}, total: ${listeners.length}`
      );
    }

    // Return unsubscribe function
    return () => {
      const currentListeners = this.eventListeners.get(eventType);
      if (currentListeners) {
        const index = currentListeners.indexOf(subscription);
        if (index !== -1) {
          currentListeners.splice(index, 1);
          if (this.isDebugMode) {
            logger.log(
              `[RecoveryEmitter] Removed listener for ${eventType}, remaining: ${currentListeners.length}`
            );
          }
        }
      }
    };
  }

  /**
   * Emit a recovery event to all subscribers
   * @param eventType The type of recovery event
   * @param data The event data
   */
  public emit<T extends WorkerMessageType>(
    eventType: RecoveryEventType,
    data: RecoveryDataForType<T>
  ): void {
    const listeners = this.eventListeners.get(eventType);

    if (!listeners || listeners.length === 0) {
      if (this.isDebugMode) {
        logger.warn(
          `[RecoveryEmitter] No listeners for recovery event: ${eventType}`
        );
      }
      return;
    }

    // Copy the array to avoid issues if listeners are added/removed during iteration
    [...listeners].forEach((subscription) => {
      try {
        subscription.callback(data);

        // Remove if this was a one-time subscription
        if (subscription.once) {
          listeners.splice(listeners.indexOf(subscription), 1);
          if (this.isDebugMode) {
            logger.log(
              `[RecoveryEmitter] Removed one-time listener for ${eventType} after execution`
            );
          }
        }
      } catch (error) {
        logger.error(
          `[RecoveryEmitter] Error in event listener for ${eventType}:`,
          error
        );
      }
    });

    if (this.isDebugMode) {
      logger.log(
        `[RecoveryEmitter] Emitted ${eventType} to ${listeners.length} listeners`
      );
    }
  }

  /**
   * Remove all listeners for a specific event type
   * @param eventType The event type to clear listeners for
   */
  public removeAllListeners(eventType?: RecoveryEventType): void {
    if (eventType) {
      this.eventListeners.delete(eventType);
      if (this.isDebugMode) {
        logger.log(`[RecoveryEmitter] Removed all listeners for ${eventType}`);
      }
    } else {
      this.eventListeners.clear();
      if (this.isDebugMode) {
        logger.log("[RecoveryEmitter] Removed all listeners for all events");
      }
    }
  }

  /**
   * Get count of listeners for a specific event type
   * @param eventType The event type
   */
  public listenerCount(eventType: RecoveryEventType): number {
    const listeners = this.eventListeners.get(eventType);
    return listeners ? listeners.length : 0;
  }
}

// Export the singleton instance
export default RecoveryEventEmitter.getInstance();
