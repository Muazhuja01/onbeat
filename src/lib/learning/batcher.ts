import type { LearningQueue } from "./queue";
import type { QueuedLine } from "./types";

export const QUIET_MS = 60_000;
export const BATCH_LINES = 12;
export const MIN_LINES = 2;

export type SendResult = "sent" | "failed";

/** Decides when queued lines go out: after a quiet minute, at 12 lines, or when the page is hidden. One batch at a time. */
export class Batcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly queue: LearningQueue,
    private readonly send: (lines: QueuedLine[]) => Promise<SendResult>,
  ) {}

  /** Call after each line is queued. */
  lineAdded(): void {
    if (this.disposed) return;
    if (this.queue.take().length >= BATCH_LINES) void this.flush();
    else this.restartTimer();
  }

  pageHidden(): void {
    void this.flush();
  }

  flush(): Promise<void> {
    this.stopTimer();
    if (this.disposed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const lines = this.queue.take();
    if (lines.length < MIN_LINES) return Promise.resolve();
    this.inFlight = this.run(lines).finally(() => {
      this.inFlight = null;
      // Lines that arrived while this batch was out get their own quiet wait.
      if (!this.disposed && this.queue.take().length > 0) this.restartTimer();
    });
    return this.inFlight;
  }

  /** Stops the timer. A batch already sent still finishes and writes to its own profile. */
  dispose(): void {
    this.disposed = true;
    this.stopTimer();
  }

  private async run(lines: QueuedLine[]): Promise<void> {
    let result: SendResult;
    try {
      result = await this.send(lines);
    } catch {
      result = "failed";
    }
    if (result === "sent") await this.queue.ack(lines.map((l) => l.id));
    else await this.queue.fail();
  }

  private restartTimer(): void {
    this.stopTimer();
    this.timer = setTimeout(() => void this.flush(), QUIET_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
