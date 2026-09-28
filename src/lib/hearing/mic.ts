import { levelOf, Resampler, SAMPLE_RATE } from "./audio";

export interface MicSource {
  stop(): void;
}

export type MicErrorKind = "denied" | "unavailable";

export class MicError extends Error {
  constructor(
    readonly kind: MicErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "MicError";
  }
}

/**
 * Opens the microphone and calls onChunk with 16 kHz mono samples and their level (0 to 1).
 * onEnded is called once if the microphone stops on its own: the device is unplugged, the
 * permission is revoked, or the system takes the audio (a phone call). It is not called after stop().
 */
export async function openMic(
  onChunk: (samples: Float32Array, level: number) => void,
  onEnded: () => void = () => {},
): Promise<MicSource> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
    throw new MicError("unavailable", "Recording needs a secure page and Web Audio support.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const kind = name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
    throw new MicError(kind, err instanceof Error ? err.message : String(err));
  }

  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch {
      // Firefox can't connect a microphone to a context running at another sample rate.
      await ctx.close();
      ctx = new AudioContext({ latencyHint: "interactive" });
      source = ctx.createMediaStreamSource(stream);
    }
    await ctx.audioWorklet.addModule("/hearing/capture-processor.js");
    const node = new AudioWorkletNode(ctx, "onbeat-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    const resampler = new Resampler(ctx.sampleRate);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const samples = resampler.push(e.data);
      onChunk(samples, levelOf(samples));
    };
    source.connect(node);
    await ctx.resume();
    const context = ctx;
    const tracks = stream.getAudioTracks();
    let stopped = false;
    const mic: MicSource = {
      stop() {
        if (stopped) return;
        stopped = true;
        tracks.forEach((t) => t.removeEventListener("ended", ended));
        context.removeEventListener("statechange", stateChanged);
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void context.close().catch(() => {});
      },
    };
    function ended() {
      if (stopped) return;
      mic.stop();
      onEnded();
    }
    function stateChanged() {
      // Safari reports "interrupted" when the system takes the audio, such as for a phone call.
      const state: string = context.state;
      if (state === "closed" || state === "interrupted") ended();
    }
    tracks.forEach((t) => t.addEventListener("ended", ended));
    context.addEventListener("statechange", stateChanged);
    return mic;
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    throw new MicError("unavailable", err instanceof Error ? err.message : String(err));
  }
}
