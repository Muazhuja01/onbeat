# OnBeat assistant (profiles stage 3a)

Date: 2026-09-30. Status: the owner agreed the choices and all four design sections in conversation (marked **(agreed)**). Details added while writing are marked **(decided)** so they are easy to review and overturn. The owner then went away and delegated the remaining choices ("select whatever you recommend"), so this spec was not reviewed by them before the plan was written.

## Why

Notes and phrases are what make replies sound like the user, but keeping them up to date means opening the notes editor and writing each one by hand, and preparing for an important conversation (a doctor, a bank, a school meeting) has no help at all. The assistant is a short chat that does three jobs: update my information, prepare for an appointment, and make quick phrases. It ends in notes and phrases the user confirms one by one.

Success looks like this: the user finishes a job in a few typed messages, what they keep is true and useful, nothing is invented, and nothing is saved without Keep.

## What was agreed before this spec

- The chat gets concrete jobs, not open chatting (profiles stage 1 conversation).
- The app says clearly when more of the profile goes to the AI (profiles spec).
- Profiles stay in the browser. No accounts or sync (profiles spec).
- New facts are confirmed by the user, never saved silently (profiles and learning specs).
- Stage 3 is split: this spec (3a) covers update my information, prepare for an appointment and quick phrases. Practise a conversation (3b) gets its own spec, built on the conversation screen. **(agreed)**
- Job buttons plus free typing. **(agreed)**
- Quick phrases appear in a row on the conversation screen that follows Talking with and Place. **(agreed)**
- The chat is not kept after it closes; only what the user keeps is saved. **(agreed)**
- One model call per turn returning JSON with the message and checked proposals (approach A). Not tool calls, not a separate extraction call. **(agreed)**

## Out of scope

Practise a conversation (3b), keeping or exporting chats, voice input to the chat, reminders or calendar entries, notes that expire on their own, per-profile settings, accounts and sync.

## Decisions

### Opening and closing (agreed)

1. **Where.** "Assistant" in the profile menu, next to "Your notes". Not offered in demos, which are never saved.
2. **Screen.** A full screen like Your notes. Opening it while a conversation runs stops listening and any speech first.
3. **First screen.** "What would you like to do?" with three buttons: Update my information, Prepare for an appointment, Make quick phrases. Under them a notice: "The assistant sends your notes and quick phrases to the AI service OnBeat uses, more than a reply does. OnBeat doesn't keep them." Then a text box, "Or type what you need", for anything else.
4. **Closing.** If any cards are not yet kept or skipped, the app asks "Leave without keeping N changes?". Then the chat is discarded. Switching profile from the menu closes the chat without asking, since switching is already a deliberate choice. **(decided)**
5. **Length.** A chat takes up to 20 user messages. After that the assistant says to start a new chat, and the text box is disabled until they do. **(agreed)**

### The chat (agreed)

6. **One question at a time.** The assistant asks short questions, one per message, because typing is slow. Its message is at most 400 characters.
7. **Update my information.** The assistant asks what changed, or offers to go through a group of notes ("Want to check the people in your notes?"). It proposes adds, edits and removals.
8. **Prepare for an appointment.** The assistant asks who, when, where, what it is about, and what the user wants to say or ask. It proposes:
   - a dated note, e.g. "Thursday 8 October, 10:00: seeing Dr Patel at the clinic about my blood pressure";
   - a person note and a place note when those are not in the notes yet, so they appear in Talking with and Place;
   - 3 to 5 quick phrases for that person or place.
9. **Make quick phrases.** The assistant asks who or where they are for and what the user often needs to say, and proposes phrases in the user's voice, each at most 120 characters.
10. **Free typing.** Without a job, the assistant works out which of the three jobs fits and says so. For anything else it says what it can help with. **(decided)**

### Cards (agreed)

