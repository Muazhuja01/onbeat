# OnBeat learning (profiles stage 2 of 3)

Date: 2026-09-30. Status: the owner agreed the main choices in conversation (marked **(agreed)**) and delegated the rest ("if you think its best do it"). Decisions the owner has not seen are marked **(decided)** so they are easy to review and overturn.

## Why

Replies are only as good as the notes. Today notes change only when the user opens the notes editor, so they go stale: a new carer, a moved appointment, a new favourite café never reach the replies unless someone types them in. This stage lets OnBeat notice new facts in conversations and suggest them as notes, so the profile keeps up without extra work.

Success looks like this: most suggestions are worth keeping, none of them invent details, nothing interrupts a live conversation, and nothing is saved until the user taps Keep.

## What was agreed before this spec

- New facts are learned by suggestion and confirmation, never silently (profiles spec).
- The app says clearly when more of the profile goes to the AI (profiles spec).
- Profiles stay in the browser. No accounts or sync (profiles spec).
- Suggestions collect in a list the user reviews when they like, never shown mid-conversation. **(agreed)**
- Learn from the user's own typed or edited sentences, and from the partner's speech. Every suggestion shows the line it came from. Not from which replies get tapped, and not from repeated typing (phrases already cover that). **(agreed)**
- When a fact changes an existing note, suggest an edit to that note (old and new side by side), not a second note. **(agreed)**
- Learning is on by default, with a one-time notice saying what is sent and a Settings switch to turn it off. **(agreed)**
- A separate learning call, sent in batches when the conversation goes quiet (approach A). Not folded into the reply request, and not done in the browser. **(agreed)**

## Out of scope

The assistant chat (stage 3), learning from reply choices, surfacing phrases for review, notes that expire on their own, per-profile settings, accounts and sync.

## Decisions

### Collecting lines (agreed in outline)

1. **Which lines.** A line joins the learning queue when:
   - the user speaks something they wrote: in `speak()` (`src/components/conversation-screen.tsx`), anything except a quick reaction or text that exactly matches a reply on screen. A reply edited in the composer before speaking counts as the user's own words. Replies spoken as-is are skipped because they come from the notes already and about 1 in 8 has an invented detail; learning from them would bake errors in.
   - the partner finishes a line: the same `partnerSaid` turn captions and replies use. With Clearer captions on, the Nova-3 text replaces Moonshine's before the line is queued.
2. **What a line keeps.** `{ id, speaker: "user" | "partner", text, at, partnerName?, placeName? }`. Names come from the Talking-to and Place pickers, so a suggestion can say "Leila said: ...".
3. **Where the queue lives.** Per profile, IndexedDB key `learn-queue:<profileId>` in the existing `onbeat` / `memory` store. At most 40 lines; the oldest drop. Lines older than 24 hours are dropped when the queue is read, so a stale queue never goes out. Demos never queue. A profile with learning off never queues.

### Sending a batch (agreed in outline)

4. **When.** With at least 2 lines queued, a batch goes when nobody has spoken for 60 s, or 12 lines have built up, or the page is hidden (`visibilitychange`). One batch in flight at a time.
5. **What goes with it.** The lines, the pinned about-me note, and up to 8 related notes found with `MemoryStore.searchNotes` over the batch text. Never the whole profile. Also today's date and weekday, so the model can write dates in full.
6. **Outcome.** A 200 response removes the sent lines from the queue, whether or not it produced proposals. A 429 or 503 leaves them for the next batch. After 3 failed tries in a row the queue waits 10 minutes before trying again.
7. **Endpoint guards.** `/api/learn` checks same origin, rate-limits per IP (6 a minute), limits the body (40 lines of 500 characters, 9 notes of 300 characters), and never logs content. Same as `/api/notes-from-document`.

### Proposals (decided)

8. **Shape.** The model returns up to 5 proposals per batch:
   `{ action: "add" | "edit", kind: NoteKind, name?: string, text: string, noteId?: string, lineIds: string[] }`. `text` is at most 300 characters. `noteId` is required for an edit.
9. **Prompt rules.** Keep facts about the user and their people, places, routines and likes. Write a dated one-off with its full date ("Dentist on Thursday 2 October at 3pm"). Skip small talk, questions, guesses, and things with no later use (today's weather, what's for lunch). Skip anything a sent note already says. If a line changes what a sent note says, propose an edit to that note, keeping the rest of its wording. Do not propose a fact about another person unless it matters to the user (who they are to the user, when they visit). Output JSON only.
10. **Checks (on the server, before returning).** A proposal is dropped, never repaired, if:
    - it cites no line from the batch, or a line id that wasn't sent;
    - it is an edit whose `noteId` wasn't sent;
    - it has a detail its sources don't support: every claim `extractClaims` finds (names, numbers, times) must pass `claimSupported` against its cited lines plus, for an edit, the old note text, A full date the model wrote ("Thursday 1 October") passes only when it is one of the coming 15 days and a cited line names that weekday, or says tomorrow, today or tonight for those days; it is then left out of the claim check. The list of coming dates is never a source itself, since its day numbers would back any small invented number. Both functions come from `src/lib/suggest/validate.ts`, the same check that catches invented details in replies;
    - it is an add that is a near duplicate (`isNearDuplicate`) of a sent note or of another proposal in the same batch, or an edit whose text is the same as the old note once normalised (an edit is meant to be close to its note, so the near-duplicate test would drop real changes like "Mondays" to "Thursdays");
    - its kind isn't a `NoteKind`, or it is empty after trimming.
