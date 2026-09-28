/** The part of the Worker API we use, so tests can pass fakes. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  /** Fires when the script fails to load, throws, or the worker dies. */
  onerror?: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}
