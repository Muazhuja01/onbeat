import { describe, expect, it } from "vitest";
import { FRAME } from "./audio";
import { LiveTranscriber } from "./live-transcriber";
import type { HearingWorkerMessage } from "./messages";

const repeat = (p: number, n: number) => Array<number>(n).fill(p);
/** A frame whose samples all hold its speech probability, so the fake VAD can read it back. */
const frame = (p: number) => new Float32Array(FRAME).fill(p);

/** Transcribes audio as "w<frames>", so tests can see which audio was read. */
function setup({ slow = false } = {}) {
  const posted: HearingWorkerMessage[] = [];
  const heard: number[] = [];
  const gates: (() => void)[] = [];
  const transcriber = new LiveTranscriber({
    vad: async (f) => f[0],
    transcribe: async (audio) => {
      heard.push(audio.length / FRAME);
      if (slow) await new Promise<void>((resolve) => gates.push(resolve));
      return { text: `w${audio.length / FRAME}`, ms: 5 };
    },
    post: (message) => posted.push(message),
  });
  const feed = (probabilities: number[], at = 0) => probabilities.forEach((p) => transcriber.push(frame(p), at));
  return { transcriber, posted, heard, gates, feed };
}

const texts = (posted: HearingWorkerMessage[], type: "partial" | "turnEnd") =>
  posted.flatMap((m) => (m.type === type ? [m.text] : []));

describe("LiveTranscriber", () => {
  it("reads each piece of a long turn once and joins them", async () => {
    const { transcriber, posted, heard, feed } = setup();
    feed([...repeat(0.9, 70), ...repeat(0.2, 5), ...repeat(0.9, 70), ...repeat(0.2, 5), ...repeat(0.9, 20)]);
    await transcriber.idle();
    // The live caption keeps the finished pieces and adds the one being spoken.
    expect(texts(posted, "partial")).toEqual(["w75 w75 w20"]);
    feed(repeat(0.02, 19));
    await transcriber.idle();
    expect(texts(posted, "turnEnd")).toEqual(["w75 w75 w23"]);
    // No single read is longer than a piece.
    expect(Math.max(...heard)).toBeLessThanOrEqual(75);
  });

  it("reads the newest audio after a slow read instead of catching up on old ones", async () => {
    const { transcriber, heard, gates, feed } = setup({ slow: true });
    feed(repeat(0.9, 20));
    await new Promise((r) => setTimeout(r));
    expect(heard).toEqual([20]);
    // Three seconds more speech arrive while that read is still running.
    feed(repeat(0.9, 94));
    gates.shift()!();
    await new Promise((r) => setTimeout(r));
    expect(heard).toEqual([20, 114]);
    gates.shift()!();
    await transcriber.idle();
  });

  it("sends the turn's audio, and when the last word ended", async () => {
    const { transcriber, posted, feed } = setup();
    feed([...repeat(0.9, 30), ...repeat(0.02, 19)], 10_000);
    await transcriber.idle();
    const end = posted.find((m) => m.type === "turnEnd") as Extract<HearingWorkerMessage, { type: "turnEnd" }>;
    expect(end.text).toBe("w33");
    expect(end.audio?.length).toBe(33 * FRAME);
    expect(end.endedAt).toBeCloseTo(10_000 - 608);
  });

  it("doesn't read a tail with no speech in it", async () => {
    const { transcriber, posted, heard, feed } = setup();
    feed([...repeat(0.9, 70), ...repeat(0.02, 19)]);
    await transcriber.idle();
    expect(texts(posted, "turnEnd")).toEqual(["w75"]);
    expect(heard.filter((n) => n === 0)).toEqual([]);
  });

  it("keeps a new turn's start behind the last turn's end", async () => {
    const { transcriber, posted, feed } = setup();
    feed([...repeat(0.9, 30), ...repeat(0.02, 19), ...repeat(0.9, 30), ...repeat(0.02, 19)]);
    await transcriber.idle();
    const order = posted.map((m) => m.type).filter((t) => t !== "partial");
    expect(order).toEqual(["speechStart", "turnEnd", "speechStart", "turnEnd"]);
    expect(texts(posted, "turnEnd")).toEqual(["w33", "w33"]);
  });

  it("drops work in progress on reset", async () => {
    const { transcriber, posted, gates, feed } = setup({ slow: true });
    feed(repeat(0.9, 20));
    await new Promise((r) => setTimeout(r));
    transcriber.reset();
    gates.shift()!();
    await transcriber.idle();
    expect(posted.filter((m) => m.type !== "speechStart")).toEqual([]);
  });

  it("keeps the live caption's words when a piece's own reading comes back with far fewer", async () => {
    // Real case: the model looped on a 6 s piece ("year 10, 10, 10, …") and was trimmed to "10,".
    const posted: HearingWorkerMessage[] = [];
    const transcriber = new LiveTranscriber({
      vad: async (f) => f[0],
      transcribe: async (audio) => ({ text: audio.length === 75 * FRAME ? "10," : "for eight years in and then the past", ms: 5 }),
      post: (message) => posted.push(message),
    });
    const feed = (probabilities: number[]) => probabilities.forEach((p) => transcriber.push(frame(p), 0));
    feed(repeat(0.9, 60));
    await transcriber.idle();
    expect(texts(posted, "partial")).toEqual(["for eight years in and then the past"]);
    feed([...repeat(0.9, 10), ...repeat(0.2, 5), ...repeat(0.02, 19)]);
    await transcriber.idle();
    expect(texts(posted, "turnEnd")).toEqual(["for eight years in and then the past"]);
  });

  it("still ends the turn with the pieces it has when a read fails", async () => {
    const posted: HearingWorkerMessage[] = [];
    const errors: string[] = [];
    let reads = 0;
    const transcriber = new LiveTranscriber({
      vad: async (f) => f[0],
      transcribe: async (audio) => {
        reads++;
        if (audio.length === 23 * FRAME) throw new Error("out of memory");
        return { text: `w${audio.length / FRAME}`, ms: 5 };
      },
      post: (message) => posted.push(message),
      onError: (context) => errors.push(context),
    });
    [...repeat(0.9, 70), ...repeat(0.2, 5), ...repeat(0.9, 20), ...repeat(0.02, 19)].forEach((p) => transcriber.push(frame(p), 0));
    await transcriber.idle();
    expect(reads).toBeGreaterThan(1);
    expect(texts(posted, "turnEnd")).toEqual(["w75"]);
    expect(errors).toContain("turnEnd");
  });
});