11. **Model.** Same provider order as the document route (Groq, then Cloudflare), temperature 0.2, with the reply model as the default. The learning eval compares it against `openai/gpt-oss-20b` on the dev split before one is fixed.
12. **Parsing.** The same tolerant JSON handling as `parseDocumentNotes` (objects may be pretty-printed across lines, wrapped in a fence, or preceded by reasoning text).

### The pending list (decided)

13. **Storage.** Kept proposals go to IndexedDB key `learn-pending:<profileId>`: `{ id, action, draft: { kind, name?, text }, noteId?, oldText?, sources: { speaker, text, at, partnerName? }[], createdAt }` (the draft is the same shape the note form edits). `oldText` is the note's text when proposed. At most 30; when full, the oldest drop.
14. **Merging.** A new proposal replaces a pending one that edits the same note, or that is a near duplicate of it. The list never holds two versions of the same fact.
15. **Skips are remembered.** Skip stores a fingerprint (the normalised token string of the proposal text) under `learn-skipped:<profileId>`, the last 200. A new proposal that is a near duplicate of a skipped one is dropped in the browser.
16. **Export and import** include the pending list (it is part of the profile). They leave out the queue (raw conversation text) and skip fingerprints. The import schema accepts files without it, so older exports still import.
17. **Deleting a profile** deletes its queue, pending list and skip list.

### Review (decided)

18. **Where.** The profile menu gets "Suggested notes" with the count ("Suggested notes (3)"). The profile menu button shows a small count badge when there are any. No sound, no vibration, no live-region announcement: the count is in the button's accessible name ("Maya, 3 suggested notes"), so a screen reader hears it only when it reaches the button. This keeps it quiet during a conversation.
19. **The screen.** A new view, `suggestions`, laid out like the notes editor. Newest first. Each card shows:
    - a label: "New note: People" or "Change a note: Routines";
    - for an edit, the current note text ("Now") above the proposed text ("New");
    - the source lines, quoted with who said them and when ("Leila said: 'your physio moved to Thursdays', today 3:12 pm");
    - three buttons: **Keep**, **Edit**, **Skip**.
    At the bottom: "Skip all", which asks once. There is no "Keep all": every fact gets its own look.
20. **Keep.** An add builds a note with `buildNote` and saves it. An edit keeps the note's id and `pinned`, and replaces its text. The reply cache is cleared (`client.clearCache()`), the card goes, and the screen reader hears "Kept".
21. **Edit.** Opens the existing note form filled with the proposal; saving it counts as Keep, cancel returns to the card.
22. **Stale edits.** If the target note was deleted since, the card shows as "New note". If its text changed since (it no longer matches `oldText`), the card shows the current text under "Now", so the user compares against what is really there.
23. **Empty state.** "Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep."

### Telling the user (decided)

24. **Settings.** A checkbox, on by default: "Suggest notes from my conversations". Help text: "After a pause, OnBeat sends recent lines from your conversations, and the notes they relate to, to its AI service to spot new facts. Nothing is saved until you choose Keep." Stored like the other settings (`onbeat:learning`, off stored as "off"). It is device-wide, like Clearer captions. Turning it off empties every profile's queue; pending suggestions stay for review.
25. **New profiles.** The last setup step adds one line: "OnBeat will suggest notes from your conversations. You choose what to keep. You can turn this off in Settings." Finishing setup sets the flag from decision 26, so the notice below is not shown again.
26. **Existing profiles.** A one-time notice on the conversation screen, using the existing notice area, the first time the app opens after this change: "New: OnBeat can suggest notes from your conversations for you to review. Turn it off in Settings." A localStorage flag (`onbeat:learning-told`) stops it repeating. No lines are queued until the notice has been shown.

## Architecture

### New modules

