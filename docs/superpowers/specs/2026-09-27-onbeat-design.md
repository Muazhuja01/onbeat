# OnBeat design spec

Date: 2026-09-27
Status: draft, awaiting review
Background and decision history: [docs/research-notes.md](../../research-notes.md)

## 1. Goal

OnBeat is a web app that helps literate nonspeaking people hold a spoken conversation at close to normal pace. It listens to the other person, shows their words as captions, and offers short replies the user can speak with one tap in a natural-sounding voice.

Success for v1:

- A user can hold a short back-and-forth conversation (for example, ordering at a café) where most replies are one tap.
- Median time from the partner's last word to suggestions on screen is about 1 second on a recent laptop or phone.
- The eval shows zero replies containing invented names, numbers or times.
- The app passes automated accessibility checks (axe) on every screen, in light, dark and high-contrast themes, and can be used with a keyboard alone.
- A 120-second demo video shows a real conversation.

Budget: about 40 hours over 4 weeks. Everything runs on free tiers.

## 2. Users

- Hearing people who can't speak or can't speak reliably: ALS, stroke, cerebral palsy, laryngectomy, nonspeaking autistic adults.
- Deaf people who don't use their voice and want to talk with hearing people.

All users can read and type (keyboard or touch). For many Deaf users written English is a second language, so replies must be short and plain. Many users have limited movement, low vision or colour vision deficiency.

Out of scope for v1: symbol-based AAC for pre-literate users, switch scanning, sign-language recognition, languages other than English.

## 3. Features

1. **Captions.** The partner's speech is transcribed live and shown in large text.
2. **Suggested replies.** Three short replies appear, based on what the partner said, what the user has typed, the current situation, and the user's saved notes.
3. **Ready before the partner finishes.** Suggestions are prepared from the partial transcript while the partner is still speaking, so they are usually on screen when the partner stops.
4. **Live reactions.** Two one-tap reactions ("Really?", "Oh no", "Ha!") chosen from a fixed, user-editable list, offered during the partner's turn.
5. **Sounds like the user.** Replies are written in the style of the user's own past sentences.
6. **Speak.** One tap speaks a reply with an in-browser voice, shows it as a large caption, and vibrates the device on phones.
7. **Notes.** The user keeps notes about people, places, routines and preferences. They are stored only in the browser.
8. **Stretch: remember people.** After a conversation, the app proposes notes from what the partner said ("Sam's daughter has a recital on Friday"). Nothing is saved without approval.

Rules that apply everywhere:

- Nothing is spoken without a user action.
- "Say what I typed" is always available.
- A reply that mentions a name, number or time not found in the user's notes, the partner's words or the user's typing is discarded.
- Personal notes never leave the device except the few relevant to the current request.

## 4. Architecture

Local-first. Speech recognition, voice, search and storage run in the browser. The server has one route that forwards requests to the language model so the API keys stay secret. It stores nothing.

```
BROWSER
  mic -> hearing worker (Silero VAD + Moonshine) -> partial text, turn end
  typing ------------------------------------------> conversation (state machine)
  conversation -> suggestion engine -> memory search (Orama + IndexedDB, embedder worker)
  suggestion engine -> POST /api/suggest (streamed) -> validate -> UI
  suggestion engine -> voice worker (Kokoro) prepares audio for the 3 replies
  tap -> voice plays cached audio, caption, vibration, phrase saved

SERVER (Vercel, stateless)
  /api/suggest -> Groq (primary) -> Cloudflare Workers AI (fallback on 429, 5xx, slow first token)
```

### Units

