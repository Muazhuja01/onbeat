import { describe, expect, it } from "vitest";
import { checkAssistProposals, unbackedRoles, withTypedTimes } from "./check";
import type { AssistProposal, AssistRequest } from "./protocol";

const req: AssistRequest = {
  job: "prepare",
  today: "2026-10-05",
  lines: [
    { id: "u1", speaker: "user", text: "I'd like to prepare for an appointment." },
    { id: "a1", speaker: "assistant", text: "Is it with Dr. Chen at 9:00 on Thursday?" },
    { id: "u2", speaker: "user", text: "Dr. Chen, Thursday at 10:00, about my blood pressure. I get dizzy in the mornings." },
  ],
  notes: [
    { id: "n1", kind: "about-me", text: "I'm Tom. I'm Deaf and I use ASL." },
    { id: "n2", kind: "person", text: "Dr. Chen at Lakeview Clinic is my family doctor." },
    { id: "n3", kind: "routine", text: "I pick up my blood pressure medication at Riverside Pharmacy every month." },
  ],
  phrases: [{ id: "q1", text: "Please write it down.", for: "Dr. Chen" }],
};

const keep = (p: AssistProposal) => checkAssistProposals([p], req);

describe("checkAssistProposals", () => {
  it("keeps a dated note backed by the user's line", () => {
    const p: AssistProposal = { action: "add", kind: "routine", text: "Thursday 8 October, 10:00: seeing Dr. Chen about my blood pressure.", lineIds: ["u2"] };
    expect(keep(p)).toEqual([p]);
  });

  it("drops a proposal citing the assistant's line", () => {
    expect(keep({ action: "add", kind: "routine", text: "Thursday 8 October, 9:00: seeing Dr. Chen.", lineIds: ["a1"] })).toEqual([]);
    expect(keep({ action: "phrase", text: "I get dizzy in the mornings.", lineIds: ["u2", "a1"] })).toEqual([]);
  });

  it("drops a time only the assistant said", () => {
    expect(keep({ action: "add", kind: "routine", text: "Thursday 8 October, 9:15: seeing Dr. Chen.", lineIds: ["u2"] })).toEqual([]);
  });

  it("keeps a removal of a sent note, drops one of a note that wasn't sent", () => {
    expect(keep({ action: "remove", noteId: "n3", lineIds: ["u2"] })).toHaveLength(1);
    expect(keep({ action: "remove", noteId: "n9", lineIds: ["u2"] })).toEqual([]);
  });

  it("drops a removal of a note that is also edited", () => {
    const out = checkAssistProposals(
      [
        { action: "edit", kind: "person", noteId: "n2", text: "Dr. Chen at Lakeview Clinic is my family doctor. I see him about my blood pressure.", lineIds: ["u2"] },
        { action: "remove", noteId: "n2", lineIds: ["u2"] },
      ],
      req,
    );
    expect(out.map((p) => p.action)).toEqual(["edit"]);
  });

  it("keeps a phrase whose names are in the chat or the notes", () => {
    expect(keep({ action: "phrase", text: "I get dizzy in the mornings.", for: "Dr. Chen", lineIds: ["u2"] })).toHaveLength(1);
    expect(keep({ action: "phrase", text: "I pick up my meds at Riverside Pharmacy.", lineIds: ["u2"] })).toHaveLength(1);
  });

  it("drops a phrase with a name or number from nowhere", () => {
    expect(keep({ action: "phrase", text: "I take 20 mg of Lisinopril.", lineIds: ["u2"] })).toEqual([]);
    expect(keep({ action: "phrase", text: "Hello.", for: "Dr. Patel", lineIds: ["u2"] })).toEqual([]);
  });

  it("drops a phrase that repeats a quick phrase or an earlier one", () => {
    expect(keep({ action: "phrase", text: "Please write it down.", lineIds: ["u2"] })).toEqual([]);
    const twice = checkAssistProposals(
      [
        { action: "phrase", text: "I get dizzy in the mornings.", lineIds: ["u2"] },
        { action: "phrase", text: "I get dizzy in the mornings", lineIds: ["u2"] },
      ],
      req,
    );
    expect(twice).toHaveLength(1);
  });

  it("checks a note's 24-hour time in the am/pm form its line typed", () => {
    expect(withTypedTimes("Wednesday 7 October, 14:00: Marco.", "Wednesday at 2 pm.")).toBe("Wednesday 7 October, 2:00 pm: Marco.");
    expect(withTypedTimes("16:30 or 09:00, not 17:00.", "4:30pm, or 9 a.m.")).toBe("4:30 pm or 9:00 am, not 17:00.");
    expect(withTypedTimes("00:00: midnight feed.", "At 12 am.")).toBe("12:00 am: midnight feed.");
    expect(withTypedTimes("Thursday 8 October, 10:00.", "Thursday at 10:00.")).toBe("Thursday 8 October, 10:00.");
  });

  it("doesn't let a line's pm time back the bare hour number elsewhere in a note", () => {
    const pm: AssistRequest = { ...req, lines: [...req.lines, { id: "u3", speaker: "user", text: "Dentist on Thursday at 2 pm." }] };
    const note = (text: string): AssistProposal => ({ action: "add", kind: "routine", text, lineIds: ["u3"] });
    expect(checkAssistProposals([note("Thursday 8 October, 14:00: dentist.")], pm)).toHaveLength(1);
    expect(checkAssistProposals([note("Thursday 8 October, 14:00: dentist in room 14.")], pm)).toEqual([]);
    expect(checkAssistProposals([note("Thursday 8 October, 2 pm: dentist. I take 14 mg of it.")], pm)).toEqual([]);
    const am: AssistRequest = { ...req, lines: [...req.lines, { id: "u3", speaker: "user", text: "Feed the baby on Thursday at 12 am." }] };
    expect(checkAssistProposals([note("Thursday 8 October, 0:00: feed the baby, bottle 0.")], am)).toEqual([]);
  });

  it("keeps a dated note in 24-hour time for a line's pm time, and drops a different hour", () => {
    const pm: AssistRequest = { ...req, lines: [...req.lines, { id: "u3", speaker: "user", text: "Marco, Wednesday at 2 pm." }] };
    const p: AssistProposal = { action: "add", kind: "routine", text: "Wednesday 7 October, 14:00: meeting with Marco.", lineIds: ["u3"] };
    expect(checkAssistProposals([p], pm)).toEqual([p]);
    expect(checkAssistProposals([{ ...p, text: "Wednesday 7 October, 15:00: meeting with Marco." }], pm)).toEqual([]);
  });

  it("keeps a date past the coming two weeks when the line typed it, and nothing it didn't type", () => {
    const far: AssistRequest = { ...req, lines: [...req.lines, { id: "u3", speaker: "user", text: "Parent-teacher meeting at Hillside School, 3 November at 4pm." }] };
    const p: AssistProposal = { action: "add", kind: "routine", text: "3 November, 16:00: parent-teacher meeting at Hillside School.", lineIds: ["u3"] };
    expect(checkAssistProposals([p], far)).toEqual([p]);
    expect(checkAssistProposals([{ ...p, text: "4 November, 16:00: parent-teacher meeting at Hillside School." }], far)).toEqual([]);
    expect(checkAssistProposals([{ ...p, text: "Tuesday 3 November, 16:00: parent-teacher meeting at Hillside School." }], far)).toEqual([]);
    expect(checkAssistProposals([{ ...p, text: "3 November, 17:00: parent-teacher meeting at Hillside School." }], far)).toEqual([]);
  });

  describe("roles and relationships", () => {
    const say = (text: string): AssistRequest => ({ ...req, lines: [...req.lines, { id: "u3", speaker: "user", text }] });
    const person = (text: string): AssistProposal => ({ action: "add", kind: "person", text, lineIds: ["u3"] });

    it("drops a person note that gives someone a role they only named", () => {
      const r = say("It's with Dr. Ahmed on Tuesday.");
      expect(checkAssistProposals([person("Dr. Ahmed is my doctor.")], r)).toEqual([]);
      expect(checkAssistProposals([person("Dr. Ahmed: my new eye doctor.")], r)).toEqual([]);
      expect(checkAssistProposals([{ action: "add", kind: "routine", text: "Tuesday 6 October: seeing my doctor, Dr. Ahmed.", lineIds: ["u3"] }], r)).toEqual([]);
    });

    it("drops a relationship the person never typed", () => {
      const r = say("Ruth is walking Biscuit today.");
      expect(checkAssistProposals([person("Ruth is my neighbour.")], r)).toEqual([]);
      expect(checkAssistProposals([person("Ruth is my carer.")], r)).toEqual([]);
      expect(checkAssistProposals([person("Ruth is my best friend.")], r)).toEqual([]);
    });

    it("keeps a role the cited line states", () => {
      expect(checkAssistProposals([person("Dr. Chen is my doctor.")], say("my doctor Dr. Chen"))).toHaveLength(1);
      expect(checkAssistProposals([person("Ruth is my new neighbour.")], say("Ruth is my new neighbour."))).toHaveLength(1);
      expect(checkAssistProposals([person("Ruth is my neighbor.")], say("Ruth lives next door, she's my neighbour."))).toHaveLength(1);
      expect(checkAssistProposals([person("Dr. Ahmed is my doctor.")], say("Dr. Ahmed is my GP now."))).toHaveLength(1);
    });

    it("keeps a note that states only what was typed about someone", () => {
      const r = say("It's with Dr. Ahmed on Tuesday, a breathing check.");
      expect(checkAssistProposals([person("Dr. Ahmed: breathing check on Tuesday.")], r)).toHaveLength(1);
    });

    it("checks the role against the line that is cited, not another line", () => {
      const r: AssistRequest = { ...req, lines: [...req.lines, { id: "u3", speaker: "user", text: "Ruth has a spare key." }, { id: "u4", speaker: "user", text: "My neighbour is kind." }] };
      expect(checkAssistProposals([person("Ruth is my neighbour.")], r)).toEqual([]);
      expect(checkAssistProposals([{ ...person("Ruth is my neighbour."), lineIds: ["u3", "u4"] }], r)).toHaveLength(1);
    });

    it("lets an edit keep a role the note it changes already states", () => {
      const r = say("Dr. Chen moved to Elm Road Clinic.");
      const edit: AssistProposal = { action: "edit", kind: "person", noteId: "n2", text: "Dr. Chen at Elm Road Clinic is my family doctor.", lineIds: ["u3"] };
      expect(checkAssistProposals([edit], r)).toEqual([edit]);
      expect(checkAssistProposals([{ ...edit, text: "Dr. Chen at Elm Road Clinic is my family doctor and my neighbour." }], r)).toEqual([]);
    });

    it("drops a phrase with a role no line or note states, and keeps one a note states", () => {
      const r = say("I want to ask Dr. Ahmed about my breathing.");
      expect(checkAssistProposals([{ action: "phrase", text: "Can my neighbour come in with me?", lineIds: ["u3"] }], r)).toEqual([]);
      expect(checkAssistProposals([{ action: "phrase", text: "Can you ask my doctor to call me?", lineIds: ["u3"] }], r)).toHaveLength(1);
      expect(checkAssistProposals([{ action: "phrase", text: "Can you check my breathing?", for: "Dr. Ahmed", lineIds: ["u3"] }], r)).toHaveLength(1);
    });

    it("doesn't read a role word after a preposition as a claim", () => {
      const r = say("I have a cleaning at the dentist on Friday.");
      expect(unbackedRoles("My appointment with the dentist.", "")).toEqual([]);
      expect(unbackedRoles("Ruth is my neighbour.", "Ruth")).toEqual(["my neighbour"]);
      expect(checkAssistProposals([{ action: "add", kind: "routine", text: "Friday 9 October: cleaning at my dentist.", lineIds: ["u3"] }], r)).toHaveLength(1);
    });
  });

  it("puts notes first, then removals, then phrases", () => {
    const out = checkAssistProposals(
      [
        { action: "phrase", text: "I get dizzy in the mornings.", lineIds: ["u2"] },
        { action: "remove", noteId: "n3", lineIds: ["u2"] },
        { action: "add", kind: "routine", text: "Thursday 8 October, 10:00: seeing Dr. Chen about my blood pressure.", lineIds: ["u2"] },
      ],
      req,
    );
    expect(out.map((p) => p.action)).toEqual(["add", "remove", "phrase"]);
  });
});
