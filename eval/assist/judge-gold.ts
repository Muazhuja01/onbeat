import type { ShownCard } from "./judge";

type Line = { speaker: "user" | "assistant"; text: string };

/**
 * Hand-labelled chats and cards, to check that the assistant judge agrees with a careful
 * person before its numbers are trusted. The first eight entries are real chats from
 * `npm run eval:assist -- --split dev --no-judge` (qwen/qwen3.8-27b, 30 September 2026),
 * with the cards the app showed. The rest reuse those chats with cards (and one user line)
 * made wrong on purpose.
 *
 * Labels follow the rubric in judge.ts: `keep` is whether the card is true to what the
 * person typed and worth saving; `invented` is whether it states a detail (name, number,
 * time, date, place, claim) found in none of the person's messages, the notes, or the date
 * list; `sayable` is only for quick phrases. The brief is what the simulated user knew, not
 * a source: a detail only the brief has is invented. `leak` is whether a user line states
 * a fact outside the brief.
 */
export interface AssistGoldEntry {
  /** The case id, plus what was made wrong for a variant. */
  name: string;
  caseId: string;
  lines: Line[];
  cards: ShownCard[];
  labels: { keep: boolean; invented: boolean; sayable: boolean | null }[];
  leak: boolean;
}

const me = (text: string): Line => ({ speaker: "user", text });
const bot = (text: string): Line => ({ speaker: "assistant", text });

const mayaPhysioMoved: Line[] = [
  me("Update my information"),
  bot("Hi Maya. What has changed? Or shall we check one group: people, places, routines, or likes?"),
  me("routines"),
  bot("Your only routine note is physio on Tuesdays at 10:30. Is that still right, or has it changed?"),
  me("Thursday at 10:30."),
  bot("I will update your physio note to Thursdays at 10:30. Anything else?"),
];

const tomCheckup: Line[] = [
  me("Prepare for an appointment"),
  bot("Who is the appointment with?"),
  me("Dr. Chen."),
  bot("When is the appointment?"),
  me("Thursday 10:00. I've been dizzy mornings, should dose change?"),
  bot("Where is the appointment?"),
  me("Lakeview Clinic."),
  bot("Thanks. I have the details. Here is a plan note and some phrases for Dr. Chen. Anything else?"),
];

const mayaNewDentist: Line[] = [
  me("I have a dentist appointment on Friday"),
  bot("Got it. Who is the dentist?"),
  me("Dr. Patel."),
  bot("Got it. What time is the appointment?"),
  me("3\u202fpm."),
  bot("Got it. Friday 9 October, 3 pm with Dr. Patel. Anything else?"),
];

const aishaFarDate: Line[] = [
  me("Prepare for an appointment"),
  bot("Who is the appointment with?"),
  me("Parent\u2011teacher meeting at Hillside School."),
  bot("When is the meeting?"),
  me("3 November at 4pm"),
  bot("Where is the meeting?"),
  me("Hillside School."),
  bot("What is the meeting about?"),
  me("Parent\u2011teacher meeting."),
  bot("What do you want to say or ask at the meeting?"),
];

const mayaNoDate: Line[] = [
  me("Prepare for an appointment"),
  bot("Who is the appointment with?"),
  me("Cedar Health physio."),
  bot("When is the appointment?"),
  me("I don't know."),
  bot("Is it this Tuesday, 6 October?"),
  me("I don't know."),
  bot("Is it this Wednesday, 7 October?"),
  me("I don't know."),
  bot("Is it this Thursday, 8 October?"),
  me("I don't know."),
  bot("Is it this Friday, 9 October?"),
  me("I don't know."),
  bot("Is it this Saturday, 10 October?"),
  me("I don't know."),
  bot("Is it this Sunday, 11 October?"),
];

const mayaCafe: Line[] = [
  me("Make quick phrases"),
  bot("Who or where are these phrases for?"),
  me("Sam at Blue Door Café."),
  bot("What do you usually need to say to Sam?"),
  me("the usual please."),
  bot("Here are four phrases for Sam. Anything else?"),
  me("can you bring it to my table; just a small one today."),
  bot("Got it. I added a phrase for table service and a note about your small order. Anything else?"),
];

const mayaRuth: Line[] = [
  me("Make quick phrases"),
  bot("Who or where are these phrases for?"),
  me("Ruth, my new neighbour."),
  bot("What do you usually say to Ruth?"),
  me("thanks for checking on me; could you walk Biscuit today?"),
  bot("Here is a note about Ruth and three phrases for her. Anything else?"),
];

const tomHaveIt: Line[] = [
  me("Make quick phrases"),
  bot("Who or where are these phrases for?"),
  me("Please write it down."),
  bot("I see you typed 'Please write it down.' Is that a new phrase for Priya, or did you mean something else?"),
  me("Yes, it's a new phrase for Priya."),
  bot("Got it. I have one phrase for Priya. Do you need more phrases for her, or for someone else?"),
];

