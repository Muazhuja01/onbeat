# Eval results

Scenarios: 60 in the dev set (`eval/scenarios.ts`, used for tuning) and 60 in the held-out test set (`eval/test-scenarios.ts`, written before tuning and not changed afterwards). They cover three example profiles: Maya at the café, Tom at the pharmacy, Aisha at work. Each scenario has what the other person said, sometimes a few typed letters, and the sentence the user meant. Replies go through the same request builder, prompt and validator as the app. A second model (the judge) decides whether any shown reply says what the user meant and whether a shown reply states a fact that isn't in the notes, the conversation or the saved phrases.

Run it with `npm run eval` (needs the keys in `.env.local`). The raw output of the runs of record is in `results/latest-dev.md` (dev run B4) and `results/latest-test.md` (test run T1). Both are without the claim check, which is how the app ships.

To tune on part of the dev set without replacing the runs of record, pick scenarios with `--ids maya-06,tom-19` and write elsewhere with `--out slice-name`. `--judges groq` keeps the judge off Cloudflare, whose free allowance the live site shares for captions and backup replies. On a free Groq key the judge model allows about 200k tokens a day, roughly 50 judge calls at high effort, so a 20-scenario slice needs `--votes 1` to fit two runs in a day.

## Prompt change shipped without a run (2026-10-09)

Reply 2 used to be told to add "one detail from the notes or the conversation". It now adds a note's detail only when a note answers what the other person said, and is otherwise another plain answer. On a 20-scenario dev slice of questions the notes don't fully answer, 17 scenarios were judged before the free Groq judge ran out of its daily quota. 8 had an invented detail, and in all 8 it was in reply 2.

The change was deployed without an eval run (owner decision), so the numbers below are for the earlier prompt. Its effect on hit rate and invented details is not measured. The next run should start with the dev set: the `--ids`, `--out` and `--judges groq` options above.

## Quality pass (2026-09-29)

What changed:

- Object parser: replies are read as JSON objects, so pretty-printed or fenced output is no longer lost. A later fix reads the `{"replies": [...]}` wrapper the model sometimes emits.
- Prompt: tuned on the dev set. The prompt states that a reply may only use facts from the notes, the conversation or the saved phrases, no longer invites new facts about the person, keeps the neutral reply free of invented plans, never contradicts a note, and does not place the person anywhere the sources don't.
- Pinned about-me note: the note that says who the user is and how they communicate is always sent.
- Validator: names at the start of a sentence, names after a title, and relative time phrases are now checked; everyday openers and titles no longer count as names.
- Claim check: a second, small model (`openai/gpt-oss-20b` on Groq by default) reads each reply against the notes and the conversation and hides the ones it calls invented. It was turned on after dev run B5 showed 5% invented, then turned off by owner decision after the test runs: on the test set it cost 5 points of hit rate and about 440 ms for 3 points fewer invented details (see the targets below). The code stays; set `CLAIM_CHECK=on` to enable it.
- Judge and scoring: the judge lists each fact and its source, sees the saved phrases, grades plain answers as answers, and takes a majority of 3 calls per scenario. Scoring counts invented details over judged replies and reports empty answers, replies dropped by the claim check and checks that could not decide. Judge answers are cached, keyed on the judge settings.

### How to read these numbers

- Judge: `openai/gpt-oss-120b` on Groq, prompt v4, reasoning effort high, majority of 3 calls per scenario. Against a hand-labelled gold set of 60 dev replies (`eval/judge-gold.ts`, labels committed before any judge ran) it agrees on 87% and finds 91% of the invented replies. The config was picked on 2 runs. Its errors are mostly false flags on plain answers, so the measured invented rates run high. The controller read T1's 20 flagged replies against the written definition and found about 12 real inventions, a true rate near 7%. That is a reading, not a measurement.
- The judge changed during the pass (consistency across endpoints was added, then calibration), so dev numbers before run B3 are not comparable with later ones. The baseline dev run B0 (68% hit, 9% invented) used the older judge.
- The parser fix for the `{"replies": [...]}` wrapper was found on the empty scenarios of test run T1. It is a format bug independent of any scenario, but it was found on the test set, so T2 is slightly informed by the test set.
- The test set was run exactly twice: T1 (claim check off) and T2 (claim check on, after the parser fix). No dev run followed.
- The eval's timing with the claim check understates the app's. The app checks every reply object in order before the client's validator runs, including replies the client later drops. Use the in-app timing below for the app.
- The Cloudflare backup model was not run on the test set in this pass (owner decision, to save judge spend). Cloudflare as a judge was never calibrated; all gate numbers were judged on Groq only.
- Cost: the calibrated judge is about 3 high-effort calls per scenario. The pass used a paid Groq plan, about $6 in total for judge and model calls.

