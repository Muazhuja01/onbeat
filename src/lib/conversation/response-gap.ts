import type { Reply } from "@/lib/types";

/**
 * Measures the time from the partner's last word until replies for that turn
 * are on screen (spec 1: about 1 second). Replies prepared during the turn
 * count as 0 ms; replies from before the turn don't count. Only replies from
 * the model count: the user's own phrase matches don't answer the partner.
 */
export class GapTimer {
  private turnStartedAt: number | null = null;
  private shownAt: number | null = null;
  /** Turns that ended with no replies for them yet. */
  private waiting: { startedAt: number; endedAt: number }[] = [];

  constructor(private readonly record: (ms: number) => void) {}

  /**
   * Segments are sequential, so the latest start before a turn end is that
   * turn's start. A start with no end (noise, an empty transcript, a half-turn
   * dropped while the app spoke) is simply replaced by the next one.
   */
  speechStarted(at: number): void {
    this.turnStartedAt = at;
  }

  /**
   * Replies reached the screen at `at`; `askedAt` is when their request was
   * made. A request made before a turn began can't have been prepared for it:
   * it is a late answer to an earlier turn, however many updates it streams.
   */
  repliesShown(at: number, replies: readonly Pick<Reply, "source">[], askedAt: number | null): void {
    if (!replies.some((r) => r.source === "model")) return;
    const asked = askedAt ?? at;
    // Every waiting turn that began before this request gets a sample: nothing
    // was on screen for it until now. Back-to-back turns each keep their own.
    const still: typeof this.waiting = [];
    for (const turn of this.waiting) {
      if (turn.startedAt <= asked) this.record(Math.max(0, at - turn.endedAt));
      else still.push(turn);
    }
    this.waiting = still;
    if (this.turnStartedAt !== null && asked < this.turnStartedAt) return;
    this.shownAt = at;
  }

  turnEnded(endedAt: number): void {
    const started = this.turnStartedAt ?? endedAt;
    this.turnStartedAt = null;
    if (this.shownAt !== null && this.shownAt >= started) {
      this.record(Math.max(0, this.shownAt - endedAt));
      return;
    }
    this.waiting.push({ startedAt: started, endedAt });
  }
}

const KEY = "onbeat:gaps";
const KEEP = 100;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadGaps(storage: Pick<Storage, "getItem"> | null = browserStorage()): number[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

export function saveGap(ms: number, storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage()): number[] {
  const all = [...loadGaps(storage), Math.round(ms)].slice(-KEEP);
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage can be full or blocked; the numbers still show for this session.
  }
  return all;
}
