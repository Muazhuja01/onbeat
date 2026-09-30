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

  it("falls back to basic when the natural clip is too slow", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic, spoken } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    v.load();
    w.emit({ type: "ready" });
    await v.speak("Slow one");
    expect(spoken).toEqual(["Slow one"]);
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
    return { engine, worker, audio: a, generated };
  }

  it("asks the worker for the current voice, and for a new one after a change", () => {
    let voice = "af_heart";
    const { engine, generated } = natural({ voice: () => voice });
    void engine.speak("Hello");
    voice = "am_michael";
    void engine.speak("Hello");
    expect(generated().map((m) => m.voice)).toEqual(["af_heart", "am_michael"]);
  });

  it("plays a sample in another voice without changing the current one", () => {
    const { engine, generated } = natural({ voice: () => "af_heart", speed: () => 1 });
    void engine.speak("Hi, I'm Tom.", { voice: "am_michael", speed: 1.15 });
    void engine.speak("Next reply");
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
    await engine.speak("Hi", { voice: "am_michael", speed: 0.85 });
    expect(calls.at(-1)).toEqual(["Hi", 0.85]);
  });

  it("a sample stops the reply that is speaking, and the next reply uses the current voice", async () => {
    const { engine, worker, audio, generated } = natural({ voice: () => "af_heart", speed: () => 1 });
    const ends: string[] = [];
    engine.on("end", (t) => ends.push(t));
    const reply = engine.speak("A reply");
    worker.emit({ type: "audio", id: generated()[0].id, samples: new Float32Array(5), sampleRate: 24000 });
    await vi.waitFor(() => expect(audio.played).toEqual([5]));
    void engine.speak("Hi, I'm Tom.", { voice: "am_michael", speed: 1.15 });
    await reply;
    expect(audio.audio.stop).toHaveBeenCalled();
    expect(ends).toEqual(["A reply"]);
    void engine.speak("Next reply");
    expect(generated().map((m) => [m.voice, m.speed])).toEqual([
      ["af_heart", 1],
      ["am_michael", 1.15],
      ["af_heart", 1],
    ]);
  });
});