### Test set (held out, 60 scenarios, written before tuning)

Default model `qwen/qwen3.8-27b`, run 2026-09-29. T1 is head 5ef8735 with the claim check off; T2 is head 2db6e0e with the claim check on.

| Run | Top-3 hit rate | Invented details | Empty | Replies blocked by the check | Keystrokes saved | Right notes sent | First reply p50 / p95 | Full answer p50 / p95 | Failed | Not judged | Dropped by the claim check | Claim check unsure |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T1, check off | 87% | 20 of 168 (12%) | 3 | 2% | 79% | 98% | 344 ms / 894 ms | 507 ms / 1077 ms | 0 | 0 | 0 | 0 |
| T2, check on | 82% | 13 of 143 (9%) | 1 | 2% | 73% | 98% | 783 ms / 1094 ms | 1162 ms / 1572 ms | 0 | 0 | 33 | 68 |

### Dev set (60 scenarios, used for tuning)

Default model `qwen/qwen3.8-27b`. B5 is the final dev run and the one in `results/latest-dev.md`.

| Run | Top-3 hit rate | Invented details | First reply p50 |
|---|---|---|---|
| B0, before the pass (older judge, not comparable) | 68% | 12 of 140 (9%) | 654 ms |
| B3, before prompt round 1, qwen | 85% | 28 of 175 (16%) | 313 ms |
| B3, before prompt round 1, gpt-oss-20b | 81% | 38 of 153 (25%) | 332 ms |
| B4, after prompt round 1, no check | 78% | 23 of 172 (13%) | 327 ms |
| B5, with the claim check | 80% | 7 of 146 (5%) | 687 ms |

The default stays `qwen/qwen3.8-27b`: on B3 it had fewer invented details than `openai/gpt-oss-20b` (16% against 25%) and a higher hit rate (85% against 81%). B3 left 1 scenario (qwen) and 6 scenarios (gpt-oss-20b) not judged.

### Against the targets

Neither target is met on the held-out test set. The owner decides before deployment (parent spec section 9).

Hit rate, target 90%. Without the claim check the hit rate is 87%, 3 points short; with it, 82%, 8 points short. With 60 scenarios, 5 points is 3 scenarios, so the gap between T1 and T2 is 3 scenarios (52 of 60 against 49) and the gap to 90% without the check is 2 scenarios (52 of 60 against 54).

Invented details, target under 5% of shown replies. The judge measured 12% without the check (20 of 168) and 9% with it (13 of 143). The dev set reached 5% (7 of 146) with the check, and the test set did not follow. The judge flags plain answers too often (see above); a manual read of T1's flags put the true rate near 7%, which would still miss the target without the check.

The claim check trades hit rate for fewer invented details: on the test set it lowered invented from 12% to 9% and the hit rate from 87% to 82%. It dropped 33 replies and could not decide on 68. The app ships with the check off, so T1 is the result of record.

First reply p50 against the plan 2 baseline (254 ms for this model, target: at most 150 ms more). Without the check it is 344 ms, 90 ms above the baseline and inside the limit. With the check it is 783 ms, 529 ms above, outside the limit. The check adds about 440 ms to the first reply in the eval.

### In-app timing

Time from the other person's last word until replies are on screen, measured by the live browser check (`tests/e2e/live-hearing.spec.ts`, Chromium on an AMD Ryzen 7 6800HS with Windows 11 Home, claim check on via `CLAIM_CHECK=on`, 10 turns): gaps of 1606, 1310, 1093, 1177, 644, 679, 691, 647, 0 and 646 ms, median 679 ms, p95 1606 ms (nearest rank). The 0 ms turn is a reply that was prepared while the partner was still talking. This run had the claim check on; the app now ships with it off, so these gaps overstate the default. This is one run of one fake-microphone fixture that loops a single question, so it says little about real conversations. The plan 2 run (5 turns, no claim check) had a median of 1159 ms and a p95 of 3665 ms; the two runs are not a like-for-like comparison, since the fixture, the network and the model load differ.

### Known gaps

Quoted from T2's judge output (13 flagged replies in 11 scenarios) and from its misses. The judge is not perfect: some of these, such as "I'll write it down.", read as plain answers.

