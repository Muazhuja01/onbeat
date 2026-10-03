import { tokenize } from "@/lib/text";

/** Matches how long replies stay on screen while the partner talks, so no answer is asked for and then never shown. */
export const SPECULATE_EVERY_MS = 5000;
export const SPECULATE_AFTER_WORDS = 3;

/** Same words, ignoring case, accents and punctuation. */
const same = (a: string, b: string) => tokenize(a).join(" ") === tokenize(b).join(" ");

/** Decides when to ask for replies while the partner is still talking (spec 4 and 5). */
export class Speculation {
  private lastAt = -Infinity;
  private wordsAtLast = 0;
  private pending: string | null = null;
  private answered: string | null = null;

  /**
   * The partner started a new turn. Word counts restart; the 5 s spacing carries over.
   * `carried`: the line they are carrying on after a pause, whose words don't count as new.
   */
  newTurn(carried = ""): void {
    this.wordsAtLast = tokenize(carried).length;
    this.pending = null;
    this.answered = null;
  }

  /** True when this partial transcript should be sent now. */
  shouldSend(partial: string, now: number): boolean {
    const words = tokenize(partial).length;
    return words - this.wordsAtLast >= SPECULATE_AFTER_WORDS && now - this.lastAt >= SPECULATE_EVERY_MS;
  }

  sent(partial: string, now: number): void {
    this.lastAt = now;
    this.wordsAtLast = tokenize(partial).length;
    this.pending = partial;
  }

  /** A speculative request ended; `ok` means its replies reached the screen. */
  finished(partial: string, ok: boolean): void {
    if (this.pending !== null && same(partial, this.pending)) this.pending = null;
    if (ok) this.answered = partial;
  }

  /** True when the finished turn needs its own request: no request for these words is on screen or on its way. */
  needsFinal(text: string): boolean {
    if (this.pending !== null && same(text, this.pending)) return false;
    if (this.answered !== null && same(text, this.answered)) return false;
    return true;
  }

  /** The turn is over; forget its words so the same line said again later is asked again. */
  turnDone(): void {
    this.wordsAtLast = 0;
    this.pending = null;
    this.answered = null;
  }
}
