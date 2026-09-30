# Assistant eval results

## The judge

`openai/gpt-oss-120b` on Groq, reasoning effort high, temperature 0, up to 8,000 completion tokens (the shared settings in `eval/judge.ts`), with the rubric in `judge.ts` at `ASSIST_JUDGE_VERSION` 2. The Cloudflare copy of the same model was out of its daily allowance on every run below and judged nothing. `npm run eval:assist-judge-check` judges each gold entry once and prints agreement with the hand labels.

### Gold set

`judge-gold.ts` has 15 entries and 38 cards. Eight are the real chats from `npm run eval:assist -- --split dev --no-judge` on eight dev cases (qwen/qwen3.8-27b), with the 13 cards the app showed. Five of those chats ended with no card, and they are there for the leak flag. The other seven reuse those chats with cards made wrong on purpose: an invented time, a removal nobody asked for, an edit that drops a still-true part, a phrase with a name from nowhere, phrases that aren't sayable, a user line with a fact outside the brief, and right-sounding cards on the case that expects nothing, where each one repeats a quick phrase or note the person already has.

Label mix: keep 20 true and 18 false; invented 6 true and 32 false; 23 quick phrases, 21 sayable and 2 not; leak true on 1 entry out of 15. Every card and leak flag was labelled from the rubric and committed before the judge saw any of them. Non-obvious labels have a comment in the file.

### Result

| Run | Prompt | Keep | Invented | Sayable | Leak |
|---|---|---|---|---|---|
| 1 | v2 | 35/38 (92%) | 34/38 (89%) | 21/23 | 15/15 |
| 2 | v3 | 30/38 (79%) | 29/38 (76%) | 22/23 | 13/15 |
| 3 | v4 | 26/38 (68%) | 27/38 (71%) | 16/23 | 12/15 |
| 4 | v5 | 29/38 (76%) | 25/38 (66%) | 18/23 | 13/15 |
| 5 | v2, final labels | 35/38 (92%) | 35/38 (92%) | 21/23 | 15/15 |

The judge passes at v2: at least 90% on keep and on invented, and leak right on every entry (run 5). It is the prompt Task 13 wrote. Runs 2 to 4 each changed the prompt and did worse, so those changes were dropped (see below). An unreadable answer counts as a disagreement on every card in the entry and on its leak flag.

### Gold label changes

One, after run 1. `maya-cafe` card 5, the note "Sometimes I order a small latte instead of a large one.", went from invented false to invented true. She asked for the phrase "just a small one today" and never said anything about her orders. The rubric counts a claim that is in none of her messages as invented, and the label's own comment already called it "a claim she never made". The judge was right. With this label, run 1 scores 35/38 on invented.

### Disagreements in the passing run (5)

- `maya-cafe` #3, "Can I get a napkin?": the judge flagged `["napkin"]` as invented. Gold says not invented because the phrase asks for something but contains no name, number, time, date, place or claim. Gold is right by the rubric's list, but this one is arguable. The card is keep false either way. The judge flagged it on every run.
- `maya-ruth` #1, "Ruth is my new neighbour.": the judge said keep false. Gold keeps it, because she typed exactly that and never typed the spare key from her brief. Gold is right. The judge kept this same card in run 1 and dropped it in the variant, so it flips between runs.
- `maya-ruth` #4, "Thanks for walking Biscuit.": the judge flagged `["walking Biscuit"]` as invented. Gold is right: Biscuit and walking both come from her message, and a thank-you states no fact. It was flagged in runs 1 and 5. The card is keep false either way.
- `maya-new-dentist: invented time` #3, "I can't keep my mouth open for long. I need breaks.": the judge said keep true with nothing invented. Gold says keep false and invented. She never typed this in the chat. It is only in her brief and in the list of expected changes, and the assistant never sees either. Gold is right. The judge made this mistake on every run where it answered this entry: runs 1, 2 and 5, plus a single v4 call made to diagnose it, where it matched the card to the listed change. In runs 3 and 4 the answer was empty.
- `tom-have-it` variant #1, "Please write it down." for Priya: the judge kept it. Gold says keep false because he already has this exact quick phrase, and it is listed in the judge's notes. Gold is right. It was missed in runs 1 and 5.
- `tom-have-it` variant #1 and #2 (the reworded "Could you please write it down?"): the judge said sayable false. Gold says sayable true, since both are fine to say. Gold is right. The judge seems to mark a duplicate as unsayable.

### Disagreements in run 1

These were the same as run 5 except for the following:

- `maya-cafe` #5: see the label change above. The judge was right.
- `maya-ruth: phrase with a name from nowhere` #3, "Could you ask Daniel to walk Biscuit today?": the judge said sayable false. Gold says sayable true, because sayable is about the wording and the made-up name is already covered by keep and invented. This is arguable, since "say it as it is" could include the content.
- `maya-cafe: phrases that aren't sayable` #2, "Maya would like her usual order.": the judge said sayable true. It is in the third person, not her own voice. Gold is right.
- In run 1, `maya-ruth` #1 was kept in the real entry and dropped in the variant.

### Prompt changes tried and dropped

- **v3 (run 2).** Four changes:
  - The brief is not a source: a detail only the brief has is still invented, and leaving out something she never typed is not wrong.
  - A proposal that repeats a note or quick phrase "in the same or other words" is not worth saving.
  - Asking, thanking or greeting is not a claim.
  - Sayable is about wording only (first person, not an instruction).

  This fixed the Daniel and third-person sayable calls and the duplicate phrase. It broke other things. The judge read "repeats what a note already says" as repeating her own messages, so it dropped "The usual, please.", "Can you bring it to my table, please?" and "Just a small one today.". It marked `aisha-far-date` as a leak: its reasoning counted the job button line "Prepare for an appointment" as a fact outside the brief. It returned 2 cards for 3 proposals once. The dentist card was still wrong.
- **v4 (run 3).** Three changes:
  - The duplicate rule was narrowed to the notes and quick phrases the app had.
  - The job button lines state no fact.
  - "One entry in cards for each of the N proposals."

  Three entries came back empty. The only readable disagreement was "Can you bring it to my table, please?" (keep false).
- **v5 (run 4).** It added that the expected-change list is written from the brief, so a proposal that matches a listed change is still invented if she never typed its details. Two entries ran out of the 8,000 completion tokens while reasoning (finish reason `length`) and came back empty. The judge also flagged "blood pressure dose" (it is in Tom's medication note), "next time" in "Thanks, see you next time." and "where I go for parent-teacher meetings" as invented.

Each change made the judge reason for longer and did not fix what it targeted, so the prompt is back at v2.

### What this means for the numbers

The v2 judge has two misses that repeat, and anyone reading the assistant's numbers should know about them:

- **Brief-only details.** It does not count a detail as invented when the detail is true in the brief or in the expected-change list but was never typed in the chat. The invented rate may be undercounted for guesses that happen to be right.
- **Duplicate phrases.** It can keep a quick phrase the person already has, so "worth keeping" may be overcounted on the phrases jobs.
