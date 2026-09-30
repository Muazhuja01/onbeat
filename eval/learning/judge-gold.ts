import type { ShownSuggestion } from "./judge";

/**
 * Hand-labelled suggestions for dev scenarios, good and deliberately bad, to check that
 * the learning judge agrees with a careful person before its numbers are trusted.
 * `invented` is whether the suggestion states anything found in neither the conversation,
 * the notes, nor the coming dates. `matches` is the expected fact it records, if any.
 */
export interface LearnGoldEntry {
  scenarioId: string;
  shown: ShownSuggestion[];
  labels: { keep: boolean; invented: boolean; matches: number | null }[];
}

export const learnGold: LearnGoldEntry[] = [
  {
    scenarioId: "maya-edit-physio",
    shown: [
      { action: "edit", noteId: "m-physio", oldText: "I have physio on Tuesdays at 10:30.", text: "I have physio on Thursdays at 10:30." },
      { action: "add", text: "Physio on Thursdays at 11:30." },
    ],
    labels: [
      { keep: true, invented: false, matches: 1 },
      { keep: false, invented: true, matches: null },
    ],
  },
  {
    scenarioId: "aisha-cycles",
    shown: [{ action: "add", text: "I cycle to work along the canal. It takes about 20 minutes." }],
    labels: [{ keep: true, invented: false, matches: 1 }],
  },
  {
    scenarioId: "tom-blood-test",
    shown: [{ action: "add", text: "Blood test on Thursday 8 October at 9am." }],
    labels: [{ keep: true, invented: false, matches: 1 }],
  },
  {
    scenarioId: "maya-haircut-tomorrow",
    shown: [{ action: "add", text: "Haircut on Tuesday 6 October at 3pm." }],
    labels: [{ keep: false, invented: true, matches: null }],
  },
  {
    scenarioId: "maya-misheard-order",
    shown: [
      { action: "add", text: "My usual is a large all mund milk latte." },
      {
        action: "edit",
        noteId: "m-usual",
        oldText: "My usual order at Blue Door Café is a large oat milk latte, no sugar.",
        text: "My usual order at Blue Door Café is a large almond milk latte, no sugar.",
      },
    ],
    labels: [
      { keep: false, invented: false, matches: null },
      { keep: true, invented: false, matches: 1 },
    ],
  },
  {
    scenarioId: "maya-weather",
    shown: [{ action: "add", text: "I love sunny mornings." }],
    labels: [{ keep: false, invented: false, matches: null }],
  },
  {
    scenarioId: "tom-priya-son",
    shown: [{ action: "add", text: "Priya's son just started secondary school." }],
    labels: [{ keep: false, invented: false, matches: null }],
  },
  {
    scenarioId: "aisha-lunch-today",
    shown: [{ action: "add", text: "I eat lunch at 12:30 at the Thai place downstairs." }],
    labels: [{ keep: false, invented: false, matches: null }],
  },
  {
    scenarioId: "aisha-harbor-deadline",
    shown: [
      {
        action: "edit",
        noteId: "a-harbor",
        oldText: "I'm leading the Harbor app redesign, due on Friday.",
        text: "The Harbor app redesign is due at the end of the month.",
      },
    ],
    // True, but the change drops that Aisha leads the redesign, which is still true.
    labels: [{ keep: false, invented: false, matches: 1 }],
  },
  {
    scenarioId: "maya-vet",
    shown: [
      { action: "add", text: "Dr Patel is Biscuit's vet. He has a check-up every six months." },
      { action: "add", text: "Dr Patel's surgery is on Elm Street." },
    ],
    labels: [
      { keep: true, invented: false, matches: 1 },
      { keep: false, invented: true, matches: null },
    ],
  },
  {
    scenarioId: "tom-pharmacy-hours",
    shown: [
      {
        action: "edit",
        noteId: "t-pharmacy",
        oldText: "Riverside Pharmacy is where I pick up my prescriptions.",
        text: "Riverside Pharmacy is where I pick up my prescriptions. It closes at 6pm on Saturdays.",
      },
    ],
    labels: [{ keep: true, invented: false, matches: 1 }],
  },
  {
    scenarioId: "maya-mixed",
    shown: [
      { action: "edit", noteId: "m-physio", oldText: "I have physio on Tuesdays at 10:30.", text: "I have physio on Thursdays at 11." },
      { action: "add", text: "Ana is my new carer. She comes every morning." },
      { action: "add", text: "It is pouring with rain where Leila lives." },
    ],
    labels: [
      { keep: true, invented: false, matches: 1 },
      { keep: true, invented: false, matches: 2 },
      { keep: false, invented: false, matches: null },
    ],
  },
];
