# Assistant eval, round 2

Goal: fix the two failure patterns the first held-out run found, tuned on dev only, then measure once on a new, larger held-out set that nobody tuning has seen.

Spec: `docs/superpowers/specs/2026-09-30-onbeat-assistant-design.md`. Round 1 results and method: `eval/assist/RESULTS.md`.

## Global constraints

- Targets (unchanged): worth keeping 90%, invented under 5%, edits right 90%, recall 80%, phrases sayable 80%, median user messages 5 or fewer.
- The judge prompt (`eval/assist/judge.ts`, version 2) does not change, so its calibration stays valid. The brief-only check and scoring rules in `score.ts` do not change, except a general matcher fix recorded in RESULTS.md.
- Held-out discipline: the new test cases live in `eval/assist/test-cases.ts`, written by an agent that does no tuning, and committed before any tuning run. Tuning agents never open that file, never print its cases, and never run `--split test` until the final task.
- The 16 round-1 test cases have been seen, so they move to dev. Dev becomes 48 cases.
- One live eval process at a time. Use `--delay 500`. Keys load through `loadLocalEnv`; never print or commit them.
- Every change to `src/lib/assist/prompt.ts` or `check.ts` keeps `npx vitest run src/lib/assist src/lib/learning src/lib/suggest eval/assist` passing, with a test for any new check rule. The check only drops; it never repairs.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review focus

1. No tuning change reads like it targets a held-out case.
2. New check rules only make the check stricter and don't drop a correct card on dev without it being reported.
3. The write-up states each missed target plainly and quotes each held-out failure.

---

### Task 1: New held-out set, old test cases to dev

Files: `eval/assist/cases.ts`, new `eval/assist/test-cases.ts`, `eval/assist/cases.test.ts`.

- Change the 16 round-1 `split: "test"` cases in `cases.ts` to `split: "dev"`, keeping their ids.
- Write 32 new cases in `test-cases.ts` (`split: "test"`), exported and appended to `assistCases`. About 11 update, 11 prepare, 10 phrases, spread over Maya, Tom and Aisha; at least 5 typed openers (`job: null`); at least 5 where the right answer is to change nothing. Include realistic cases where a new person or place is named with no role stated, where a detail of an existing note changes (an edit is right), and where something ends (a removal is right, and the person says so). Dates relative to EVAL_TODAY, Monday 5 October 2026.
- Same shape and rules as `cases.ts`: second-person briefs listing every fact the user may type and nothing more, consistent with the persona's notes, plain-words `expected` facts with the right note ids, `briefOnly` terms for specific brief content a card could carry.
- Update `cases.test.ts`: 80 cases, 48 dev and 32 test, unique ids, every brief-only term in its brief and in none of the persona's notes, note ids exist.
- Commit before anything else in this plan runs.

### Task 2: Dev baseline

Run `npm run eval:assist -- --split dev --delay 500` on the current code. Record it as R2-D0 in a new "Round 2" section of `eval/assist/RESULTS.md`, with a list of every card not worth keeping or invented, and every edit or removal that was wrong.

### Task 3: Person and place notes say only what was typed

Round 1's held-out run proposed "Dr. Ahmed is my doctor." when the person only named Dr. Ahmed as who the appointment was with. Likely cause: round 1's last prompt change asked for a note for each new person or place.
- Prompt: a new person or place note states only what the person typed about them (for example "Dr. Ahmed: breathing check on Tuesday"), never a role or relationship they didn't state.
- Check: drop a note or phrase that claims a role or relationship for someone ("my doctor", "my dentist", "my GP", "my pharmacist", "my neighbour", "my manager", "my carer" and similar) unless a cited user line or the note being edited states that role.
- Tests for the check rule. Dev run R2-D1, recorded with what it fixed and broke.

### Task 4: Edit, don't remove and re-add; remove only when asked

Round 1's held-out run removed a note nobody asked to remove, and replaced a note with a removal plus a new note where an edit was right.
- Prompt: when something about an existing note changes, propose an edit of that note; propose a removal only when the person says the note is no longer true or asks for it to go.
- Check: drop a removal unless a cited user line says the thing ended or asks for removal (remove, delete, gone, left, no longer, not any more, died, stopped, finished, closed, cancelled and similar). Drop a removal when the same reply adds a new note about the same person or place (that should have been an edit).
- Tests. Dev run R2-D2.

### Task 5: Up to two more tuning rounds

Only if the dev runs show a clear remaining failure pattern: one change per round, dev run R2-D3, R2-D4. Stop when all six targets are met on dev or after two rounds.

### Task 6: Held-out run, once, and write-up

- `npm run eval:assist -- --split test --votes 3 --delay 500` on the final code. `--rejudge` only to finish judging. No product change after it.
- RESULTS.md "Round 2": the new set, the dev table per round and what each change did, the held-out table, every held-out card not worth keeping or invented quoted with its user line, every void or unjudged case by id, and a plain statement of each missed target. Recompute with the three voids counted too.

### Task 7: Final checks and PR

Typecheck, lint, full vitest, e2e `assistant.spec.ts`. Whole-branch review; fix critical and important findings. Push and open a PR against `main`. If every target is met, the PR description says so and that turning the assistant on is one setting (`NEXT_PUBLIC_ASSISTANT=1`); the switch itself is the owner's call.
