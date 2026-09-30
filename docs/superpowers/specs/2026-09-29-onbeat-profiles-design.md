# OnBeat profiles (stage 1 of 3)

Date: 2026-09-29. Status: written while the owner was away; they delegated the design decisions ("Take good decisions by yourself"). Every decision the owner has not seen is marked **(decided)** so it is easy to review and overturn.

## Why

Today OnBeat only works with the three example people. There is no way to write your own notes, so replies can never be about the real user. This stage makes the app usable by one real person, or a few people sharing a device, before any learning (stage 2) or assistant chat (stage 3) is built.

Owner's request, in short: set up a profile before first use; switch between profiles; an "about me" section filled by typing or uploading a document, kept per profile and editable any time; top-notch UX; no example profiles, but keep a demo link.

## What was agreed before this spec

- Keep a "try a demo" link on the first screen.
- Profiles live in the browser. Export and import as a backup. No accounts or sync.
- Say clearly in the app when more of the profile goes to the AI than replies send.
- New facts are confirmed by the user, never saved silently. (Applies here to document import.)

## Decisions made for this spec

1. **Who sets it up (decided).** The person who uses OnBeat, sometimes with a carer, therapist or family member sitting with them. All text speaks to the user ("you", "your"). There is no separate carer mode. A helper can type into the same screens.
2. **The first screen is setup (decided).** With no profiles saved, the app opens on setup. A plain link under it, "Try a demo first", opens the three example people.
3. **Demos are not saved (decided).** A demo runs in memory for this visit only and never appears in the profile list. A bar at the top says "Demo: Maya. Nothing you do here is saved." with a "Set up your own" button. This keeps the example people out of the user's own profiles, as the owner asked.
4. **Setup is three short steps (decided).** One question per step, with Back, and Skip on the optional ones:
   1. "What's your name?" (required). The profile label.
   2. "Tell OnBeat about you" (optional). One text box for the pinned about-me note: how you communicate, whether you hear well, anything people should know. Hint text gives an example. Below it, "Or start from a document" (see 7).
   3. "Who do you talk to, and where?" (optional). Add people (name, who they are to you) and places (name, a few words). These fill the Talking-to and Place pickers.
   Then the conversation screen opens with a short note: "You can add or change notes any time from your profile menu."
5. **Notes are short (decided).** The reply prompt cuts each note at 300 characters (`src/lib/suggest/request.ts`), so the editor limits every note to 300 characters with a visible counter. Longer information is several notes. The about-me note gets the same limit. If the name is not in the about-me text, setup starts it with "I'm <name>." so replies know who they speak for.
6. **Notes editor (decided).** "Your notes" opens from the profile menu. Notes are grouped: About you, People, Places, Routines, Likes and dislikes. About you has one main note, pinned and sent with every reply request (the one setup writes); any further about-you notes, for example from a document, are found by search like the rest. Each group lists its notes with Edit and Delete, and has an Add button. People and places have a Name field plus a description; other kinds have one text field. Delete asks once ("Delete this note?"). Proper names for search are taken from the Name field, plus capitalised words in the text that are not at the start of a sentence (for example "Blue Door Café"); the user never sees or edits them.
7. **Document import (decided).** Accepts .txt, .md, .docx and .pdf up to 4 MB. The file goes to a new server route that pulls out the text, keeps the first 20,000 characters, and asks the reply model to write short notes from it. The user then sees every suggested note with a checkbox (all ticked), unticks any they don't want, and saves the rest; saved notes can be edited in the notes editor like any other. Nothing from the document is saved until they press Save. Before upload the screen says: "To write notes from a document, its text is sent to the AI service OnBeat uses. OnBeat doesn't keep a copy. Replies only ever send the few notes that fit the moment." (It makes no promise about the provider's own retention, which OnBeat doesn't control.) Works in setup step 2 and from the notes editor. If the AI is unavailable, the user gets the message and can still type notes.
8. **Profile menu (decided).** The header button "Example profiles" becomes a button with the current profile's name. It opens a panel with: the list of profiles (switch with one tap), "Your notes", "New profile", "Export this profile", "Import a profile", "Rename", "Delete this profile". In a demo it offers the demo picker and "Set up your own".
9. **Switching (decided).** Switching stops speech, cancels any reply request in flight, clears the conversation and the Place and Talking-to choices, and loads the other profile's notes and phrases. The last used profile opens next time.
10. **Export and import (decided).** Export downloads `onbeat-<name>-<date>.json` with the profile name, notes and phrases. Import reads such a file, checks it strictly, and always adds a new profile (a name clash gets " (2)"). It never overwrites an existing one. A file that fails the check is refused with a plain message and nothing changes.
11. **Delete (decided).** Asks for confirmation, suggests exporting first, and names the profile. Deleting the last profile returns to setup.
12. **Keeping data (decided).** After the first profile is created the app asks the browser to keep its storage (`navigator.storage.persist()`), so it is not cleared under storage pressure. The browser decides; nothing is shown either way. In a window where storage is blocked, profiles work for the visit and the existing notice says they won't be saved.
13. **Old data (decided).** Browsers that used OnBeat before this change have one saved snapshot. Every note in it came from an example person (there was no editor), plus phrases the user spoke. It is dropped rather than turned into a profile that looks like the user's own. Setup opens as for a new user.

## Out of scope

