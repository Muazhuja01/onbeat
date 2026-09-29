# OnBeat quality pass: design

Date: 2026-09-28. Parent spec: `docs/superpowers/specs/2026-09-27-onbeat-design.md` (section 9 sets the gate). Baseline: `eval/RESULTS.md` (plan 2, eval run 2).

## 1. Goal

Before OnBeat is deployed, the default model must reach, on a held-out test set:

- a top-3 hit rate of at least 90% (a shown reply says what the user meant), and
- invented details in under 5% of shown replies.

The owner set 90% ("make sure these numbers are optimized and made better before deployment. Preferably 90%") and left the rest to the controller, which set the 5% bound.

Speed must not get worse: first-reply p50 in the eval may rise by at most 150 ms over the baseline for the chosen model, and the in-app median from the partner's last word to replies on screen stays near the parent spec's "about 1 second".

If the test set misses a target after the work in section 4, the results are written up as measured and the owner decides (parent spec section 9 allows the owner to accept the numbers). Nothing is deployed in this pass.

## 2. What the baseline shows

Eval run 2, 60 scenarios, default model `qwen/qwen3.8-27b` on Groq:

| | Qwen | gpt-oss-20b |
|---|---|---|
| Top-3 hit rate | 63% (37 of 59) | 76% (42 of 55) |
| Scenarios with no reply shown | 19 of 59 | 1 of 55 |
| Hit rate when replies were shown | 93% (37 of 40) | 78% (42 of 54) |
| Invented details shown | 21 of 119 (18%) | 35 of 159 (22%) |

Two causes explain most of the gap:

