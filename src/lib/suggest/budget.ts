export type RequestPriority = "final" | "typed" | "speculative";

/** Tokens that must stay in the bucket after a request of this priority, so speculation gives way first. */
const RESERVE: Record<RequestPriority, number> = { final: 0, typed: 2, speculative: 7 };

/**
 * Client-side token bucket for calls to /api/suggest (spec 5, quota guard).
 * The server allows 30 requests per minute per IP; the default 24 per minute
 * leaves room for a retry on the other provider.
 */
export class RequestBudget {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly perMinute: number;
  private readonly now: () => number;

  constructor(opts: { capacity: number; perMinute: number; now?: () => number } = { capacity: 20, perMinute: 24 }) {
    this.capacity = opts.capacity;
    this.perMinute = opts.perMinute;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.capacity;
    this.last = this.now();
  }

  /** Takes a token and returns 0, or returns how many ms to wait before this priority may send. */
  take(priority: RequestPriority): number {
    this.refill();
    const needed = RESERVE[priority] + 1;
    if (this.tokens >= needed) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil(((needed - this.tokens) * 60_000) / this.perMinute);
  }

  /** The server said it is rate limited: stop sending until the bucket refills. */
  drain(): void {
    this.refill();
    this.tokens = 0;
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) * this.perMinute) / 60_000);
    this.last = t;
  }
}
