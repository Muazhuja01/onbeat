# Eval results

Scenarios: 20 per example profile (Maya at the café, Tom at the pharmacy, Aisha at work), in `eval/scenarios.ts`. Each scenario has what the other person said, sometimes a few typed letters, and the sentence the user meant. Replies go through the same request builder, prompt and validator as the app. A second model (the judge) decides whether any shown reply says what the user meant and whether a shown reply states a fact that isn't in the notes or the conversation.

The judge also sees the user's saved phrases that the model was given as style examples, so a reply that restates one is not counted as invented. Rate-limited calls are retried: model calls through `eval/retry.ts`, judge calls up to three times in `eval/judge.ts`.

Run it with `npm run eval` (needs the keys in `.env.local`, about 20 minutes). The raw output is in `results/latest.md` and `results/latest.json`.

## Results (2026-09-28)

| Model | Top-3 hit rate | Invented details shown | Replies blocked by the check | Keystrokes saved | Right notes sent | First reply p50 / p95 | Full answer p50 / p95 | Failed |
|---|---|---|---|---|---|---|---|---|
| groq:qwen/qwen3.8-27b | 63% | 21 of 119 | 1% | 57% | 95% | 254 ms / 367 ms | 387 ms / 590 ms | 1 |
| groq:openai/gpt-oss-20b | 76% | 35 of 159 | 2% | 70% | 95% | 527 ms / 1000 ms | 532 ms / 1000 ms | 5 |
| cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast | 73% | 13 of 156 | 4% | 48% | 95% | 1014 ms / 4103 ms | 1819 ms / 5887 ms | 1 |

The judge ran out of its free daily quota (HTTP 429) during the Cloudflare row, so 15 of that model's 59 answered scenarios were not judged. The hit rate is over the 44 judged scenarios only. The invented count only covers the judged scenarios (13 of the 115 replies shown in them), so "13 of 156" understates it. Keystrokes saved counts the 15 unjudged scenarios as no match, so 48% is too low; over the judged scenarios it is 65%. Both Groq rows were fully judged.

"Failed" means the model request failed after retries: timeouts and aborted streams (five of them for gpt-oss-20b), not wrong answers.

## Model choice

`qwen/qwen3.8-27b` stays the default on Groq. It showed fewer invented details (21 of 119 shown replies, 18%, against 35 of 159, 22%, for `openai/gpt-oss-20b`), which is the first rule, so gpt-oss-20b's higher hit rate (76% against 63%) doesn't decide it; Qwen was also twice as fast to the first reply (254 ms p50 against 527 ms) and failed once instead of five times.

## In-app timing

Time from the other person's last word until replies are on screen, measured by the live browser check (`tests/e2e/live-hearing.spec.ts`, Chromium on an AMD Ryzen 7 6800HS with Windows 11 Home, 5 turns): median 652 ms, p95 1880 ms. Replies prepared while they were still talking count as 0 ms.

## Known gaps

Quoted replies come from this run and from the first run of the day (before the validator learned "tomorrow" and before the judge saw the saved phrases).

- The validator only checks names, numbers, days and times. Replies that invent an event, a state, a symptom or a preference without naming anything new still get through: "I brought Biscuit, he's in the car.", "No, I left Biscuit at home.", "Yes, I read it during stand-up.", "Yes, I saw it this morning.", "No, just mild dizziness.", "The new dose feels less nauseous.", "I noticed my energy has increased.", "Also, a refill for my allergy cream.", "Just finished a mockup for a local charity, it's almost ready.", "Desk feels great, thanks to the new ergonomic chair.", "I prefer email", "Maybe later, busy".
- A reply can combine details from the notes into something the notes don't say, and it passes because every name and time in it is backed: "I'm heading to the Thai place after the Harbor redesign meeting." (in both runs), "I'll send the final files before lunch at 12:30.", "Yes, Dr. Chen prescribed it.", "It's right next to Marco's office.", "I'll join after meeting with Jen next.", "I finished a Christie mystery.", "My daughter Leila will be back soon."
- A reply can contradict a note or the conversation: "I don't have a doctor." (the doctor note was sent), "Not today, I'm free" (physio is on Tuesdays and it was Tuesday), "My meds are ready for pickup." (the pharmacist had just said about ten minutes), "I'm heading to the café." (she was at the café).
- Orders that aren't the usual: "Just a small espresso today.", "Maybe a soy latte today?", "Maybe a croissant instead?", "ok, almond milk", "Toast maybe". These are choices the user can make, but the notes don't back them.
- Relative time words other than tomorrow, yesterday and tonight are not checked. "Maybe I'll skip it this week and just enjoy coffee." passed with nothing mentioning a week, and it tells the barista Maya is skipping physio.
- Two blind spots in how the validator finds names, not hit by an unbacked name in this run but easy to hit. A name as the first word of a sentence is not checked ("Jen helped me set it up" passed without "Jen" being looked at; Jen happened to be in the notes). A title with a full stop ends the sentence, so in "Ask Dr. Patel about it." only "Dr" is checked, and any note that says "Dr." backs it; "Yes, Dr. Chen prescribed it." shows the same split. Ordinals such as "third" are not checked either.
- "Yes, I can hear you, Priya." for Tom, who is Deaf, in both runs: his about-me note wasn't among the notes sent for "Sorry, can you hear me okay?", so the model never saw it. Search should always send the about-me note. The other two scenarios where a needed note was not sent are maya-09 and maya-20.
- The Cloudflare backup (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) shows invented details too (13 of the 115 replies the judge saw, 11%), such as "Jen helped me set it up", "after this meeting" and "I'm waiting for Sam". Its prompt needs the same tuning in plan 3.
- The judge still flags some replies that only restate the partner or a saved phrase: "Thanks, I'll take it with breakfast." and "Yes, I take it every morning." (the pharmacist said "every morning with food"), "Let me check and get back to you after stand-up." (two of Aisha's saved phrases). The invented counts are a little high because of this.

## Before deployment

These numbers are the first measurement, before any tuning. Deployment waits for a quality pass that reaches a top-3 hit rate of 90% and invented details in under 5% of shown replies, or for the owner to accept the measured numbers. The pass will try:

- a prompt that only states facts from the notes, the conversation or the saved phrases;
- a second check for vague claims (events, states, symptoms, plans) that the validator can't catch;
- better retrieval, with a reranker, and always sending the about-me note;
- revisiting the model choice after those changes;
- a bigger eval with a judge that isn't limited by a daily quota.
