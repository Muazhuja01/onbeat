import { describe, expect, it } from "vitest";
import { GapTimer, loadGaps, saveGap } from "./response-gap";

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
    gaps.repliesShown(2000);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([0]);
  });

  it("waits for replies that arrive after the partner stops", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(3800);
    gaps.repliesShown(4200);
    expect(recorded).toEqual([800]);
  });

  it("ignores replies from before the turn", () => {
    const { gaps, recorded } = timer();
    gaps.repliesShown(500);
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    gaps.repliesShown(3500);
    expect(recorded).toEqual([500]);
  });

  it("counts replies shown after the last word but before the transcript arrived", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(3200);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([200]);
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
