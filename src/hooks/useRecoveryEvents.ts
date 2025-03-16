import { useEffect, useState, useCallback, DependencyList } from "react";
import recoveryEmitter from "@/utils/recovery-event-emitter";
import {
  RecoveryEventType,
  RecoveryDataForType,
  WorkerMessageType,
} from "@/types/processor";

/**
 * Custom hook for subscribing to recovery events
 *
 * @param eventType The recovery event type to subscribe to
 * @param callback Optional callback function that receives the event data
 * @param deps Optional array of dependencies for the callback
 * @returns Tuple with [lastEventData, eventCount]
 */
export function useRecoveryEvent<T extends WorkerMessageType>(
  eventType: RecoveryEventType,
  callback?: (data: RecoveryDataForType<T>) => void,
  deps: DependencyList = []
): [RecoveryDataForType<T> | null, number] {
  const [lastEventData, setLastEventData] =
    useState<RecoveryDataForType<T> | null>(null);
  const [eventCount, setEventCount] = useState(0);

  // Create a stable callback reference
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableCallback = useCallback(callback || (() => {}), deps);

  useEffect(() => {
    const handleEvent = (data: RecoveryDataForType<T>) => {
      setLastEventData(data);
      setEventCount((prev) => prev + 1);
      stableCallback(data);
    };

    // Subscribe to the event
    const unsubscribe = recoveryEmitter.on<T>(eventType, handleEvent);

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, [eventType, stableCallback]);

  return [lastEventData, eventCount];
}

/**
 * Hook for recovering orphaned page results
 * @returns Tuple with [lastPageData, pageRecoveryCount]
 */
export function usePageRecovery(
  onPageRecovered?: (
    data: RecoveryDataForType<WorkerMessageType.PageProcessed>
  ) => void,
  deps: DependencyList = []
): [RecoveryDataForType<WorkerMessageType.PageProcessed> | null, number] {
  return useRecoveryEvent<WorkerMessageType.PageProcessed>(
    RecoveryEventType.PageProcessed,
    onPageRecovered,
    deps
  );
}

/**
 * Hook for recovering orphaned PDF initialization events
 * @returns Tuple with [lastInitData, initRecoveryCount]
 */
export function usePDFInitRecovery(
  onInitRecovered?: (
    data: RecoveryDataForType<WorkerMessageType.PDFInitialized>
  ) => void,
  deps: DependencyList = []
): [RecoveryDataForType<WorkerMessageType.PDFInitialized> | null, number] {
  return useRecoveryEvent<WorkerMessageType.PDFInitialized>(
    RecoveryEventType.PDFInitialized,
    onInitRecovered,
    deps
  );
}

/**
 * Hook for monitoring general PDF recovery stats
 * @returns Object with counts for different recovery event types
 */
export function useRecoveryStats(): {
  pageRecoveries: number;
  initRecoveries: number;
  errorRecoveries: number;
  cleanupRecoveries: number;
  abortRecoveries: number;
} {
  const [pageRecoveries, setPageRecoveries] = useState(0);
  const [initRecoveries, setInitRecoveries] = useState(0);
  const [errorRecoveries, setErrorRecoveries] = useState(0);
  const [cleanupRecoveries, setCleanupRecoveries] = useState(0);
  const [abortRecoveries, setAbortRecoveries] = useState(0);

  useEffect(() => {
    // Track page processed recoveries
    const pageUnsubscribe = recoveryEmitter.on(
      RecoveryEventType.PageProcessed,
      () => setPageRecoveries((prev) => prev + 1)
    );

    // Track PDF init recoveries
    const initUnsubscribe = recoveryEmitter.on(
      RecoveryEventType.PDFInitialized,
      () => setInitRecoveries((prev) => prev + 1)
    );

    // Track error recoveries
    const errorUnsubscribe = recoveryEmitter.on(RecoveryEventType.Error, () =>
      setErrorRecoveries((prev) => prev + 1)
    );

    // Track cleanup recoveries
    const cleanupUnsubscribe = recoveryEmitter.on(
      RecoveryEventType.Cleanup,
      () => setCleanupRecoveries((prev) => prev + 1)
    );

    // Track abort recoveries
    const abortUnsubscribe = recoveryEmitter.on(
      RecoveryEventType.AbortProcessing,
      () => setAbortRecoveries((prev) => prev + 1)
    );

    // Cleanup all subscriptions
    return () => {
      pageUnsubscribe();
      initUnsubscribe();
      errorUnsubscribe();
      cleanupUnsubscribe();
      abortUnsubscribe();
    };
  }, []);

  return {
    pageRecoveries,
    initRecoveries,
    errorRecoveries,
    cleanupRecoveries,
    abortRecoveries,
  };
}
