import { describe, expect, it } from "vitest";
import { FRAME } from "./audio";
import { DEFAULT_SEGMENTER, Segmenter, type SegmentEvent } from "./segmenter";

function feed(segmenter: Segmenter, probabilities: number[]): SegmentEvent[] {
  return probabilities.flatMap((p) => segmenter.push(new Float32Array(FRAME).fill(p), p));
}
const repeat = (p: number, n: number) => Array<number>(n).fill(p);
const types = (events: SegmentEvent[]) => events.map((e) => e.type);

describe("Segmenter", () => {
  it("stays quiet without speech", () => {
    expect(feed(new Segmenter(), repeat(0.05, 50))).toEqual([]);
  });

  it("starts, sends a partial every half second and ends after a 600 ms pause", () => {
    const events = feed(new Segmenter(), [0.9, ...repeat(0.9, 30), ...repeat(0.02, 19)]);
    expect(types(events)).toEqual(["start", "partial", "partial", "partial", "end"]);
    const end = events.at(-1) as Extract<SegmentEvent, { type: "end" }>;
    // 50 frames, minus the trailing silence beyond 96 ms of padding.
    expect(end.audio.length).toBe(50 * FRAME - (19 * FRAME - 3 * FRAME));
    expect(end.silenceMs).toBeCloseTo(608);
  });

  it("keeps a little audio from just before speech started", () => {
    const events = feed(new Segmenter(), [...repeat(0.05, 5), 0.9, ...repeat(0.9, 16)]);
    const partial = events.find((e) => e.type === "partial") as Extract<SegmentEvent, { type: "partial" }>;
    expect(partial.audio.length).toBe((3 + 1 + 16) * FRAME);
  });

  it("discards a short noise without sending partials", () => {
    expect(types(feed(new Segmenter(), [0.9, ...repeat(0.05, 19)]))).toEqual(["start", "discard"]);
  });

  it("forces an end at the maximum length", () => {
    const segmenter = new Segmenter({ ...DEFAULT_SEGMENTER, maxSegmentMs: 1000, partialEveryMs: 100_000 });
    const events = feed(segmenter, repeat(0.9, 40));
    expect(types(events)).toEqual(["start", "end", "start"]);
    expect((events[1] as Extract<SegmentEvent, { type: "end" }>).audio.length).toBe(32 * FRAME);
  });

  it("drops speech in progress on reset", () => {
    const segmenter = new Segmenter();
    feed(segmenter, repeat(0.9, 6));
    segmenter.reset();
    expect(feed(segmenter, repeat(0.02, 25))).toEqual([]);
  });
});
