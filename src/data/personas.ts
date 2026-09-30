import { DEFAULT_VOICE, type VoiceChoice } from "@/lib/voice/choices";
import type { Note, Phrase } from "@/lib/types";

export interface Persona {
  id: string;
  name: string;
  summary: string;
  defaultPlaceId: string;
  defaultPartnerId: string;
  notes: Note[];
  phrases: Phrase[];
  voice: VoiceChoice;
}

const n = (id: string, kind: Note["kind"], text: string, entities: string[] = [], extra: Partial<Note> = {}): Note => ({
  id,
  kind,
  text,
  entities,
  updatedAt: 0,
  ...extra,
});

const p = (id: string, text: string, timesUsed: number, placeId?: string, partnerId?: string): Phrase => ({
  id,
  text,
  context: { placeId, partnerId, timeOfDay: "morning" },
  timesUsed,
  lastUsed: 0,
});

export const personas: Persona[] = [
  {
    id: "maya",
    name: "Maya",
    summary: "Has ALS and hears fine. Ordering at her local café.",
    defaultPlaceId: "m-cafe",
    defaultPartnerId: "m-sam",
    notes: [
      n("m-me", "about-me", "I'm Maya. I have ALS, so I type to talk. I can hear fine.", ["Maya"], { pinned: true }),
      n("m-cafe", "place", "Blue Door Café is my local coffee shop, two blocks from home.", ["Blue Door Café"]),
      n("m-sam", "person", "Sam is the barista at Blue Door Café and knows my usual order.", ["Sam", "Blue Door Café"]),
      n("m-usual", "preference", "My usual order at Blue Door Café is a large oat milk latte, no sugar.", ["Blue Door Café"]),
      n("m-physio", "routine", "I have physio on Tuesdays at 10:30."),
      n("m-leila", "person", "Leila is my daughter. She studies at university in Toronto.", ["Leila", "Toronto"]),
      n("m-biscuit", "person", "Biscuit is my dog, a golden retriever.", ["Biscuit"]),
      n("m-books", "preference", "I love mystery novels, especially Agatha Christie.", ["Agatha Christie"]),
      n("m-home", "place", "Home is my apartment on Cedar Street.", ["Cedar Street"]),
    ],
    voice: DEFAULT_VOICE,
    phrases: [
      p("m-p1", "My usual, please.", 12, "m-cafe", "m-sam"),
      p("m-p2", "Could I get a large oat latte?", 6, "m-cafe"),
      p("m-p3", "Thanks Sam, have a good day.", 9, "m-cafe", "m-sam"),
      p("m-p4", "I'm doing well, thanks for asking.", 7),
      p("m-p5", "Give me a moment, I'm typing.", 5),
      p("m-p6", "Can I pay by card?", 4, "m-cafe"),
      p("m-p7", "Leila is doing great at school.", 3),
    ],
  },
  {
    id: "tom",
    name: "Tom",
    summary: "Deaf, uses ASL, and doesn't use his voice. Picking up a prescription.",
    defaultPlaceId: "t-pharmacy",
    defaultPartnerId: "t-priya",
    notes: [
      n("t-me", "about-me", "I'm Tom. I'm Deaf and I use ASL. I read captions to follow what people say.", ["Tom"], { pinned: true }),
      n("t-pharmacy", "place", "Riverside Pharmacy is where I pick up my prescriptions.", ["Riverside Pharmacy"]),
      n("t-priya", "person", "Priya is the pharmacist at Riverside Pharmacy.", ["Priya", "Riverside Pharmacy"]),
      n("t-meds", "routine", "I pick up my blood pressure medication at Riverside Pharmacy every month.", ["Riverside Pharmacy"]),
      n("t-allergy", "about-me", "I'm allergic to penicillin."),
      n("t-doctor", "person", "Dr. Chen at Lakeview Clinic is my family doctor.", ["Dr. Chen", "Lakeview Clinic"]),
      n("t-work", "about-me", "I work as a graphic designer."),
    ],
    voice: { gender: "male", accent: "american", style: "calm", speed: "normal" },
    phrases: [
      p("t-p1", "I'm here to pick up a prescription.", 10, "t-pharmacy"),
      p("t-p2", "Can you type that for me?", 8),
      p("t-p3", "Is it ready?", 6, "t-pharmacy"),
      p("t-p4", "Thank you, Priya.", 7, "t-pharmacy", "t-priya"),
      p("t-p5", "Please look at me when you speak.", 5),
      p("t-p6", "I'm allergic to penicillin.", 3),
    ],
  },
  {
    id: "aisha",
    name: "Aisha",
    summary: "Had a laryngectomy and types instead of speaking. At work.",
    defaultPlaceId: "a-office",
    defaultPartnerId: "a-marco",
    notes: [
      n("a-me", "about-me", "I'm Aisha. I had a laryngectomy, so I type instead of speaking.", ["Aisha"], { pinned: true }),
      n("a-office", "place", "The Northline Design office, third floor, is where I work.", ["Northline Design"]),
      n("a-marco", "person", "Marco is my manager at Northline Design.", ["Marco", "Northline Design"]),
      n("a-jen", "person", "Jen sits next to me at Northline Design and works on the website team.", ["Jen", "Northline Design"]),
      n("a-standup", "routine", "Team stand-up is every weekday at 9:15."),
      n("a-harbor", "routine", "I'm leading the Harbor app redesign, due on Friday.", ["Harbor"]),
      n("a-lunch", "preference", "I usually eat lunch at 12:30 and like the Thai place downstairs."),
    ],
    voice: DEFAULT_VOICE,
    phrases: [
      p("a-p1", "Morning, Marco.", 9, "a-office", "a-marco"),
      p("a-p2", "The Harbor designs are almost done.", 6, "a-office"),
      p("a-p3", "I'll send it by Friday.", 5, "a-office", "a-marco"),
      p("a-p4", "Can we talk after stand-up?", 4, "a-office"),
      p("a-p5", "Sounds good to me.", 8),
      p("a-p6", "Let me check and get back to you.", 7),
    ],
  },
];
