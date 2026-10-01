import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerLike } from "@/lib/worker-like";
import type { VoiceWorkerMessage, VoiceWorkerRequest } from "./messages";
import { SpeakError, VoiceRouter, type RouterDeps } from "./router";

/** A 16-bit mono WAV with `n` samples. */
function wav(n = 4): ArrayBuffer {
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); text(8, "WAVE"); text(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, n * 2, true);
  return buf;
}

class FakeKokoro implements WorkerLike {
  sent: VoiceWorkerRequest[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown) { this.sent.push(m as VoiceWorkerRequest); }
  terminate() {}
  emit(m: VoiceWorkerMessage) { this.onmessage?.({ data: m } as MessageEvent); }
  gens() { return this.sent.filter((m): m is Extract<VoiceWorkerRequest, { type: "generate" }> => m.type === "generate"); }
}

function setUp(over: Partial<RouterDeps> = {}) {
  const kokoro = new FakeKokoro();
  let warmAnswer: (ok: boolean) => void = () => {};
  const warm = vi.fn(() => new Promise<boolean>((r) => (warmAnswer = r)));
  const speak = vi.fn<RouterDeps["speak"]>(async () => wav());
  const router = new VoiceRouter({ kokoro, speak, warm, ...over });
  const got: VoiceWorkerMessage[] = [];
  router.onmessage = (e) => got.push(e.data as VoiceWorkerMessage);
  const gen = (id: number, text: string, urgent = false) => router.postMessage({ type: "generate", id, text, voice: "m_gb_gentle", speed: 1, urgent });
  return { kokoro, warm, speak, router, got, gen, wake: (ok: boolean) => warmAnswer(ok) };
}
const types = (got: VoiceWorkerMessage[]) => got.map((m) => (m.type === "source" ? `source:${m.source}` : m.type));

