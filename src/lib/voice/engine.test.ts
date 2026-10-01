import { describe, expect, it, vi } from "vitest";
import { VoiceEngine, type AudioOut, type BasicSpeech } from "./engine";
import type { VoiceWorkerMessage, VoiceWorkerRequest } from "./messages";
import type { WorkerLike } from "@/lib/worker-like";

class FakeWorker implements WorkerLike {
  sent: VoiceWorkerRequest[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown) {
    this.sent.push(m as VoiceWorkerRequest);
  }
  terminate() {}
  emit(m: VoiceWorkerMessage) {
    this.onmessage?.({ data: m } as MessageEvent);
  }
  lastGenerate() {
    return this.sent.filter((m) => m.type === "generate").at(-1) as Extract<VoiceWorkerRequest, { type: "generate" }>;
  }
}

function fakeAudio() {
  const played: number[] = [];
  let finish: (() => void) | null = null;
  const audio: AudioOut = {
    play: vi.fn((samples: Float32Array) => {
      played.push(samples.length);
      return new Promise<void>((r) => (finish = r));
    }),
    stop: vi.fn(() => finish?.()),
  };
  return { audio, played, finish: () => finish?.() };
}

function fakeBasic() {
  const spoken: string[] = [];
  const calls: [string, number][] = [];
  const basic: BasicSpeech = {
    speak: vi.fn(async (t: string, rate: number) => {
      spoken.push(t);
      calls.push([t, rate]);
    }),
    stop: vi.fn(),
  };
  return { basic, spoken, calls };
}

const deps = (worker: WorkerLike | null, audio: AudioOut, basic: BasicSpeech) => ({
  worker,
  audio,
  basic,
  voice: () => "af_heart",
  speed: () => 1,
  naturalWaitMs: 50,
});

