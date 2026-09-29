/**
 * Hand labels for checking the judge. Each entry is a dev scenario and the replies a
 * saved run showed for it (copied verbatim from runs B0 and B2, dev set). `invented`
 * lists the 1-based replies that state something about the person, their life or the
 * situation that none of the sources back (notes sent, situation line, what the
 * partner said, typed text, saved phrases) beyond directly answering the partner, or
 * that contradict a source. Labelled from that definition before any judge saw them.
 */
export interface GoldEntry {
  id: string;
  candidates: string[];
  invented: number[];
  why: string;
}

export const judgeGold: GoldEntry[] = [
  {
    // B2, qwen
    id: "maya-04",
    candidates: ["No, just the coffee, please.", "No, I have physio at 10:30.", "Actually, I could use a muffin."],
    invented: [3],
    why: "3 wants a muffin; physio at 10:30 is in the notes",
  },
  {
    // B0, qwen
    id: "maya-05",
    candidates: ["To go, please.", "For here, thanks.", "To go, I have physio at 10:30."],
    invented: [],
    why: "all plain answers; choosing one of the partner's options, physio is in the notes",
  },
  {
    // B2, qwen
    id: "maya-07",
    candidates: ["She's doing really well.", "She's happy in Toronto.", "She's good, I think."],
    invented: [],
    why: "all plain answers; Toronto is in the notes",
  },
  {
    // B2, qwen
    id: "maya-09",
    candidates: ["I'm actually reading a good book.", "I'm enjoying it, thanks for asking.", "Not sure, maybe I'll check later."],
    invented: [1],
    why: "1 reading a good book (no books note is sent here)",
  },
  {
    // B2, qwen
    id: "maya-12",
    candidates: ["No, that's fine, thank you.", "No, I'm just picking up my usual.", "Let me check my bag first."],
    invented: [3],
    why: "3 a bag and a plan to check it",
  },
  {
    // B2, qwen
    id: "maya-14",
    candidates: ["Maya.", "Maya. I'm right here at the counter.", "Just Maya works for me."],
    invented: [2],
    why: "2 standing at the counter",
  },
  {
    // B2, qwen
    id: "maya-20",
    candidates: ["It's been busy, thanks for asking.", "I have physio today at ten-thirty.", "I'm doing well, honestly."],
    invented: [],
    why: "all plain answers; physio on Tuesdays at 10:30 is in the notes and it is Tuesday",
  },
  {
    // B0, gpt-oss-20b
    id: "tom-05",
    candidates: ["I'm allergic to penicillin.", "I only have one allergy, penicillin.", "I have no other allergies."],
    invented: [],
    why: "all plain answers; the penicillin allergy is in the notes",
  },
  {
    // B2, qwen
    id: "tom-06",
    candidates: ["Okay, I'll wait.", "Ten minutes is fine.", "I'll check my phone."],
    invented: [3],
    why: "3 a phone and a plan to check it",
  },
  {
    // B2, qwen
    id: "tom-08",
    candidates: ["No, I haven't had any side effects.", "It's been fine since I picked up my blood pressure medication.", "I need a moment to think about that."],
    invented: [],
    why: "all plain answers; the blood pressure medication is in the notes",
  },
  {
    // B0, qwen
    id: "tom-10",
    candidates: ["Yes, I can hear you fine.", "Yes, it is loud enough.", "Yes, I am listening."],
    invented: [1, 2, 3],
    why: "all three say Tom hears the partner; the pinned note says he is Deaf",
  },
  {
    // B0, qwen
    id: "tom-11",
    candidates: ["No, thank you, Priya.", "I have a bag with me.", "Just the medication, please."],
    invented: [2],
    why: "2 has a bag",
  },
  {
    // B0, gpt-oss-20b
    id: "tom-14",
    candidates: ["Yes, a text would be helpful.", "I prefer a reminder before my refill.", "Could you also text me the refill date?"],
    invented: [],
    why: "all plain answers; accepting the partner's offer and asking a question",
  },
  {
    // B0, qwen
    id: "tom-15",
    candidates: ["Okay, I can call Dr. Chen.", "Please call Lakeview Clinic for me.", "I don't have my phone with me."],
    invented: [1, 3],
    why: "1 a plan to phone the doctor himself (the partner said they would call); 3 no phone with him",
  },
  {
    // B0, gpt-oss-20b
    id: "tom-16",
    candidates: ["I need my blood pressure meds.", "I also need a refill for my prescription.", "I don't need anything else."],
    invented: [],
    why: "all plain answers; the monthly blood pressure medication is in the notes",
  },
  {
    // B0, qwen
    id: "tom-19",
    candidates: ["I'm feeling much better on the new dose.", "It's helping, but I still have some headaches.", "I'm not sure, but I feel a bit tired."],
    invented: [2, 3],
    why: "2 headaches; 3 feeling tired",
  },
  {
    // B0, qwen
    id: "aisha-01",
    candidates: ["Good morning, Marco.", "Doing well, thanks. Ready for the day.", "Just settling in at my desk."],
    invented: [3],
    why: "3 settling in at her desk",
  },
  {
    // B0, qwen
    id: "aisha-06",
    candidates: ["Sure, tomorrow works for me.", "That\u2019s fine, but I have a deadline.", "How about later today after stand-up?"],
    invented: [2],
    why: "2 a deadline (no Harbor note is sent here)",
  },
  {
    // B2, qwen
    id: "aisha-11",
    candidates: ["Yes, I saw it.", "Yes, just before stand-up.", "Let me check and get back to you."],
    invented: [2],
    why: "2 says when she read the email (just before stand-up)",
  },
  {
    // B0, gpt-oss-20b
    id: "aisha-15",
    candidates: ["Yes, I can cover Jen's review this afternoon.", "I\u2019ll be at the third floor office, ready after stand\u2011up.", "If anything changes, let me know before the meeting starts."],
    invented: [2],
    why: "2 adds a plan and time the partner did not raise (at the office, ready after stand-up)",
  },
];