describe("VoiceRouter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads Kokoro and wakes Chatterbox; ready once, when either is ready", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    expect(t.kokoro.sent).toEqual([{ type: "load" }]);
    expect(t.warm).toHaveBeenCalledTimes(1);
    t.kokoro.emit({ type: "progress", value: 40 });
    t.kokoro.emit({ type: "ready" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toEqual(["source:waking", "progress", "ready", "source:awake"]));
  });

  it("makes lines with Chatterbox once awake", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Hello", true);
    await vi.waitFor(() => expect(t.got.at(-1)).toMatchObject({ type: "audio", id: 1, sampleRate: 24000 }));
    expect(t.speak).toHaveBeenCalledWith({ text: "Hello", voice: "m_gb_gentle", speed: 1 }, expect.any(AbortSignal));
    expect(t.got.at(-1)).not.toHaveProperty("backup");
  });

  it("while waking, a line being said goes to Kokoro and prepared replies wait for Chatterbox", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.gen(1, "Now", true);
    t.gen(2, "Later");
    expect(t.kokoro.gens()).toEqual([{ type: "generate", id: 1, text: "Now", voice: "bm_george", speed: 1, urgent: true }]);
    t.kokoro.emit({ type: "audio", id: 1, samples: new Float32Array(2), sampleRate: 24000 });
    expect(t.got.at(-1)).toMatchObject({ type: "audio", id: 1, backup: true });
    expect(t.speak).not.toHaveBeenCalled();
    t.wake(true);
    await vi.waitFor(() => expect(t.speak).toHaveBeenCalledTimes(1));
    expect(t.speak.mock.calls[0][0]).toMatchObject({ text: "Later" });
  });

  it("a slow line being said goes to Kokoro after 6 s", async () => {
    const t = setUp({ speak: vi.fn((_r, signal: AbortSignal) => new Promise<ArrayBuffer>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Slow", true);
    await vi.advanceTimersByTimeAsync(5900);
    expect(t.kokoro.gens()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Slow"]);
  });

  it("two failed lines mean down; a wake call every 60 s brings it back", async () => {
    const t = setUp({ speak: vi.fn(async () => { throw new SpeakError(503); }) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "One", true);
    await vi.waitFor(() => expect(t.kokoro.gens()).toHaveLength(1));
    expect(types(t.got)).not.toContain("source:down");
    t.gen(2, "Two", true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:down"));
    t.gen(3, "Three");
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["One", "Two", "Three"]);
    expect(t.warm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.warm).toHaveBeenCalledTimes(2);
    t.wake(true);
    await vi.waitFor(() => expect(t.got.at(-1)).toEqual({ type: "source", source: "awake" }));
  });

  it("a retry wake call while down stays down until it succeeds", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.wake(false);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:down"));
    const before = t.got.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.warm).toHaveBeenCalledTimes(2);
    t.gen(1, "Prepared");
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Prepared"]);
    expect(types(t.got.slice(before))).not.toContain("source:waking");
    t.wake(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.got.slice(before).some((m) => m.type === "source")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.warm).toHaveBeenCalledTimes(3);
    t.wake(true);
    await vi.waitFor(() => expect(t.got.at(-1)).toEqual({ type: "source", source: "awake" }));
    expect(types(t.got.slice(before))).toEqual(["source:awake"]);
  });

  it("a 4xx answer or a line over 300 characters goes to Kokoro without counting toward down", async () => {
    const speak = vi.fn(async () => { throw new SpeakError(429); });
    const t = setUp({ speak });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    for (let i = 1; i <= 3; i++) t.gen(i, `Line ${i}`, true);
    t.gen(4, "x".repeat(301), true);
    await vi.waitFor(() => expect(t.kokoro.gens()).toHaveLength(4));
    expect(speak).toHaveBeenCalledTimes(3);
    expect(types(t.got)).not.toContain("source:down");
  });

  it("an empty clip from the server is a failed line, not silence", async () => {
    const t = setUp({ speak: vi.fn(async () => wav(0)) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Hi", true);
    await vi.waitFor(() => expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Hi"]));
    expect(t.got.some((m) => m.type === "audio" && m.id === 1)).toBe(false);
  });

  it("after 5 idle minutes, the next line wakes Chatterbox and is said by Kokoro meanwhile", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    await vi.advanceTimersByTimeAsync(300_001);
    t.gen(1, "Back again", true);
    expect(t.warm).toHaveBeenCalledTimes(2);
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Back again"]);
    expect(t.speak).not.toHaveBeenCalled();
  });

  it("with Kokoro failed and Chatterbox down, tells the engine no voice is available", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "error", message: "blocked" });
    expect(types(t.got)).not.toContain("error");
    t.wake(false);
    await vi.waitFor(() => expect(types(t.got)).toEqual(["source:waking", "source:down", "error"]));
    t.gen(1, "Hi", true);
    expect(t.got.at(-1)).toMatchObject({ type: "error", id: 1 });
  });

  it("a reply held while waking that becomes the line being said goes to Kokoro", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.gen(1, "Later");
    expect(t.kokoro.gens()).toHaveLength(0);
    t.router.postMessage({ type: "urgent", id: 1 });
    expect(t.kokoro.gens()).toEqual([{ type: "generate", id: 1, text: "Later", voice: "bm_george", speed: 1, urgent: true }]);
    // Already with Kokoro, or never seen: ignored.
    t.router.postMessage({ type: "urgent", id: 1 });
    t.router.postMessage({ type: "urgent", id: 99 });
    expect(t.kokoro.gens()).toHaveLength(1);
    expect(t.kokoro.sent.some((m) => (m.type as string) === "urgent")).toBe(false);
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    expect(t.speak).not.toHaveBeenCalled();
  });

  it("a reply in flight to Chatterbox that becomes the line being said goes to Kokoro 6 s later", async () => {
    const t = setUp({ speak: vi.fn((_r, signal: AbortSignal) => new Promise<ArrayBuffer>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Prepared");
    await vi.advanceTimersByTimeAsync(10_000);
    t.router.postMessage({ type: "urgent", id: 1 });
    await vi.advanceTimersByTimeAsync(5900);
    expect(t.kokoro.gens()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.kokoro.gens()).toEqual([{ type: "generate", id: 1, text: "Prepared", voice: "bm_george", speed: 1, urgent: true }]);
    expect(t.kokoro.sent.some((m) => (m.type as string) === "urgent")).toBe(false);
  });

  it("an in-flight reply that becomes urgent never waits longer than its first deadline", async () => {
    const t = setUp({ speak: vi.fn((_r, signal: AbortSignal) => new Promise<ArrayBuffer>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Prepared");
    await vi.advanceTimersByTimeAsync(22_000);
    t.router.postMessage({ type: "urgent", id: 1 });
    await vi.advanceTimersByTimeAsync(3100);
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Prepared"]);
  });

  it("ignores urgent for a line Chatterbox already made", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Done");
    await vi.waitFor(() => expect(t.got.at(-1)).toMatchObject({ type: "audio", id: 1 }));
    t.router.postMessage({ type: "urgent", id: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.kokoro.gens()).toHaveLength(0);
    expect(t.got.filter((m) => m.type === "audio" || m.type === "error")).toHaveLength(1);
  });

  it("works with no Kokoro at all", async () => {
    const t = setUp({ kokoro: null });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toEqual(["source:waking", "ready", "source:awake"]));
  });
});
