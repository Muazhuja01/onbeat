import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_RATE } from "./audio";
import { MicError, openMic } from "./mic";

function stubMic(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal("AudioWorkletNode", class {});
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("openMic", () => {
  it("reports a blocked permission as denied", async () => {
    stubMic(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
    await expect(openMic(() => {})).rejects.toMatchObject({ kind: "denied" });
  });

  it("reports a missing microphone as unavailable", async () => {
    stubMic(() => Promise.reject(new DOMException("Requested device not found", "NotFoundError")));
    await expect(openMic(() => {})).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("reports a browser without recording support as unavailable", async () => {
    const err = await openMic(() => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MicError);
    expect((err as MicError).kind).toBe("unavailable");
  });

  it("closes the AudioContext and stops every track when setup fails after the context is created", async () => {
    const trackStop = vi.fn();
    const stream = {
      getTracks: () => [{ stop: trackStop }, { stop: trackStop }],
    } as unknown as MediaStream;
    stubMic(() => Promise.resolve(stream));

    const closeSpy = vi.fn(() => Promise.resolve());
    class FakeAudioContext {
      sampleRate = SAMPLE_RATE;
      audioWorklet = { addModule: () => Promise.reject(new Error("no worklet")) };
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
      resume = vi.fn(() => Promise.resolve());
      close = closeSpy;
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const err = await openMic(() => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MicError);
    expect((err as MicError).kind).toBe("unavailable");
    expect(trackStop).toHaveBeenCalledTimes(2);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