- `src/lib/learning/types.ts`: `QueuedLine`, `Proposal` (the wire shape) and `PendingSuggestion` (the stored shape).
- `src/lib/learning/queue.ts`: `LearningQueue`, bound to one profile's `KeyValue`. `add(line)`, `take()` (lines to send, trimmed by age and cap), `ack(ids)`, `fail()`, and the backoff state. Pure logic plus the key-value calls.
- `src/lib/learning/batcher.ts`: decides when to send (quiet timer, line count, page hidden). Takes a clock and a `send` function so tests run on fake timers.
- `src/lib/learning/prompt.ts`: `buildLearnMessages(lines, notes, today)` and `parseProposals(output)`.
- `src/lib/learning/check.ts`: `checkProposals(proposals, { lines, notes, today })`, the server-side checks in decision 10.
- `src/lib/learning/pending.ts`: `PendingStore` for the pending list and skip list: `list()`, `merge(proposals, sources, notes)`, `keep(id)`, `skip(id)`, `skipAll()`.
- `src/lib/learning/client.ts`: the browser side. Posts a batch to `/api/learn` and returns proposals or an error kind.
- `src/app/api/learn/route.ts`: the endpoint. Shaped like `/api/notes-from-document`: guards, `streamCompletion`, parse, check, JSON back.
- `src/components/suggested-notes.tsx`: the review view.

### Changed modules

- `conversation-screen.tsx`: owns one `LearningQueue`, `Batcher` and `PendingStore` per open profile (none for demos); feeds lines from `speak()` and `partnerSaid`; adds the `suggestions` view; shows the one-time notice.
- `profile-menu.tsx`: the "Suggested notes (n)" entry and the badge.
- `settings-panel.tsx` and `src/lib/settings.ts`: the learning checkbox.
- `profile-setup.tsx`: the line in the last step.
- `src/lib/profiles/transfer.ts`: pending list in export and import (optional field).
- `src/lib/profiles/registry.ts`: `remove(id)` also deletes the three learning keys.

### Data flow

```
speak() / partnerSaid ──> LearningQueue (IndexedDB) ──> Batcher (quiet 60 s | 12 lines | hidden)
                                                            │
                                  lines + related notes + today
                                                            ▼
                                                     POST /api/learn
                                         model ─> parseProposals ─> checkProposals
                                                            │
                                               proposals (0 to 5)
                                                            ▼
                         PendingStore.merge (drop skipped, merge duplicates) ──> badge count
                                                            │
                                     user opens Suggested notes: Keep / Edit / Skip
                                                            ▼
                                          MemoryStore.upsertNote, clear reply cache
```

## Error handling

- Provider down or rate-limited: lines stay queued; backoff after 3 failures (decision 6). The user sees nothing, since this runs in the background.
- Malformed model output: treated as no proposals; the lines are acknowledged so a bad batch can't loop.
- Storage blocked (private window): the queue and pending list live in memory for the visit, like notes do.
- Switching profile mid-batch: the batch's result is written to the profile it was sent for, never the one now open. The batcher for the old profile is disposed after its in-flight request settles.
- Page closed mid-batch: the lines were not acknowledged, so they go with the next batch.

## Testing

- Unit tests for every new module: queue cap, age trim and backoff; batcher timings on fake timers; prompt building and parsing (pretty-printed, fenced, reasoning-prefixed output); each drop rule in `checkProposals`, including the date line; pending merge, skip memory and stale edits.
- Route tests like `notes-from-document/route.test.ts`: guards, rate limit, body limits, provider failure, bad output.
- Component tests: the review card for add, edit, stale edit and deleted target; Keep, Edit, Skip, Skip all; badge count and accessible name; the settings checkbox; the one-time notice.
- End to end (Playwright, `/api/learn` mocked): a short scripted conversation, a quiet gap, the badge appears, Keep adds the note to the notes editor, and a reply request afterwards sends it.
- Export and import round trip with a pending list, and an older export without one.

## Learning eval

Replies had to pass a measured bar before deploy; learning gets the same treatment.

- `eval/learning/`: scripted conversations, each with the profile's notes and hand-labelled expected facts (adds and edits), plus lines that should produce nothing (small talk, questions, gossip, one-offs). About 60 conversations, split 40 dev and 20 test. Some partner lines carry the kinds of errors the live captions make (dropped words, misheard names), taken from the hearing eval's Moonshine output.
- `npm run eval:learning` runs the real prompt and checks against a model and scores:
  - **Precision:** share of shown suggestions that are true and worth keeping. Target at least 80%.
  - **Invented details:** share of shown suggestions with a detail not in the lines or notes. Target under 5%, the same bar as replies.
  - **Edit targeting:** share of changed facts shown as an edit of the right note, not a new note. Target at least 90%.
  - **Recall:** share of expected facts suggested. Reported, no target; missing a fact costs less than a wrong one.
- Judging uses the calibrated judge from the reply eval (`eval/judge.ts`) with a learning rubric and a small hand-labelled gold set checked with the judge-check flow. Groq is on the free tier, so runs are paced.
- Tune on dev; run test once at the end. Results go in `eval/learning/RESULTS.md`. As with replies, shipping below target needs the owner to accept the measured numbers.

## Cost

One call per quiet gap: about 3 to 6 per 20-minute conversation. A typical batch is under 2,500 input tokens; the body limits in decision 7 cap it at about 7,000. On the Groq free tier this fits comfortably beside reply calls; on Cloudflare it uses neurons from the same daily allowance as the other fallbacks.
