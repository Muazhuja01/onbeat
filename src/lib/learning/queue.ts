import type { KeyValue } from "@/lib/profiles/kv";
import { queueKey } from "./keys";
import type { QueuedLine } from "./types";

export const QUEUE_MAX = 40;
export const LINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FAILURES_BEFORE_BACKOFF = 3;
export const BACKOFF_MS = 10 * 60 * 1000;

interface QueueState {
  version: 1;
  lines: QueuedLine[];
  failures: number;
  backoffUntil: number;
}

const EMPTY: QueueState = { version: 1, lines: [], failures: 0, backoffUntil: 0 };

/**
 * One profile's lines waiting to be learned from. Kept in memory and saved on every
 * change, so a reload doesn't lose them; if storage fails they still work for the visit.
 */
export class LearningQueue {
  private constructor(
    private readonly kv: KeyValue,
    private readonly key: string,
    private state: QueueState,
    private readonly now: () => number,
  ) {}

  static async open(kv: KeyValue, profileId: string, now: () => number = Date.now): Promise<LearningQueue> {
    const saved = await kv.get<QueueState>(queueKey(profileId)).catch(() => undefined);
    return new LearningQueue(kv, queueKey(profileId), saved?.version === 1 ? saved : EMPTY, now);
  }

  /** Lines young enough to send, oldest first; none while backing off after failures. */
  take(): QueuedLine[] {
    return this.now() < this.state.backoffUntil ? [] : this.fresh();
  }

  async add(line: QueuedLine): Promise<void> {
    await this.write({ ...this.state, lines: [...this.fresh(), line].slice(-QUEUE_MAX) });
  }

  /** A batch went through: its lines are done, and failures start counting again. */
  async ack(ids: string[]): Promise<void> {
    const sent = new Set(ids);
    await this.write({ ...this.state, lines: this.fresh().filter((l) => !sent.has(l.id)), failures: 0, backoffUntil: 0 });
  }

  /** A batch failed: its lines stay. After three failures in a row, wait before trying again. */
  async fail(): Promise<void> {
    const failures = this.state.failures + 1;
    if (failures < FAILURES_BEFORE_BACKOFF) await this.write({ ...this.state, failures });
    else await this.write({ ...this.state, failures: 0, backoffUntil: this.now() + BACKOFF_MS });
  }

  async clear(): Promise<void> {
    await this.write(EMPTY);
  }

  private fresh(): QueuedLine[] {
    const cutoff = this.now() - LINE_MAX_AGE_MS;
    return this.state.lines.filter((l) => l.at >= cutoff);
  }

  private async write(state: QueueState): Promise<void> {
    this.state = state;
    try {
      await this.kv.set(this.key, state);
    } catch {
      // Storage full or blocked: the queue still works for this visit.
    }
  }
}

/** Turning learning off empties every profile's queue, not only the open one. */
export async function clearQueues(kv: KeyValue, profileIds: string[]): Promise<void> {
  for (const id of profileIds) await kv.del(queueKey(id)).catch(() => {});
}
