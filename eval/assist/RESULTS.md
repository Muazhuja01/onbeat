# Assistant eval results

Round 1 measured the assistant on 48 scripted cases (`cases.ts`) over the three example people (Maya, Tom and Aisha): 32 dev cases used for tuning and 16 test cases held out. Each job had 16 cases: update their information (11 dev, 5 test), prepare for an appointment (10 dev, 6 test) and make quick phrases (11 dev, 5 test). Seven cases started from a typed first message instead of a job button (4 dev, 3 test), and six expected no change at all (2 dev, 4 test), such as a note that is still right or an appointment that was cancelled. Round 2 moved those 16 test cases to dev, so dev is now 48 cases, and added 32 new held-out cases in `test-cases.ts` (see Round 2 at the end). Today is fixed at Monday 5 October 2026, so dates have one right answer. Each case has a brief (what the person wants and every fact they may type), the changes a good chat should end with (65 on dev and 28 on test in round 1; round 2's 48 dev cases have 93), and a list of brief-only terms (see the judge section).

Each case goes through the app's own path: `AssistSession` with the persona's notes, the server turn (`assistTurn`: prompt, model, parse and `checkAssistProposals`), and the cards the session shows. The assistant model is `qwen/qwen3.8-27b` on Groq, the route's default. Cards are judged as they are left open at the end, as if the person had not kept or skipped any.

Run it with `npm run eval:assist -- --split dev` (keys come from `.env.local`, or from the main checkout's when run in a git worktree). `--rejudge <results.json>` judges only cases the judge could not finish, without rerunning the chats.

## The simulated user

`openai/gpt-oss-120b` on Groq, temperature 0.3, reasoning effort low (`sim-user.ts`). It sees its brief and the chat lines, and nothing else: not the notes, not the assistant's instructions, and not the text of the cards. So it can't react to a wrong card, and it can't know whether a card was shown; it only reads what the assistant says. It answers what it is asked in a few words, says it doesn't know anything its brief doesn't cover, and ends with a goodbye once it has said what its brief wants, or after 8 user messages in all.

The goodbye is sent to the assistant as a real user message, because the assistant may still propose something in its answer. It counts toward "user messages", which raises the median by about one compared with counting only the messages that carry content.

A case is void when the judge says the simulated user typed a fact outside its brief. Void cases are left out of every number.

## Targets

- Worth keeping: at least 90% of shown cards are true to what the person said and worth saving.
- Invented: under 5% of shown cards state a detail the person never typed (the judge or the brief-only check).
- Edits right: at least 90% of expected edits and removals are shown as that action on the right note.
- Recall: at least 80% of expected changes are matched by a card worth keeping.
- Phrases sayable: at least 80% of quick phrase cards are fine to say as they are.
- Median user messages: 5 or fewer, over cases that expect a change.

## The judge

`openai/gpt-oss-120b` on Groq, reasoning effort high, temperature 0, up to 8,000 completion tokens (the shared settings in `eval/judge.ts`), with the rubric in `judge.ts` at `ASSIST_JUDGE_VERSION` 2. The Cloudflare copy of the same model was out of its daily allowance on every run below and judged nothing. `npm run eval:assist-judge-check` judges each gold entry once and prints agreement with the hand labels.

The judge is paired with a mechanical brief-only check (see below). The eval counts a card as invented if either the judge or the check flags it. A card the check flags also counts as not worth keeping, even if the judge kept it.

### Gold set

`judge-gold.ts` has 18 entries and 44 cards.

- **Real chats (8).** From `npm run eval:assist -- --split dev --no-judge` on eight dev cases (qwen/qwen3.8-27b), with the 13 cards the app showed. Five of those chats ended with no card, and they are there for the leak flag.
- **Wrong on purpose (7).** These reuse the same chats with cards made wrong on purpose:
  - an invented time
  - a removal nobody asked for
  - an edit that drops a still-true part
  - a phrase with a name from nowhere
  - phrases that aren't sayable
  - a user line with a fact outside the brief
  - right-sounding cards on the case that expects nothing, where each one repeats a quick phrase or note the person already has
- **Brief-only (3).** Added after run 5, with 6 cards. Each card states a detail that only the brief has: "cleaning", "Smile Dental", "blood pressure check", "check-up" and the spare key. The one correct card is a phrase.

Label mix:
- keep: 21 true, 23 false
- invented: 11 true, 33 false
- quick phrases: 25, of which 23 are sayable and 2 are not
- leak: true on 1 entry out of 18

Every card and leak flag was labelled from the rubric and committed before the judge saw it. Non-obvious labels have a comment in the file.

Coverage of the positive cases is thin:
- one leak entry
- six cards with a brief-only detail: the dentist phrase in the invented-time variant, and the five new cards
- two unsayable phrases

### Result

Runs 1 to 5 used the first 15 entries (38 cards, 23 phrases). Run 6 used all 18 entries.

| Run | Prompt | Keep (judge) | Keep (with check) | Invented (judge) | Invented (judge or check) | Sayable | Leak |
|---|---|---|---|---|---|---|---|
| 1 | v2 | 35/38 (92%) | | 34/38 (89%) | | 21/23 | 15/15 |
| 2 | v3 | 30/38 (79%) | | 29/38 (76%) | | 22/23 | 13/15 |
| 3 | v4 | 26/38 (68%) | | 27/38 (71%) | | 16/23 | 12/15 |
| 4 | v5 | 29/38 (76%) | | 25/38 (66%) | | 18/23 | 13/15 |
| 5 | v2, final labels | 35/38 (92%) | | 35/38 (92%) | | 21/23 | 15/15 |
| 6 | v2, 18 entries | 36/44 (82%) | 41/44 (93%) | 39/44 (89%) | 42/44 (95%) | 24/25 | 18/18 |

On its first 15 entries, run 6 scored keep 34/38 (89%, or 35/38 with the check) and invented 35/38 (92%, or 36/38 with the check).

**Where the gate stands:**
- On the first 15 entries, the v2 judge passed in run 5: at least 90% on keep and on invented, and leak right on every entry.
- On all 18 entries, invented passes only with the brief-only check (95%).
- Keep passes only with the check: 41/44 (93%). The judge alone scores 36/44 (82%). It kept 4 of the 5 new brief-only cards that should be dropped, even when it listed their detail as invented itself: "cleaning", "Smile Dental" and the spare key.
- The combined gain on the 3 new brief-only gold entries is circular: those cards were made to state brief-only terms from `cases.ts`, so the check catching them shows nothing about other cards. The evidence that the check does not flag good cards is that it flags none of the 13 cards in the 8 real chats.
- The rule that a card the check flags is not worth keeping was set after run 6 showed keep at 82%. The reason comes from the rubric: keep requires a card to be "true to what the person said", and a detail the person never typed isn't.
- The combined keep and invented numbers for run 6 were worked out from its saved verdicts (`results/judge-check-2026-09-30T19-17-35-220Z.json`). The judge was not run again. `judge-check` now prints both numbers for each measure.

Runs 2 to 4 each changed the prompt and did worse, so those changes were dropped (see below). An unreadable answer counts as a disagreement on every card in the entry and on its leak flag. Run 1's saved verdicts were lost because its process was stopped while the Cloudflare endpoint was waiting out its quota. Its disagreements below come from the printed log, which has all of them.

### The brief-only check

The judge sees the brief and the expected changes. It doesn't count a detail as invented when the detail is true there, even though the person never typed it in the chat and the assistant never sees the brief. A prompt line about this (v3, v5) didn't help.

So each case in `cases.ts` has a `briefOnly` list: words from the brief that a card could carry but the user may never type.
- They cover names, places, what an appointment is for, and the words of a wanted phrase: for example "Smile Dental", "clean*", "blood pressure check", "check-up" and "key".
- Days and times are left to the judge, and so are words a user could easily say another way.
- A unit test checks that every term is in its brief and in none of the persona's notes.

`briefOnlyCards` in `score.ts` flags a card that states one of those terms when no user line in the chat does. The assistant's own lines don't count. `summarizeAssist` counts a flagged card as invented, together with the judge's own calls. It also counts a flagged card as not worth keeping, and so not toward recall. It reports how many cards were counted invented only because of the check, and how many kept cards the check dropped. The runner saves the flags per card and prints each one with its terms.

On the gold set, the check flags exactly the 6 brief-only cards and no other card.

### Gold label changes

One, after run 1. `maya-cafe` card 5, the note "Sometimes I order a small latte instead of a large one.", went from invented false to invented true. She asked for the phrase "just a small one today" and never said anything about her orders. The rubric counts a claim that is in none of her messages as invented, and the label's own comment already called it "a claim she never made". The judge was right. With this label, run 1 scores 35/38 on invented.

### Disagreements in run 6

First 15 entries:
- **`tom-checkup` #1, "Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about morning dizziness and blood pressure dose."** The judge said keep false and flagged `["blood pressure dose"]` as invented. It flagged the same phrase in #3, "Should my blood pressure dose change?". Gold keeps both with nothing invented, because "blood pressure" comes from Tom's medication note and that is the only dose he has. Gold is right, but this is arguable. The judge flagged this in runs 2, 4 and 6.
- **`maya-new-dentist: invented time` #3, "I can't keep my mouth open for long. I need breaks."** The judge said keep true with nothing invented. Gold is right (see run 5). The brief-only check now flags it ("mouth open", "break*"), so it counts as invented, and under the combined rule it also counts as not worth keeping, as gold says.
- **`maya-ruth: phrase with a name from nowhere` #1, "Ruth is my new neighbour."** The judge said keep false. Gold is right. This card flips from run to run.
- **`maya-cafe: phrases that aren't sayable` #2, "Maya would like her usual order."** The judge said sayable true. Gold is right: the phrase is in the third person.
- **`tom-have-it` variant #1, "Please write it down."** The judge said keep true. Gold is right: he already has this phrase.

Brief-only entries:
- The judge kept "Friday 9 October, 3pm: dentist cleaning with Dr. Patel.", "Smile Dental: My dentist." and "Ruth: My new neighbour. She has a spare key to my home.", although it listed their detail as invented.
- It kept "Thursday 8 October, 10:00: blood pressure check with Dr. Chen at Lakeview Clinic." and found nothing invented in it.
- It found nothing invented in "I'm here for my check-up."
- Gold is right on all of them. The check flags all five as invented.

### Disagreements in run 5

- **`maya-cafe` #3, "Can I get a napkin?"** The judge flagged `["napkin"]` as invented. Gold says not invented: the phrase asks for something but has no name, number, time, date, place or claim. Gold is right by the rubric's list, but this one is arguable. The card is keep false either way. The judge flagged it in runs 1, 2, 4 and 5, but not in 3 or 6.
- **`maya-ruth` #1, "Ruth is my new neighbour."** The judge said keep false. Gold keeps it, because she typed exactly that and never typed the spare key from her brief. Gold is right.
- **`maya-ruth` #4, "Thanks for walking Biscuit."** The judge flagged `["walking Biscuit"]` as invented. Gold is right: Biscuit and walking both come from her message, and a thank-you states no fact. The judge flagged it in runs 1, 2 and 5. The card is keep false either way.
- **`maya-new-dentist: invented time` #3, "I can't keep my mouth open for long. I need breaks."** The judge said keep true with nothing invented. Gold says keep false and invented. She never typed this in the chat: it is only in her brief and in the list of expected changes, and the assistant never sees either. Gold is right. The judge made this mistake on every run where it answered this entry: runs 1, 2, 5 and 6, plus a single v4 call made to diagnose it, where it matched the card to the listed change. In runs 3 and 4 the answer was empty.
- **`tom-have-it` variant #1, "Please write it down." for Priya.** The judge kept it. Gold says keep false because he already has this exact quick phrase, and it is listed in the judge's notes. Gold is right. The judge missed it in runs 1, 5 and 6.
- **`tom-have-it` variant #1 and #2 (the reworded "Could you please write it down?").** The judge said sayable false. Gold says sayable true, since both are fine to say. Gold is right.

### Disagreements in run 1

- **`maya-cafe` #3, "Can I get a napkin?"** The judge said invented `["napkin"]`, as in run 5.
- **`maya-cafe` #5, "Sometimes I order a small latte instead of a large one."** The judge said invented `["small latte"]`. The judge was right, and the label was changed (see above).
- **`maya-ruth` #4, "Thanks for walking Biscuit."** The judge said invented `["walking Biscuit"]`, as in run 5.
- **`maya-new-dentist: invented time` #3.** The judge said keep true with nothing invented, as in run 5.
- **`maya-ruth: phrase with a name from nowhere` #1, "Ruth is my new neighbour."** The judge said keep false. It kept the same card in the real `maya-ruth` entry.
- **`maya-ruth: phrase with a name from nowhere` #3, "Could you ask Daniel to walk Biscuit today?"** The judge said sayable false. Gold says sayable true, because sayable is about the wording and the made-up name is already covered by keep and invented. This is arguable, since "say it as it is" could include the content.
- **`maya-cafe: phrases that aren't sayable` #2, "Maya would like her usual order."** The judge said sayable true. Gold is right: the phrase is in the third person.
- **`tom-have-it` variant #1, "Please write it down."** The judge said keep true, as in run 5.

### Prompt changes tried and dropped

- **v3 (run 2).** Four changes:
  - The brief is not a source: a detail only the brief has is still invented, and leaving out something she never typed is not wrong.
  - A proposal that repeats a note or quick phrase "in the same or other words" is not worth saving.
  - Asking, thanking or greeting is not a claim.
  - Sayable is about wording only (first person, not an instruction).

  Run 2 got the Daniel and third-person sayable calls right and dropped the duplicate phrase. But the v2 judge also got both sayable calls right in run 5, so that part was probably noise. The changes also broke other things:
  - The judge read "repeats what a note already says" as repeating her own messages. So it dropped "The usual, please.", "Can you bring it to my table, please?" and "Just a small one today.".
  - It marked `aisha-far-date` as a leak. Its reasoning counted the job button line "Prepare for an appointment" as a fact outside the brief.
  - Once it returned 2 cards for 3 proposals.
  - The dentist card was still wrong.
- **v4 (run 3).** Three changes:
  - The duplicate rule was narrowed to the notes and quick phrases the app had.
  - The job button lines state no fact.
  - "One entry in cards for each of the N proposals."

  Three entries came back empty. The only readable disagreement was "Can you bring it to my table, please?" (keep false).
- **v5 (run 4).** It added that the expected-change list is written from the brief, so a proposal that matches a listed change is still invented if she never typed its details. Two entries ran out of the 8,000 completion tokens while reasoning (finish reason `length`) and came back empty. The judge also flagged "napkin", "blood pressure dose" (it is in Tom's medication note), "next time" in "Thanks, see you next time." and "where I go for parent-teacher meetings" as invented.

Each change made the judge reason for longer and did not fix what it targeted, so the prompt is back at v2.

### What this means for the numbers

- **Brief-only details.** The judge doesn't count a detail as invented, and often keeps the card, when the detail is true in the brief or in the expected-change list but was never typed in the chat. The brief-only check covers invented for the terms listed in `cases.ts`. A detail outside those lists, or a day or time, is still up to the judge. For the same terms, the check also sets keep to false.
- **Duplicate phrases.** The judge can keep a quick phrase the person already has. The app's own check already drops a phrase that is a near-duplicate of an existing quick phrase before it is shown (`src/lib/assist/check.ts`, line 91), so this only matters for a repeat that the check doesn't catch. Where it happens, "worth keeping" is overcounted on the phrases jobs.
- **Run-to-run noise.** The same card can get a different verdict on another run. Examples are "Ruth is my new neighbour." and "blood pressure dose". Each gold card was judged once per run.

## Round 1: dev split (32 cases, 1 judge vote)

Model `qwen/qwen3.8-27b`, `--delay 500`, Groq's higher limits. Each round is one change and a full dev run. The cause of each miss was found by reading the saved chats and by replaying some of them through the prompt and the check (a scratch script, not in the repo) to see which proposals the check dropped.

| Run | Change | Cases (void) | Shown | Worth keeping | Invented | Edits right | Recall | Sayable | Median user messages |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Baseline | 30 (1) | 60 | 80% (48/60) | 12% (7/60) | 78% (7/9) | 60% (35/58) | 96% (43/45) | 4 |
| D2 | A phrase only for what the person asked to say | 31 (1) | 41 | 100% (41/41) | 2% (1/41) | 89% (8/9) | 63% (39/62) | 93% (26/28) | 4 |
| D3 | Don't ask the same question again | 30 (2) | 51 | 94% (48/51) | 2% (1/51) | 88% (7/8) | 72% (44/61) | 92% (34/37) | 4 |
| D4 | Check: 24-hour times and typed far dates | 28 (4) | 45 | 96% (43/45) | 0% (0/45) | 89% (8/9) | 69% (38/55) | 97% (29/30) | 4 |
| D5 | Check: a plural day backed by the singular | 30 (1) | 51 | 92% (47/51) | 2% (1/51) | 100% (9/9) | 78% (46/59) | 91% (29/32) | 4 |
| D6 | A note for each new person or place | 31 (1) | 56 | 93% (52/56) | 4% (2/56) | 89% (8/9) | 74% (46/62) | 97% (32/33) | 4 |

D6 is the final code. It meets four targets on dev and misses two: recall is 74% against 80%, and edits right is 8/9 (89%) against 90%. Recall and edits right move by several points between runs in cases no change touched (see D6 below), so on 1 vote and about 60 expected changes a difference of 4 points is within the noise. D5 read higher on recall than D6, but D6 was kept as the final code rather than reverted: the cases D6 aimed at did improve, and choosing between the two on a 4-point difference would be tuning on noise.

No dev card was flagged by the brief-only check in any round, so no matcher or term fix was needed.

Left out, by round:
- D1: `aisha-ent` not judged (the judge's answer was unreadable, and again on two `--rejudge` tries); `maya-vet` void.
- D2: `tom-interview` void.
- D3: `tom-shellfish` and `tom-interview` void.
- D4: `aisha-review`, `aisha-ent`, `maya-vet` and `tom-have-it` void.
- D5: `maya-leila-phrases` failed (the Groq stream was aborted: "All providers failed: groq: This operation was aborted"); `tom-pharmacy-phrases` void.
- D6: `maya-general` void.

Reading those chats, the simulated user typed only what its brief says in every void case above (in `tom-pharmacy-phrases` it typed the three wanted phrases word for word). The leak flag looks like a judge false positive in these. The gold set has one leak entry, so this is the least tested part of the judge, and each void case drops out of every number.

### D1 failures

Cards not worth keeping (12 of 60), invented ones marked:
- `aisha-review`: "I am ready to take on more responsibility." (invented). She only asked for phrases about a promotion and working from home.
- `aisha-far-date`: "Hillside School is where my child goes to school." (invented), "I'd like to discuss my child's progress." (invented), "How is my child doing in class?" (invented) and "Are there any concerns I should know about?". She had said she didn't know what to ask.
- `aisha-thai`: an edit of the lunch note adding "I often order green curry to take away." (invented), in the phrases job.
- `tom-chen-phrases`: "I read captions to follow what people say.", a phrase copied from a note.
- `aisha-jen-phrases`: "Want to grab lunch at the Thai place?" (the Thai place is from a note) and "Do you have a sec to look at the build?" (invented "sec").
- `maya-ruth`: "No need to worry, I'm doing okay." (invented).
- `tom-have-it`: "I'm allergic to penicillin." and "I need my blood pressure medication.", copied from notes when he asked for one phrase he already had.

Edits not right (2 of 9):
- `maya-physio-moved`: no card. The model proposed "I have physio on Thursdays at 10:30." and the check dropped it: she typed "Thursday", and the claim check took "Tuesday" as backed by "Tuesdays" but not "Thursdays" by "Thursday".
- `tom-shellfish`: "I'm allergic to shellfish." as a new note instead of an edit of "I'm allergic to penicillin.".

Recall misses (23 of 58), by cause:
- Appointment notes dropped by the check. The model writes times in 24-hour form ("Wednesday 7 October, 14:00" for "Wednesday at 2 pm"), and the check wanted "14" in a line. It also dropped "3 November, 16:00" although she typed "3 November at 4pm": the learning check drops any date past the coming two weeks, while the prompt asks for such a date as typed.
- Nothing proposed before the goodbye (`tom-checkup`), and a typed first message that never got a job (`maya-new-dentist`).
- Person and place notes never proposed (a dentist, a bank, a clinic, a vet).
- Phrases matched to a different place than expected (`aisha-standup-phrases` for "Team stand-up", `aisha-thai`).

Sayable misses (2 of 45): the judge called "I'm Deaf, can you write it down?" and "Does this bus go to the station?" not sayable, which looks wrong.

### What each change fixed

- **D2, prompt: a phrase only for what the person asked to say.** The jobs asked for "3 to 5" phrases, so the model padded with phrases of its own or from the notes. The prepare job now asks for one phrase for each thing they want to say or ask, the phrases job for one per thing they said and only phrases, and the phrase rule says not to add phrases of its own or from the notes. Worth keeping went from 80% to 100% and invented from 12% to 2%. The one invented card left was "blood pressure dose" in Tom's check-up note, the known judge disagreement from the gold set. Recall barely moved: the chats that lost notes still lost them, and six chats now ran to the 8-message limit or near it, re-asking the same question.
- **D3, prompt: don't ask the same question again.** In D2 the assistant re-asked a day she said she didn't know (`maya-no-date`), listed the three jobs on every turn when no button was picked (`tom-new-doctor`), and refused "I have ALS and I type to talk" as a phrase because a note says it (`maya-general`). With no button picked, the prompt now gives every job's guidance and says to carry on with the one that fits; a rule says never to ask again something they answered or said they don't know; and a quick phrase may say what a note says. Recall went from 63% to 72%. One D3 chat still reached the limit (`maya-no-date`, where the assistant went on to offer a reminder note instead of re-asking the day). Re-asking is not gone: in D6 `maya-new-carer` asked "What does she help you with?" three times after "I don't know".
- **D4, check: 24-hour times and typed far dates.** An am/pm time in a user line now also backs its 24-hour form ("2 pm" backs "14:00"), and a date a cited user line states as typed is left out of the learning check's date rule, while every other part of the note is still checked (`src/lib/assist/check.ts`, with tests). From D4 on, appointment notes in 24-hour time come through: `aisha-review` (14:00) and `maya-vet` (17:00) in D4, `tom-flu-jab` (16:00) in D5 and D6, `maya-new-dentist` (15:00) and `tom-interview` (13:00) in D6. The typed far date never reached a card on dev, though (see below). Recall read 69%, lower than D3, on 55 expected changes instead of 61, because four cases were void in this run.
- **D5, shared check: a plural day backed by the singular.** `claimSupported` in `src/lib/suggest/validate.ts` now takes "Thursdays" as backed by "Thursday", as it already took "Tuesday" by "Tuesdays". The check is shared by replies, the learning check and the assistant, so tests were added for replies and claims (`validate.test.ts`) and for the learning check (`check.test.ts`). The physio edit came through and edits right went to 9/9. Recall read 78%.
- **D6, prompt: a note for each new person or place.** In D5, 9 of 13 recall misses were a person or place the person named with no note of its own. The prepare job now asks for a person note and a place note for each new one, a rule with a made-up example ("Dr. Lee is my eye doctor.") says this holds in any job, and the phrases job allows such a note. `maya-new-dentist` and `tom-interview` got their person and place notes. Recall still read 74%, because other cases missed in this run: `maya-cafe` lost all three phrases (the judge rejected all three; the only thing wrong in them is "for Blue Door Café", which she never typed, where the case expects Sam), `maya-ruth` lost a phrase and the note for Ruth, and `maya-bank` lost its appointment note.

Still wrong on dev after D6:
- `maya-bank`: she typed "13 October, 11:00". The model adds the weekday from its date list ("Tuesday 13 October"), and the check wants the weekday in a line, so the note is dropped. Checked by hand: the same note without "Tuesday" passes.
- `aisha-far-date`: the typed date fix never showed. In D4 to D6 the model either proposed no appointment note or had it dropped. A replay of the D4 chat showed the drop came from "Parent‑teacher", which the simulated user typed with a non-breaking hyphen: the claim check reads that as two words, so the model's "Parent-teacher" is unbacked.
- `tom-checkup`: two phrases the person typed as one sentence become one card, which matches only one expected phrase. The same happened in `maya-general` and `aisha-thai` in earlier rounds, and in `maya-gp` on test.
- `tom-shellfish`: an added allergy is still proposed as a new note in some runs (D1, D3, D6), not as an edit of the allergy note.
- `tom-have-it` (D3, D6) and `maya-general` (D4): the model proposed "Goodbye." as a quick phrase from the simulated user's goodbye.
- Person or place notes are still missing in some chats (`aisha-ent`, `maya-vet`, `aisha-far-date`). In `aisha-ent` and `maya-vet` the assistant's message said it had made them, so either it never proposed them or the check dropped them; these turns were not replayed.

## Round 1: test split (16 cases, 3 judge votes)

Run once on 2026-09-30 with the D6 code (commit `fab9c5a`), `qwen/qwen3.8-27b`, `--delay 500`. Each card is judged by the majority of 3 votes. Every case was judged; none failed.

| Cases (void) | Shown | Worth keeping | Invented | Edits right | Recall | Sayable | Median user messages |
|---|---|---|---|---|---|---|---|
| 13 (3) | 20 | 90% (18/20) | 10% (2/20) | 75% (3/4) | 84% (16/19) | 100% (11/11) | 4 |

Four targets are met: worth keeping (90%, exactly at the target), recall, phrases sayable and the median. Two are missed:
- **Invented is 10% against under 5%.** 2 of 20 cards, both in `maya-gp`. With 20 cards, a single invented card is already 5% and misses.
- **Edits right is 75% against 90%.** 3 of 4 expected edits; the miss is in `tom-pharmacy-moved`.

Cards judged not worth keeping or invented:
- `tom-pharmacy-moved` #4, the removal of "Priya is the pharmacist at Riverside Pharmacy.", not worth keeping. From "Pharmacy changed: Riverside closed, now Oak Street for all meds, including blood pressure." Tom said nothing about Priya.
- `maya-gp` #1, "Tuesday 6 October, 2:30 pm: seeing Dr. Ahmed at Cedar Health about fatigue and shortness of breath at night.", kept but invented `["fatigue", "shortness breath"]`. From "Tuesday at 2:30 pm.", "Cedar Health." and "I'm more tired than usual and short of breath at night." These are the model's rewording of her line, not new facts, but the rubric counts a detail in none of her messages as invented, and the judge applied it. This one is arguable.
- `maya-gp` #2, "Dr. Ahmed is my doctor.", not worth keeping and invented `["my doctor"]`. From "Dr. Ahmed." She never said he is her doctor.

The edit miss: in `tom-pharmacy-moved` the model removed "Riverside Pharmacy is where I pick up my prescriptions." and added "Oak Street Pharmacy is where I pick up my prescriptions." where an edit of that note was expected. Both cards were kept and the add matched the expected change, so recall counts it and edits right does not. The same chat brought the wrong removal of the Priya note above.

Recall misses (3 of 19), all in `maya-gp`: "I've been more tired than usual" and "I'm short of breath at night" came as one phrase card, which the judge matched to neither expected phrase, and the person note "Dr. Ahmed, at Cedar Health" came only as the rejected "Dr. Ahmed is my doctor.".

Void, left out of every number: `maya-optician`, `tom-dentist` and `aisha-pitch`. As on dev, the simulated user's lines in all three stay inside its brief (in `maya-optician` and `aisha-pitch` it even said it didn't know where the appointment was, when the brief names the place). Counting them anyway, from their saved verdicts, gives 28 cards: worth keeping 26/28 (93%), invented 2/28 (7%), edits right 3/4, recall 23/28 (82%) and sayable 14/14. The same two targets are missed.

Two chats that expect no change never ended: in `tom-cancelled` and `aisha-meeting-off` the person said the appointment was cancelled or off, and the assistant kept asking who or when it was until the 8-message limit. It saved nothing, which is right, but the re-asking that D3 reduced on dev is still there for this kind of answer. These cases expect no change, so they are not in the median.

### Where the gate stands

The gate is that nothing deploys until the eval meets its targets with invented under 5%. It is not met. On the held-out test, invented is 10% (2/20) and edits right is 75% (3/4). On dev, the final code misses recall (74%) and edits right (89%). The test numbers rest on 20 cards and 4 expected edits, so one card moves invented by 5 points and one edit moves edits right by 25. They show the targets were not met on this run, not by how much the assistant is off.

### Changes after the held-out run

- The check's time rule changed after the test run, following a code review. D4's version appended the 24-hour form of each am/pm time to the user's line, and the learning check then read "(14:00)" as a bare "14", which backed any 14 in a note ("room 14", "14 mg"). Now only the note is rewritten: a 24-hour time the cited line typed as am/pm is checked in that form, so "2 pm" backs "14:00" and nothing else (`withTypedTimes` in `src/lib/assist/check.ts`). This only makes the check stricter, so it can drop cards the run above kept but never keep one it dropped. The eval was not run again.
- The D6 prompt example ("Dr. Lee is my eye doctor.") is close to the setting of the held-out case `maya-optician`. That case was void in the test run, so it is in none of the numbers above.

## Round 2

Round 1's held-out run found two failure patterns: a person note giving someone a role the person never typed ("Dr. Ahmed is my doctor."), and removals nobody asked for, including a removal plus a new note where an edit of the old note was right. Round 2 tried one fix for each, tuned and measured on dev only.

The 16 round-1 test cases have been seen, so they moved to dev, which is now 48 cases. A new set of 32 held-out cases was written in `eval/assist/test-cases.ts` by an agent that does no tuning, and committed before any round 2 run. It was not run in this round. The owner chose to demo the assistant rather than spend another eval round, so round 2 is a dev baseline and the two fixes, each with a dev run. **No held-out run was made, so every number below is a dev number, on the cases the changes were tuned on.**

Same setup as round 1: `qwen/qwen3.8-27b` on Groq, the v2 judge with 1 vote, the same simulated user, `--delay 500`. No case failed or was left unjudged in any run, and the brief-only check flagged no card.

| Run | Code | Cases (void) | Shown | Worth keeping | Invented | Edits right | Recall | Sayable | Median user messages |
|---|---|---|---|---|---|---|---|---|---|
| R2-D0 | Baseline: round 1's final code | 46 (2) | 92 | 92% (85/92) | 3% (3/92) | 85% (11/13) | 87% (78/90) | 98% (47/48) | 4 |
| R2-D1a | First version of Task 3 (replaced) | 45 (3) | 82 | 93% (76/82) | 2% (2/82) | 75% (9/12) | 74% (64/86) | 87% (41/47) | 4 |
| R2-D1 | Task 3: person and place notes say only what was typed | 44 (4) | 84 | 98% (82/84) | 1% (1/84) | 100% (11/11) | 84% (73/87) | 100% (44/44) | 4 |
| R2-D2a | Task 4 prompt and check (prompt part dropped) | 48 (0) | 84 | 93% (78/84) | 1% (1/84) | 92% (12/13) | 76% (71/93) | 93% (37/40) | 4 |
| R2-D2 | Task 4: removal check only | 44 (4) | 77 | 92% (71/77) | 0% (0/77) | 77% (10/13) | 78% (67/86) | 88% (35/40) | 4 |
| R2-D3 | Fix round: Task 4 reverted, edit name fix, no name-only notes | 44 (4) | 73 | 90% (66/73) | 1% (1/73) | 92% (12/13) | 76% (62/82) | 95% (37/39) | 4 |

R2-D3 is the last code run (3e7e0ba, see the fix round). On dev it meets five targets (worth keeping, invented, edits right, sayable, median) and misses one: recall is 76% against 80%. One fix came after it (b385701) and was not run; see the fix round. R2-D1 and R2-D2 send the model the same prompt, and the only difference, the removal check, can only take away removal cards. In R2-D2 it took away one (see Task 4). So most of the fall from R2-D1 to R2-D2 in edits right and recall is run-to-run spread from the model and the judge, and it shows how far one run on 1 vote can move.

R2-D1a and R2-D2a are first versions that made dev worse. Each was replaced before the next step and its commit amended, so neither is in the branch. They are in the table because they are what those versions did.

Void, left out of every number:
- R2-D0: `maya-optician`, `tom-have-it`.
- R2-D1a: `maya-soy-latte`, `aisha-ent`, `tom-bus`.
- R2-D1: `maya-soy-latte`, `aisha-jen-left`, `tom-dentist`, `tom-have-it`.
- R2-D2a: none.
- R2-D2: `aisha-lunch-same`, `maya-new-dentist`, `maya-vet`, `tom-have-it`.
- R2-D3: `aisha-ent`, `maya-optician`, `aisha-pitch`, `aisha-thai`.

### R2-D0 failures

Cards not worth keeping (7 of 92), invented ones marked:
- `maya-new-carer`: four restatements of the kept "Ana is my carer. She helps me weekday mornings, 8-10.": "I have a carer named Ana who helps me weekday mornings.", "I have a carer on weekday mornings from 8 to 10.", "Ana is my carer." and "I have a new carer named Ana.". The check's near-duplicate rule doesn't catch them.
- `tom-new-doctor`: the edit of "Dr. Chen at Lakeview Clinic is my family doctor." into "Dr. Chen: Dr. Osei is my family doctor.". The app put the old name in front: an edit that sent no name fell back to the note's stored name (see the fix round). The model's own text also dropped Lakeview Clinic.
- `aisha-jen-left`: the removal of "Jen sits next to me at Northline Design and works on the website team.", from "Remove the note about Jen leaving Northline Design.". The judge matched it to the expected removal but said not worth keeping. This looks like a judge error; it kept the same card in every other run that showed it.
- `maya-ruth`: "Ruth is someone I ask to walk Biscuit." (invented). She asked for phrases for Ruth and never said this.

Also invented, though kept by the judge:
- `aisha-review`: "Wednesday 7 October, 14:00: meeting Marco to discuss promotion and working from home on Fridays." (`["meeting"]`).
- `aisha-ent`: "Dr. Rao is my ENT doctor." (`["ENT doctor"]`). She typed "Dr. Rao." and "St Mary's ENT clinic.", never that he is her doctor. This is round 1's held-out failure, on dev. In the same run `maya-gp` got "Dr. Ahmed is my doctor at Cedar Health." from "Dr. Ahmed." and "Cedar Health."; the judge kept it this time, where round 1's held-out run called the same claim invented.

Edits and removals that were wrong:
- `tom-new-doctor`: the edit above, so the expected edit is missed.
- `tom-shellfish`: "I'm allergic to shellfish." as a new note from "Allergy: shellfish.", not an edit of "I'm allergic to penicillin.".
- `tom-pharmacy-moved`: the removal of "Priya is the pharmacist at Riverside Pharmacy." from "Pharmacy changed to Oak Street Pharmacy.". Nobody asked for it. The judge kept it and it matches no expected change, so no measure counts it. This is round 1's other held-out failure, on dev. The same chat's pharmacy edit showed as "Riverside Pharmacy: Oak Street Pharmacy is where I pick up my prescriptions.", the same stored-name problem as `tom-new-doctor`; the judge kept it.

Sayable miss (1 of 48): `tom-checkup`, "I've been dizzy in the mornings. Should my dose change?".

### Task 3: person and place notes say only what was typed

Meant to fix: a person or place note that gives someone a role or relationship the person never typed. Round 1's last prompt change asked for a note for each new person or place, with the example "Dr. Lee is my eye doctor.", which itself states a role.

The change (`src/lib/assist/prompt.ts`, `src/lib/assist/check.ts`):
- Prompt: a new person or place note has only what they typed about it, such as where someone is ("Dr. Lund, at Elm Road Clinic.", "Elm Road Clinic: where I see Dr. Lund."), cites each line it uses, and has no day or time. It never gives a role or relationship they didn't type, because a name alone doesn't say who someone is to them. The output format example now has a person note citing two lines.
- Check: `unbackedRoles` finds "my" or "our", up to two words, then a role or relationship word (doctor, GP, dentist, pharmacist, nurse, neighbour, manager, carer, friend, family words and similar). A note is dropped when no cited line and not the note it edits states that role. A word of the same group counts ("GP" backs "my doctor"), and "Dr." alone doesn't. A phrase is dropped when no cited line and no sent note states it, since a phrase may already say what a note says.

The first version (R2-D1a) used the example "Dr. Osei: knee check on Friday.". Recall fell from 87% to 74%. In `tom-dentist`, `maya-gp`, `maya-vet` and `tom-interview` the assistant said it had made person and place notes, but none was shown. Replaying the last turns of `tom-dentist` and `maya-gp` showed why: the model copied the example's day into the notes ("Dr. Kim: dental check-up on Monday 12 October.", "Bright Smile Dental: dental check-up with Dr. Kim on Monday 12 October.") and cited only the line with the name, so the learning check dropped them for a date no cited line names. The role rule dropped none of them. Osei is also a name from a dev case. That version was commit 47b3f5c, amended to the current one (3818fd8). Replays of the new wording gave "Dr. Kim, at Bright Smile Dental." and "Dr. Ahmed, at Cedar Health.", each citing both lines, and both passed. Those replays still used "Osei" as the example name; it was renamed to "Lund" afterwards with no other change, and R2-D1 ran with "Lund".

What it did on dev (R2-D0 to R2-D1): worth keeping 92% to 98%, invented 3% to 1%, edits right 85% to 100%, recall 87% to 84%, sayable 98% to 100%. No card in R2-D1 or R2-D2 states a role the person didn't type. `aisha-ent` now got "Dr. Rao, at St Mary's ENT clinic." and `maya-gp` got "Dr. Ahmed, at Cedar Health.", both kept. Checked against R2-D0's saved cards, the role rule drops "Dr. Rao is my ENT doctor." and "Dr. Ahmed is my doctor at Cedar Health." and no other card. The second was kept by the judge in that run and matched the expected person note, so on that run the rule would have cost one recall hit.

New failures:
- Bare notes. Asked for only what was typed, the model sometimes writes just the name: `maya-ruth` "Ruth." and `aisha-pitch` "Lumen Foods office.", both not worth keeping (R2-D1; "Ruth." again in R2-D2).
- `aisha-ent`: "St Mary's ENT clinic: where I see Dr. Rao." was kept but flagged `["I see Dr. Rao"]` as invented, the one invented card in R2-D1. She is seeing Dr. Rao there, so this one is arguable.
- `maya-new-carer`: Ana's note came as two cards, "Ana, my carer." and "Ana comes on weekday mornings from 8 to 10.", and the judge matched neither to the expected single note.

### Task 4: edit, don't remove and re-add; remove only when asked

Meant to fix: a removal nobody asked for (`tom-pharmacy-moved` removing the Priya note), and a removal plus a new note where an edit was right (the same chat in round 1's held-out run removing "Riverside Pharmacy is where I pick up my prescriptions." and adding "Oak Street Pharmacy is where I pick up my prescriptions.").

**This change was reverted** in the fix round (see below); none of it is in the final code. What follows is what it was and what it did.

The check (commit 2d391dd, reverted by 2773160): a removal is dropped unless a cited line says the thing ended or asks for it to go (remove, delete, get rid, gone, left, no longer, any more, no more, died, passed away, stopped, finished, ended, closed, shut, cancelled, called off, quit, retired, moved away, broke up, not true and similar). A removal is also dropped when the same answer adds a new person or place note whose first name is a name in the removed note, since that should have been an edit; the new note stays.

The prompt part was tried (R2-D2a, commit c3cecf3, amended to the check only) and dropped. It said: "When something a note says changes (a new day, time, place, name or detail, or something added), propose an edit of that note ... Never remove a note and add a new one in its place." and "Remove a note only when they say that thing is no longer true (it ended, closed, or someone left) or ask you to remove it. Never remove a note they didn't say that about, even one that mentions something that changed." Recall fell from 84% to 76%: in `tom-pharmacy-phrases`, `maya-general`, `maya-physio-phrases` and `tom-work-phrases` the assistant said "Here are three phrases" and no card was shown. Replays showed the model writing the phrases as `{"action": "add", "kind": "phrase", ...}`, which the parser rejects. Over four replays each of `maya-physio-phrases` and `tom-work-phrases`, the R2-D1 prompt gave all 12 and all 8 phrase proposals, and the R2-D2a prompt gave 6 and 6. A plainer second wording gave 9 and 8, and in `tom-pharmacy-moved` the model still removed and re-added the pharmacy note in 2 of 3 replays with either prompt. The prompt part didn't fix its pattern and hurt phrases, so it was taken out and the commit holds the check only.

What the check did on dev: every removal card shown in the five runs above was checked against the new rule, citing all of the chat's user lines. It keeps every removal that matched an expected one (`aisha-harbor-shipped`, `maya-biscuit-gone` and `aisha-jen-left`, from lines such as "Remove the Harbor redesign note.") and drops only R2-D0's Priya removal. In R2-D2, Tom's lines in `tom-pharmacy-moved` were "places", "Oak Street Pharmacy." and "Yes, pick up now. No pharmacist info.". The assistant said twice it would "remove the old one" or "remove Riverside Pharmacy", and only the add "Oak Street Pharmacy is where I pick up my prescriptions." and the medication edit were shown. The runner doesn't save the model's raw proposals, so this is inferred: no line says Riverside closed, so the check most likely dropped a removal Tom had confirmed, leaving the stale Riverside note next to the new one. When the person does say it closed (R2-D1a: "Oak Street Pharmacy now; Riverside closed."), the removal is backed and the remove-and-re-add goes through, because the new note names a different place, so the check doesn't fix remove-and-re-add either.

R2-D2 failures:
- Not worth keeping (6 of 77): `tom-new-doctor` "Dr. Chen: Dr. Osei is my family doctor." and "Dr. Chen: Dr. Osei at Lakeview Clinic is my family doctor." (the stored-name problem, as in R2-D0); `maya-no-date` "Cedar Health, where I go for physio."; `tom-dentist` "This is a dental appointment." (a phrase); `aisha-standup-phrases` "My update: leading the Harbor app redesign, due Friday."; `maya-ruth` "Ruth.". None invented.
- Edits right misses (3 of 13): `tom-new-doctor` (above), `tom-shellfish` ("I'm allergic to shellfish." as a new note again, from "Add shellfish allergy.") and `tom-pharmacy-moved` (an add, not an edit). The first two also missed in R2-D0.
- Sayable misses (5 of 40): `aisha-thai` "The green curry please." and "To take away."; `maya-leila-phrases` "Call me when you land.", "Love you." and "How was your exam?". These look like judge errors: the same or nearly the same phrases were judged sayable in R2-D0.
- No card at all in `tom-checkup` (the assistant said it had the who, when and where and never proposed before the goodbye, as in round 1), `tom-bus` and `maya-general` (8 messages).

### Fix round

A review of Tasks 2 to 4 (2a1fa93..48b2cfd) led to four changes:

- **Task 4's check reverted** (2773160). It dropped correct removals, including a "Yes." to the assistant's own "Shall I remove...?", which cites no line saying the thing ended. In R2-D2 it most likely left the stale Riverside note in place (see Task 4), and nothing measurable improved.
- **No old name on an edit** (080e2ae). The old name in front of an edit ("Dr. Chen: Dr. Osei is my family doctor.") came from the app, not the model, as Task 3's write-up had assumed. An edit that sent no name fell back to the note's stored name (`src/lib/assist/session.ts`), and suggested notes had the same fallback (`src/lib/learning/session.ts`). Both now use `editName` (`src/lib/profiles/notes.ts`), which keeps the stored name only when the note held it as a "Name: " label, when the new text still mentions it, or when the new text doesn't start with another name.
- **No name-only notes** (3e7e0ba). A new person or place note whose text is only the name ("Ruth.") is dropped. "physiotherapy" was added to the physio role group, so it backs "my physio".
- These corrections to this write-up.

R2-D3 ran this code. `tom-new-doctor` now shows "Dr. Osei at Lakeview Clinic is my family doctor." and `tom-pharmacy-moved` shows "Oak Street Pharmacy is where I pick up my prescriptions." as an edit of the Riverside note. Both were kept and both match the expected edit. No card states a name alone.

R2-D3 failures:
- Not worth keeping (7 of 73): `maya-moved-home` "Cedar Street: Home is my flat on Birch Road." (see below); `maya-bank` "I want to open a joint account with my daughter Leila." (a phrase); `tom-interview` "Wednesday 7 October, 13:00: job interview at Brightline Studio."; `maya-gp` "Tuesday 6 October, 2:30 pm: seeing Dr. Ahmed at Cedar Health about more fatigue than usual and shortness of breath at night." and "Cedar Health: where I see Dr. Ahmed."; `aisha-standup-phrases` "My update: leading the Harbor app redesign, due Friday."; `tom-have-it` "Goodbye".
- Invented (1 of 73): `tom-checkup` "Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about morning dizziness and blood pressure dose." The judge flagged "blood pressure dose" and kept the card.
- Edits right miss (1 of 13): `tom-shellfish`, "I'm allergic to shellfish." as a new note again.
- Sayable misses (2 of 39): `tom-work-phrases` "Please turn on captions." and "Can you type that in the chat?". These look like judge errors.
- Recall misses (20 of 82): mostly chats where the assistant never proposed the phrases or notes (`maya-general` and `aisha-pottery` showed no card at all; `tom-dentist`, `maya-gp`, `tom-checkup` and `maya-bank` were missing phrases or person and place notes), plus the cards above. `maya-ruth` had no person note for Ruth at all, so dropping "Ruth." didn't bring a better one.

`maya-moved-home` showed the old-name problem in all six round 2 runs, including R2-D3, and the fix above didn't cover it. The note "Home is my apartment on Cedar Street." stores Cedar Street as its name. The new text starts with "Home", a common word, so `editName` read it as not starting with another name and kept Cedar Street. A follow-up (b385701) keeps the stored name for that reason only when the old note started with it, as in "Home is my flat on Oak Road." edited to "My flat on Elm Road.". When the name was inside the old sentence and the new sentence no longer mentions it, it was replaced, so it's dropped. Replayed through `editName`, all five stale-name edit cards seen in the six runs come out with no old name. **The eval was not run again after b385701.** On R2-D3 it would change only how the `maya-moved-home` card reads, and whether the judge then keeps it isn't known.

### Still wrong on dev after round 2

- Chats that end with too little proposed: missing phrases or person and place notes are most of the recall misses (`maya-general`, `aisha-pottery`, `tom-dentist`, `maya-gp`, `maya-ruth`).
- An added allergy as a new note instead of an edit (`tom-shellfish`, every run).
- Remove and re-add when a place gets a new name. R2-D3 did it right, but earlier runs didn't, and no change targeted it after Task 4 was reverted.
- Near-copies of the same note in one answer (`maya-new-carer` in R2-D0).
- `guessEntities` reads "Dr. Osei" as the name "Dr" when it isn't given a name.
