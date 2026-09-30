# Assistant eval results

The assistant is measured on 48 scripted cases (`cases.ts`) over the three example people (Maya, Tom and Aisha): 32 dev cases used for tuning and 16 test cases held out. Each job has 16 cases: update their information (11 dev, 5 test), prepare for an appointment (10 dev, 6 test) and make quick phrases (11 dev, 5 test). Seven cases start from a typed first message instead of a job button (4 dev, 3 test), and six expect no change at all (2 dev, 4 test), such as a note that is still right or an appointment that was cancelled. Today is fixed at Monday 5 October 2026, so dates have one right answer. Each case has a brief (what the person wants and every fact they may type), the changes a good chat should end with (65 on dev, 28 on test), and a list of brief-only terms (see the judge section).

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

## Dev split (32 cases, 1 judge vote)

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

## Test split (16 cases, 3 judge votes)

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
