import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerLike } from "@/lib/worker-like";
import type { VoiceWorkerMessage, VoiceWorkerRequest } from "./messages";
import { SpeakError, VoiceRouter, splitLine, type RouterDeps } from "./router";

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
  /** Ids sent and not answered yet, oldest first, and the most there ever were at once. */
  open: number[] = [];
  maxOpen = 0;
  /** Answers each line by itself, a tick later. */
  auto = false;
  postMessage(m: unknown) {
    const msg = m as VoiceWorkerRequest;
    this.sent.push(msg);
    if (msg.type !== "generate") return;
    this.open.push(msg.id);
    this.maxOpen = Math.max(this.maxOpen, this.open.length);
    if (this.auto) queueMicrotask(() => this.answer(msg.id));
  }
  terminate() {}
  emit(m: VoiceWorkerMessage) {
    if ((m.type === "audio" || m.type === "error") && m.id !== undefined) this.open = this.open.filter((id) => id !== m.id);
    this.onmessage?.({ data: m } as MessageEvent);
  }
  /** Answers the oldest line Kokoro has, or the given one. */
  answer(id = this.open[0]) { this.emit({ type: "audio", id, samples: new Float32Array(2), sampleRate: 24000 }); }
  gens() { return this.sent.filter((m): m is Extract<VoiceWorkerRequest, { type: "generate" }> => m.type === "generate"); }
}