describe("VoiceEngine", () => {
  it("uses the basic voice while loading", async () => {
    const w = new FakeWorker();
    const { audio } = fakeAudio();
    const { basic, spoken } = fakeBasic();
    const v = new VoiceEngine(deps(w, audio, basic));
    v.load();
    await v.speak("Hello");
    expect(spoken).toEqual(["Hello"]);
    expect(v.mode).toBe("loading");
  });

  it("switches to basic when there is no worker or loading fails", () => {
    const { audio } = fakeAudio();
    const { basic } = fakeBasic();
    const none = new VoiceEngine(deps(null, audio, basic));
    none.load();
    expect(none.mode).toBe("basic");

    const w = new FakeWorker();
    const modes: string[] = [];
    const v = new VoiceEngine(deps(w, audio, basic));
    v.on("mode", (m) => modes.push(m));
    v.load();
    w.emit({ type: "error", message: "download failed" });
    expect(v.mode).toBe("basic");
    expect(modes).toEqual(["basic"]);
  });

  it("prepares audio once and plays it from cache", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    v.load();
    w.emit({ type: "ready" });
    v.prepare("Large, please.");
    v.prepare("Large, please.");
    expect(w.sent.filter((m) => m.type === "generate")).toHaveLength(1);
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(10), sampleRate: 24000 });
    const done = v.speak("Large, please.");
    await vi.waitFor(() => expect(a.played).toEqual([10]));
    a.finish();
    await done;
  });

  it("uses the device voice and says so when the chosen voice takes too long", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic, spoken } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    const fellBack: string[] = [];
    v.on("fallback", (t) => fellBack.push(t));
    v.load();
    w.emit({ type: "ready" });
    await v.speak("Slow one");
    expect(spoken).toEqual(["Slow one"]);
    expect(fellBack).toEqual(["Slow one"]);
  });

  it("uses the device voice and says so when the clip fails", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic, spoken } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000 });
    const fellBack: string[] = [];
    v.on("fallback", (t) => fellBack.push(t));
    v.load();
    w.emit({ type: "ready" });
    const done = v.speak("Broken");
    w.emit({ type: "error", id: w.lastGenerate().id, message: "boom" });
    await done;
    expect(spoken).toEqual(["Broken"]);
    expect(fellBack).toEqual(["Broken"]);
  });

  it("waits for the chosen voice instead of using the device voice, and says it is waiting", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000 });
    const waiting: boolean[] = [];
    v.on("waiting", (on) => waiting.push(on));
    v.load();
    w.emit({ type: "ready" });
    const done = v.speak("Take your time");
    await new Promise((r) => setTimeout(r, 120));
    expect(basic.speak).not.toHaveBeenCalled();
    expect(waiting).toEqual([true]);
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(6), sampleRate: 24000 });
    await vi.waitFor(() => expect(a.played).toEqual([6]));
    expect(waiting).toEqual([true, false]);
    a.finish();
    await done;
    expect(basic.speak).not.toHaveBeenCalled();
  });

  it("doesn't say it is waiting when the clip is already made", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    const waiting: boolean[] = [];
    v.on("waiting", (on) => waiting.push(on));
    v.load();
    w.emit({ type: "ready" });
    v.prepare("Ready");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(3), sampleRate: 24000 });
    const done = v.speak("Ready");
    await vi.waitFor(() => expect(a.played).toEqual([3]));
    a.finish();
    await done;
    expect(waiting).toEqual([]);
  });

  it("makes one clip at a time, and a line being said goes ahead of replies still waiting", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000 });
    v.load();
    w.emit({ type: "ready" });
    const texts = () => w.sent.flatMap((m) => (m.type === "generate" ? [m.text] : []));
    v.prepareReplies(["A", "B", "C"]);
    expect(texts()).toEqual(["A"]);
    const done = v.speak("Typed");
    expect(texts()).toEqual(["A"]);
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(texts()).toEqual(["A", "Typed"]);
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(2), sampleRate: 24000 });
    await vi.waitFor(() => expect(a.played).toEqual([2]));
    expect(texts()).toEqual(["A", "Typed", "B"]);
    a.finish();
    await done;
  });

  it("a tapped reply that is waiting its turn moves to the front", () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000 });
    v.load();
    w.emit({ type: "ready" });
    const texts = () => w.sent.flatMap((m) => (m.type === "generate" ? [m.text] : []));
    v.prepareReplies(["A", "B", "C"]);
    void v.speak("C");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(texts()).toEqual(["A", "C"]);
  });

  it("new replies drop the old ones not made yet", () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    v.load();
    w.emit({ type: "ready" });
    const texts = () => w.sent.flatMap((m) => (m.type === "generate" ? [m.text] : []));
    v.prepareReplies(["A", "B"]);
    v.prepareReplies(["C", "A"]);
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(texts()).toEqual(["A", "C"]);
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(texts()).toEqual(["A", "C"]);
  });

  it("speaking again stops the previous utterance", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    v.load();
    w.emit({ type: "ready" });
    const events: string[] = [];
    v.on("start", (t) => events.push(`start:${t}`));
    v.on("end", (t) => events.push(`end:${t}`));
    v.prepare("One");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(5), sampleRate: 24000 });
    v.prepare("Two");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(7), sampleRate: 24000 });
    const first = v.speak("One");
    await vi.waitFor(() => expect(a.played).toEqual([5]));
    const second = v.speak("Two");
    await first;
    await vi.waitFor(() => expect(a.played).toEqual([5, 7]));
    a.finish();
    await second;
    expect(events).toEqual(["start:One", "end:One", "start:Two", "end:Two"]);
    expect(v.current).toBeNull();
  });

  it("stop ends the current utterance once", async () => {
    const { audio } = fakeAudio();
    const basic: BasicSpeech = { speak: () => new Promise(() => {}), stop: vi.fn() };
    const v = new VoiceEngine(deps(null, audio, basic));
    v.load();
    const ends: string[] = [];
    v.on("end", (t) => ends.push(t));
    void v.speak("Hello");
    v.stop();
    v.stop();
    expect(ends).toEqual(["Hello"]);
    expect(basic.stop).toHaveBeenCalled();
  });

  it("reports load progress", () => {
    const w = new FakeWorker();
    const { audio } = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, audio, basic));
    const progress: number[] = [];
    v.on("progress", (p) => progress.push(p));
    w.emit({ type: "progress", value: 42 });
    expect(progress).toEqual([42]);
  });

  it("keeps up to `parallel` lines in progress, the line being said first, and marks it urgent", () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000, parallel: 3 });
    v.load();
    w.emit({ type: "ready" });
    const gens = () => w.sent.filter((m): m is Extract<VoiceWorkerRequest, { type: "generate" }> => m.type === "generate");
    v.prepareReplies(["A", "B", "C", "D"]);
    expect(gens().map((g) => g.text)).toEqual(["A", "B", "C"]);
    expect(gens().every((g) => !g.urgent)).toBe(true);
    void v.speak("Typed");
    expect(gens().map((g) => g.text)).toEqual(["A", "B", "C"]);
    w.emit({ type: "audio", id: gens()[0].id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(gens().at(-1)).toMatchObject({ text: "Typed", urgent: true });
  });

  it("marks a tapped reply urgent even when it is already first in the queue, and keeps it", () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000, parallel: 3 });
    v.load();
    w.emit({ type: "ready" });
    const gens = () => w.sent.filter((m): m is Extract<VoiceWorkerRequest, { type: "generate" }> => m.type === "generate");
    v.prepareReplies(["A", "B", "C", "D"]);
    void v.speak("D");
    v.prepareReplies(["X", "Y"]);
    w.emit({ type: "audio", id: gens()[0].id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(gens().find((g) => g.text === "D")).toMatchObject({ urgent: true });
  });

  it("says when a reply came from the backup voice, but not while the backup is the only voice", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000 });
    const backups: string[] = [];
    v.on("backup", (t) => backups.push(t));
    v.load();
    w.emit({ type: "ready" });
    const first = v.speak("One");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000, backup: true });
    await vi.waitFor(() => expect(a.played).toEqual([1]));
    a.finish();
    await first;
    expect(backups).toEqual(["One"]);
    w.emit({ type: "source", source: "down" });
    const second = v.speak("Two");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000, backup: true });
    await vi.waitFor(() => expect(a.played).toEqual([1, 1]));
    a.finish();
    await second;
    expect(backups).toEqual(["One"]);
  });

  it("reports the source, and once Chatterbox is awake remakes replies that came from the backup", () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), parallel: 3 });
    const sources: string[] = [];
    v.on("source", (s) => sources.push(s));
    expect(v.source).toBe("waking");
    v.load();
    w.emit({ type: "ready" });
    v.prepareReplies(["A", "B"]);
    const [a1, b1] = w.sent.filter((m) => m.type === "generate") as Extract<VoiceWorkerRequest, { type: "generate" }>[];
    w.emit({ type: "audio", id: a1.id, samples: new Float32Array(1), sampleRate: 24000, backup: true });
    w.emit({ type: "audio", id: b1.id, samples: new Float32Array(1), sampleRate: 24000 });
    w.emit({ type: "source", source: "awake" });
    expect(sources).toEqual(["awake"]);
    expect(v.source).toBe("awake");
    const texts = w.sent.flatMap((m) => (m.type === "generate" ? [m.text] : []));
    expect(texts).toEqual(["A", "B", "A"]);
  });
});

