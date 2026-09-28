import { describe, expect, it } from "vitest";
import { GapTimer, loadGaps, saveGap } from "./response-gap";

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

// repliesShown(shown at, replies, asked for at)
describe("GapTimer", () => {
  it("counts replies already on screen when the partner stops as no wait", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(2000, model(), 1500);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([0]);
  });

  it("waits for replies that arrive after the partner stops", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(3800, model(), 3000);
    gaps.repliesShown(4200, model(), 3000);
    expect(recorded).toEqual([800]);
  });

  it("ignores replies from before the turn", () => {
    const { gaps, recorded } = timer();
    gaps.repliesShown(500, model(), 0);
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    gaps.repliesShown(3500, model(), 3000);
    expect(recorded).toEqual([500]);
  });

  it("counts replies shown after the last word but before the transcript arrived", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(3200, model(), 2000);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([200]);
  });

  it("starts the turn at the latest speech start, so noise that never became a turn doesn't count", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000); // noise the segmenter discarded: no turn end follows
    gaps.repliesShown(2000, model(), 1500);
    gaps.speechStarted(5000);
    gaps.turnEnded(6000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(6500, model(), 6000);
    expect(recorded).toEqual([500]);
  });

  it("does not count replies from before a turn that was dropped while the app spoke", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000); // the app speaks a reply and hearing drops this half-turn
    gaps.repliesShown(3000, model(), 2000);
    gaps.speechStarted(8000);
    gaps.turnEnded(9000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(9700, model(), 9000);
    expect(recorded).toEqual([700]);
  });

  it("only counts replies from the model, not the user's own phrase matches", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(2000, phrase(), 2000);
    gaps.turnEnded(3000);
    gaps.repliesShown(3100, phrase(), 3100);
    expect(recorded).toEqual([]);
    gaps.repliesShown(3900, [...phrase(), ...model()], 3000);
    expect(recorded).toEqual([900]);
  });

  it("gives a late answer to the turn that was waiting, not to the next turn, however many updates it streams", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(2000);
    gaps.speechStarted(2500);
    gaps.repliesShown(2800, model(), 2000); // the answer to the first turn
    gaps.repliesShown(2900, model(), 2000); // its second streamed reply
    expect(recorded).toEqual([800]);
    gaps.turnEnded(4000);
    expect(recorded).toEqual([800]);
    gaps.repliesShown(4100, model(), 2000); // still the old answer
    expect(recorded).toEqual([800]);
    gaps.repliesShown(4600, model(), 4000);
    expect(recorded).toEqual([800, 600]);
  });

  it("counts replies asked for during the new turn for both the waiting turn and the new one", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(2000);
    gaps.speechStarted(2500);
    gaps.repliesShown(3500, model(), 3200); // asked while the partner was still talking
    expect(recorded).toEqual([1500]);
    gaps.turnEnded(4000);
    expect(recorded).toEqual([1500, 0]);
  });

  it("measures every turn that was still waiting when replies arrive", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(2000);
    gaps.speechStarted(2500);
    gaps.turnEnded(4000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(4500, model(), 4000);
    expect(recorded).toEqual([2500, 500]);
  });

  it("does not let an answer asked for before a turn began end that turn's wait", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(2000);
    gaps.speechStarted(2500);
    gaps.turnEnded(4000);
    gaps.repliesShown(4200, model(), 2000);
    expect(recorded).toEqual([2200]);
    gaps.repliesShown(4700, model(), 4000);
    expect(recorded).toEqual([2200, 700]);
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
