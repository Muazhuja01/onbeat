import { describe, expect, it } from "vitest";
import { voiceStatusText } from "./voice-status";

describe("voiceStatusText", () => {
  it("says what the voice is doing", () => {
    expect(voiceStatusText("loading", "waking", 10)).toBe("Waking your voice…");
    expect(voiceStatusText("natural", "waking", 100)).toBe("Waking your voice…");
    expect(voiceStatusText("natural", "awake", 100)).toBe("Your voice is ready.");
    expect(voiceStatusText("natural", "down", 100)).toBe("Using the backup voice.");
    expect(voiceStatusText("loading", "down", 40)).toBe("Getting the backup voice ready… 40%. The basic voice works in the meantime.");
    expect(voiceStatusText("basic", "down", 0)).toBe("Using the basic voice.");
  });
});
