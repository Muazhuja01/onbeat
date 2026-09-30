import { describe, expect, it } from "vitest";
import { buildLearnMessages, comingDays, dateLine, localIsoDate, longDate, parseProposals } from "./prompt";

describe("dates", () => {
  it("writes the user's local calendar date", () => {
    expect(localIsoDate(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
  });

  it("names days in full, across months and years", () => {
    expect(longDate("2026-09-30", 0, true)).toBe("Wednesday 30 September 2026");
    expect(longDate("2026-09-30", 1)).toBe("Thursday 1 October");
    expect(longDate("2026-12-31", 1)).toBe("Friday 1 January");
  });

  it("gives today and the next 14 days as parts", () => {
    const days = comingDays("2026-09-30");
    expect(days).toHaveLength(15);
    expect(days[0]).toEqual({ offset: 0, weekday: "Wednesday", day: 30, month: "September" });
    expect(days[14]).toEqual({ offset: 14, weekday: "Wednesday", day: 14, month: "October" });
  });

  it("lists today and the next 14 days", () => {
    const line = dateLine("2026-09-30");
    expect(line.startsWith("Today is Wednesday 30 September 2026. Coming days: Thursday 1 October, Friday 2 October,")).toBe(true);
    expect(line.endsWith("Wednesday 14 October.")).toBe(true);
  });
});

describe("buildLearnMessages", () => {
  it("shows ids, who said each line, the notes and the dates", () => {
    const [system, user] = buildLearnMessages({
      today: "2026-09-30",
      lines: [
        { id: "L1", speaker: "partner", text: "Your physio moved to Thursdays.", partnerName: "Leila", placeName: "Home" },
        { id: "L2", speaker: "user", text: "Thanks, noted." },
      ],
      notes: [{ id: "N1", kind: "routine", text: "I have physio on Tuesdays at 10:30." }],
    });
    expect(system.role).toBe("system");
    expect(user.content).toContain("L1 Leila (at Home): Your physio moved to Thursdays.");
    expect(user.content).toContain("L2 Me: Thanks, noted.");
    expect(user.content).toContain("N1 (routine): I have physio on Tuesdays at 10:30.");
    expect(user.content).toContain("Today is Wednesday 30 September 2026.");
  });

  it("steers facts about a known person or place into an edit, and keeps vague times as said", () => {
    const [, user] = buildLearnMessages({ today: "2026-09-30", lines: [{ id: "L1", speaker: "user", text: "Hi" }], notes: [] });
    expect(user.content).toContain("A fact about a person or place that has a note is a change to that note, not a new note.");
    expect(user.content).toContain('Write a date only when a line names the day (a weekday, today, tomorrow, or a date). Keep other time words as they were said ("end of the month").');
    expect(user.content).toContain("Leave out other people's news (a friend's holiday, a child starting school) unless it changes the person's own plans.");
    expect(user.content).toContain("Don't say what someone's job or role is unless a line or a note says it.");
  });

  it("says when there are no notes", () => {
    const [, user] = buildLearnMessages({ today: "2026-09-30", lines: [{ id: "L1", speaker: "user", text: "Hi" }], notes: [] });
    expect(user.content).toContain("(none)");
  });
});

describe("parseProposals", () => {
  it("reads one proposal per line", () => {
    const out = [
      '{"action": "add", "kind": "person", "name": "Ana", "text": "Ana is my new carer.", "lines": ["L1"]}',
      '{"action": "edit", "note": "N1", "kind": "routine", "text": "I have physio on Thursdays at 10:30.", "lines": ["L2"]}',
    ].join("\n");
    expect(parseProposals(out)).toEqual([
      { action: "add", kind: "person", name: "Ana", text: "Ana is my new carer.", lines: ["L1"] },
      { action: "edit", kind: "routine", note: "N1", text: "I have physio on Thursdays at 10:30.", lines: ["L2"] },
    ]);
  });

  it("reads pretty-printed, fenced output after some reasoning", () => {
    const out = 'Here are the notes:\n```json\n{\n  "action": "add",\n  "kind": "preference",\n  "text": "I like green tea.",\n  "lines": ["L3"]\n}\n```';
    expect(parseProposals(out)).toEqual([{ action: "add", kind: "preference", text: "I like green tea.", lines: ["L3"] }]);
  });

  it("skips anything malformed", () => {
    const out = [
      '{"action": "add", "kind": "friend", "text": "x", "lines": ["L1"]}',
      '{"action": "edit", "kind": "routine", "text": "no note id", "lines": ["L1"]}',
      '{"action": "add", "kind": "routine", "text": "no lines", "lines": []}',
      '{"action": "add", "kind": "routine", "text": "   ", "lines": ["L1"]}',
      `{"action": "add", "kind": "routine", "text": "${"x".repeat(301)}", "lines": ["L1"]}`,
      '{"action": "remove", "kind": "routine", "text": "x", "lines": ["L1"]}',
      "{not json}",
    ].join("\n");
    expect(parseProposals(out)).toEqual([]);
  });

  it("keeps at most five", () => {
    const one = '{"action": "add", "kind": "routine", "text": "x", "lines": ["L1"]}';
    expect(parseProposals(Array(7).fill(one).join("\n"))).toHaveLength(5);
  });
});
