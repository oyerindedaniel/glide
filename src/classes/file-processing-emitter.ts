/* eslint-disable @typescript-eslint/no-unsafe-function-type */
class FileProcessingEmitter {
  private listeners: Map<string, Set<Function>> = new Map();

  on(event: string, listener: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  off(event: string, listener: Function) {
    this.listeners.get(event)?.delete(listener);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
}

export const fileProcessingEmitter = new FileProcessingEmitter();