11. **Kinds.** New note, changed note (old and new text side by side), removed note, new quick phrase (with who or where it is for). Cards appear under the assistant message they came with.
12. **Keep, Edit, Skip** as in Suggested notes. Nothing is saved without Keep. A removal card has Delete and Skip instead (there is nothing to edit), and Delete asks once more: "Delete this note?". The pinned about-me note is never offered for removal. **(button label and pinned rule decided)**
13. **Changed since.** Keep compares the note's text now with the card's old text. If it differs (edited in Your notes, or by a kept suggested note), the card says "This note has changed since" and offers only Edit and Skip. The same applies to a removal.
14. **Duplicates.** Keep on an add or phrase whose words match an existing note or quick phrase saves nothing and says "You already have this." A double tap saves once.
15. **Who a phrase is for.** The model names a person or place. At Keep this resolves to an existing person or place note by name, else to one kept earlier in the same chat, else the phrase is general.

### Quick phrases in conversation (agreed)

16. **The row.** "Your phrases", under Quick reactions, one tap to speak. It shows up to 4 quick phrases for the current Talking with or Place (Talking with first), else up to 4 general ones. Hidden when there are none. Within a group, most used first, then newest. **(ordering decided)**
17. **Typing** still finds quick phrases by their first letters, like every saved phrase.
18. **Tapping** a quick phrase speaks it and counts a use, like a spoken phrase. It is not learned from (stage 2 skips replies tapped as they are; the same rule applies). **(decided)**
19. **Managing.** Your notes gets a "Quick phrases" section: each phrase with who or where it is for, Edit and Delete, and an Add button that asks for text and an optional person or place. **(Add decided)**
20. **Everyday phrases** saved from speech are not quick phrases and never appear in the row.

### What is sent (agreed)

21. The job, today's date, the chat so far, the profile's notes and its quick phrases.
22. All notes go if their text totals under 12,000 characters (about 40 full notes). Otherwise the about-me note plus the notes related to the chat's user lines (same search as learning) up to that total. The notice says "your notes", not "all your notes", for this reason.
23. Chat lines never reach the learning queue, so a fact is not suggested twice.

## Architecture

### Route

`POST /api/assist` (`src/app/api/assist/route.ts`). Same origin, no logging, body limit 64 KB **(decided)**, 10 requests a minute per address. One call to the reply model, `qwen/qwen3.8-27b`, with Cloudflare as backup; `ASSIST_MODEL` overrides the model. Not streamed; the screen shows a typing indicator.

Request:

```ts
interface AssistRequest {
  job: "update" | "prepare" | "phrases" | null;
  today: string; // ISO date, the user's local day
  lines: { id: string; speaker: "user" | "assistant"; text: string; proposed?: string[] }[]; // U1.., A1..; proposed lists what an assistant line already offered, so it is not offered again
  notes: { id: string; kind: NoteKind; text: string }[]; // N1.., the text already includes a person or place name
  phrases: { id: string; text: string; for?: string }[]; // Q1.., for = person or place name
}
```

Response:

```ts
interface AssistResponse {
  say: string;
  proposals: AssistProposal[];
}
type AssistProposal =
  | { action: "add"; kind: NoteKind; name?: string; text: string; lineIds: string[] }
  | { action: "edit"; noteId: string; name?: string; text: string; lineIds: string[] }
  | { action: "remove"; noteId: string; lineIds: string[] }
  | { action: "phrase"; text: string; for?: string; lineIds: string[] };
```

The model writes short ids; the server returns them. The client maps them back to real note ids, keeping the map for the chat.

### Server check

Reuses `checkProposals` from `src/lib/learning/check.ts` for adds and edits, with user lines as the lines. On top of it, a proposal is dropped (never repaired) if:

- it cites no user line, or cites an assistant line;
- it edits or removes a note that was not sent;
- a name, number, time or date in it is in none of its cited user lines (plus the old note for an edit);
- it is a phrase that states a name or number found in no user line and no sent note, or is over 120 characters;
- it is an add or phrase that repeats a sent note or quick phrase.

Dates use the same 15-day table as learning (`comingDays`). For a date past the table, the assistant asks the user to type it, and the typed date is then in a user line.

If the JSON does not parse, the call is made once more. If `say` is fine, it is shown even when every proposal is dropped.

### Data

