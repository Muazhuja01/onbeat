# Assistant eval results

## The judge

`openai/gpt-oss-120b` on Groq, reasoning effort high, temperature 0, up to 8,000 completion tokens (the shared settings in `eval/judge.ts`), with the rubric in `judge.ts` at `ASSIST_JUDGE_VERSION` 2. The Cloudflare copy of the same model was out of its daily allowance on every run below and judged nothing. `npm run eval:assist-judge-check` judges each gold entry once and prints agreement with the hand labels.

The judge is paired with a mechanical brief-only check (see below). The eval counts a card as invented if either of them flags it.

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

| Run | Prompt | Keep | Invented (judge) | Invented (judge or check) | Sayable | Leak |
|---|---|---|---|---|---|---|
| 1 | v2 | 35/38 (92%) | 34/38 (89%) | | 21/23 | 15/15 |
| 2 | v3 | 30/38 (79%) | 29/38 (76%) | | 22/23 | 13/15 |
| 3 | v4 | 26/38 (68%) | 27/38 (71%) | | 16/23 | 12/15 |
| 4 | v5 | 29/38 (76%) | 25/38 (66%) | | 18/23 | 13/15 |
| 5 | v2, final labels | 35/38 (92%) | 35/38 (92%) | | 21/23 | 15/15 |
| 6 | v2, 18 entries | 36/44 (82%) | 39/44 (89%) | 42/44 (95%) | 24/25 | 18/18 |

On its first 15 entries, run 6 scored keep 34/38 (89%) and invented 35/38 (92%, or 36/38 with the check).

**Where the gate stands:**
- On the first 15 entries, the v2 judge passed in run 5: at least 90% on keep and on invented, and leak right on every entry.
- On all 18 entries, invented passes only with the brief-only check (95%).
- Keep does not pass: 82%. The judge kept 4 of the 5 new brief-only cards that should be dropped. It did so even when it listed their detail as invented itself: "cleaning", "Smile Dental" and the spare key.
- If the brief-only check also made a card keep false, keep would be 41/44 (93%). I worked this out from run 6's saved verdicts. The eval doesn't apply the check to keep.

Runs 2 to 4 each changed the prompt and did worse, so those changes were dropped (see below). An unreadable answer counts as a disagreement on every card in the entry and on its leak flag. Run 1's saved verdicts were lost because its process was stopped while the Cloudflare endpoint was waiting out its quota. Its disagreements below come from the printed log, which has all of them.

### The brief-only check

The judge sees the brief and the expected changes. It doesn't count a detail as invented when the detail is true there, even though the person never typed it in the chat and the assistant never sees the brief. A prompt line about this (v3, v5) didn't help.

So each case in `cases.ts` has a `briefOnly` list: words from the brief that a card could carry but the user may never type.
- They cover names, places, what an appointment is for, and the words of a wanted phrase: for example "Smile Dental", "clean*", "blood pressure check", "check-up" and "key".
- Days and times are left to the judge, and so are words a user could easily say another way.
- A unit test checks that every term is in its brief and in none of the persona's notes.

`briefOnlyCards` in `score.ts` flags a card that states one of those terms when no user line in the chat does. The assistant's own lines don't count. `summarizeAssist` counts a flagged card as invented, together with the judge's own calls, and reports how many cards were counted only because of the check. The runner saves the flags per card and prints each one with its terms.

On the gold set, the check flags exactly the 6 brief-only cards and no other card.

### Gold label changes

One, after run 1. `maya-cafe` card 5, the note "Sometimes I order a small latte instead of a large one.", went from invented false to invented true. She asked for the phrase "just a small one today" and never said anything about her orders. The rubric counts a claim that is in none of her messages as invented, and the label's own comment already called it "a claim she never made". The judge was right. With this label, run 1 scores 35/38 on invented.

### Disagreements in run 6

First 15 entries:
- **`tom-checkup` #1, "Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about morning dizziness and blood pressure dose."** The judge said keep false and flagged `["blood pressure dose"]` as invented. It flagged the same phrase in #3, "Should my blood pressure dose change?". Gold keeps both with nothing invented, because "blood pressure" comes from Tom's medication note and that is the only dose he has. Gold is right, but this is arguable. The judge flagged this in runs 2, 4 and 6.
- **`maya-new-dentist: invented time` #3, "I can't keep my mouth open for long. I need breaks."** The judge said keep true with nothing invented. Gold is right (see run 5). The brief-only check now flags it ("mouth open", "break*"), so it counts as invented. It still counts as keep.
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

- **Brief-only details.** The judge doesn't count a detail as invented, and often keeps the card, when the detail is true in the brief or in the expected-change list but was never typed in the chat. The brief-only check covers invented for the terms listed in `cases.ts`. A detail outside those lists, or a day or time, is still up to the judge. The check does not change keep, so "worth keeping" may be overcounted on cards like these.
- **Duplicate phrases.** The judge can keep a quick phrase the person already has. The app's own check already drops a phrase that is a near-duplicate of an existing quick phrase before it is shown (`src/lib/assist/check.ts`, line 53), so this only matters for a repeat that the check doesn't catch. Where it happens, "worth keeping" is overcounted on the phrases jobs.
- **Run-to-run noise.** The same card can get a different verdict on another run. Examples are "Ruth is my new neighbour." and "blood pressure dose". Each gold card was judged once per run.
