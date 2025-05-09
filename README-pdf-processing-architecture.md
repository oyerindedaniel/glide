# PDF Processing Architecture

## Overview

This document describes the PDF processing architecture, focusing on how components interact and synchronize to provide robust document processing capabilities.

## Core Components

The PDF processing system consists of these primary components:

1. **PDFProcessor** - Client-facing class that handles document operations
2. **PDFWorkerPool** - Manages worker lifecycles and communication
3. **Coordinator Workers** - Route messages between processing workers and library
4. **PDF Worker** - Process individual PDF operations
5. **PDF Library Worker** - Core PDF.js rendering engine

```
┌────────────────┐          ┌───────────────────┐          ┌───────────────┐
│  Main Thread   │◄────────►│   Worker Pool     │◄────────►│  PDF Workers  │
│  (Browser)     │          │   & Coordinators  │          │               │
└────────────────┘          └───────────────────┘          └───────┬───────┘
                                                                   │
                                                                   ▼
                                                           ┌───────────────┐
                                                           │  PDF.js       │
                                                           │  Library      │
                                                           └───────────────┘
```

## Message Flow

### Initialization Flow

```
┌─────────────┐     ┌─────────────┐     ┌────────────┐     ┌───────────────┐
│ PDFProcessor│─1──►│ Worker Pool │─2──►│ Coordinator│─3──►│ PDF.js Library│
│ (Main)      │     │             │     │            │     │               │
└─────────────┘     └─────────────┘     └────────────┘     └───────────────┘
                                                                   │
                                                                   │ 4
                                                                   ▼
┌─────────────┐     ┌─────────────┐     ┌────────────┐     ┌───────────────┐
│ PDFProcessor│◄─7──│ Worker Pool │◄─6──│ Coordinator│◄─5──│ PDF.js Library│
│ (Main)      │     │             │     │            │     │               │
└─────────────┘     └─────────────┘     └────────────┘     └───────────────┘
```

1. Main thread requests PDF initialization with client ID
2. Worker Pool assigns the task to an available worker
3. Coordinator forwards PDF data to Library Worker
4. Library Worker processes the PDF and initializes document
5. Response returns to Coordinator with document metadata
6. Coordinator routes response back to originating worker
7. Worker returns response to main thread

### Page Processing Flow

```
┌─────────────┐     ┌─────────────┐     ┌────────────┐     ┌───────────────┐
│ PDFProcessor│─1──►│ Worker Pool │─2──►│ Coordinator│─3──►│ PDF.js Library│
│ (Main)      │     │             │     │            │     │               │
└─────────────┘     └─────────────┘     └────────────┘     └───────────────┘
                                                                   │
                                                                   │ 4
                                                                   ▼
┌─────────────┐     ┌─────────────┐     ┌────────────┐     ┌───────────────┐
│ PDFProcessor│◄─7──│ Worker Pool │◄─6──│ Coordinator│◄─5──│ PDF.js Library│
│ (Main)      │     │             │     │            │     │               │
└─────────────┘     └─────────────┘     └────────────┘     └───────────────┘
```

### Cleanup Flow

```
┌─────────────┐     ┌─────────────┐     ┌────────────┐     ┌───────────────┐
│ PDFProcessor│─1──►│ Worker Pool │─2──►│ Coordinator│─3──►│ PDF.js Library│
│ (Main)      │◄─8──│             │◄─7──│            │◄─6──│               │
└─────────────┘     └─────────────┘     └────────────┘     └───────────────┘
                          │4                  │5
                          ▼                   ▼
                    ┌─────────────┐    ┌────────────┐
                    │ Close Ports │    │ Close Ports│
                    └─────────────┘    └────────────┘
```

1. Main thread initiates cleanup with client ID and options
2. Worker Pool sends cleanup to all relevant workers and coordinators
3. Coordinator forwards cleanup to Library Worker
   4-5. Both Worker Pool and Coordinator close message ports if requested
   6-7-8. Cleanup confirmations flow back to main thread

## Synchronization Mechanisms

### 1. Message Channel Architecture

The system uses a tiered messaging architecture with dedicated `MessageChannel` instances:

```
┌─────────────┐     ┌─────────────┐     ┌────────────┐     ┌───────────────┐
│ PDFProcessor│────►│ Worker Pool │────►│ Coordinator│────►│ PDF.js Library│
│ (Main)      │◄────│             │◄────│            │◄────│               │
└─────────────┘     └─────────────┘     └────────────┘     └───────────────┘
```

Each line represents a dedicated `MessageChannel` with paired `MessagePort` objects allowing bi-directional communication.

