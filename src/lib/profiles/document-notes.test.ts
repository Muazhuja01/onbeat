import { describe, expect, it } from "vitest";
import { buildDocumentMessages, parseDocumentNotes } from "./document-notes";

describe("document notes", () => {
  it("puts the document inside the prompt", () => {
    const msgs = buildDocumentMessages("I'm Maya.");
    expect(msgs.at(-1)?.content).toContain('"""\nI\'m Maya.\n"""');
  });

  it("keeps valid lines, checks kinds and drops the rest", () => {
    const out = [
      '{"kind": "about-me", "text": "I have ALS."}',
      "not json",
      '{"kind": "person", "name": "Sam", "text": "Sam is my barista."}',
      '{"kind": "secret", "text": "x"}',
      '{"kind": "routine", "text": ""}',
      "```",
      '  {"kind": "place", "name": "Home", "text": "' + "a".repeat(400) + '"}',
      '{"kind": "routine", "name": "ignored", "text": "Physio on Tuesdays."}',
    ].join("\n");
    const notes = parseDocumentNotes(out);
    expect(notes.map((n) => n.kind)).toEqual(["about-me", "person", "place", "routine"]);
    expect(notes[1]).toEqual({ kind: "person", name: "Sam", text: "Sam is my barista." });
    expect(notes[2].text).toHaveLength(300);
    expect(notes[3]).toEqual({ kind: "routine", text: "Physio on Tuesdays." });
  });

  it("stops at 40 notes", () => {
    const out = Array.from({ length: 50 }, (_, i) => `{"kind": "preference", "text": "Fact ${i}"}`).join("\n");
    expect(parseDocumentNotes(out)).toHaveLength(40);
  });
});
