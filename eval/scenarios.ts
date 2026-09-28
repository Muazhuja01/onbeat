export interface Scenario {
  id: string;
  persona: "maya" | "tom" | "aisha";
  /** Place note id. Left out: the profile's default. null: not set. */
  placeId?: string | null;
  /** Partner note id. Left out: the profile's default. null: someone new. */
  partnerId?: string | null;
  partnerSaid: string;
  /** What the user had typed before choosing, if anything. */
  typed?: string;
  /** What the user meant to say. */
  intended: string;
  /** Notes the intended reply relies on, to check that search sent them. */
  noteIds: string[];
}

type Extra = Pick<Scenario, "placeId" | "partnerId" | "typed">;

export const make =
  (persona: Scenario["persona"], prefix = "") =>
  (n: number, partnerSaid: string, intended: string, noteIds: string[] = [], extra: Extra = {}): Scenario => ({
    id: `${persona}-${prefix}${String(n).padStart(2, "0")}`,
    persona,
    partnerSaid,
    intended,
    noteIds,
    ...extra,
  });

const maya = make("maya");
const tom = make("tom");
const aisha = make("aisha");

export const scenarios: Scenario[] = [
  // Maya: ALS, hears fine. Blue Door Café with Sam unless noted.
  maya(1, "Hi Maya, the usual today?", "Yes please, my usual.", ["m-usual"]),
  maya(2, "What size would you like?", "Large, please.", ["m-usual"], { typed: "lar" }),
  maya(3, "Oat milk again?", "Yes, oat milk and no sugar.", ["m-usual"]),
  maya(4, "Anything to eat with that?", "No thanks, just the coffee."),
  maya(5, "Is that for here or to go?", "To go, please."),
  maya(6, "How are you doing today?", "I'm doing well, thanks for asking."),
  maya(7, "How's Leila getting on at university?", "She's doing great in Toronto.", ["m-leila"], { typed: "she's" }),
  maya(8, "Did you bring Biscuit with you today?", "Not today, Biscuit is at home.", ["m-biscuit"]),
  maya(9, "Reading anything good lately?", "An Agatha Christie mystery. I love them.", ["m-books"]),
  maya(10, "Will that be card or cash?", "Card, please.", [], { typed: "card" }),
  maya(11, "Sorry, we're out of oat milk today.", "Okay, I'll have it black then.", [], { typed: "ok" }),
  maya(12, "Do you want your receipt?", "No thanks."),
  maya(13, "Are you off to physio later?", "Yes, physio is at 10:30.", ["m-physio"]),
  maya(14, "Can I get your name for the cup?", "It's Maya.", ["m-me"]),
  maya(15, "Would you like to try our new pumpkin latte?", "No thanks, I'll stick with my usual.", ["m-usual"], { typed: "no" }),
  maya(16, "That'll be ready in a few minutes.", "Thanks, I'll wait over here."),
  maya(17, "Do you live nearby?", "Yes, just two blocks away.", ["m-cafe"]),
  maya(18, "Excuse me, is this seat taken?", "No, go ahead.", [], { partnerId: null }),
  maya(19, "Sorry, I didn't catch that. Could you say it again?", "I have ALS, so I type to talk. One moment.", ["m-me"], {
    partnerId: null,
    typed: "i type",
  }),
  maya(20, "Hi Mum, how was your week?", "Pretty good. Biscuit and I went to the café.", ["m-biscuit", "m-cafe"], {
    placeId: "m-home",
    partnerId: "m-leila",
  }),

  // Tom: Deaf, uses ASL. Riverside Pharmacy with Priya unless noted.
  tom(1, "Hi, what can I do for you today?", "I'm here to pick up my prescription.", ["t-meds"]),
  tom(2, "Can I have your name, please?", "It's Tom.", ["t-me"]),
  tom(3, "What's your date of birth?", "I'll type it for you.", [], { typed: "i'll type" }),
  tom(4, "Is this for your blood pressure medication?", "Yes, my blood pressure medication.", ["t-meds"]),
  tom(5, "Do you have any allergies?", "Yes, I'm allergic to penicillin.", ["t-allergy"]),
  tom(6, "It'll be about ten minutes.", "Okay, I'll wait."),
  tom(7, "Who's your doctor?", "Dr. Chen at Lakeview Clinic.", ["t-doctor"]),
  tom(8, "Have you had any side effects?", "No, I feel fine."),
  tom(9, "Do you want to talk to the pharmacist about it?", "Yes please. Can you write it down?", [], { partnerId: null }),
  tom(10, "Sorry, can you hear me okay?", "I'm Deaf. I read captions, so please look at me when you speak.", ["t-me"]),
  tom(11, "Would you like a bag?", "No thanks."),
  tom(12, "Can I see your insurance card, please?", "Here it is.", [], { typed: "here" }),
  tom(13, "Take one tablet every morning with food.", "One every morning with food, got it."),
  tom(14, "Do you want a text when your refill is due?", "Yes, a reminder would help."),
  tom(15, "We need to call your doctor first.", "Okay. Can you text me when it's ready?"),
  tom(16, "Is there anything else you need?", "No, that's all. Thank you."),
  tom(17, "How's work going these days?", "Busy, lots of design projects.", ["t-work"]),
  tom(18, "Are you in line?", "Yes, I'm next.", [], { partnerId: null }),
  tom(19, "How have you been feeling on the new dose?", "Much better, thank you.", [], { placeId: null, partnerId: "t-doctor" }),
  tom(20, "That's $12.50, please.", "Card, please.", [], { typed: "card" }),

  // Aisha: laryngectomy. Northline Design office with Marco unless noted.
  aisha(1, "Morning Aisha, how are you?", "Morning, Marco. I'm good, thanks."),
  aisha(2, "How's the Harbor redesign coming along?", "Almost done. It's due on Friday.", ["a-harbor"]),
  aisha(3, "Can you have it ready by Friday?", "Yes, I'll send it by Friday.", ["a-harbor"]),
  aisha(4, "Are you coming to stand-up?", "Yes, see you at 9:15.", ["a-standup"]),
  aisha(5, "Do you want to grab lunch later?", "Sure, the Thai place at 12:30?", ["a-lunch"]),
  aisha(6, "Can we move our meeting to tomorrow?", "Sounds good to me."),
  aisha(7, "Do you need anything from me for Harbor?", "Just your feedback on the designs.", ["a-harbor"]),
  aisha(8, "Hey, can you look at the website header?", "Sure, send me the link.", [], { partnerId: "a-jen" }),
  aisha(9, "Are you going to the Thai place today?", "Yes, at 12:30 as usual.", ["a-lunch"], { partnerId: "a-jen" }),
  aisha(10, "Can you present the designs to the client?", "I'd rather share the slides and answer questions in the chat.", [], {
    typed: "i'd rather",
  }),
  aisha(11, "Did you get my email?", "Not yet, I'll check now."),
  aisha(12, "The client wants a few changes.", "Okay, let me check and get back to you."),
  aisha(13, "How's the new desk setup?", "Much better, thanks."),
  aisha(14, "Is the third floor too noisy for you?", "It's fine for me.", ["a-office"]),
  aisha(15, "Can you cover Jen's review this afternoon?", "Yes, I can do that."),
  aisha(16, "Want a coffee from downstairs?", "No thanks, I'm fine."),
  aisha(17, "What time is stand-up again?", "Every weekday at 9:15.", ["a-standup"]),
  aisha(18, "Hi, I'm new here. Which floor is Northline Design on?", "It's on the third floor.", ["a-office"], { partnerId: null }),
  aisha(19, "Are you free for a quick call?", "After stand-up works for me.", ["a-standup"], { typed: "after" }),
  aisha(20, "Great work on the mockups!", "Thanks, Marco."),
];