| Unit | Job | Interface |
|---|---|---|
| `hearing` (worker) | Voice activity detection and transcription of the partner | events `partial(text)`, `turnEnd(text)`, `level(0..1)` |
| `conversation` | Turn state and timing of suggestion requests | states `idle`, `partnerSpeaking`, `composing`, `speaking` |
| `memory` | Store and search notes and past phrases | `search(query, ctx, k)`, `matchPhrases(prefix)`, `addPhrase()`, CRUD for notes |
| `embedder` (worker) | Text embeddings for vector search | `embed(texts)` |
| `suggest` | Build requests, throttle, cancel, cache, validate | `request(input) -> AsyncIterable<SuggestionUpdate>` |
| `voice` (worker) | Text to speech with pre-generation | `prepare(text)`, `speak(text)`, `stop()`, events `start`, `end` |
| `language-pack` | Per-language settings | English pack only: trust tier, voices, ASR model id, prompt text, reaction list |
| `/api/suggest` | Validate, rate limit, route to provider, stream JSON | POST, NDJSON response |

Each unit is a folder under `src/lib/` with its own tests. Workers communicate with typed messages.

### A conversation turn

1. Partner starts talking. `hearing` emits partial text about every 0.5 s.
2. At most once every 2.5 s, and only after 3 or more new words, `conversation` asks `suggest` for replies and reactions. Reactions appear right away. Audio for all 3 replies is generated in the background.
3. Partner stops. `turnEnd` triggers one final request with the full sentence. Suggestions already on screen are updated in place (see 6.4 on stability).
4. If the user types, matching past phrases appear instantly from the device, and model suggestions replace them about half a second later.
5. The user taps a reply. Cached audio plays, the text appears as a large caption, the phone vibrates, and the sentence is saved to phrase history.

## 5. Suggestion engine

### Data

```ts
type Note = {
  id: string;
  kind: "person" | "place" | "routine" | "preference" | "about-me";
  text: string;            // "Sam is the barista at Blue Door Café"
  entities: string[];      // ["Sam", "Blue Door Café"]
  updatedAt: number;
};

type Phrase = {
  id: string;
  text: string;
  context: { placeId?: string; partnerId?: string; timeOfDay: "morning" | "afternoon" | "evening" | "night" };
  timesUsed: number;
  lastUsed: number;
};

type Context = { now: Date; placeId?: string; partnerId?: string }; // place and partner picked by the user
```

### Retrieval (on device, target under 30 ms)

1. Query text = typed text + partner's latest utterance + context names.
2. Orama hybrid search (BM25 + vector) over notes. Notes whose entities match the current place or partner get a score boost. Top 8.
3. Style examples: the 5 past phrases most similar to the query, weighted toward recent ones.

There is no separate "should we retrieve" step. Local search is cheaper than asking the model. A reranker is added only if the eval shows the right note is often missing from the top 8.

### Model request

One call returns both kinds of output while the partner is speaking. While typing, replies only.

Prompt rules:

- Write as the user, first person, in the style of the examples.
- Use only the provided notes. Each reply lists the note ids it relies on. If a detail isn't in the notes, keep it general.
- 15 words or fewer per reply. A "simple language" setting lowers this to 10 and asks for common words.
- The three replies say three different things (for example: a direct answer, an answer with a detail, an alternative), not rewordings.
- If the user typed something, every reply keeps its meaning.
- Reactions are returned as ids from the reaction list only.

Response shape (validated with Zod):

```ts
{ replies: { text: string; noteIds: string[] }[]; reactions: string[] }
```

The response is streamed and parsed incrementally so the first reply can show before the rest arrive.

### Validation (client side, after every response)

1. Schema check. On failure, retry once on the other provider.
2. Every cited note id must be one that was sent.
3. Names, numbers and times in a reply must appear in the cited notes, the partner's words or the user's typing. Otherwise the reply is dropped.
4. Near-duplicates are removed.
5. "Say what I typed" is added when the user has typed text.

If fewer than three replies survive, fewer are shown. Nothing unchecked is used to fill the gap.

### Timing rules