- `Phrase` gains `quick?: true`. `context.partnerId` and `context.placeId` say who or where a quick phrase is for.
- `MemoryStore.quickPhrases(ctx, k = 4)` returns the row's phrases (rule 16). `MemoryStore.addQuickPhrase(text, for)` adds one. `addPhrase` from speech is unchanged and never sets `quick`.
- Removals use the existing `MemoryStore.removeNote(id)`. When a person or place note is deleted, by the assistant or in Your notes, its quick phrases stay and become general (their `partnerId` or `placeId` is cleared). **(decided)**
- A quick phrase's `context.timeOfDay` is set from when it is kept, as for any phrase; the row ignores it.
- Export and import carry `quick`: `PhraseSchema` in `src/lib/profiles/transfer.ts` gains `quick: z.literal(true).optional()` (zod drops unknown keys, so without this an import would lose the flag). Older files without it still import.

### Code

- `src/lib/assist/`: `protocol.ts` (types and validation), `prompt.ts` (messages and parser), `check.ts` (the rules above), `server.ts` (the call), `client.ts` (fetch and error mapping), `session.ts` (chat state, id map, closing, profile switch), `use-assistant.ts` (React).
- `src/components/assistant-screen.tsx`: the screen.
- `src/components/suggestion-card.tsx`: the card, moved out of `suggested-notes.tsx` so both screens use it, with the removal and phrase kinds added.
- `src/components/phrase-row.tsx`: the "Your phrases" row.
- `src/components/notes-editor.tsx`: the Quick phrases section.

## Error handling (agreed)

- **Both providers fail or are out of quota.** The user's message stays in the chat marked "Not sent. Try again", with a Retry button. Nothing half-done appears.
- **Output unreadable after the retry.** The assistant says "Sorry, I didn't get that. Could you say it another way?"
- **Rate limited.** "Please wait a moment." Send works again after the wait.
- **A response arriving after the chat closed or the profile changed** is thrown away. It never writes to another profile.
- **Storage blocked.** The chat works; kept items follow the existing notice that nothing is saved.
- **Accessibility.** New assistant messages go through the existing announcer. Focus moves to the first new card, or back to the text box when there are none. Cards have headings. Everything works with Tab and Enter.

## Testing (agreed)

- **Unit.** Every check rule; the parser (pretty-printed JSON across lines, as in the reply quality pass); `quickPhrases` matching and order; resolving `for` at Keep; changed-since; duplicates; export and import with and without `quick`; the session discarding a late response.
- **End to end**, with `/api/assist` mocked:
  - prepare an appointment, keep the cards, pick that person in Talking with, see the phrase row;
  - a removal asks for confirmation;
  - closing with unreviewed cards asks first;
  - no Assistant in demos;
  - axe on the assistant screen and the phrase row.

## Assistant eval (agreed)

`eval/assist/`, write-up in `eval/assist/RESULTS.md`.

- **Cases.** 48 over the three example people, 16 per job, including cases where the right answer is to change nothing (a fact already in the notes, a question the user decides not to pursue). 32 dev and 16 held out, all written before tuning and not changed afterwards.
- **Simulated user.** Each case has a private brief: what the user wants and the facts they will type when asked. A model plays the user, answering the assistant in short typed lines, for up to 8 turns. It is told nothing beyond the brief, so a fact outside the brief is invented. The simulated user runs on `gpt-oss-120b` at low effort, a different model from the assistant. **(decided)**
- **Judge.** `gpt-oss-120b` on Groq at high effort, calibrated on a hand-labelled gold set of about 15 chats before use, as in learning. Test runs use 3 votes.
- **What is measured**, over proposals the check lets through:

  | Measure | Target |
  |---|---|
  | Worth keeping | at least 90% |
  | Invented | under 5% |
  | Edits and removals right | at least 90% |
  | Recall of the brief's facts | at least 80% |
  | Phrases fine to say as they are | at least 80% |
  | Median user messages to finish | 5 or fewer |

  The simulated user's turns are also checked for leaks: a brief fact typed before it was asked for is fine, a fact not in the brief voids the case.

## Cost

The eval makes about 10 to 15 model calls per case. On Groq's free tier a dev and a test run take several days; on the paid plan they cost a few dollars, in line with earlier passes. In use, each chat turn is one call of a few thousand tokens.
