import { describe, expect, it } from "vitest";
import { aboutMeText, buildNote, guessEntities, noteFields, NOTE_MAX, setupNotes } from "./notes";

describe("guessEntities", () => {
  it("finds names, joined when they run together, and skips ordinary words", () => {
    expect(guessEntities("My usual order at Blue Door Café is a latte. Leila is my daughter.")).toEqual(["Blue Door Café", "Leila"]);
    expect(guessEntities("I have physio on Tuesdays. The bus is slow.")).toEqual(["Tuesdays"]);
    expect(guessEntities("i like tea")).toEqual([]);
  });
});

describe("buildNote and noteFields", () => {
  it("puts a person's name first and reads it back", () => {
    const note = buildNote({ kind: "person", name: "Sam", text: "the barista at Blue Door Café" }, { now: 7, id: "n1" });
    expect(note).toMatchObject({ id: "n1", kind: "person", text: "Sam: the barista at Blue Door Café", updatedAt: 7 });
    expect(note.entities).toEqual(["Sam", "Blue Door Café"]);
    expect(noteFields(note)).toEqual({ name: "Sam", text: "the barista at Blue Door Café" });
  });

  it("keeps a description that already names the person as it is", () => {
    const note = buildNote({ kind: "person", name: "Sam", text: "Sam is the barista." }, { now: 1 });
    expect(note.text).toBe("Sam is the barista.");
    expect(noteFields(note)).toEqual({ name: "Sam", text: "Sam is the barista." });
  });

  it("cuts text to the note limit and trims it", () => {
    const note = buildNote({ kind: "routine", text: `  ${"a".repeat(400)}  ` }, { now: 1 });
    expect(note.text).toHaveLength(NOTE_MAX);
    expect(note.id).toMatch(/^n_/);
    expect(note.pinned).toBeUndefined();
  });
});

describe("aboutMeText", () => {
  it("adds the name when the text doesn't mention it", () => {
    expect(aboutMeText("Maya", "I have ALS and type to talk.")).toBe("I'm Maya. I have ALS and type to talk.");
    expect(aboutMeText("Maya", "I'm Maya, I type to talk.")).toBe("I'm Maya, I type to talk.");
    expect(aboutMeText("Maya", "  ")).toBe("I'm Maya.");
  });
});

describe("setupNotes", () => {
  it("makes one pinned about-me note first, then the drafts unpinned", () => {
    const notes = setupNotes(
      {
        name: "Maya",
        about: "I type to talk.",
        drafts: [
          { kind: "about-me", text: "I love mystery novels." },
          { kind: "place", name: "Home", text: "my flat" },
        ],
      },
      3,
    );
    expect(notes.map((n) => [n.kind, n.pinned ?? false])).toEqual([
      ["about-me", true],
      ["about-me", false],
      ["place", false],
    ]);
    expect(notes[0].text).toBe("I'm Maya. I type to talk.");
  });
});
