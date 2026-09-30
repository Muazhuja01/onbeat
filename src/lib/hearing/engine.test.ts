import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerLike } from "@/lib/worker-like";
import { HearingEngine, type HearingDeps, type HearingStatus } from "./engine";
import type { HearingWorkerMessage } from "./messages";
import { MicError, type MicSource } from "./mic";

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: { type: string }[] = [];
  terminated = false;
  postMessage(m: unknown) {
    this.sent.push(m as { type: string });
  }
  terminate() {
    this.terminated = true;
  }
  /** The script failed to load, threw, or the browser killed the worker. */
  crash() {
    this.onerror?.({ message: "worker died" } as ErrorEvent);
  }
  reply(m: HearingWorkerMessage) {
    this.onmessage?.({ data: m } as MessageEvent);
  }
  count(type: string) {
    return this.sent.filter((m) => m.type === type).length;
  }
}

function setup(
  opts: { openMic?: HearingDeps["openMic"]; noWorker?: boolean; createWorker?: HearingDeps["createWorker"]; refineTurn?: HearingDeps["refineTurn"] } = {},
) {
  let worker = new FakeWorker();
  let feedMic: (samples: Float32Array, level: number) => void = () => {};
  let endMic: () => void = () => {};
  const micStop = vi.fn();
  const openMic =
    opts.openMic ??
    (async (onChunk: (samples: Float32Array, level: number) => void, onEnded: () => void): Promise<MicSource> => {
      feedMic = onChunk;
      endMic = onEnded;
      return { stop: micStop };
    });
  let t = 0;
  const createWorker =
    opts.createWorker ??
    (() => {
      if (opts.noWorker) return null;
      if (worker.terminated) worker = new FakeWorker();
      return worker;
    });
  const engine = new HearingEngine({ createWorker, openMic, model: "moonshine", now: () => t, refineTurn: opts.refineTurn });
  const statuses: HearingStatus[] = [];
  engine.on("status", (s) => statuses.push(s));
  return {
    engine,
    get worker() {
      return worker;
    },
    micStop,
    endMic: () => endMic(),
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

  it("shows an error, releases the mic and drops the worker when the worker dies while listening", async () => {
    const hearing = setup();
    const partials: string[] = [];
    hearing.engine.on("partial", (p) => partials.push(p));
    await hearing.engine.start();
    const first = hearing.worker;
    first.reply({ type: "ready" });
    first.reply({ type: "partial", text: "What size", ms: 50 });
    first.crash();
    expect(hearing.engine.status).toBe("error");
    expect(hearing.micStop).toHaveBeenCalled();
    expect(first.terminated).toBe(true);
    expect(partials).toEqual(["What size", ""]);

    // Listen again starts a new worker and loads the model again.
    await hearing.engine.start();
    expect(hearing.worker).not.toBe(first);
    expect(hearing.worker.count("load")).toBe(1);
    hearing.worker.reply({ type: "ready" });
    expect(hearing.engine.status).toBe("listening");
  });

  it("shows an error when the worker script fails while the model is loading", async () => {
    const hearing = setup();
    await hearing.engine.start();
    hearing.worker.crash();
    expect(hearing.engine.status).toBe("error");
    expect(hearing.micStop).toHaveBeenCalled();
  });

  it("closes a mic granted after the worker died during the permission prompt", async () => {
    let grant!: (m: MicSource) => void;
    const hearing = setup({ openMic: () => new Promise<MicSource>((r) => (grant = r)) });
    const started = hearing.engine.start();
    hearing.worker.crash();
    const stop = vi.fn();
    grant({ stop });
    await started;
    expect(stop).toHaveBeenCalled();
    expect(hearing.engine.status).toBe("error");
  });

  it("reports unavailable instead of rejecting when the worker can't be created", async () => {
    const hearing = setup({
      createWorker: () => {
        throw new Error("SecurityError");
      },
    });
    await expect(hearing.engine.start()).resolves.toBeUndefined();
    expect(hearing.engine.status).toBe("unavailable");
  });

  it("says the microphone stopped when its track ends, and can listen again", async () => {
    const hearing = setup();
    const partials: string[] = [];
    hearing.engine.on("partial", (p) => partials.push(p));
    await hearing.engine.start();
    hearing.worker.reply({ type: "ready" });
    hearing.worker.reply({ type: "partial", text: "What size", ms: 50 });
    hearing.endMic();
    expect(hearing.engine.status).toBe("interrupted");
    expect(hearing.micStop).toHaveBeenCalled();
    expect(partials).toEqual(["What size", ""]);
    expect(hearing.worker.count("reset")).toBe(1);

    await hearing.engine.start();
    expect(hearing.engine.status).toBe("listening");
  });

  it("ignores the end of a mic it already stopped", async () => {
    const hearing = setup();
    await hearing.engine.start();
    hearing.worker.reply({ type: "ready" });
    hearing.engine.stop();
    hearing.endMic();
    expect(hearing.engine.status).toBe("off");
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

describe("HearingEngine with cloud captions", () => {
  /** A cloud call the test answers by hand. */
  function manualCloud() {
    const calls: { audio: Float32Array; answer: (text: string | null) => void }[] = [];
    const refineTurn = vi.fn((audio: Float32Array) => new Promise<string | null>((answer) => calls.push({ audio, answer })));
    return { calls, refineTurn };
  }
  const audio = () => new Float32Array([0.1, 0.2]);
  const flush = () => new Promise((r) => setTimeout(r, 0));

  async function listening(refineTurn: HearingDeps["refineTurn"]) {
    const s = setup({ refineTurn });
    const events: string[] = [];
    s.engine.on("partial", (p) => events.push(`partial:${p}`));
    s.engine.on("turnEnd", (t) => events.push(`turn:${t.text}`));
    s.engine.on("speechStart", () => events.push("start"));
    await s.engine.start();
    s.worker.reply({ type: "ready" });
    return { ...s, events };
  }

  it("uses the cloud text for a finished turn", async () => {
    const cloud = manualCloud();
    const { worker, events } = await listening(cloud.refineTurn);
    worker.reply({ type: "partial", text: "Can I have your", ms: 50 });
    worker.reply({ type: "turnEnd", text: "Can I have your", endedAt: 1, ms: 50, audio: audio() });
    expect(events).toEqual(["partial:Can I have your"]);
    cloud.calls[0].answer("Can I have your name?");
    await flush();
    expect(events).toEqual(["partial:Can I have your", "turn:Can I have your name?"]);
    expect(Array.from(cloud.calls[0].audio)).toEqual([Math.fround(0.1), Math.fround(0.2)]);
  });

  it("keeps the in-browser text when the cloud has nothing, fails or is off", async () => {
    for (const refineTurn of [async () => null, async () => "  ", async () => Promise.reject(new Error("down"))]) {
      const { worker, events } = await listening(refineTurn);
      worker.reply({ type: "turnEnd", text: "What size?", endedAt: 1, ms: 50, audio: audio() });
      await flush();
      expect(events).toEqual(["turn:What size?"]);
    }
  });

  it("holds the next turn's events until the refined turn is out, in order", async () => {
    const cloud = manualCloud();
    const { worker, events } = await listening(cloud.refineTurn);
    worker.reply({ type: "turnEnd", text: "first", endedAt: 1, ms: 50, audio: audio() });
    worker.reply({ type: "speechStart" });
    worker.reply({ type: "partial", text: "sec", ms: 50 });
    worker.reply({ type: "turnEnd", text: "second", endedAt: 2, ms: 50, audio: audio() });
    expect(events).toEqual([]);
    cloud.calls[0].answer("First.");
    await flush();
    expect(events).toEqual(["turn:First.", "start", "partial:sec"]);
    cloud.calls[1].answer("Second.");
    await flush();
    expect(events).toEqual(["turn:First.", "start", "partial:sec", "turn:Second."]);
  });

  it("still shows a line the partner finished before the app started speaking", async () => {
    const cloud = manualCloud();
    const { engine, worker, events } = await listening(cloud.refineTurn);
    worker.reply({ type: "turnEnd", text: "What size?", endedAt: 1, ms: 50, audio: audio() });
    engine.pause();
    cloud.calls[0].answer("What size would you like?");
    await flush();
    expect(events).toEqual(["turn:What size would you like?"]);
  });

  it("drops a turn still being refined when listening stops", async () => {
    const cloud = manualCloud();
    const { engine, worker, events } = await listening(cloud.refineTurn);
    worker.reply({ type: "turnEnd", text: "What size?", endedAt: 1, ms: 50, audio: audio() });
    worker.reply({ type: "partial", text: "late", ms: 50 });
    engine.stop();
    cloud.calls[0].answer("What size would you like?");
    await flush();
    expect(events).toEqual([]);
  });

  it("doesn't call the cloud for a turn without audio", async () => {
    const cloud = manualCloud();
    const { worker, events } = await listening(cloud.refineTurn);
    worker.reply({ type: "turnEnd", text: "Hello.", endedAt: 1, ms: 50 });
    expect(cloud.refineTurn).not.toHaveBeenCalled();
    expect(events).toEqual(["turn:Hello."]);
  });
});