1. **Replies lost to formatting.** In all 19 empty Qwen scenarios the model produced zero parseable lines. A probe of three of them showed correct replies in the wrong shape: each JSON object pretty-printed over several lines, sometimes inside a ```` ```json ```` fence. `createLineSplitter` splits on newlines, so a multi-line object never parses. The app has the same bug as the eval.
2. **Invented details the validator can't see.** The validator checks names, numbers, days and times. Most flagged replies invent an event, a state, a symptom, a preference or a choice ("Just a small espresso today.", "No, just mild dizziness."). The prompt invites some of this: it asks for "an alternative" as the third reply. A few are judge errors (restating the partner or a saved phrase).

Smaller causes: Tom's about-me note ("I'm Deaf") was not among the notes sent once, which produced "Yes, I can hear you"; two validator blind spots (a name as the first word of a sentence; "Dr." ending a sentence); relative time words beyond tomorrow/yesterday/tonight.

## 3. How results are measured

The 90% has to mean something, so the eval changes first, before any tuning.

**Held-out test set.** Write 60 new scenarios (20 per profile, same shape and mix as today, including about a fifth with typed letters) before touching the prompt. The existing 60 become the dev set, used while tuning. The test set is run only to report results: after the work in section 4 is done, and at most twice. The gate is judged on the test set; both sets are reported.

**Judge precision.** The judge (`openai/gpt-oss-120b`) lists, for each reply, the factual claims it makes and where each is backed (a note, the situation, the partner, the typed text, a saved phrase, or nothing). A reply counts as invented only if a claim is backed by nothing. Plain courtesy, yes/no answers and restatements of what the partner said are not claims. This is still one call per scenario.

**Judge availability.** The judge falls back to the same model on Cloudflare Workers AI when Groq answers 429 after its retries, so a spent daily quota on one provider doesn't stall a run. Judgements are cached on disk by scenario id plus the exact reply texts, so a rerun only judges replies it hasn't seen. The cache is git-ignored.

**Scoring fixes.** Invented details are divided by the replies in judged scenarios, not all shown replies. Scenarios with no reply shown are reported as their own column ("Empty"), since they are a different failure from a wrong reply.

**Diagnosis.** When a scenario shows no reply, the runner saves the raw model output in the results file, so format failures can be seen without a separate probe.

**Live timing.** The in-app live check reports at least 10 turns.

## 4. Changes to the app

### 4.1 Stream parsing

Replace newline splitting with an object splitter that reads the stream character by character, tracks string and escape state and brace depth, and emits each top-level JSON object when its depth returns to zero. Text outside objects (fences, prose, blank lines) is ignored. Each object then goes through the existing `parseLine` checks. The client (`src/lib/suggest/client.ts`) and the eval use the same splitter, so the first reply still appears as soon as its object closes. Tests cover pretty-printed objects, fenced output, several objects on one line, braces inside strings, and objects split across chunks at every position.

### 4.2 Prompt

The three replies become: a direct answer; a direct answer with one detail taken from the notes or the conversation; and the opposite or a neutral answer (for example "No thanks." or "Let me check."). The prompt no longer asks for "an alternative".

The facts rule widens from names, places, numbers, days and times to anything about the person: what they did, have, feel, want, plan or prefer. If the notes and the conversation don't say it, a reply doesn't say it. When the answer isn't in the notes, the reply stays short and general or asks back. The rule gets two short counter-examples in the prompt.

The output format line asks for one JSON object per line again, but section 4.1 no longer depends on it.

The same prompt serves both providers. Changes are tuned on the dev set only.

### 4.3 Retrieval

The profile's main about-me note, the one that says who the user is and how they communicate, is always among the notes sent. It takes one of the 8 places. Which note that is gets marked on the note itself, not guessed from its text.

### 4.4 Validator

- A capitalised word at the start of a sentence is checked as a possible name when it isn't a common English word (a short list of everyday words kept next to the validator's other word lists, for example "Yes", "Large", "Thanks", "Sure", "Okay").
- Titles with a full stop ("Dr.", "Mr.", "Mrs.", "Ms.") don't end a sentence, so the name after them is checked.
- Relative time words that need a source grow to include "this week", "next week", "this weekend", "next month" and "later today". "Today" stays unchecked.

Each change gets tests with the replies quoted in `eval/RESULTS.md`, plus tests that ordinary replies still pass.

### 4.5 Claim check (conditional)

A second, small and fast model on Groq (the plan picks one, for example `llama-3.1-8b-instant`, after checking availability and latency) reads each reply with the notes and the conversation and answers whether it states anything about the person that they don't back. A reply that fails isn't shown.

If the check model errors or takes longer than 600 ms, the reply is shown (the deterministic validator still applies), so a slow checker never empties the list. This is built behind a flag and measured in the eval on the dev set, with and without the check. It goes into the app only if, after sections 4.1 to 4.4, the default model is still at or above 5% invented on the dev set, and the check brings it under 5% while adding at most 250 ms to first-reply p50. Otherwise the flag stays off and the code stays for plan 3 to decide. The check never runs on replies from the phrase matcher, only on model replies.

### 4.6 Reply timer

The response-gap timer's waiting list (plan 2 ruling R14) is cleared when the conversation resets (profile switch) and when listening stops, and a waiting turn older than 30 seconds is dropped.

## 5. Model choice

After sections 4.1 to 4.5, run the dev set for Qwen and gpt-oss-20b and apply the plan 2 rule (fewer invented details; then higher hit rate, a gap under 5 points being a tie; then lower first-reply p50). Then run the test set for the chosen default and the Cloudflare backup. The backup is reported against the same targets but doesn't gate deployment.

## 6. Order of work

1. Eval: test set, judge precision and fallback, cache, scoring fixes, raw output on empty scenarios. Baseline the dev set with the current app; the test set stays unseen.
2. Stream parsing (4.1). Rerun the dev set.
3. Prompt (4.2), retrieval (4.3), validator (4.4). Rerun the dev set after each.
4. Claim check (4.5) behind a flag; measure; decide.
5. Model choice (section 5); reply timer (4.6).
6. Test set, live check, write-up in `eval/RESULTS.md` and the README table.

Full eval runs are started by the controller, not by task agents (plan 2 ruling R8). Each dev run is about 20 minutes for two models.

## 7. Out of scope

Plan 3 items (settings and notes screens, first-run flow, accessibility pass, iOS audio, deploy, demo video), a reranker beyond the pinned note, fine-tuning, and new languages.
