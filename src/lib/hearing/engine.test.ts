import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerLike } from "@/lib/worker-like";
import { HearingEngine, type HearingDeps, type HearingStatus } from "./engine";
import type { HearingWorkerMessage } from "./messages";
import { MicError, type MicSource } from "./mic";

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  sent: { type: string }[] = [];
  postMessage(m: unknown) {
    this.sent.push(m as { type: string });
  }
  terminate() {}
  reply(m: HearingWorkerMessage) {
    this.onmessage?.({ data: m } as MessageEvent);
  }
  count(type: string) {
    return this.sent.filter((m) => m.type === type).length;
  }
}

function setup(opts: { openMic?: HearingDeps["openMic"]; noWorker?: boolean } = {}) {
  const worker = new FakeWorker();
  let feedMic: (samples: Float32Array, level: number) => void = () => {};
  const micStop = vi.fn();
  const openMic =
    opts.openMic ??
    (async (onChunk: (samples: Float32Array, level: number) => void): Promise<MicSource> => {
      feedMic = onChunk;
      return { stop: micStop };
    });
  let t = 0;
  const engine = new HearingEngine({ createWorker: () => (opts.noWorker ? null : worker), openMic, model: "moonshine", now: () => t });
  const statuses: HearingStatus[] = [];
  engine.on("status", (s) => statuses.push(s));
  return {
    engine,
    worker,
    micStop,
    statuses,
    feed: (level = 0.5) => feedMic(new Float32Array(4), level),
    advance: (ms: number) => void (t += ms),
  };
}

afterEach(() => vi.useRealTimers());

describe("HearingEngine", () => {
  it("loads the model and listens once the mic and the model are ready", async () => {
    const { engine, worker, statuses } = setup();
    await engine.start();
    expect(worker.sent[0]).toEqual({ type: "load", model: "moonshine" });
    expect(engine.status).toBe("loading");
    worker.reply({ type: "ready" });
    expect(statuses).toEqual(["loading", "listening"]);
  });

  it("sends audio to the worker only while listening", async () => {
    const { engine, worker, feed } = setup();
    await engine.start();
    feed();
    expect(worker.count("audio")).toBe(0);
    worker.reply({ type: "ready" });
    feed();
    expect(worker.count("audio")).toBe(1);
  });

  it("reports a blocked microphone", async () => {
    const { engine } = setup({ openMic: async () => Promise.reject(new MicError("denied", "no")) });
    await engine.start();
    expect(engine.status).toBe("denied");
  });

  it("reports unavailable without workers or a microphone", async () => {
    const noWorker = setup({ noWorker: true });
    await noWorker.engine.start();
    expect(noWorker.engine.status).toBe("unavailable");
    const noMic = setup({ openMic: async () => Promise.reject(new MicError("unavailable", "none")) });
    await noMic.engine.start();
    expect(noMic.engine.status).toBe("unavailable");
  });

  it("shows an error when the model fails to load, releases the mic, and can retry", async () => {
    const { engine, worker, micStop } = setup();
    await engine.start();
    worker.reply({ type: "error", message: "offline" });
    expect(engine.status).toBe("error");
    expect(micStop).toHaveBeenCalled();
    await engine.start();
    expect(worker.count("load")).toBe(2);
  });

  it("pauses while the app speaks and resumes after a tail", async () => {
    vi.useFakeTimers();
    const { engine, worker, feed } = setup();
    await engine.start();
    worker.reply({ type: "ready" });
    engine.pause();
    expect(worker.count("reset")).toBe(1);
    feed();
    expect(worker.count("audio")).toBe(0);
    engine.resume(400);
    vi.advanceTimersByTime(399);
    feed();
    expect(worker.count("audio")).toBe(0);
    vi.advanceTimersByTime(1);
    feed();
    expect(worker.count("audio")).toBe(1);
  });

  it("clears the live caption when paused, and ignores transcripts while paused", async () => {
    const { engine, worker } = setup();
    const partials: string[] = [];
    const turns: string[] = [];
    engine.on("partial", (p) => partials.push(p));
    engine.on("turnEnd", (t) => turns.push(t.text));
    await engine.start();
    worker.reply({ type: "ready" });
    worker.reply({ type: "partial", text: "What size", ms: 50 });
    engine.pause();
    worker.reply({ type: "partial", text: "What size would", ms: 50 });
    worker.reply({ type: "turnEnd", text: "What size would you like?", endedAt: 1, ms: 80 });
    expect(partials).toEqual(["What size", ""]);
    expect(turns).toEqual([]);
  });

  it("passes on turn ends, and an empty one only clears the live caption", async () => {
    const { engine, worker } = setup();
    const partials: string[] = [];
    const turns: { text: string; endedAt: number }[] = [];
    engine.on("partial", (p) => partials.push(p));
    engine.on("turnEnd", (t) => turns.push(t));
    await engine.start();
    worker.reply({ type: "ready" });
    worker.reply({ type: "partial", text: "Um", ms: 50 });
    worker.reply({ type: "turnEnd", text: "", endedAt: 5, ms: 50 });
    worker.reply({ type: "turnEnd", text: "Hello there.", endedAt: 9, ms: 50 });
    expect(partials).toEqual(["Um", ""]);
    expect(turns).toEqual([{ text: "Hello there.", endedAt: 9 }]);
  });

  it("ignores transcripts after stop and releases the mic", async () => {
    const { engine, worker, micStop } = setup();
    const partials: string[] = [];
    engine.on("partial", (p) => partials.push(p));
    await engine.start();
    worker.reply({ type: "ready" });
    engine.stop();
    worker.reply({ type: "partial", text: "late", ms: 10 });
    expect(partials).toEqual([]);
    expect(micStop).toHaveBeenCalled();
    expect(engine.status).toBe("off");
  });

  it("closes the mic when stopped while the browser was asking for permission", async () => {
    let grant!: (m: MicSource) => void;
    const { engine } = setup({ openMic: () => new Promise<MicSource>((r) => (grant = r)) });
    const started = engine.start();
    engine.stop();
    const stop = vi.fn();
    grant({ stop });
    await started;
    expect(stop).toHaveBeenCalled();
    expect(engine.status).toBe("off");
  });

  it("sends the level at most every 100 ms", async () => {
    const { engine, feed, advance } = setup();
    const levels: number[] = [];
    engine.on("level", (l) => levels.push(l));
    await engine.start();
    feed(0.2);
    advance(50);
    feed(0.3);
    advance(50);
    feed(0.4);
    expect(levels).toEqual([0.2, 0.4]);
  });
});
