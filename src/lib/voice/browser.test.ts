import { afterEach, describe, expect, it, vi } from "vitest";
import { warmServer } from "./browser";

afterEach(() => vi.unstubAllGlobals());

describe("warmServer", () => {
  it("gives up after 60 s, so a stalled wake call counts as failed", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      ),
    );
    const ctrl = new AbortController();
    timeout.mockReturnValue(ctrl.signal);
    const result = warmServer();
    expect(timeout).toHaveBeenCalledWith(60_000);
    ctrl.abort();
    expect(await result).toBe(false);
    timeout.mockRestore();
  });

  it("is true when the server answers that it's ready", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect(await warmServer()).toBe(true);
  });
});
