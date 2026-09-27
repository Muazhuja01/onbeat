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
  const basic: BasicSpeech = { speak: vi.fn(async (t: string) => void spoken.push(t)), stop: vi.fn() };
  return { basic, spoken };
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
