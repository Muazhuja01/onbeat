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
  /** End times of turns that ended with no replies for them yet. */
  private waiting: number[] = [];
  /** The reply set that answered waiting turns; its later updates don't count for a newer turn. */
  private lateAnswer: object | null = null;

  constructor(private readonly record: (ms: number) => void) {}

  /**
   * Segments are sequential, so the latest start before a turn end is that
   * turn's start. A start with no end (noise, an empty transcript, a half-turn
   * dropped while the app spoke) is simply replaced by the next one.
   */
  speechStarted(at: number): void {
    this.turnStartedAt = at;
  }

  repliesShown(at: number, replies: readonly Pick<Reply, "source">[]): void {
    // A streamed answer arrives as several updates that reuse the same reply
    // objects, so its first model reply identifies the request it came from.
    const first = replies.find((r) => r.source === "model");
    if (!first || first === this.lateAnswer) return;
    if (this.waiting.length) {
      // These replies answer the turn(s) that were waiting, even if the partner
      // has started talking again; they weren't prepared for the new turn.
      // Every waiting turn gets a sample: nothing was on screen for it until now.
      for (const endedAt of this.waiting) this.record(Math.max(0, at - endedAt));
      this.waiting = [];
      this.lateAnswer = first;
      return;
    }
    this.shownAt = at;
  }

  turnEnded(endedAt: number): void {
    const started = this.turnStartedAt ?? endedAt;
    this.turnStartedAt = null;
    if (this.shownAt !== null && this.shownAt >= started) {
      this.record(Math.max(0, this.shownAt - endedAt));
      return;
    }
    this.waiting.push(endedAt);
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
