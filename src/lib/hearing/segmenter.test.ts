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
    const segmenter = new Segmenter();
    feed(segmenter, [...repeat(0.05, 5), 0.9, ...repeat(0.9, 16)]);
    expect(segmenter.pending()?.length).toBe((3 + 1 + 16) * FRAME);
  });

  it("has nothing pending without speech", () => {
    const segmenter = new Segmenter();
    expect(segmenter.pending()).toBeNull();
    feed(segmenter, [0.9, 0.9]);
    // Under 250 ms of speech so far.
    expect(segmenter.pending()).toBeNull();
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

  describe("pieces of a long turn", () => {
    const quiet = { ...DEFAULT_SEGMENTER, partialEveryMs: 100_000 };
    const chunk = (events: SegmentEvent[]) => events.find((e) => e.type === "chunk") as Extract<SegmentEvent, { type: "chunk" }>;
    const end = (events: SegmentEvent[]) => events.find((e) => e.type === "end") as Extract<SegmentEvent, { type: "end" }>;

    it("cuts a piece at a short pause once 2 s have built up", () => {
      const segmenter = new Segmenter(quiet);
      // 70 frames is 2.24 s; 5 frames under the speech threshold is 160 ms.
      const events = feed(segmenter, [...repeat(0.9, 70), ...repeat(0.2, 5), ...repeat(0.9, 10)]);
      expect(types(events)).toEqual(["start", "chunk"]);
      expect(chunk(events).audio.length).toBe(75 * FRAME);
      expect(chunk(events).forced).toBe(false);
      expect(segmenter.pending()?.length).toBe(10 * FRAME);
    });

    it("doesn't cut at a pause before 2 s have built up", () => {
      const events = feed(new Segmenter(quiet), [...repeat(0.9, 30), ...repeat(0.2, 5), ...repeat(0.9, 10)]);
      expect(types(events)).toEqual(["start"]);
    });

    it("cuts at the quietest moment of the last 2 s when there is no pause by 6 s", () => {
      const probabilities = repeat(0.9, 200);
      probabilities[150] = 0.4;
      const segmenter = new Segmenter(quiet);
      const events = feed(segmenter, probabilities);
      expect(types(events)).toEqual(["start", "chunk"]);
      // 6 s is 188 frames; the cut falls after the quiet frame.
      expect(chunk(events).audio.length).toBe(151 * FRAME);
      expect(chunk(events).forced).toBe(true);
      expect(segmenter.pending()?.length).toBe(49 * FRAME);
    });

    it("ends with the whole turn and the part after the last cut", () => {
      const events = feed(new Segmenter(quiet), [...repeat(0.9, 70), ...repeat(0.2, 5), ...repeat(0.9, 20), ...repeat(0.02, 19)]);
      expect(types(events)).toEqual(["start", "chunk", "end"]);
      // The trailing silence beyond 96 ms of padding is dropped from both.
      expect(end(events).audio.length).toBe((70 + 5 + 20 + 3) * FRAME);
      expect(end(events).tail.length).toBe((20 + 3) * FRAME);
    });

    it("ends with no tail when nothing was said after the last cut", () => {
      const events = feed(new Segmenter(quiet), [...repeat(0.9, 70), ...repeat(0.02, 19)]);
      expect(types(events)).toEqual(["start", "chunk", "end"]);
      expect(chunk(events).audio.length).toBe(75 * FRAME);
      expect(end(events).audio.length).toBe((70 + 3) * FRAME);
      expect(end(events).tail.length).toBe(0);
    });

    it("starts the next turn without the last turn's cuts", () => {
      const segmenter = new Segmenter(quiet);
      feed(segmenter, [...repeat(0.9, 70), ...repeat(0.02, 19)]);
      feed(segmenter, repeat(0.9, 20));
      expect(segmenter.pending()?.length).toBe(20 * FRAME);
    });
  });

  it("drops speech in progress on reset", () => {
    const segmenter = new Segmenter();
    feed(segmenter, repeat(0.9, 6));
    segmenter.reset();
    expect(feed(segmenter, repeat(0.02, 25))).toEqual([]);
  });
});
