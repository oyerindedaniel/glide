/* eslint-disable @typescript-eslint/no-unsafe-function-type */
class FileProcessingEmitter {
  private static instance: FileProcessingEmitter;
  private listeners: Map<string, Set<Function>> = new Map();

  private constructor() {}

  public static getInstance(): FileProcessingEmitter {
    if (!FileProcessingEmitter.instance) {
      FileProcessingEmitter.instance = new FileProcessingEmitter();
    }
    return FileProcessingEmitter.instance;
  }

  public on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  public off(event: string, listener: Function): void {
    this.listeners.get(event)?.delete(listener);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
}

export const fileProcessingEmitter = FileProcessingEmitter.getInstance();