### 2. Request/Response Correlation

Each request is assigned a unique ID that follows it through the entire processing pipeline:

```typescript
// When sending a request:
const requestId = uuidv4();
pendingRequests.set(requestId, responseHandler);

// When receiving a response:
const handler = pendingRequests.get(requestId);
if (handler) {
  handler(response);
  pendingRequests.delete(requestId);
}
```

### 3. Client-Based Message Routing

All PDF operations require a client ID for proper isolation and message routing. This is a critical design feature:

```typescript
// Client ID is required for all PDF operations (not optional)
if (!clientId) {
  throw new Error(`Client ID is required for operation type: ${type}`);
}

// Track which requests belong to which client
if (!clientRequests.has(clientId)) {
  clientRequests.set(clientId, new Set<string>());
}
clientRequests.get(clientId)!.add(requestId);
```

This strict client identification ensures:

- Complete isolation between different documents being processed
- Cache entries are properly segregated
- Resources are correctly cleaned up for each client
- No cross-contamination between concurrent processing tasks

### 4. Transferable Objects

PDF data is efficiently transferred between threads using the Transferable interface to avoid copying large buffers:

```typescript
// Create a copy for potential retries
const pdfDataToSend = pdfData.slice(0);

// Transfer ownership completely (no copying)
worker.postMessage(
  {
    type: WorkerMessageType.InitPDF,
    pdfData: pdfDataToSend,
  },
  [pdfDataToSend]
); // Transfer list
```

### 5. Concurrency Coordination System

The architecture implements a synchronized concurrency system that ensures optimal resource utilization across the processing pipeline:

```typescript
// Utility function to calculate optimal coordinator count
export function calculateOptimalCoordinatorCount(workers: number): number {
  return Math.max(1, Math.min(4, Math.ceil(workers / 2)));
}
```

This system manages coordination between components through:

1. **Concurrency Cascade**: When optimal concurrency is detected in the batch processor, the values cascade through the entire system:

   ```typescript
   const workerPool = await PDFWorkerPool.getInstance({
     detectOptimalConcurrency: true,
     concurrencyOptions: {
       customConcurrency: this.usedOptimalConcurrency
         ? this.maxConcurrentFiles
         : undefined,
     },
     coordinatorCount: this.usedOptimalConcurrency
       ? calculateOptimalCoordinatorCount(this.maxConcurrentFiles)
       : undefined,
   });
   ```

2. **Worker-Coordinator Balance**: Coordinators are scaled based on worker count using a standardized formula: one coordinator for approximately every two workers, with minimum of 1 and maximum of 4.

3. **Resource Synchronization**: The system ensures that the appropriate number of message channels and coordination workers are created based on detected system capabilities.

4. **Batch Size Adaptation**: Processing options like page concurrency scale inversely with batch size to maintain optimal performance across different workloads.

The concurrency coordination flow is illustrated below:

```
┌─────────────────────┐
│ Optimal Concurrency │
│    Detection        │◄───────┐ System
└──────────┬──────────┘        │ Capabilities
           │                   │
           ▼                   │
┌─────────────────────┐        │
│ PDFBatchProcessor   │────────┘
│ maxConcurrentFiles  │
└──────────┬──────────┘
           │
           │ Cascade concurrency settings
           │ using utility functions
           ▼
┌─────────────────────┐    ┌─────────────────────┐
│   Worker Pool       │───►│   Worker Count      │
│ (Singleton)         │    │   Scaling           │
└──────────┬──────────┘    └─────────────────────┘
           │
           │ Calculate optimal coordinator count
           │ based on worker count
           ▼
┌─────────────────────┐
│  Coordinator Count  │
│  Scaling            │
└─────────────────────┘
```

This coordination system ensures that all components are properly resourced without overcommitting CPU or memory, enhancing both performance and stability.

## Resource Management

### 1. Message Port Lifecycle

Message ports (`MessagePort`) are created and passed between components through the following lifecycle:

1. **Creation**: A new `MessageChannel` is created with paired ports
2. **Transfer**: One port is transferred to the destination (worker/coordinator)
3. **Usage**: The port is used for bi-directional communication
4. **Cleanup**: The port is explicitly closed when no longer needed

```typescript
// Creation
const channel = new MessageChannel();
const port1 = channel.port1;
const port2 = channel.port2;

// Transfer to worker
worker.postMessage({ type: "INIT", port: port1 }, [port1]);

// Cleanup when done
port2.close();
```

### 2. Cleanup System

The architecture implements a robust cleanup system with configurable options:

#### Shared CleanupOptions Interface

