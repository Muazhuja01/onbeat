import { describe, expect, it } from "vitest";
import type { Note, Phrase } from "@/lib/types";
import { exportFileName, exportProfile, parseImport } from "./transfer";

const notes: Note[] = [
  { id: "cafe", kind: "place", text: "Blue Door Café: my café", entities: ["Blue Door Café"], updatedAt: 1 },
  { id: "me", kind: "about-me", text: "I'm Maya.", entities: ["Maya"], updatedAt: 1, pinned: true },
];
const phrases: Phrase[] = [{ id: "p1", text: "My usual.", context: { placeId: "cafe", timeOfDay: "morning" }, timesUsed: 3, lastUsed: 9 }];
const now = new Date("2026-09-29T20:00:00Z");

describe("export and import", () => {
  it("round-trips with fresh ids and remapped phrase places", () => {
    const back = parseImport(exportProfile("Maya", notes, phrases, now));
    expect(back?.name).toBe("Maya");
    expect(back?.notes.map((n) => n.text)).toEqual(notes.map((n) => n.text));
    expect(back?.notes[1].pinned).toBe(true);
    const cafe = back!.notes[0];
    expect(cafe.id).not.toBe("cafe");
    expect(back?.phrases[0].context.placeId).toBe(cafe.id);
    expect(back?.phrases[0].id).not.toBe("p1");
    expect(back?.phrases[0].timesUsed).toBe(3);
  });

  it("gives two imports of one file different ids", () => {
    const text = exportProfile("Maya", notes, phrases, now);
    expect(parseImport(text)!.notes[0].id).not.toBe(parseImport(text)!.notes[0].id);
  });

  it("refuses anything that isn't an OnBeat export", () => {
    expect(parseImport("not json")).toBeNull();
    expect(parseImport(JSON.stringify({ format: "other" }))).toBeNull();
    expect(parseImport(JSON.stringify({ format: "onbeat-profile", version: 1, exportedAt: "x", profile: { name: " " }, notes: [], phrases: [] }))).toBeNull();
    const bad = JSON.parse(exportProfile("Maya", notes, phrases, now));
    bad.notes[0].kind = "secret";
    expect(parseImport(JSON.stringify(bad))).toBeNull();
  });

  it("drops a phrase context that points at a note that isn't there", () => {
    const text = exportProfile("Maya", [], phrases, now);
    expect(parseImport(text)?.phrases[0].context.placeId).toBeUndefined();
  });

  it("names the file after the profile and date", () => {
    expect(exportFileName("Maya López", now)).toBe("onbeat-maya-lopez-2026-09-29.json");
    expect(exportFileName("!!!", now)).toBe("onbeat-profile-2026-09-29.json");
  });
});