/** A speak whose answers the test gives. An abort rejects it unless `abortable` is false. */
function heldSpeak(abortable = true) {
  const calls: { text: string; resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void }[] = [];
  const speak = vi.fn<RouterDeps["speak"]>(
    (req, signal) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        calls.push({ text: req.text, resolve, reject });
        if (abortable) signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  return { speak, calls, texts: () => calls.map((c) => c.text) };
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
/** The line from the bug report: 495 characters, over the voice server's 300. */
const LONG =
  "I am a Computer Science student (graduating Dec 2026) specializing in Artificial Intelligence and Full-Stack Development. I focus on building real-world, LLM-powered applications using TypeScript, Next.js, and Python. Recently, I developed a RAG-powered conversation assistant for AAC users and a live AI flood-mapping platform that processes thousands of data points in real-time. I am actively seeking 2027 software engineering opportunities where I can contribute to scalable, impactful tech.";
const types = (got: VoiceWorkerMessage[]) => got.map((m) => (m.type === "source" ? `source:${m.source}` : m.type));
/** The ids answered with a clip or an error, in order. */
const answered = (got: VoiceWorkerMessage[]) => got.flatMap((m) => ((m.type === "audio" || m.type === "error") && m.id !== undefined ? [m.id] : []));
async function awake(t: ReturnType<typeof setUp>) {
  t.router.postMessage({ type: "load" });
  t.wake(true);
  await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
}

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
    t.kokoro.auto = true;
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

  it("a 4xx answer goes to Kokoro without counting toward down", async () => {
    const speak = vi.fn(async () => { throw new SpeakError(429); });
    const t = setUp({ speak });
    t.kokoro.auto = true;
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    for (let i = 1; i <= 3; i++) t.gen(i, `Line ${i}`, true);
    await vi.waitFor(() => expect(t.kokoro.gens()).toHaveLength(3));
    expect(speak).toHaveBeenCalledTimes(3);
    expect(types(t.got)).not.toContain("source:down");
  });

  it("a line over 300 characters is made by Chatterbox in parts split at sentences, each sent as soon as it is made", async () => {
    const held = heldSpeak();
    const t = setUp({ speak: held.speak });
    await awake(t);
    t.gen(1, LONG, true);
    const of = splitLine(LONG, 300).length;
    expect(of).toBeGreaterThan(1);
    for (let i = 0; i < of; i++) {
      await vi.waitFor(() => expect(held.calls).toHaveLength(i + 1));
      held.calls[i].resolve(wav());
      // Sent before the next part is asked for, so it can play while the rest is made.
      await vi.waitFor(() => expect(t.got.at(-1)).toMatchObject({ type: "audio", id: 1, sampleRate: 24000, part: { from: i, to: i + 1, of } }));
    }
    expect(held.texts().every((p) => p.length <= 300)).toBe(true);
    expect(held.texts().join(" ")).toBe(LONG);
    expect(t.got.filter((m) => m.type === "audio").every((m) => !("backup" in m))).toBe(true);
    expect(t.kokoro.gens()).toHaveLength(0);
  });

  it("a short line is still sent whole", async () => {
    const t = setUp();
    await awake(t);
    t.gen(1, "Large, please.", true);
    await vi.waitFor(() => expect(t.got.at(-1)).toMatchObject({ type: "audio", id: 1 }));
    expect(t.got.at(-1)).not.toHaveProperty("part");
  });

  it("makes the parts one after another, so a second cold server isn't started", async () => {
    const held = heldSpeak();
    const t = setUp({ speak: held.speak });
    await awake(t);
    t.gen(1, LONG, true);
    await vi.waitFor(() => expect(held.calls).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(held.calls).toHaveLength(1);
    held.calls[0].resolve(wav());
    await vi.waitFor(() => expect(held.calls).toHaveLength(2));
  });

  it("gives a long line the 6 s wait for each part", async () => {
    const held = heldSpeak();
    const t = setUp({ speak: held.speak });
    t.kokoro.auto = true;
    await awake(t);
    t.gen(1, LONG, true);
    const parts = splitLine(LONG, 300).length;
    await vi.advanceTimersByTimeAsync(6000 * parts - 100);
    expect(t.kokoro.gens()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.kokoro.gens().map((g) => g.text)).toEqual([LONG]);
  });

  it("when a long line's first part fails, the whole line goes to Kokoro once", async () => {
    const held = heldSpeak();
    const t = setUp({ speak: held.speak });
    t.kokoro.auto = true;
    await awake(t);
    t.gen(1, LONG, true);
    await vi.waitFor(() => expect(held.calls).toHaveLength(1));
    held.calls[0].reject(new SpeakError(503));
    await vi.waitFor(() => expect(answered(t.got)).toEqual([1]));
    expect(t.kokoro.gens().map((g) => g.text)).toEqual([LONG]);
    expect(t.got.find((m) => m.type === "audio")).toMatchObject({ backup: true });
    expect(t.got.find((m) => m.type === "audio")).not.toHaveProperty("part");
  });

  it("when a later part fails, only the rest goes to Kokoro, sent as the closing piece", async () => {
    const held = heldSpeak();
    const t = setUp({ speak: held.speak });
    t.kokoro.auto = true;
    await awake(t);
    t.gen(1, LONG, true);
    const parts = splitLine(LONG, 300);
    await vi.waitFor(() => expect(held.calls).toHaveLength(1));
    held.calls[0].resolve(wav());
    await vi.waitFor(() => expect(held.calls).toHaveLength(2));
    held.calls[1].reject(new SpeakError(503));
    await vi.waitFor(() => expect(answered(t.got)).toEqual([1, 1]));
    expect(t.kokoro.gens().map((g) => g.text)).toEqual([parts.slice(1).join(" ")]);
    const audio = t.got.filter((m) => m.type === "audio");
    expect(audio[0]).toMatchObject({ part: { from: 0, to: 1, of: parts.length } });
    expect(audio[0]).not.toHaveProperty("backup");
    expect(audio[1]).toMatchObject({ backup: true, part: { from: 1, to: parts.length, of: parts.length } });
  });

  it("when a later part fails and there is no backup, the line is answered with an error after its first piece", async () => {
    const held = heldSpeak();
    const t = setUp({ speak: held.speak, kokoro: null });
    await awake(t);
    t.gen(1, LONG, true);
    await vi.waitFor(() => expect(held.calls).toHaveLength(1));
    held.calls[0].resolve(wav());
    await vi.waitFor(() => expect(held.calls).toHaveLength(2));
    held.calls[1].reject(new SpeakError(503));
    await vi.waitFor(() => expect(t.got.filter((m) => m.type === "audio" || m.type === "error").map((m) => m.type)).toEqual(["audio", "error"]));
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

  it("keeps one prepared line at a time with Chatterbox; the others wait their turn", async () => {
    const s = heldSpeak();
    const t = setUp({ speak: s.speak });
    await awake(t);
    t.gen(1, "A");
    t.gen(2, "B");
    t.gen(3, "C");
    expect(s.texts()).toEqual(["A"]);
    s.calls[0].resolve(wav());
    await vi.waitFor(() => expect(s.texts()).toEqual(["A", "B"]));
    // A prepared line's wait starts when it is sent, not while it waits its turn.
    await vi.advanceTimersByTimeAsync(20_000);
    s.calls[1].resolve(wav());
    await vi.waitFor(() => expect(s.texts()).toEqual(["A", "B", "C"]));
    s.calls[2].resolve(wav());
    await vi.waitFor(() => expect(answered(t.got)).toEqual([1, 2, 3]));
    expect(t.got.filter((m) => m.type === "audio").every((m) => !("backup" in m))).toBe(true);
    expect(t.kokoro.gens()).toHaveLength(0);
  });

  it("a line being said goes to Chatterbox at once, not behind the prepared ones", async () => {
    const s = heldSpeak();
    const t = setUp({ speak: s.speak });
    await awake(t);
    t.gen(1, "A");
    t.gen(2, "B");
    t.gen(3, "C");
    t.gen(4, "Typed", true);
    expect(s.texts()).toEqual(["A", "Typed"]);
    s.calls[1].resolve(wav());
    await vi.waitFor(() => expect(answered(t.got)).toEqual([4]));
    // The prepared turn is still A's.
    expect(s.texts()).toEqual(["A", "Typed"]);
    s.calls[0].resolve(wav());
    await vi.waitFor(() => expect(s.texts()).toEqual(["A", "Typed", "B"]));
  });

  it("a waiting prepared line that becomes the line being said goes to Chatterbox at once, with the 6 s wait", async () => {
    const s = heldSpeak();
    const t = setUp({ speak: s.speak });
    await awake(t);
    t.gen(1, "A");
    t.gen(2, "B");
    t.gen(3, "C");
    t.router.postMessage({ type: "urgent", id: 3 });
    expect(s.texts()).toEqual(["A", "C"]);
    await vi.advanceTimersByTimeAsync(5900);
    expect(t.kokoro.gens()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.kokoro.gens()).toEqual([{ type: "generate", id: 3, text: "C", voice: "bm_george", speed: 1, urgent: true }]);
    s.calls[0].resolve(wav());
    await vi.waitFor(() => expect(s.texts()).toEqual(["A", "C", "B"]));
  });

  it("while down, Kokoro gets one line at a time, the line being said first", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.wake(false);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:down"));
    t.gen(1, "A");
    t.gen(2, "B");
    t.gen(3, "C");
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["A"]);
    t.gen(4, "Typed", true);
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["A"]);
    t.kokoro.answer();
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["A", "Typed"]);
    t.kokoro.answer();
    t.kokoro.answer();
    t.kokoro.answer();
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["A", "Typed", "B", "C"]);
    expect(t.kokoro.maxOpen).toBe(1);
    expect(answered(t.got)).toEqual([1, 4, 2, 3]);
  });

  it("a line waiting for Kokoro that becomes the line being said goes next", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.wake(false);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:down"));
    t.gen(1, "One");
    t.gen(2, "Two");
    t.gen(3, "Three");
    t.router.postMessage({ type: "urgent", id: 3 });
    t.kokoro.answer();
    expect(t.kokoro.gens().map((g) => [g.id, g.urgent])).toEqual([[1, false], [3, true]]);
    expect(t.kokoro.maxOpen).toBe(1);
  });

  it("prepared lines waiting for Chatterbox go to Kokoro when it goes down, each answered once", async () => {
    const s = heldSpeak();
    const t = setUp({ speak: s.speak });
    t.kokoro.auto = true;
    await awake(t);
    t.gen(1, "A");
    t.gen(2, "B");
    t.gen(3, "C");
    s.calls[0].reject(new SpeakError(503));
    await vi.waitFor(() => expect(s.texts()).toEqual(["A", "B"]));
    s.calls[1].reject(new SpeakError(503));
    await vi.waitFor(() => expect(answered(t.got)).toEqual([1, 2, 3]));
    expect(types(t.got)).toContain("source:down");
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["A", "B", "C"]);
    expect(s.speak).toHaveBeenCalledTimes(2);
    expect(t.kokoro.maxOpen).toBe(1);
  });

  it("prepared lines waiting for Chatterbox wait again while it wakes after idle, then go one at a time", async () => {
    const s = heldSpeak(false);
    const t = setUp({ speak: s.speak });
    await awake(t);
    t.gen(1, "A");
    t.gen(2, "B");
    await vi.advanceTimersByTimeAsync(300_001);
    t.gen(3, "C");
    expect(t.warm).toHaveBeenCalledTimes(2);
    expect(t.got.at(-1)).toEqual({ type: "source", source: "waking" });
    s.calls[0].resolve(wav());
    await vi.waitFor(() => expect(answered(t.got)).toEqual([1]));
    expect(s.texts()).toEqual(["A"]);
    t.wake(true);
    await vi.waitFor(() => expect(s.texts()).toEqual(["A", "B"]));
    s.calls[1].resolve(wav());
    await vi.waitFor(() => expect(s.texts()).toEqual(["A", "B", "C"]));
    s.calls[2].resolve(wav());
    await vi.waitFor(() => expect(answered(t.got)).toEqual([1, 2, 3]));
  });

  it("a line being said held while Kokoro loads goes to Kokoro once it is ready", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.gen(1, "Now", true);
    t.gen(2, "Later");
    expect(t.kokoro.gens()).toHaveLength(0);
    t.kokoro.emit({ type: "ready" });
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Now"]);
    t.wake(true);
    await vi.waitFor(() => expect(t.speak).toHaveBeenCalledTimes(1));
    expect(t.speak.mock.calls[0][0]).toMatchObject({ text: "Later" });
  });

  it("when Kokoro fails to load, each line it had is answered once", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.wake(false);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:down"));
    t.gen(1, "A");
    t.gen(2, "B");
    t.kokoro.emit({ type: "error", message: "blocked" });
    // The worker also fails the line it was making.
    t.kokoro.emit({ type: "error", id: 1, message: "blocked" });
    expect(answered(t.got)).toEqual([1, 2]);
    expect(t.kokoro.gens()).toHaveLength(1);
  });

  it("works with no Kokoro at all", async () => {
    const t = setUp({ kokoro: null });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toEqual(["source:waking", "ready", "source:awake"]));
  });
});

describe("splitLine", () => {
  it("keeps a line that fits whole", () => {
    expect(splitLine("Hello there. How are you?", 300)).toEqual(["Hello there. How are you?"]);
  });

  it("packs whole sentences into parts that fit", () => {
    expect(splitLine("One two. Three four. Five six.", 20)).toEqual(["One two. Three four.", "Five six."]);
  });

  it("splits a sentence too long for one part at a comma, then at a space", () => {
    expect(splitLine("alpha beta gamma, delta epsilon zeta", 20)).toEqual(["alpha beta gamma,", "delta epsilon zeta"]);
    expect(splitLine("alpha beta gamma delta epsilon", 12)).toEqual(["alpha beta", "gamma delta", "epsilon"]);
  });

  it("cuts a word longer than a part rather than going over", () => {
    const parts = splitLine("x".repeat(25), 10);
    expect(parts).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("never makes a part over the limit or an empty one, and loses no words", () => {
    const parts = splitLine(LONG, 300);
    expect(parts.every((p) => p.length > 0 && p.length <= 300)).toBe(true);
    expect(parts.join(" ")).toBe(LONG);
  });
});