| Rule | Value |
|---|---|
| Local phrase matches while typing | synchronous, under 16 ms |
| Speculative requests during partner speech | at most every 2.5 s, only after 3+ new words |
| Final request | on `turnEnd` if text changed since the last request |
| Typing debounce | 300 ms, minimum 2 characters |
| Cancellation | a new request aborts the previous one (AbortController) |
| Cache | last 20 results keyed by (mode, typed, partner text, context) |
| Provider fallback | Groq, then Cloudflare Workers AI on 429, 5xx, or no first token after 1.5 s |
| Quota guard | client-side token bucket per provider; speculative requests are skipped first when the budget is low |

Default model: Qwen 3.8 27B with reasoning off on Groq (`qwen/qwen3.8-27b`). The Cloudflare fallback runs Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), because Qwen 3.8 on Workers AI can't turn its reasoning off and misses the first-token budget. The eval (section 9) compares Qwen 3.8 27B with `openai/gpt-oss-20b` on Groq before the choice is final. The plan 2 eval chose qwen/qwen3.8-27b; see eval/RESULTS.md.

### Phrase learning

Each spoken sentence is saved as a Phrase with its context. It feeds instant matches and style examples.

## 6. Interface and accessibility

### 6.1 Design read

Accessibility-critical conversation tool for nonspeaking adults, used live in public places (cafés, clinics, shops). Calm, dignified, high legibility. Not a landing page and not a children's app. Dials from taste-skill: layout variance 3, motion 2, density 4.

The memorable element is the **cue light**: a round lamp in the reply area that lights up when replies are ready. It comes from the cue lights that tell performers and broadcasters it's their turn to speak, which is exactly the job here. It's the only decorative moment; everything else stays quiet.

### 6.2 Tokens

Colour:

| Token | Light | Dark | Use |
|---|---|---|---|
| `ground` | `#EEF1F4` porcelain | `#101826` night navy | page background |
| `surface` | `#FAFBFC` | `#172234` | reply buttons, inputs |
| `ink` | `#15233B` | `#E8EDF4` | body text (AAA on ground) |
| `muted` | `#4A5A70` | `#A9B6C8` | secondary text (AA or better) |
| `cue` | `#F2A93B` amber | `#F5B656` | cue light, selected state fill, focus ring outer. Never used for text on ground |
| `partner` | `#2D5B86` slate blue | `#8DB8E3` | partner captions' side rule and speaker label |

Measured contrast ratios: ink on ground 13.9:1 (light) and 15.1:1 (dark); muted on ground 6.2:1 and 8.7:1; partner on ground 6.3:1 and 8.6:1; ink on a cue fill 7.9:1. Amber on the light ground is only 1.8:1, which fails the 3:1 rule for non-text elements, so in the light theme the cue light always has a 2 px ink border and a text label ("Replies ready"), and focus rings are two rings: 2 px ink inside, 3 px amber outside. In the dark theme amber on ground is 9.9:1.

A high-contrast theme uses pure-contrast pairs (`#FFFFFF` on `#000000` and the reverse) with a 3 px amber outline on every interactive element. It's the one place pure black and white are allowed, because that's what the setting is for.

Colour is never the only signal. The partner and the user are told apart by position (partner left, user right on wide screens, stacked with labels on phones), a text label, and a different edge treatment (partner lines have a left rule, user lines have a filled background). The blue and amber pair stays distinguishable across protanopia, deuteranopia and tritanopia; states also carry an icon and text.

Type: **Atkinson Hyperlegible Next** (variable, self-hosted via `next/font`), designed by the Braille Institute for low-vision readers. One family for everything. Scale, based on a 20 px body:

| Role | Size / line height | Weight |
|---|---|---|
| Partner caption | 32 / 40 (user adjustable up to 56) | 500 |
| Reply button text | 24 / 32 | 600 |
| Body, inputs | 20 / 30 | 400 |
| Small labels | 16 / 24 | 500 |

Sentence case everywhere. No all-caps labels. (The Vercel guidelines prefer Title Case for buttons; sentence case is chosen instead because it reads faster for users reading in a second language.)

Shape: one radius rule. Reply buttons and inputs 14 px, chips and the cue light fully round. Shadows are not used; elevation is shown with a 2 px border in the ink colour at low opacity.

