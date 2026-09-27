import { describe, expect, it } from "vitest";
import { contextLine, timeOfDay } from "./context";
import type { Note } from "./types";

const notes: Record<string, Note> = {
  cafe: { id: "cafe", kind: "place", text: "Blue Door Café is my local coffee shop.", entities: ["Blue Door Café"], updatedAt: 0 },
  sam: { id: "sam", kind: "person", text: "Sam is the barista.", entities: ["Sam"], updatedAt: 0 },
};
const get = (id: string) => notes[id];

describe("timeOfDay", () => {
  it.each([
    [5, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [16, "afternoon"],
    [17, "evening"],
    [21, "evening"],
    [22, "night"],
    [3, "night"],
  ] as const)("hour %i is %s", (hour, expected) => {
    expect(timeOfDay(new Date(2026, 8, 29, hour))).toBe(expected);
  });
});

describe("contextLine", () => {
  it("describes day, time, place and partner", () => {
    const line = contextLine({ now: new Date(2026, 8, 29, 8), placeId: "cafe", partnerId: "sam" }, get);
    expect(line).toBe("It is Tuesday morning. Place: Blue Door Café. Talking with: Sam.");
  });
  it("leaves out unknown place and partner", () => {
    expect(contextLine({ now: new Date(2026, 8, 29, 20) }, get)).toBe("It is Tuesday evening.");
  });
});