describe("voices", () => {
  function natural(overrides: { voice?: () => string; speed?: () => number } = {}) {
    const worker = new FakeWorker();
    const a = fakeAudio();
    const b = fakeBasic();
    const engine = new VoiceEngine({ ...deps(worker, a.audio, b.basic), ...overrides });
    engine.load();
    worker.emit({ type: "ready" });
    const generated = () =>
      worker.sent.filter((m): m is Extract<VoiceWorkerRequest, { type: "generate" }> => m.type === "generate");
    return { engine, worker, audio: a, basic: b.basic, generated };
  }

  it("asks the worker for the current voice, and for a new one after a change", () => {
    let voice = "af_heart";
    const { engine, worker, generated } = natural({ voice: () => voice });
    void engine.speak("Hello");
    voice = "am_michael";
    void engine.speak("Hello");
    worker.emit({ type: "audio", id: generated()[0].id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(generated().map((m) => m.voice)).toEqual(["af_heart", "am_michael"]);
  });

  it("plays a sample in another voice without changing the current one", () => {
    const { engine, worker, generated } = natural({ voice: () => "af_heart", speed: () => 1 });
    void engine.sample("Hi, I'm Tom.", { voice: "am_michael", speed: 1.15 });
    void engine.speak("Next reply");
    worker.emit({ type: "audio", id: generated()[0].id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(generated().map((m) => [m.voice, m.speed])).toEqual([
      ["am_michael", 1.15],
      ["af_heart", 1],
    ]);
  });

  it("uses the sample's speed with the device voice", async () => {
    const { audio } = fakeAudio();
    const { basic, calls } = fakeBasic();
    const engine = new VoiceEngine(deps(null, audio, basic));
    engine.load();
    await engine.sample("Hi", { voice: "am_michael", speed: 0.85 });
    expect(calls.at(-1)).toEqual(["Hi", 0.85]);
  });

  it("a sample stops the reply that is speaking, and the next reply uses the current voice", async () => {
    const { engine, worker, audio, generated } = natural({ voice: () => "af_heart", speed: () => 1 });
    const ends: string[] = [];
    engine.on("end", (t) => ends.push(t));
    const reply = engine.speak("A reply");
    worker.emit({ type: "audio", id: generated()[0].id, samples: new Float32Array(5), sampleRate: 24000 });
    await vi.waitFor(() => expect(audio.played).toEqual([5]));
    void engine.sample("Hi, I'm Tom.", { voice: "am_michael", speed: 1.15 });
    await reply;
    expect(audio.audio.stop).toHaveBeenCalled();
    expect(ends).toEqual(["A reply"]);
    void engine.speak("Next reply");
    worker.emit({ type: "audio", id: generated()[1].id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(generated().map((m) => [m.voice, m.speed])).toEqual([
      ["af_heart", 1],
      ["am_michael", 1.15],
      ["af_heart", 1],
    ]);
  });

  it("a sample waits past the reply wait for its clip, plays it, and is not a reply", async () => {
    const { engine, worker, audio, basic, generated } = natural();
    const events: string[] = [];
    engine.on("start", (t) => events.push(`start:${t}`));
    engine.on("end", (t) => events.push(`end:${t}`));
    engine.on("sampleStart", () => events.push("sampleStart"));
    engine.on("sampleEnd", () => events.push("sampleEnd"));
    const done = engine.sample("Hi, I'm Tom.", { voice: "am_michael", speed: 1 });
    // Well past naturalWaitMs (50 ms here): a reply would have used the device voice by now.
    await new Promise((r) => setTimeout(r, 150));
    expect(basic.speak).not.toHaveBeenCalled();
    worker.emit({ type: "audio", id: generated()[0].id, samples: new Float32Array(9), sampleRate: 24000 });
    await vi.waitFor(() => expect(audio.played).toEqual([9]));
    expect(engine.current).toBeNull();
    audio.finish();
    await done;
    expect(basic.speak).not.toHaveBeenCalled();
    expect(events).toEqual(["sampleStart", "sampleEnd"]);
  });

  it("a sample uses the device voice in basic mode, still without reply events", async () => {
    const { audio } = fakeAudio();
    const { basic, calls } = fakeBasic();
    const engine = new VoiceEngine(deps(null, audio, basic));
    engine.load();
    const events: string[] = [];
    engine.on("start", (t) => events.push(`start:${t}`));
    engine.on("end", (t) => events.push(`end:${t}`));
    await engine.sample("Hi", { voice: "am_michael", speed: 1.15 });
    expect(calls).toEqual([["Hi", 1.15]]);
    expect(events).toEqual([]);
  });

  it("a sample uses the device voice when its clip fails", async () => {
    const { engine, worker, basic, generated } = natural();
    const done = engine.sample("Hi", { voice: "am_michael", speed: 1 });
    worker.emit({ type: "error", id: generated()[0].id, message: "no voice file" });
    await done;
    expect(basic.speak).toHaveBeenCalledWith("Hi", 1);
  });

  it("speaking while a sample is being prepared cancels the sample", async () => {
    const { engine, worker, audio, generated } = natural();
    const ends: string[] = [];
    engine.on("sampleEnd", () => ends.push("sample"));
    const sample = engine.sample("Hi, I'm Tom.", { voice: "am_michael", speed: 1 });
    const reply = engine.speak("A reply");
    expect(ends).toEqual(["sample"]);
    // The sample's clip arrives late and is not played over the reply.
    worker.emit({ type: "audio", id: generated()[0].id, samples: new Float32Array(9), sampleRate: 24000 });
    worker.emit({ type: "audio", id: generated()[1].id, samples: new Float32Array(4), sampleRate: 24000 });
    await vi.waitFor(() => expect(audio.played).toEqual([4]));
    await sample;
    expect(audio.played).toEqual([4]);
    audio.finish();
    await reply;
  });
});
