import { describe, expect, it } from "vitest";
import { GapTimer, loadGaps, saveGap } from "./response-gap";

/** A new reply set, as from a new request; each streamed update of one request reuses its reply objects. */
const model = () => [{ source: "model" as const }];
const phrase = () => [{ source: "phrase" as const }];

function timer() {
  const recorded: number[] = [];
  return { gaps: new GapTimer((ms) => recorded.push(ms)), recorded };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("GapTimer", () => {
  it("counts replies already on screen when the partner stops as no wait", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(2000, model());
    gaps.turnEnded(3000);
    expect(recorded).toEqual([0]);
  });

  it("waits for replies that arrive after the partner stops", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(3800, model());
    gaps.repliesShown(4200, model());
    expect(recorded).toEqual([800]);
  });

  it("ignores replies from before the turn", () => {
    const { gaps, recorded } = timer();
    gaps.repliesShown(500, model());
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    gaps.repliesShown(3500, model());
    expect(recorded).toEqual([500]);
  });

  it("counts replies shown after the last word but before the transcript arrived", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(3200, model());
    gaps.turnEnded(3000);
    expect(recorded).toEqual([200]);
  });

  it("starts the turn at the latest speech start, so noise that never became a turn doesn't count", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000); // noise the segmenter discarded: no turn end follows
    gaps.repliesShown(2000, model());
    gaps.speechStarted(5000);
    gaps.turnEnded(6000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(6500, model());
    expect(recorded).toEqual([500]);
  });

  it("does not count replies from before a turn that was dropped while the app spoke", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000); // the app speaks a reply and hearing drops this half-turn
    gaps.repliesShown(3000, model());
    gaps.speechStarted(8000);
    gaps.turnEnded(9000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(9700, model());
    expect(recorded).toEqual([700]);
  });

  it("only counts replies from the model, not the user's own phrase matches", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(2000, phrase());
    gaps.turnEnded(3000);
    gaps.repliesShown(3100, phrase());
    expect(recorded).toEqual([]);
    gaps.repliesShown(3900, [...phrase(), ...model()]);
    expect(recorded).toEqual([900]);
  });

  it("gives late replies to the turn that was waiting, not to the next turn", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(2000);
    gaps.speechStarted(2500);
    gaps.repliesShown(2800, model()); // the answer to the first turn
    expect(recorded).toEqual([800]);
    gaps.turnEnded(4000);
    expect(recorded).toEqual([800]);
    gaps.repliesShown(4600, model());
    expect(recorded).toEqual([800, 600]);
  });

  it("keeps the rest of a late answer from counting for the next turn, but counts a new answer", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(2000);
    gaps.speechStarted(2500);
    const late = model();
    gaps.repliesShown(2800, late);
    gaps.repliesShown(2900, [...late, { source: "model" }]); // the same request streams its second reply
    gaps.turnEnded(4000);
    expect(recorded).toEqual([800]);
    gaps.repliesShown(4100, [...late, { source: "model" }, { source: "model" }]); // still the old answer
    expect(recorded).toEqual([800]);
    gaps.repliesShown(4600, model());
    expect(recorded).toEqual([800, 600]);

    gaps.speechStarted(5000);
    gaps.turnEnded(6000);
    const lateAgain = model();
    gaps.speechStarted(6500);
    gaps.repliesShown(6700, lateAgain);
    gaps.repliesShown(7000, model()); // prepared while this turn is still going
    gaps.turnEnded(8000);
    expect(recorded).toEqual([800, 600, 700, 0]);
  });

  it("measures every turn that was still waiting when replies arrive", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(2000);
    gaps.speechStarted(2500);
    gaps.turnEnded(4000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(4500, model());
    expect(recorded).toEqual([2500, 500]);
  });
});

describe("saved gaps", () => {
  it("keeps the last 100 and survives bad data", () => {
    const storage = memoryStorage();
    storage.setItem("onbeat:gaps", "not json");
    expect(loadGaps(storage)).toEqual([]);
    for (let i = 0; i < 105; i++) saveGap(i + 0.4, storage);
    const all = loadGaps(storage);
    expect(all).toHaveLength(100);
    expect(all[0]).toBe(5);
    expect(all.at(-1)).toBe(104);
  });
});
