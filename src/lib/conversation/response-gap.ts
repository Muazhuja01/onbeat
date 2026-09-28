/**
 * Measures the time from the partner's last word until replies for that turn
 * are on screen (spec 1: about 1 second). Replies prepared during the turn
 * count as 0 ms; replies from before the turn don't count.
 */
export class GapTimer {
  private turnStartedAt: number | null = null;
  private shownAt: number | null = null;
  private waitingSince: number | null = null;

  constructor(private readonly record: (ms: number) => void) {}

  speechStarted(at: number): void {
    this.turnStartedAt ??= at;
  }

  repliesShown(at: number): void {
    this.shownAt = at;
    if (this.waitingSince !== null) {
      this.record(Math.max(0, at - this.waitingSince));
      this.waitingSince = null;
    }
  }

  turnEnded(endedAt: number): void {
    const started = this.turnStartedAt ?? endedAt;
    this.turnStartedAt = null;
    if (this.shownAt !== null && this.shownAt >= started) {
      this.record(Math.max(0, this.shownAt - endedAt));
      return;
    }
    this.waitingSince = endedAt;
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
