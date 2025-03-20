import { CleanupOptions } from "./processor";

export enum CoordinatorMessageType {
  INIT_COORDINATOR = "INIT_COORDINATOR",
  COORDINATOR_READY = "COORDINATOR_READY",
  ASSIGN_COORDINATOR = "ASSIGN_COORDINATOR",
  REGISTER_COORDINATOR = "REGISTER_COORDINATOR",
  COORDINATOR_STATUS = "COORDINATOR_STATUS",
  REGISTER_WORKER = "REGISTER_WORKER",
  CLEANUP = "CLEANUP",
}

export interface CoordinatorMessage {
  type: CoordinatorMessageType;
  coordinatorId?: number;
  clientId?: string;
  requestId?: string;
}

export interface CoordinatorStatusMessage extends CoordinatorMessage {
  type: CoordinatorMessageType.COORDINATOR_STATUS;
  activeRequests: number;
  activeClients: string[];
}

export interface AssignCoordinatorMessage extends CoordinatorMessage {
  type: CoordinatorMessageType.ASSIGN_COORDINATOR;
  coordinatorIndex: number;
  workerId?: string;
}

export interface InitCoordinatorMessage extends CoordinatorMessage {
  type: CoordinatorMessageType.INIT_COORDINATOR;
  coordinatorId: number;
}

export interface RegisterCoordinatorMessage extends CoordinatorMessage {
  type: CoordinatorMessageType.REGISTER_COORDINATOR;
  coordinatorId: number;
}

export interface CoordinatorReadyMessage extends CoordinatorMessage {
  type: CoordinatorMessageType.COORDINATOR_READY;
  coordinatorId: number;
}

export interface RegisterWorkerMessage extends CoordinatorMessage {
  type: CoordinatorMessageType.REGISTER_WORKER;
  workerId: string;
}

export interface CleanupMessage extends CoordinatorMessage {
  type: CoordinatorMessageType.CLEANUP;
  clientId?: string;
  requestId?: string;
  options?: CleanupOptions;
  success?: boolean;
  responseRequired?: boolean;
}

// Type guard to check if a message is of a specific coordinator type
export function isCoordinatorMessageType<T extends CoordinatorMessage>(
  message: unknown,
  type: CoordinatorMessageType
): message is T {
  return (
    message !== null &&
    typeof message === "object" &&
    "type" in message &&
    (message as { type: string }).type === type
  );
}