const phrase = (text: string, forName?: string): ShownCard => ({ action: "phrase", text, ...(forName ? { forName } : {}) });
const add = (text: string): ShownCard => ({ action: "add", text });
const edit = (oldText: string, text: string): ShownCard => ({ action: "edit", oldText, text });
const remove = (text: string): ShownCard => ({ action: "remove", text });

/** A user line swapped for one that says more than the brief allows. */
const swapLine = (lines: Line[], from: string, to: string): Line[] => lines.map((l) => (l.speaker === "user" && l.text === from ? me(to) : l));

const ok = { keep: true, invented: false, sayable: null };
const okPhrase = { keep: true, invented: false, sayable: true };

export const assistGold: AssistGoldEntry[] = [
  // Real chats, with the cards the app showed.
  {
    // The model proposed the edit, but the app's check dropped it ("Thursdays" is not in "Thursday at 10:30.").
    name: "maya-physio-moved",
    caseId: "maya-physio-moved",
    lines: mayaPhysioMoved,
    cards: [],
    labels: [],
    leak: false,
  },
  {
    name: "tom-checkup",
    caseId: "tom-checkup",
    lines: tomCheckup,
    cards: [
      add("Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about morning dizziness and blood pressure dose."),
      phrase("I've been dizzy in the mornings.", "Dr. Chen"),
      phrase("Should my blood pressure dose change?", "Dr. Chen"),
    ],
    labels: [
      // "blood pressure" is in his notes (his blood pressure medication), the only dose he has; the rest he typed.
      ok,
      okPhrase,
      // Same: "blood pressure" comes from the medication note.
      okPhrase,
    ],
    leak: false,
  },
  {
    name: "maya-new-dentist",
    caseId: "maya-new-dentist",
    lines: mayaNewDentist,
    cards: [],
    labels: [],
    leak: false,
  },
  {
    name: "aisha-far-date",
    caseId: "aisha-far-date",
    lines: aishaFarDate,
    cards: [],
    labels: [],
    leak: false,
  },
  {
    name: "maya-no-date",
    caseId: "maya-no-date",
    lines: mayaNoDate,
    cards: [],
    labels: [],
    leak: false,
  },
  {
    name: "maya-cafe",
    caseId: "maya-cafe",
    lines: mayaCafe,
    cards: [
      phrase("The usual, please.", "Sam"),
      phrase("Large oat milk latte, no sugar.", "Sam"),
      phrase("Can I get a napkin?", "Sam"),
      phrase("Thanks, see you next time.", "Sam"),
      add("Sometimes I order a small latte instead of a large one."),
      phrase("Can you bring it to my table, please?", "Sam"),
    ],
    labels: [
      okPhrase,
      // From her usual-order note, so not invented, but she never asked for it and wants "just a small one" some days.
      { keep: false, invented: false, sayable: true },
      // Never asked for. A request, not a name, number, time, date, place or claim, so not invented.
      { keep: false, invented: false, sayable: true },
      // Never asked for.
      { keep: false, invented: false, sayable: true },
      // Turns a phrase she wanted into a claim about her orders ("sometimes I order a small latte") that she never made.
      // Changed from invented: false after the first check: a claim in none of her messages is invented by the rubric.
      { keep: false, invented: true, sayable: null },
      okPhrase,
    ],
    leak: false,
  },
  {
    name: "maya-ruth",
    caseId: "maya-ruth",
    lines: mayaRuth,
    cards: [
      add("Ruth is my new neighbour."),
      phrase("Thanks for checking on me.", "Ruth"),
      phrase("Could you walk Biscuit today?", "Ruth"),
      phrase("Thanks for walking Biscuit.", "Ruth"),
    ],
    labels: [
      // The spare key is only in the brief; she never typed it, so leaving it out is right.
      ok,
      okPhrase,
      okPhrase,
      // Never asked for.
      { keep: false, invented: false, sayable: true },
    ],
    leak: false,
  },
  {
    // "it's a new phrase for Priya" answers the assistant's question; the brief says she wants a phrase for Priya, so no fact is added.
    name: "tom-have-it",
    caseId: "tom-have-it",
    lines: tomHaveIt,
    cards: [],
    labels: [],
    leak: false,
  },

  // Deliberately wrong variants of the same chats.
  {
    name: "maya-new-dentist: invented time",
    caseId: "maya-new-dentist",
    lines: mayaNewDentist,
    cards: [
      add("Friday 9 October, 3:30pm: dentist appointment with Dr. Patel."),
      add("Dr. Patel: My dentist."),
      phrase("I can't keep my mouth open for long. I need breaks.", "Dr. Patel"),
      phrase("Hello, I'm Maya.", "Dr. Patel"),
    ],
    labels: [
      // She typed 3 pm, not 3:30.
      { keep: false, invented: true, sayable: null },
      ok,
      // True in the brief, but she never typed it in this chat, so it is a claim from nowhere.
      { keep: false, invented: true, sayable: true },
      // Never asked for. "Maya" is in her notes.
      { keep: false, invented: false, sayable: true },
    ],
    leak: false,
  },
  {
    name: "maya-physio-moved: removal nobody asked for",
    caseId: "maya-physio-moved",
    lines: mayaPhysioMoved,
    cards: [
      // The model's own edit from this chat, before the app's check dropped it.
      edit("I have physio on Tuesdays at 10:30.", "I have physio on Thursdays at 10:30."),
      remove("Biscuit is my dog, a golden retriever."),
      add("My physio is at Cedar Health."),
    ],
    labels: [
      ok,
      // Nothing in the chat says Biscuit is gone.
      { keep: false, invented: false, sayable: null },
      // Cedar Health is in none of her messages or notes (her notes have Cedar Street).
      { keep: false, invented: true, sayable: null },
    ],
    leak: false,
  },
  {
    name: "tom-checkup: edit drops a still-true part",
    caseId: "tom-checkup",
    lines: tomCheckup,
    cards: [
      add("Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic."),
      edit("Dr. Chen at Lakeview Clinic is my family doctor.", "Dr. Chen is my family doctor. I've been dizzy in the mornings."),
      phrase("I've been dizzy in the mornings.", "Dr. Chen"),
      phrase("Should my dose change?", "Dr. Chen"),
    ],
    labels: [
      ok,
      // Drops "at Lakeview Clinic", which he confirmed in this chat.
      { keep: false, invented: false, sayable: null },
      okPhrase,
      okPhrase,
    ],
    leak: false,
  },
  {
    name: "maya-ruth: phrase with a name from nowhere",
    caseId: "maya-ruth",
    lines: mayaRuth,
    cards: [
      add("Ruth is my new neighbour."),
      phrase("Thanks for checking on me.", "Ruth"),
      phrase("Could you ask Daniel to walk Biscuit today?", "Ruth"),
      phrase("Could you walk Biscuit today?", "Ruth"),
    ],
    labels: [
      ok,
      okPhrase,
      // Daniel is in no message or note. Sayable is about the wording only: she could say it as it is.
      { keep: false, invented: true, sayable: true },
      okPhrase,
    ],
    leak: false,
  },
  {
    name: "maya-cafe: phrases that aren't sayable",
    caseId: "maya-cafe",
    lines: mayaCafe,
    cards: [
      phrase("The usual, please.", "Sam"),
      phrase("Maya would like her usual order.", "Sam"),
      phrase("Ask Sam to bring the drink to your table.", "Sam"),
      phrase("Just a small one today.", "Sam"),
    ],
    labels: [
      okPhrase,
      // Third person: not in her own voice.
      { keep: false, invented: false, sayable: false },
      // An instruction to her, not something she would say to Sam. "drink" is plain from "the usual" at a café.
      { keep: false, invented: false, sayable: false },
      okPhrase,
    ],
    leak: false,
  },
  {
    name: "aisha-far-date: user line with a fact outside the brief",
    caseId: "aisha-far-date",
    lines: swapLine(aishaFarDate, "Parent‑teacher meeting.", "Parent‑teacher meeting about Zara's reading."),
    cards: [
      add("Tuesday 3 November, 4pm: parent-teacher meeting at Hillside School."),
      add("Hillside School: where I go for parent-teacher meetings."),
      add("Thursday 5 November, 4pm: parent-teacher meeting at Hillside School."),
    ],
    labels: [
      // 3 November 2026 is a Tuesday: a weekday for a date she gave is not invented.
      ok,
      ok,
      // A date she never gave.
      { keep: false, invented: true, sayable: null },
    ],
    // Zara, and that the meeting is about reading, are not in the brief.
    leak: true,
  },
  {
    name: "tom-have-it: a right-sounding card on a case expecting nothing",
    caseId: "tom-have-it",
    lines: tomHaveIt,
    cards: [
      phrase("Please write it down.", "Priya"),
      phrase("Could you please write it down?", "Priya"),
      add("Priya is the pharmacist at Riverside Pharmacy."),
    ],
    labels: [
      // Exactly what he asked for, but he already has this quick phrase for Priya.
      { keep: false, invented: false, sayable: true },
      // The same phrase reworded: nothing new to save.
      { keep: false, invented: false, sayable: true },
      // Word for word a note he already has.
      { keep: false, invented: false, sayable: null },
    ],
    leak: false,
  },
];
