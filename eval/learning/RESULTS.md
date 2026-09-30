# Learning eval results

Suggested notes are measured on 60 scripted conversations (`scenarios.ts`) over the three example people: 40 dev scenarios used for tuning and 20 test scenarios held out. All 60 were written before any tuning and not changed afterwards. Categories: a new fact from the user (10) or from the other person (10), a change to an existing note (12), a dated one-off (6), nothing worth a note (10), other people's business (4), misheard captions (5), and a mix (3). Today is fixed at Monday 5 October 2026 so dates have one right answer.

Each scenario goes through the app's own path: the notes search picks what to send (text search, no embedder, like the reply eval), `learnFromBatch` runs the prompt and the server checks, and the pending list's merge rules decide what the user would see. A judge then reads each shown suggestion against the conversation and the notes.

Run it with `npm run eval:learning -- --split dev` (keys come from `.env.local`, or from the main checkout's when run in a git worktree). `--rejudge <results.json>` judges only scenarios the judge could not finish, without regenerating.

## Targets

- Worth keeping: at least 80% of shown suggestions are true and worth saving.
- Invented: under 5% of shown suggestions state a detail found in none of the conversation, the notes or the coming dates.
- Edits right: at least 90% of changed facts are shown as an edit of the right note.
- Recall: reported, no target. Missing a fact costs less than a wrong one.

## The judge

`openai/gpt-oss-120b` on Groq, reasoning effort high (the same settings as the reply judge), with the learning rubric in `judge.ts`. Against 12 hand-labelled gold entries (17 suggestions, `judge-gold.ts`) it agrees on keep for 16 of 17 (94%) and on invented for 16 of 17. The one invented disagreement was an error in the gold text ("where Leila lives" when the conversation only says "here"); the judge was right, and the example was fixed. The keep disagreement: the judge kept "I love sunny mornings" from "Gorgeous. Perfect for a walk with Biscuit.", which the gold label calls a guess.

Medium effort was tried to fit more judge calls into Groq's free daily allowance. It fell to 14 of 17 on keep and flagged a true detail as invented, so it was not used.

The Cloudflare judge was out of its daily allowance for the whole pass and judged nothing.

## Dev split (40 scenarios, 1 judge vote)

Model `qwen/qwen3.8-27b` (the reply model) unless named.

| Run | Change | Shown | Worth keeping | Invented | Edits right | Recall |
|---|---|---|---|---|---|---|
| D1 | Baseline, after the search fix below | 32 | 91% (29/32) | 6% (2/32) | 55% (6/11) | 81% (26/32) |
| D2 | Check accepts "9:00" and "AM"; prompt rules for known people and places, dates, other people's news, roles | 34 | 94% (32/34) | 3% (1/34) | 82% (9/11) | 94% (30/32) |
| D3 | Prompt shows how a change keeps the rest of a note | 34 | 97% (33/34) | 0% (0/34) | 100% (11/11) | 97% (31/32) |
| D3, `openai/gpt-oss-20b` | Same code as D3 | 33 (8 of 40 failed) | 91% (30/33) | 3% (1/33) | 82% (9/11) | 69% (22/32) |

What each change fixed:

- Search (before D1): the note a line changes reached the model in 10 of the 15 edit scenarios. Everyday words matched nearly every note under typo tolerance, the pinned note took one of each line's three slots, and a line like "we close at six on Saturdays" never names the place. Searching with content words and always sending the notes for the Talking with and Place choices brought it to 15 of 15. This was measured without model calls.
- Check (D2): the model wrote "9:00 AM", "11:00" and "10:00" for lines that said "nine", "eleven" and "10"; the invented-detail check dropped all three. "9:00" now counts as "9", and capital AM/PM is read like lowercase. "9:30" still needs its digits in a line.
- Prompt (D2): facts about a person or place that has a note now change that note instead of adding a second one; a date is written only when a line names the day (the model had turned "end of the month" into "Friday 30 October", which the check dropped); other people's news is left out; no inferred roles ("Omar is the pharmacist").
- Prompt (D3): a made-up example (a library, not any scenario) of a change that keeps the rest of the note. Before it, edits dropped still-true parts ("due on Friday") or were filed as new notes.

`gpt-oss-20b` was worse on every measure and 8 of its 40 batches produced no first token within 10 s, so the reply model stays. The eval's batch time for qwen (p50 about 4 s in D3) includes free-tier rate-limit waits; batches run in the background, so the user never waits on them.

Remaining dev miss (D3): the misheard Harbor review became an edit of the Harbor note that dropped "due on Friday"; the judge rejected it.

## Test split (20 scenarios, 3 judge votes)

Run once on 2026-09-30 with the final code (PR #11 head `aab1c95`, which adds the review's check fixes to D3), `qwen/qwen3.8-27b`, Groq paid plan. Each suggestion is judged by the majority of 3 votes.

| Shown | Worth keeping | Invented | Edits right | Recall | Batch p50 |
|---|---|---|---|---|---|
| 15 | 100% (15/15) | 7% (1/15) | 100% (4/4) | 93% (14/15) | 442 ms |

Three targets are met. Invented misses its target: 1 of 15 is 7%, and with 15 suggestions a single one is enough to miss under 5%. The five "nothing worth a note" and "other people's business" scenarios in the split produced no suggestion, as they should.

- Invented (`maya-neighbour-key`): the line was "My neighbour Ruth has a spare key if anything happens." The suggestion read "Ruth is my neighbour and has a spare key to my home if I need help." The judge flagged "home", which no line says. It is almost certainly right, but under the rubric it is still an added detail.
- Recall miss (`tom-flu-jab`): Priya said the flu jab is ready any time this month, no appointment needed. The suggestion kept only "I will pick up my flu jab at Riverside Pharmacy next week." It is true and was kept, but it drops the offer the scenario expected.

Batch time is lower than on dev because the paid plan has no rate-limit waits.

Earlier attempts are void and were not used for tuning. The first ran out of judge quota after 10 of 20 scenarios and its runner lost the unjudged suggestions (the runner now keeps them and `--rejudge` finishes them). The second was generated with the D3 code, which the review then changed.

### The review's check fixes on dev

The final review tightened the server check (an added note may no longer borrow a detail from an unrelated sent note, and an edit's name is now checked). To see whether that costs good suggestions, the 40 dev conversations were sent to the model once more and each batch was checked under both rules (model only, no judge): 36 proposals, 36 kept under the old rule and 36 under the new one. The stricter check dropped nothing on dev.
