// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError } from "@/lib/server/providers";
import { createRecordingCooldown, withRetry } from "./retry";

describe("createRecordingCooldown", () => {
  it("never reports cooling but remembers the last blocked ms", () => {
    const cooldown = createRecordingCooldown();
    expect(cooldown.lastBlockedMs).toBeNull();
    cooldown.block("groq", 1234);
    expect(cooldown.isCooling("groq")).toBe(false);
    expect(cooldown.lastBlockedMs).toBe(1234);
  });
});

describe("withRetry", () => {
  it("retries after a 429 and returns the second attempt's result", async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    const result = await withRetry(
      "maya-08",
      async (cooldown) => {
        calls++;
        if (calls === 1) {
          cooldown.block("groq", 5_000);
          throw new AllProvidersFailedError("groq: HTTP 429");
        }
        return "second attempt result";
      },
      { sleep, log: () => {} },
    );
    expect(result).toBe("second attempt result");
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it("waits the recorded Retry-After, capped at 60 s", async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    await withRetry(
      "maya-08",
      async (cooldown) => {
        calls++;
        if (calls === 1) {
          cooldown.block("groq", 120_000);
          throw new AllProvidersFailedError("groq: HTTP 429");
        }
        return "ok";
      },
      { sleep, log: () => {} },
    );
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it("gives up after 4 attempts and rethrows the last error", async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    await expect(
      withRetry(
        "maya-08",
        async (cooldown) => {
          calls++;
          cooldown.block("groq", 1_000);
          throw new AllProvidersFailedError("groq: HTTP 429");
        },
        { sleep, log: () => {} },
      ),
    ).rejects.toThrow("groq: HTTP 429");
    expect(calls).toBe(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('retries "fetch failed" only once over the whole scenario', async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    await expect(
      withRetry(
        "maya-08",
        async () => {
          calls++;
          throw new TypeError("fetch failed");
        },
        { sleep, log: () => {} },
      ),
    ).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it("does not retry a timeout or a non-429 HTTP error", async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    await expect(
      withRetry(
        "maya-08",
        async () => {
          calls++;
          throw new Error("provider stalled for 4000 ms");
        },
        { sleep, log: () => {} },
      ),
    ).rejects.toThrow("provider stalled for 4000 ms");
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("prints one line per retry", async () => {
    let calls = 0;
    const log = vi.fn();
    await withRetry(
      "maya-08",
      async (cooldown) => {
        calls++;
        if (calls === 1) {
          cooldown.block("groq", 30_000);
          throw new AllProvidersFailedError("groq: HTTP 429");
        }
        return "ok";
      },
      { sleep: vi.fn(async () => {}), log },
    );
    expect(log).toHaveBeenCalledWith("  maya-08: rate limited, retrying in 30 s (attempt 2 of 4)");
  });
});