Learning from conversations (stage 2), the assistant chat (stage 3), accounts and sync, a carer mode, locking profiles, photos, other languages, a profile-level voice choice.

## Architecture

### Storage

Same IndexedDB database and store as today (`onbeat` / `memory`, via idb-keyval; a second store would need a database version change). Keys:

- `profiles`: `{ version: 1, activeId: string | null, profiles: { id, name, createdAt }[] }`
- `profile:<id>`: the existing `Snapshot` (`{ version: 1, notes, phrases }`)
- `snapshot`: the old single snapshot, deleted on first load (decision 13).

New module `src/lib/profiles/registry.ts`: a `ProfileRegistry` with `list()`, `active()`, `create(name)`, `rename(id, name)`, `remove(id)`, `setActive(id)`, and `persistFor(id)` which returns a `Persist` bound to `profile:<id>`. It takes a small key-value interface so tests use an in-memory map and the browser uses idb-keyval. `detectPersist` moves here: when IndexedDB fails, the registry runs on the in-memory map and reports `durable: false`.

`MemoryStore` does not change. One store per open profile: `openProfileMemory(registry, id)` creates a `MemoryStore` with that profile's persist and the shared browser embedder. Demos use `MemoryStore.create()` with in-memory persistence and `replaceAll(persona.notes, persona.phrases)`.

`src/lib/memory/browser.ts` changes from one cached store to a cached registry.

### Screen state

`ConversationScreen` gets a small top-level state: `loading`, `setup`, `demo-picker`, `ready` (with a profile or a demo). The conversation view stays mounted when switching, as today (useStableTargets attaches once). `SuggestClient` is already rebuilt when `memory` changes; switching also calls `client.cancel()`, resets the reducer and the gap timer, the same steps `choosePersona` takes today.

### New components

- `ProfileSetup`: the three steps. Focus moves to each step's heading. Enter moves on from single-line fields.
- `NotesEditor`: groups, add, edit and delete forms, character counter.
- `NoteForm`: one note's fields; shared by setup step 3 and the editor.
- `DocumentImport`: file input, privacy line, progress, review list.
- `ProfileMenu`: replaces the "Example profiles" button; a disclosure panel like `SettingsPanel`, not a modal.
- `DemoBar`: the demo notice.
- `ProfilePicker` becomes the demo picker (copy changes, no "Continue without a profile").

All forms use real labels, keep the existing 48 px targets and focus rings, work in all four themes and at double text size, and announce saves and errors through the existing announcer.

### Document route

`POST /api/notes-from-document`, multipart with one `file`. Same origin check and rate limiter as `/api/suggest` (a lower limit: 5 a minute). Steps:

1. Refuse over 4 MB (413) or other types (415).
2. Pull out the text: .txt and .md as UTF-8; .docx with `mammoth` (`extractRawText`); .pdf with `unpdf` (`extractText`). An empty result (for example a scanned PDF) returns `{ error: "no_text" }`.
3. Keep the first 20,000 characters; report `truncated: true` if cut.
4. Ask the model (same providers and order as replies, non-streaming use of `streamCompletion`) for one JSON object per line: `{"kind": "person|place|routine|preference|about-me", "name": "...", "text": "..."}`. Prompt rules: first person, one fact per note, at most 300 characters, only facts the document states, skip anything about other people's health or private details that aren't needed to talk with them.
5. Parse line by line, drop invalid lines, cap at 40 notes, return `{ notes, truncated }`.

Document content is never logged, as with replies.

### Export format

```json
{ "format": "onbeat-profile", "version": 1, "exportedAt": "2026-09-29T20:00:00Z",
  "profile": { "name": "Maya" }, "notes": [], "phrases": [] }
```

Checked with zod on import. Note and phrase ids are regenerated on import (and references in phrase contexts remapped) so two imports of one file never share ids.

## Error handling

- IndexedDB blocked: profiles in memory for the visit, existing notice.
- A save fails (quota): announce "Couldn't save. Your browser's storage may be full." and keep the change in memory.
- Document route errors map to plain messages: too large, wrong type, no text found (suggest copying the text in instead), AI busy (try again in a minute).
- Import file invalid: "This file isn't an OnBeat profile export." Nothing changes.

## Testing

- Unit: registry (create, rename, remove, active, persistence per profile, old snapshot removed), entity guessing, note length limit, export and import round trip (ids remapped, bad files refused, name clash), document text extraction for each type (small fixtures made in the test), model output parsing.
- Component: setup steps (required name, skip, back, about-me prefix), notes editor (add, edit, delete, counter), document review (untick, edit, save only kept notes), profile menu (switch, delete confirmation).
- End to end (Playwright): first visit opens setup and finishes into the conversation screen with the new person in Talking to; reload keeps the profile; demo link loads Maya and leaves no profile behind; a second profile and switching; export then import round trip. The document route is mocked in e2e (no real AI calls). The existing a11y tests get the new screens: axe clean in every theme, Tab order, no sideways scroll at double text size.
- The reply eval does not change (it builds notes directly), so no eval rerun is needed.

## Risks

- `unpdf` and `mammoth` add server bundle size; both run in Vercel's Node runtime. If either fails to build under Next 16, fall back to .txt, .md and .docx only and say so.
- Dropping old data (decision 13) loses phrases a tester typed. Acceptable: nobody has real data yet, and the owner has asked for a fresh start without example profiles.
