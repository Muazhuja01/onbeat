import { make, type Scenario } from "./scenarios";

const maya = make("maya", "t");
const tom = make("tom", "t");
const aisha = make("aisha", "t");

/**
 * Held-out test set, written before any tuning (quality pass spec, section 3).
 * Do not edit, and do not tune prompts, the validator or retrieval against it.
 */
export const testScenarios: Scenario[] = [
  // Maya: ALS, hears fine. Blue Door Café with Sam unless noted.
  maya(1, "Morning! Same as always?", "Yes, the usual please.", ["m-usual"]),
  maya(2, "Hot or iced today?", "Hot, please."),
  maya(3, "Do you want a lid on that?", "Yes please."),
  maya(4, "Would you like a pastry with your latte?", "No thanks, just the latte.", [], { typed: "no" }),
  maya(5, "How's your daughter doing?", "Leila's doing well, thanks.", ["m-leila"]),
  maya(6, "Is Biscuit still chewing everything?", "Ha, not as much now."),
  maya(7, "Any plans for the weekend?", "Not sure yet."),
  maya(8, "Can you tap your card on the reader?", "Sure, one moment."),
  maya(9, "Do you want me to carry it to your table?", "Yes please, that would help.", [], { typed: "yes" }),
  maya(10, "What time is your physio today?", "It's at 10:30.", ["m-physio"]),
  maya(11, "Do you still like Agatha Christie?", "Yes, I love her mysteries.", ["m-books"]),
  maya(12, "Sorry, the card machine is down. Cash only today.", "Okay, give me a moment.", [], { typed: "ok" }),
  maya(13, "Are you walking home after this?", "Yes, it's only two blocks.", ["m-cafe"]),
  maya(14, "Do you need help with the door?", "Yes please, thank you.", [], { partnerId: null }),
  maya(15, "Hi, is anyone sitting here?", "No, it's free.", [], { partnerId: null }),
  maya(16, "Which street do you live on again?", "Cedar Street.", ["m-home"], { typed: "cedar" }),
  maya(17, "Mum, are you coming to visit me in Toronto?", "I'd love to. Let's talk about it.", ["m-leila"], {
    placeId: "m-home",
    partnerId: "m-leila",
  }),
  maya(18, "Mum, how's Biscuit?", "He's doing great.", ["m-biscuit"], { placeId: "m-home", partnerId: "m-leila" }),
  maya(19, "Can I write your name on the cup?", "Yes, it's Maya.", ["m-me"], { typed: "yes" }),
  maya(20, "Why do you use the tablet to talk?", "I have ALS, so I type to talk.", ["m-me"], { partnerId: null }),

  // Tom: Deaf, uses ASL. Riverside Pharmacy with Priya unless noted.
  tom(1, "Next, please. How can I help?", "I'm picking up my prescription.", ["t-meds"]),
  tom(2, "Can you spell your last name for me?", "I'll type it for you.", [], { typed: "i'll" }),
  tom(3, "Is this your usual blood pressure refill?", "Yes, same as every month.", ["t-meds"]),
  tom(4, "Any new allergies since last time?", "Just penicillin, same as before.", ["t-allergy"]),
  tom(5, "Your prescription isn't ready yet. Can you come back in an hour?", "Okay, I'll come back later."),
  tom(6, "Which pharmacy should we send your refills to?", "Riverside Pharmacy.", ["t-pharmacy"]),
  tom(7, "Would you like to speak with the pharmacist about the dose?", "Yes, please.", [], { partnerId: null }),
  tom(8, "Is Dr. Chen still your doctor?", "Yes, Dr. Chen at Lakeview Clinic.", ["t-doctor"]),
  tom(9, "Can you hear the announcements, or should I tell you when your name is called?", "Please tell me. I'm Deaf.", ["t-me"]),
  tom(10, "Do you want to pay now or later?", "Now, please.", [], { typed: "now" }),
  tom(11, "Would you like a printed information sheet?", "Yes please, that helps."),
  tom(12, "Please sign here.", "Okay."),
  tom(13, "Do you need a sharps container too?", "No, thank you.", [], { typed: "no" }),
  tom(14, "Are you still working as a designer?", "Yes, I'm still a graphic designer.", ["t-work"]),
  tom(15, "Do you want your tablets in a blister pack?", "No thanks, the bottle is fine."),
  tom(16, "Hi Tom, any questions about your medication?", "No questions, thank you.", [], { placeId: null, partnerId: "t-doctor" }),
  tom(17, "Should we try a different dose?", "What do you recommend?", [], { placeId: null, partnerId: "t-doctor" }),
  tom(18, "Excuse me, do you know when the pharmacy closes?", "Sorry, I'm not sure.", [], { partnerId: null }),
  tom(19, "Your total is $8.20.", "Card, please.", [], { typed: "card" }),
  tom(20, "Have a good day, Tom!", "Thanks Priya, you too."),

  // Aisha: laryngectomy. Northline Design office with Marco unless noted.
  aisha(1, "Hi Aisha, got a minute?", "Sure, what's up?"),
  aisha(2, "Is the Harbor redesign still on track for Friday?", "Yes, on track for Friday.", ["a-harbor"]),
  aisha(3, "Can you join a call at 3 today?", "Yes, 3 works for me.", [], { typed: "yes" }),
  aisha(4, "Can you send me the Harbor files?", "Sure, I'll send them now."),
  aisha(5, "Do you want to join us for lunch?", "Yes! The Thai place?", ["a-lunch"], { partnerId: "a-jen" }),
  aisha(6, "What time do you usually eat lunch?", "Around 12:30.", ["a-lunch"], { partnerId: "a-jen" }),
  aisha(7, "Are you coming to stand-up tomorrow?", "Yes, I'll be there.", ["a-standup"]),
  aisha(8, "Could you review my slides before the client meeting?", "Sure, send them over.", [], { partnerId: "a-jen" }),
  aisha(9, "Where do you sit?", "Third floor, Northline Design.", ["a-office"], { partnerId: null }),
  aisha(10, "Do you need a bigger monitor?", "No, mine is fine, thanks.", [], { typed: "no" }),
  aisha(11, "Can we push the Harbor deadline?", "I'd rather keep Friday.", ["a-harbor"], { typed: "i'd rather" }),
  aisha(12, "Who's leading the Harbor redesign?", "I am.", ["a-harbor"], { partnerId: null }),
  aisha(13, "Can you help Jen with the website?", "Yes, I can help her.", ["a-jen"]),
  aisha(14, "The meeting room is booked. Can we meet at your desk?", "Sure, that works."),
  aisha(15, "Do you want me to type the notes for the meeting?", "Yes please, that would help."),
  aisha(16, "Are you feeling okay today?", "I'm fine, thanks for asking."),
  aisha(17, "Is anything blocking you on Harbor?", "Not right now, thanks.", [], { typed: "not" }),
  aisha(18, "I'll be late to stand-up.", "Okay, I'll tell Marco.", ["a-marco"], { partnerId: "a-jen" }),
  aisha(19, "Can you explain the design to the new intern?", "Sure, I'll type it out.", [], { typed: "sure" }),
  aisha(20, "Thanks for your help today!", "You're welcome, Marco."),
];
