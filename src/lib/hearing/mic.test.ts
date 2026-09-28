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

  it("tells the caller when the microphone stops on its own, but not when the caller stops it", async () => {
    const track = new EventTarget() as EventTarget & { stop: () => void };
    track.stop = vi.fn();
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    stubMic(() => Promise.resolve(stream));
    class FakeAudioContext extends EventTarget {
      sampleRate = SAMPLE_RATE;
      state = "running";
      audioWorklet = { addModule: () => Promise.resolve() };
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
      resume = () => Promise.resolve();
      close = vi.fn(() => {
        this.state = "closed";
        this.dispatchEvent(new Event("statechange"));
        return Promise.resolve();
      });
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        port = { onmessage: null };
        disconnect() {}
      },
    );

    const onEnded = vi.fn();
    await openMic(() => {}, onEnded);
    track.dispatchEvent(new Event("ended"));
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();

    const onEndedAgain = vi.fn();
    const mic = await openMic(() => {}, onEndedAgain);
    mic.stop();
    track.dispatchEvent(new Event("ended"));
    expect(onEndedAgain).not.toHaveBeenCalled();
  });

  it("tells the caller when the audio context closes or is interrupted by the system", async () => {
    const track = new EventTarget() as EventTarget & { stop: () => void };
    track.stop = vi.fn();
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    stubMic(() => Promise.resolve(stream));
    const contexts: (EventTarget & { state: string })[] = [];
    class FakeAudioContext extends EventTarget {
      sampleRate = SAMPLE_RATE;
      state = "running";
      audioWorklet = { addModule: () => Promise.resolve() };
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
      resume = () => Promise.resolve();
      close = vi.fn(() => Promise.resolve());
      constructor() {
        super();
        contexts.push(this);
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        port = { onmessage: null };
        disconnect() {}
      },
    );

    const onEnded = vi.fn();
    await openMic(() => {}, onEnded);
    contexts[0].state = "interrupted";
    contexts[0].dispatchEvent(new Event("statechange"));
    expect(onEnded).toHaveBeenCalledTimes(1);
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