Icons: Phosphor, regular weight, one size scale. Every icon sits next to a text label or has an `aria-label`.

Motion: the cue light fades on over 150 ms and replies cross-fade when replaced. Nothing loops except a slow level meter while the mic is live. Under `prefers-reduced-motion`, all transitions become instant and the meter becomes a static bar.

### 6.3 Screens

**Conversation (main screen).** Phone layout:

```
[ Place: Blue Door Café v ] [ With: Sam v ]      [mic on]
---------------------------------------------------------
Sam                                              (caption area,
What size would you like?                          scrolls, newest
                                                   at bottom)
---------------------------------------------------------
Reactions:  [ Really? ]  [ Mm-hmm ]
(o) cue light   Replies
[1] Large, please.
[2] My usual, a large oat latte.
[3] What sizes do you have?
---------------------------------------------------------
[ Type a reply...                         ] [ Speak ]
```

Laptop and tablet landscape: two columns. Left, the conversation history with captions. Right, context pickers, reactions, cue light, replies and composer. Replies stay in the same screen position at all sizes.

**First run.** Three steps: allow the microphone (or skip, typing still works), choose a voice, download the voice and speech models (about 150 MB, one time, with progress and an explanation). Then choose "Start with an example profile" or "Start empty".

**Notes.** A list grouped by kind (people, places, routines, preferences, about me). Add, edit, delete. Delete has a 5-second undo instead of a confirmation dialog.

