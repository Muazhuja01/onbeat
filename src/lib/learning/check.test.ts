import { describe, expect, it } from "vitest";
import { checkProposals } from "./check";
import type { LearnRequest, Proposal } from "./protocol";

const req: LearnRequest = {
  today: "2026-09-30",
  lines: [
    { id: "a", speaker: "partner", text: "Your physio moved to Thursdays, same time.", partnerName: "Leila" },
    { id: "b", speaker: "user", text: "My new carer Ana starts on Monday." },
    { id: "c", speaker: "partner", text: "The dentist can see you on Thursday at 3." },
    { id: "d", speaker: "partner", text: "Your haircut is tomorrow at 2." },
  ],
  notes: [
    { id: "me", kind: "about-me", text: "I'm Maya. I type to talk." },
    { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30." },
  ],
};

const add = (text: string, lineIds = ["b"], extra: Partial<Proposal> = {}): Proposal => ({ action: "add", kind: "routine", text, lineIds, ...extra });
const edit = (text: string, noteId = "physio", lineIds = ["a"]): Proposal => ({ action: "edit", kind: "routine", noteId, text, lineIds });

describe("checkProposals", () => {
  it("keeps a new note backed by its line", () => {
    const p = add("Ana is my new carer. She starts on Monday.", ["b"], { kind: "person", name: "Ana" });
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("keeps an edit backed by its line and the old note", () => {
    const p = edit("I have physio on Thursdays at 10:30.");
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("accepts a day turned into its full date", () => {
    const p = add("Dentist on Thursday 1 October at 3pm.", ["c"]);
    expect(checkProposals([p], req)).toEqual([p]);
    const short = add("Dentist on 1 October at 3pm.", ["c"]);
    expect(checkProposals([short], req)).toEqual([short]);
  });

  it("accepts tomorrow turned into its date", () => {
    const p = add("Haircut on Thursday 1 October at 2pm.", ["d"]);
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("drops a date the cited line doesn't name, or one outside the coming two weeks", () => {
    expect(checkProposals([add("Dentist on Friday 2 October at 3pm.", ["c"])], req)).toEqual([]);
    expect(checkProposals([add("Haircut on Friday 2 October at 2pm.", ["d"])], req)).toEqual([]);
    expect(checkProposals([add("Dentist on Thursday 22 October at 3pm.", ["c"])], req)).toEqual([]);
  });

  it("accepts an hour written with :00 when the line says the hour", () => {
    const words = { ...req, lines: [...req.lines, { id: "e", speaker: "partner" as const, text: "Your blood test is on Thursday at nine in the morning." }] };
    const p = add("Blood test on Thursday 1 October at 9:00 AM.", ["e"]);
    expect(checkProposals([p], words)).toEqual([p]);
    const digits = add("Dentist on Thursday at 3:00.", ["c"]);
    expect(checkProposals([digits], req)).toEqual([digits]);
    expect(checkProposals([add("Dentist on Thursday at 3:30.", ["c"])], req)).toEqual([]);
  });

  it("accepts the partner's name from the line", () => {
    const p = add("Leila told me my physio moved to Thursdays.", ["a"]);
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("drops an invented time or name, even a number that is also a day of the month", () => {
    expect(checkProposals([add("Dentist on Thursday at 4pm.", ["c"])], req)).toEqual([]);
    expect(checkProposals([add("Dentist on Thursday 1 October at 4pm.", ["c"])], req)).toEqual([]);
    expect(checkProposals([add("Anna is my new carer.", ["b"], { kind: "person", name: "Anna" })], req)).toEqual([]);
  });

  it("doesn't let a note borrow a detail from an unrelated sent note", () => {
    const moved = { ...req, lines: [...req.lines, { id: "f", speaker: "partner" as const, text: "My dentist moved to Friday." }] };
    expect(checkProposals([add("Dentist on Friday at 10:30.", ["f"])], moved)).toEqual([]);
    expect(checkProposals([edit("I have physio on Fridays at 10:30. I'm Maya.", "physio", ["f"])], moved)).toEqual([]);
  });

  it("drops a detail that is only in a line the proposal doesn't cite", () => {
    expect(checkProposals([add("My new carer Ana starts on Monday.", ["c"])], req)).toEqual([]);
  });

  it("drops a proposal citing a line that wasn't sent", () => {
    expect(checkProposals([add("Ana is my carer.", ["zzz"])], req)).toEqual([]);
    expect(checkProposals([add("Ana is my carer.", ["b", "zzz"])], req)).toEqual([]);
  });

  it("drops an edit of a note that wasn't sent, or one that changes nothing", () => {
    expect(checkProposals([edit("I have physio on Thursdays at 10:30.", "other")], req)).toEqual([]);
    expect(checkProposals([edit("I have physio on Tuesdays at 10:30!")], req)).toEqual([]);
  });

  it("drops a new note that repeats a note or an earlier proposal", () => {
    expect(checkProposals([add("I have physio on Tuesdays at 10:30", ["a"])], req)).toEqual([]);
    const first = add("Ana is my new carer.", ["b"]);
    expect(checkProposals([first, add("Ana is my new carer!", ["b"])], req)).toEqual([first]);
  });

  it("checks an edit as the kind of note it changes, so a name the model adds is checked too", () => {
    const people: LearnRequest = {
      ...req,
      lines: [{ id: "g", speaker: "partner", text: "Your carer comes in the afternoons now." }],
      notes: [{ id: "ana", kind: "person", text: "Ana: my carer, weekday mornings" }],
    };
    const wrongKind: Proposal = { action: "edit", kind: "routine", name: "Anna", noteId: "ana", text: "comes in the afternoons now", lineIds: ["g"] };
    expect(checkProposals([wrongKind], people)).toEqual([]);
    const [kept] = checkProposals([{ ...wrongKind, name: "Ana" }], people);
    expect(kept).toMatchObject({ kind: "person", name: "Ana" });
  });

  it("keeps only the first edit of a note", () => {
    const first = edit("I have physio on Thursdays at 10:30.");
    expect(checkProposals([first, edit("Physio moved to Thursdays at 10:30.")], req)).toEqual([first]);
  });

  it("never lets a new note carry a note id", () => {
    const [kept] = checkProposals([add("Ana is my new carer.", ["b"], { noteId: "physio" })], req);
    expect(kept).not.toHaveProperty("noteId");
  });
});