```typescript
interface CleanupOptions {
  // Force cleanup even if client isn't found in active list
  force?: boolean;
  // Don't log standard cleanup messages
  silent?: boolean;
  // Mark requests as pending cleanup but don't remove them yet
  delayRequestRemoval?: boolean;
  // The timeout in ms for delayed request removal
  requestRemovalDelay?: number;
  // Whether to close channel ports during cleanup
  closeChannels?: boolean;
}
```

#### Client-Specific Cleanup

Cleanup can be targeted to specific clients:

```typescript
workerPool.cleanupClient("client-123", {
  force: true,
  closeChannels: true,
});
```

#### Full System Cleanup

Or applied to the entire system:

```typescript
workerPool.terminateAll();
```

The cleanup system ensures proper resource reclamation by:

1. Cleaning up client-specific data across all components
2. Properly closing message ports to prevent memory leaks
3. Removing pending requests and canceling timeouts
4. Destroying PDF documents in the PDF.js library

### 3. Worker Termination Protocol

When a worker needs to be terminated:

1. A special cleanup message with `CoordinatorMessageType.CLEANUP` is sent
2. The worker clears its heartbeat interval
3. The worker forwards a cleanup request to the library worker
4. The worker closes its coordinator port
5. The worker sends a completion message back to the main thread
6. The pool terminates the worker once cleanup is confirmed (or times out)

### 4. Dynamic Resource Allocation

The system dynamically adjusts resource allocation based on device capabilities and batch size:

```typescript
// In PDFBatchProcessor
private getProcessorOptionsForBatch(batchSize: number): Partial<ProcessingOptions> {
  // Large batches use fewer page slots per document to balance overall throughput
  if (batchSize > 5) {
    return {
      pageProcessingSlots: 1,
      // Other settings...
    };
  }

  // Small batches can use more resources per document
  return {
    pageProcessingSlots: 2,
    // Other settings...
  };
}
```

The system coordinates allocation of resources at multiple levels:

1. **CPU Utilization**: Automatically scales worker and coordinator count based on available CPU cores
2. **Memory Management**: Adjusts page processing slots based on batch size to prevent memory pressure
3. **Resource Balancing**: Ensures proper balance between worker threads and coordinator threads
4. **Adaptive Processing**: Changes throughput strategies based on document characteristics

This multi-level resource management ensures optimal performance across different devices and workloads.

## Type System

### 1. Message Types

The system uses hierarchical type definitions for all messages:

```typescript
// Base message type with common properties
interface BaseWorkerMessage {
  type: WorkerMessageType | LibraryWorkerMessageType;
  clientId: string;
  requestId?: string;
}

// Specific message types extend the base type
interface InitPDFMessage extends BaseWorkerMessage {
  type: WorkerMessageType.InitPDF;
  pdfData: ArrayBuffer;
}
```

### 2. Cleanup Type Hierarchy

Cleanup operations have their own type hierarchy:

```typescript
// Base cleanup options
interface CleanupOptions {
  force?: boolean;
  silent?: boolean;
  delayRequestRemoval?: boolean;
  requestRemovalDelay?: number;
  closeChannels?: boolean;
}

// Component-specific extensions
type CoordinatorCleanupOptions = CleanupOptions & {
  clearTimeout?: boolean;
  excludeRequestId?: string;
  isWorkerTermination?: boolean;
};

// Response type
interface CleanupResponse {
  success: boolean;
  workerResponses: number;
  coordinatorResponses: number;
  timedOut: boolean;
}
```

## Recovery System

The architecture implements a sophisticated recovery system for handling edge cases:

### 1. Orphaned Results

When a worker disconnects but its result arrives later:

```typescript
// In the coordinator
if (!pendingRequests.has(requestId)) {
  // Fallback delivery methods
  if (workerPorts.size > 0) {
    // 1. Try broadcasting to all workers
    workerPorts.forEach((port) => port.postMessage(data));
  } else {
    // 2. Send to main thread as last resort
    self.postMessage(createCoordinatorFallbackMessage(data, coordinatorId));
  }
}
```

### 2. Message Fallback

Tiered delivery approach when the target worker is unavailable:

```typescript
// In the worker pool
private handleCoordinatorFallbackMessage(event: MessageEvent<WorkerMessage>): void {
  const data = event.data;

  // Route based on message type
  switch (data.type) {
    case WorkerMessageType.PageProcessed:
      this.handleOrphanedPageProcessed(data);
      break;
    // Other handlers...
  }
}
```

### 3. Cleanup Management

Coordinated cleanup of resources across threads with configurable behaviors:

```typescript
function cleanupClientResources(
  clientId: string,
  options: CleanupOptions
): boolean {
  // Default options
  const {
    silent = false,
    force = false,
    delayRequestRemoval = false,
    requestRemovalDelay = 5000,
  } = options;

  // Cleanup implementation
  // ...
}
```

## Multi-Tier Retry Implementation

The system implements a robust retry mechanism with multiple levels:

### 1. Operation-Level Retry

The `withRetry` utility retries individual operations:

```typescript
return await this.withRetry(
  async () => {
    // Operation logic
  },
  {
    operationName: OperationName.PDFProcessing,
    maxAttempts: 3,
  }
);
```

### 2. Message Delivery Retry

Coordinators attempt multiple delivery paths for critical messages:

```typescript
// First attempt direct delivery
if (pendingRequests.has(requestId)) {
  const port = pendingRequests.get(requestId);
  port.postMessage(data);
}
// Then try broadcasting to all workers
else if (workerPorts.size > 0) {
  workerPorts.forEach((port) => port.postMessage(data));
}
// Finally fall back to main thread
else {
  self.postMessage(createCoordinatorFallbackMessage(data, coordinatorId));
}
```

## Memory Management

PDF processing can be memory-intensive. The architecture optimizes memory use through:

### 1. Buffer Transfers

Using transferable objects to avoid duplicate memory allocation:

```typescript
worker.postMessage({ type: "RENDER", buffer: imageData }, [imageData]);
```

### 2. Worker Pooling

Reusing workers to avoid initialization overhead:

```typescript
public releaseWorker(worker: Worker) {
  this.availableWorkers.push(worker);
  this.processQueue(); // Reuse for next task
}
```

### 3. Explicit Cleanup

Coordinated cleanup of PDF documents:

```typescript
// Library worker cleanup
if (pdfDocument) {
  await pdfDocument.cleanup();
  pdfDocuments.delete(clientId);
}
```

### 4. Port Closing

Explicitly closing `MessagePort` objects to prevent memory leaks:

```typescript
if (shouldCloseChannels) {
  for (const [id, port] of coordinators.entries()) {
    try {
      port.close();
    } catch (err) {
      logger.warn(`Error closing coordinator port ${id}:`, err);
    }
  }
}
```

### 5. Cache Limits

Limiting the number of cached rendered pages:

```typescript
// Enforce cache size limit per client
if (clientCache.size >= MAX_SCALE_CACHE_ENTRIES) {
  // Remove oldest entry (first key in the map)
  const firstKey = clientCache.keys().next().value;
  if (firstKey !== undefined) {
    clientCache.delete(firstKey);
  }
}
```

### 6. Cache Limits

Limiting the number of cached rendered pages:

```typescript
// Enforce cache size limit per client
if (clientCache.size >= MAX_SCALE_CACHE_ENTRIES) {
  // Remove oldest entry (first key in the map)
  const firstKey = clientCache.keys().next().value;
  if (firstKey !== undefined) {
    clientCache.delete(firstKey);
  }
}
```

## Advanced Features

### 1. Heartbeat Mechanism

Workers send periodic heartbeats to detect stalled or crashed workers:

```typescript
function startHeartbeat(): void {
  heartbeatInterval = setInterval(() => {
    self.postMessage({
      type: WorkerMessageType.WorkerHeartbeat,
      timestamp: Date.now(),
      workerId,
    });
  }, 3000);
}
```

### 2. Coordinator Fallback

The system implements a fallback mechanism for messages that can't be delivered:

```typescript
// Create a coordinator fallback message
function createCoordinatorFallbackMessage<T extends WorkerMessage>(
  message: T,
  coordinatorId: number
): CoordinatorFallbackMessage<T> {
  return {
    ...message,
    coordinatorFallback: true,
    coordinatorId,
  };
}
```

### 3. Timeout-Based Safety

Critical operations have timeout safety mechanisms:

```typescript
// Set timeout for cleanup responses
const cleanupTimeout = setTimeout(() => {
  if (pendingCleanupResponses.has(workerId)) {
    logger.warn(`Cleanup response timeout for worker ${workerId}`);
    pendingCleanupResponses.delete(workerId);
    worker.terminate(); // Force termination
  }
}, 300);
```

## Error Handling & Recovery

The architecture implements sophisticated error handling:

1. **Error Propagation**: Errors are properly propagated up the stack
2. **Resource Cleanup**: Failed operations properly release resources
3. **State Recovery**: The system can recover from transient failures
4. **Abort Handling**: Clean abortion of in-progress operations

This architecture ensures reliable PDF processing with graceful degradation, making it suitable for production applications where robustness is critical.
