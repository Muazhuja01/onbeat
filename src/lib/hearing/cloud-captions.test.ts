import { describe, expect, it, vi } from "vitest";
import { createCloudCaptions } from "./cloud-captions";

const audio = new Float32Array(1600);
const ok = (text: string) => vi.fn(async () => new Response(JSON.stringify({ text }), { status: 200 }));

describe("createCloudCaptions", () => {
  it("does nothing while the setting is off", async () => {
    const fetchImpl = ok("hi");
    const refine = createCloudCaptions({ enabled: () => false, fetchImpl });
    expect(await refine(audio)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the turn as WAV and returns the text", async () => {
    const fetchImpl = ok(" Can I have your name? ");
    const refine = createCloudCaptions({ enabled: () => true, fetchImpl });
    expect(await refine(audio)).toBe("Can I have your name?");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/transcribe");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("audio/wav");
    const body = init.body as Uint8Array;
    expect(new TextDecoder().decode(body.subarray(0, 4))).toBe("RIFF");
    expect(body.byteLength).toBe(44 + audio.length * 2);
  });

  it("after a failure, skips the cloud for a minute instead of making every turn wait", async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    const refine = createCloudCaptions({ enabled: () => true, fetchImpl, now: () => t });
    expect(await refine(audio)).toBeNull();
    t = 59_000;
    expect(await refine(audio)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 61_000;
    await refine(audio);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up on a slow answer", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")))),
    );
    const refine = createCloudCaptions({ enabled: () => true, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 });
    expect(await refine(audio)).toBeNull();
  });

  it("treats a reply without text as nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    expect(await createCloudCaptions({ enabled: () => true, fetchImpl })(audio)).toBeNull();
  });
});
