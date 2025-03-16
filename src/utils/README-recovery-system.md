# PDF Processing Recovery System

This document explains the recovery event system implemented in the PDF processing workflow.

## Overview

The PDF processing system works with Web Workers in a multi-tier structure:

1. Main thread → Worker Pool → Workers (direct messaging)
2. Worker → Coordinator (via MessagePort)
3. Coordinator → Library Worker (via MessagePort)

When a worker is terminated or a message delivery fails, the coordinator attempts to broadcast the message to all connected workers. If all attempts fail, the coordinator sends a fallback message to the worker pool, which then propagates this to the main application through the recovery event system.

## Architecture

The recovery system consists of:

1. **RecoveryEventEmitter**: A singleton that provides a type-safe event emitter for recovery events
2. **React Hooks**: Custom hooks for easy consumption of recovery events in React components
3. **Integration with PDFProcessor**: Handling of recovery events in the PDF processing system

## Types of Recovery Events

- `PageProcessed`: When a processed page result cannot be delivered to the original requester
- `PDFInitialized`: When PDF initialization results are orphaned
- `Error`: When error messages cannot be delivered
- `Cleanup`: When cleanup confirmation cannot be delivered
- `AbortProcessing`: When abort processing confirmation cannot be delivered

## Usage Examples

### 1. Basic Event Subscription

```typescript
import recoveryEmitter from "@/utils/recovery-event-emitter";
import { RecoveryEventType, WorkerMessageType } from "@/types/processor";

// Subscribe to page processed events
const unsubscribe = recoveryEmitter.on<WorkerMessageType.PageProcessed>(
  RecoveryEventType.PageProcessed,
  (data) => {
    console.log(
      `Recovered page ${data.pageNumber} for client ${data.clientId}`
    );
    // Process the recovered page...
  }
);

// Later, clean up the subscription
unsubscribe();
```

### 2. Using React Hooks

```tsx
import { usePageRecovery, usePDFInitRecovery } from "@/hooks/useRecoveryEvents";

function PDFViewer() {
  // Handle page recovery events
  usePageRecovery(
    (data) => {
      if (data.clientId === currentClientId) {
        // Try to recover the orphaned page result
        const result = PDFWorkerPool.getInstance().getOrphanedResult(
          data.recoveryKey
        );
        if (result) {
          // Process the recovered result...
        }
      }
    },
    [currentClientId]
  );

  // Rest of component...
}
```

### 3. Recovery Stats Monitoring

```tsx
import { useRecoveryStats } from "@/hooks/useRecoveryEvents";

function RecoveryStats() {
  const stats = useRecoveryStats();

  return (
    <div>
      <h3>Recovery System Stats</h3>
      <ul>
        <li>Pages Recovered: {stats.pageRecoveries}</li>
        <li>PDF Inits Recovered: {stats.initRecoveries}</li>
        <li>Errors Recovered: {stats.errorRecoveries}</li>
        <li>Cleanup Events: {stats.cleanupRecoveries}</li>
        <li>Abort Events: {stats.abortRecoveries}</li>
      </ul>
    </div>
  );
}
```

## Implementation Details

### Type-Safe Coordinator Fallback Messages

The system uses a type-safe approach for handling fallback messages from coordinators:

```typescript
// Define the coordinator fallback metadata
export interface CoordinatorFallbackMetadata {
  coordinatorFallback: boolean;
  coordinatorId: number;
}

// Create a generic type for coordinator fallback messages
export type CoordinatorFallbackMessage<
  T extends WorkerMessage = WorkerMessage
> = T & CoordinatorFallbackMetadata;

// Helper to create fallback messages
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

// Type guard to check for fallback messages
export function isCoordinatorFallbackMessage(
  message: unknown
): message is CoordinatorFallbackMessage {
  // Implementation checks for coordinatorFallback and coordinatorId
}
```

This type system ensures that all coordinator fallbacks are properly typed throughout the codebase.

### Recovery Event Emitter

The `RecoveryEventEmitter` is a type-safe event emitter implemented as a singleton:

```typescript
// Get the singleton instance
const recoveryEmitter = RecoveryEventEmitter.getInstance();

// Subscribe to events
const unsubscribe = recoveryEmitter.on<WorkerMessageType.PageProcessed>(
  RecoveryEventType.PageProcessed,
  callback
);

// Emit events
recoveryEmitter.emit<WorkerMessageType.PageProcessed>(
  RecoveryEventType.PageProcessed,
  data
);
```

### Integration with Worker Pool

The worker pool uses the recovery event emitter to notify the main thread about orphaned messages:

```typescript
private notifyMainThread<T extends WorkerMessageType>(
  eventName: RecoveryEventType,
  data: RecoveryDataForType<T>
): void {
  recoveryEmitter.emit(eventName, data);
}
```

## Future Improvements

1. **Persistent Storage**: Store orphaned results in IndexedDB for recovery across page reloads
2. **Global Error Boundary**: Implement a React error boundary that can use recovery data to restore state
3. **Metrics Collection**: Track recovery events for analytics and performance monitoring

## Troubleshooting

If recovery events are not being received:

1. Ensure the worker pool is properly initialized
2. Check that event listeners are set up before any potential orphaned results occur
3. Verify that the recovery emitter singleton is being imported consistently
4. Look for console warnings about unhandled recovery events