**Settings.** Voice (with written descriptions for users who can't hear the sample: "Warm, lower pitch, slower"), speaking speed, caption size, simple language, reaction list, theme (system, light, dark, high contrast), vibration, "hold to speak" (see below), keyboard shortcut list.

### 6.4 Interaction rules

- **Targets.** Reply buttons are full width and at least 64 px tall. Every other control is at least 48 x 48 px.
- **Keyboard.** `1`, `2`, `3` speak replies when focus isn't in the text box; `Alt+1`, `Alt+2` send reactions; `Enter` in the text box speaks what's typed; `Up arrow` from the text box moves focus to the first reply; `Esc` stops speech or clears the box. Shortcuts are listed in settings and can be turned off. Tab order follows the visual order. Skip link to the replies.
- **Stable targets.** Replies never move while the user is aiming. If the pointer is over the reply list or a reply has keyboard focus, new suggestions wait until the pointer leaves or 1.5 s passes without movement. This protects users with tremor or slow targeting from tapping a reply that changed under their finger.
- **Hold to speak** (optional setting). The user holds a reply for 400 ms to speak it, with a visible fill. Helps users with involuntary taps.
- **Stop.** While speaking, the tapped reply turns into a "Stop" button.
- **Deaf users.** Every audio event has a visual equivalent: mic level meter, "Listening" and "Speaking" status text, the spoken sentence shown as a caption, vibration on phones.
- **Screen readers.** New replies and caption lines are announced through polite live regions, throttled to one announcement per second. The cue light is announced as "Replies ready".
- **Zoom.** Layout works at 200% text size and 320 px width. Zoom is never disabled.
- **Copy.** Plain, active, second person. Errors say what happened and what to do. No em dashes anywhere in the UI.

### 6.5 Component foundation

Tailwind CSS v4 with CSS variable tokens, Radix primitives for dialogs, selects, switches and toasts (accessible behaviour without imposed styling), Phosphor icons. No component kit in its default look.

## 7. Errors and fallbacks

| Situation | Behaviour | Message |
|---|---|---|
| Mic permission denied | Typing and suggestions still work, no captions | "Microphone is off. You can still type replies. Turn it on in your browser's site settings." |
| No WebGPU | Models run on WebAssembly (slower) | none unless slow |
| Voice too slow or fails to load | Browser speech voice is used | "Using the basic voice while the natural voice loads." |
| Model download fails or offline | Retry with backoff; typed speech still works with the basic voice | "Couldn't download the voice. Check your connection and try again." |
| Both LLM providers fail or quota is out | Local phrase matches and typing only | "Suggestions are paused. Typing and speaking still work." |
| Invalid model output | Retry once on the other provider, then drop | none |
| IndexedDB unavailable (private browsing) | Notes kept in memory for the session | "Notes won't be saved in this window." |
| Speech playback error | Caption still shows; retry with browser voice | "Couldn't play that. Showing it on screen instead." |

Server protections on `/api/suggest`: request body limit (16 KB), Zod validation, per-IP rate limit (in-memory, 30 requests per minute), same-origin check, and no logging of request content. API keys are only read from server environment variables.

## 8. Project structure

```
onbeat/
  src/app/                 Next.js routes: /, /notes, /settings, /api/suggest
  src/components/          UI components
  src/lib/conversation/
  src/lib/memory/
  src/lib/suggest/
  src/lib/voice/
  src/lib/hearing/
  src/lib/language-packs/en/
  src/workers/             hearing, embedder, voice workers
  src/data/personas/       example profiles used by the demo and the eval
  eval/                    scenarios, runner, results table
  tests/e2e/               Playwright tests
```

Versions at time of writing: Next.js 16.3, React 19, Tailwind 4.3, Orama 3.1, Transformers.js 3.8.1 (pinned, because kokoro-js depends on v3), kokoro-js 1.2, @ricky0123/vad-web 0.0.31, Zod 4.6. Provider calls use plain `fetch` against the OpenAI-compatible endpoints of Groq and Cloudflare Workers AI. Node 24.

## 9. Testing and eval

**Unit (Vitest).** Memory ranking with boosts, phrase prefix matching, the invented-detail validator, throttle and cancellation logic, prompt builder, provider fallback with mocked fetch, NDJSON stream parser.

**Component (Vitest + Testing Library).** Keyboard shortcuts, live-region announcements, stable-target rule, hold to speak, empty and error states.

**End to end (Playwright).** Typed conversation with a mocked `/api/suggest`; axe scan on every screen in light, dark and high-contrast themes; keyboard-only run; reduced-motion run; 320 px width and 200% text size checks; colour-vision-deficiency screenshots (Chromium vision emulation) reviewed by hand.

**Eval (`npm run eval`).** Three example personas: Maya (ALS, hearing, café regular), Tom (Deaf, uses ASL, at the pharmacy), Aisha (laryngectomy, at work). About 20 scenarios each: context, partner utterance, optional typed prefix, the sentence the user meant, and the notes that are allowed. Reported per model:

- top-3 hit rate (a reply matches the intended meaning, judged by a second model call plus spot checks by hand)
- invented-detail rate (validator plus judge)
- keystrokes saved compared with typing the full sentence
- latency p50 and p95 for the API call; in-app timing for turn end to suggestions visible

Results go into a table in the README. Before deployment, a quality pass has to reach a top-3 hit rate of 90% and invented details in under 5% of shown replies, or the owner has to accept the measured numbers (see eval/RESULTS.md). The quality pass measured a top-3 hit rate of 82% and invented details in 9% of shown replies on the held-out test set with the claim check on (87% and 12% with it off), so neither target is met and the owner decides; see eval/RESULTS.md.

**Demo video (120 s).** Outline: the problem in one line (10 s); Maya at the café with a live conversation, reactions landing while the barista talks, replies ready when she stops, a visible timer (60 s); Tom at the pharmacy showing captions and the visual speaking signal (30 s); eval table and privacy note (20 s).

## 10. Build order

1. Project setup, tokens, fonts, layout shell, CI with lint, typecheck, tests.
2. Memory (notes, phrases, Orama, embedder worker) and example personas.
3. `/api/suggest`, suggestion engine, validator; eval runner.
4. Conversation screen with typing, replies, voice (Kokoro worker with fallback).
5. Hearing worker, speculative requests, reactions, cue light.
6. Notes and settings screens, first-run flow.
7. Accessibility pass, e2e tests, eval results, deploy to Vercel, demo video.
8. Stretch: remember people.