- Events, states or plans stated without a source: "No, I am staying here.", "He loves chewing things.", "One second, I'm typing.", "I have cash on me.", "Sure, I'm just grabbing my coffee.", "I'm at my desk right now.", "Yes, I have the notes ready."
- Commitments or facts about the user that the notes don't give: "I would love to, but I can't travel.", "I'll write it down.", "No, I'll handle it.", "I'll tell Marco you'll be late.", "He's a good golden retriever, as usual."
- Wrong or missing answers (11 scenarios did not hit): maya-t07 ("Any plans for the weekend?") showed nothing; maya-t15 ("is anyone sitting here?", meant "No, it's free.") showed "No, it's taken."; maya-t14 (door help, meant a yes) showed only "Not needed, thanks."; maya-t06, maya-t12, maya-t17, maya-t18, tom-t12, tom-t15, tom-t17 and aisha-t19 also missed.
- The claim check and app issues below were seen but not fixed; the app is frozen for plan 3:
  - a whitespace-only reply can show as a blank button;
  - the claim check reads any answer that contains "invented", so "not invented" would hide a reply;
  - it has no 429 cooldown and does not stop when the client disconnects;
  - every reply the check drops can leave the list empty without a retry;
  - checks run one after another and can add up to about 1.8 s when they time out.

## Plan 2 baseline (2026-09-28)

The first measurement, before any tuning, on the earlier 60-scenario dev set (20 per profile) and an older judge. The numbers below are history; they are not comparable with the quality pass.

### Results (2026-09-28)

| Model | Top-3 hit rate | Invented details shown | Replies blocked by the check | Keystrokes saved | Right notes sent | First reply p50 / p95 | Full answer p50 / p95 | Failed |
|---|---|---|---|---|---|---|---|---|
| groq:qwen/qwen3.8-27b | 63% | 21 of 119 | 1% | 57% | 95% | 254 ms / 367 ms | 387 ms / 590 ms | 1 |
| groq:openai/gpt-oss-20b | 76% | 35 of 159 | 2% | 70% | 95% | 527 ms / 1000 ms | 532 ms / 1000 ms | 5 |
| cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast | 73% | 13 of 156 | 4% | 48% | 95% | 1014 ms / 4103 ms | 1819 ms / 5887 ms | 1 |

The judge ran out of its free daily quota (HTTP 429) during the Cloudflare row, so 15 of that model's 59 answered scenarios were not judged. The hit rate is over the 44 judged scenarios only. The invented count only covers the judged scenarios (13 of the 115 replies shown in them), so "13 of 156" understates it. Keystrokes saved counts the 15 unjudged scenarios as no match, so 48% is too low; over the judged scenarios it is 65%. Both Groq rows were fully judged.

"Failed" means the model request failed after retries: timeouts and aborted streams (five of them for gpt-oss-20b), not wrong answers.

### Model choice

`qwen/qwen3.8-27b` stays the default on Groq. It showed fewer invented details (21 of 119 shown replies, 18%, against 35 of 159, 22%, for `openai/gpt-oss-20b`), which is the first rule, so gpt-oss-20b's higher hit rate (76% against 63%) doesn't decide it; Qwen was also twice as fast to the first reply (254 ms p50 against 527 ms) and failed once instead of five times.

### In-app timing

Time from the other person's last word until replies are on screen, measured by the live browser check (`tests/e2e/live-hearing.spec.ts`, Chromium on an AMD Ryzen 7 6800HS with Windows 11 Home, 5 turns): gaps of 1159, 1343, 3665, 1105 and 1003 ms, median 1159 ms, p95 3665 ms (nearest rank). Replies prepared while they were still talking count as 0 ms; none did in this run.

The first run reported a median of 652 ms and a p95 of 1880 ms, with one 0 ms turn. The timer was corrected after that run: it now starts a turn at its latest speech start, counts only replies from the model, and gives a late answer to the turn that was waiting for it rather than to the next one. The 0 ms turn from the first run can't be confirmed, so those numbers are replaced by the ones above.

### Known gaps

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

### Before deployment (as written on 2026-09-28)

Deployment waits for a quality pass that reaches a top-3 hit rate of 90% and invented details in under 5% of shown replies, or for the owner to accept the measured numbers. The pass tried a prompt that only states facts from the notes, the conversation or the saved phrases, a second check for vague claims, always sending the about-me note, and a judge that isn't limited by a daily quota. Better retrieval with a reranker was not part of this pass.
