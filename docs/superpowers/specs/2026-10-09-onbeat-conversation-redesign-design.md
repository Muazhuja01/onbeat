# OnBeat conversation redesign

Date: 2026-10-09
Status: approved in conversation, awaiting written review
Updates: [the original design spec](2026-09-27-onbeat-design.md), sections 6.1 to 6.3. Where this spec and that one disagree, this one wins.

## 1. Why

The user reported four problems with the conversation screen, all confirmed on screenshots:

1. **Looks plain or unfinished.** Everything is a grey-outlined box, empty states are dead space, and the header is bare.
2. **Hard to know where to look.** The replies, the Listen button, "Last said", the selects and the inputs all have the same visual weight.
3. **Cluttered and wordy.** Full-width banners, a help sentence under Listen, two type boxes that look the same, and settings under the conversation.
4. **Poor on phones.** One long scroll; the type box falls below the replies and off screen.

Earlier fixes this week (PR #23) made the laptop screen fit one window. This redesign keeps that and fixes the rest.

## 2. Decisions

Made with the user during brainstorming, with mockups:

| Question | Decision |
|---|---|
| Which device leads the design | Laptop first; phones and tablets get a version tuned for them |
| Layout | A chat thread: their lines on the left, yours on the right, replies stacked above the type box |
| Typing what the other person said | A "+ They said" button that opens a one-line box, then closes |
| Look | "Porcelain, refined": today's cool palette with soft shadows instead of grey outlines, and navy bubbles for your lines |
| Telling the speakers apart | Never by colour alone: always side, shape and label (navy bubble and slate-blue rule are only 2.2:1 apart) |
| Other screens | Take on the new look through shared styles; their flows don't change |

## 3. Laptop conversation screen (1024 px and wider)

The page never scrolls during a conversation. It has three zones, top to bottom.

### 3.1 Top bar

One row, `surface` background, a 1 px hairline below.

- **Mark:** a 12 px amber dot and "OnBeat".
- **Place** and **Talking with:** native `<select>` elements styled as round chips ("📍 Blue Door Café ▾", "👤 Sam ▾"). Their accessible names stay "Place" and "Talking with".
- **Listen:** one round toggle (`aria-pressed`). Its label carries the state:
  - off: "Listen" with the microphone-slash icon;
  - loading: "Getting ready 42%";
  - on: amber fill, "Listening" and the level meter.
  The status sentence stays in a `role="status"` region for screen readers but is only shown on screen for problem states (denied, unavailable, error, interrupted), as a short note under the bar.
- Right side: the **demo chip** in demo mode ("Demo: Maya · Set up your own", amber tint), the **profile menu**, and a **gear button** ("Settings").

### 3.2 Thread

A centred column, `max-width: 54rem`, that fills the space between the bar and the tray and scrolls inside itself.

- **Their lines:** left, name label above (partner colour, 15 px bold), 32 px text, 4 px partner-colour rule on the left. Dashed rule and "· still talking" while the line is live.
- **Your lines:** right, max 72 % of the column, `bubble` background with `onBubble` text, 20 px, corner radius 20 px with the bottom-right corner 6 px. Label "You" above the text.
  - While a line plays, its label becomes "Speaking" with a **Stop** button (amber, round) in the bubble; before the clip arrives it reads "Getting your voice ready…".
  - Long lines simply wrap; there is no separate "Last said" box any more.
- **Notes under a bubble:** a voice problem is shown as one muted line under the line it happened to, for example "Said in your device's voice: yours wasn't ready in time." or "Said in the backup voice." No banner.
- **Following:** the thread follows new lines. Scrolling up stops that and shows a round "↓ Newest" button at the bottom of the thread; pressing it scrolls to the end and follows again.
- **Header row** at the top of the column: the "Conversation" heading and a quiet **New conversation** button (same confirm step as today).
- **Empty state:** centred "Ready when you are" and one sentence: "Press **Listen** and their words will show up here in large text. You can also type them with **+ They said**."
- The thread is a keyboard-focusable scroll region (as the log is today).

### 3.3 Tray

A floating card at the bottom of the column: `surface` background, 22 px corners, the tray shadow.

1. **Cue row:** the cue light and its status text ("Waiting", "Finding replies…", "Replies ready", "Paused"), reactions on the right.
2. **Replies:** three slots, each at least 64 px tall, kept even when empty, `raised` background with the lift shadow, numbered badges. Empty before the first turn: one muted line, "Replies show up here when someone talks to you, or as you type."
3. **Type row:** "+ They said" (secondary), the type box ("Type a reply"), and **Speak**.
   - "+ They said" swaps the type row for a "Sam said [ ] Add · Cancel" row with a partner-colour rule on the left. The box's accessible name stays "What they said". Enter adds the line, Escape or Cancel closes it, and focus returns to "Type a reply".
   - Voice status ("Waking your voice…", "Using the backup voice.") shows as one muted line under the type row only when the voice isn't the chosen one and ready. "Your voice is ready." is no longer shown.

### 3.4 Notices

Screen-wide notices (for example "Profiles and notes won't be saved in this window.", replies paused) show in a slim banner under the top bar with a close button. Voice notices are not screen-wide any more (3.2).

### 3.5 Settings

The settings content moves out of the page into a panel that slides in from the right, opened by the gear. It is a native `<dialog>` opened with `showModal()`, so focus is trapped, Escape closes it, and the page behind is inert. It is reachable from every screen.

## 4. Phone and tablet (narrower than 1024 px)

The same zones, arranged for one hand.

- **Top bar:** mark, Listen, and a **☰** button. ☰ opens the profile menu as a bottom sheet with the same items plus **Settings**.
- **Context chip** under the bar: "📍 Blue Door Café · 👤 Sam ▾". It opens a bottom sheet, "Where and who", with the two selects and **Done**. From 640 px wide, the chip splits back into the two select chips in the bar.
- **Thread:** their lines are 26 px; your bubbles max 80 % wide. "+ They said" sits as a small pill on their side at the bottom of the thread (from 640 px it moves next to the type box, as on laptop).
- **Tray:** docked to the bottom edge, 24 px top corners, shadow above it.
- **Keyboard open:** the viewport sets `interactiveWidget: "resizes-content"`, so the tray stays above the keyboard and the thread shrinks. All three replies stay; only the reactions row hides while "Type a reply" has focus (CSS `:has()`), and returns when it loses focus. The thread always keeps room for their latest line.
- Bottom sheets are native `<dialog>` elements with a grab handle, a heading and a close or Done button.

## 5. Visual system

### 5.1 Theme tokens

`src/styles/tokens.ts` stays the source of truth, and `globals.css` must match it. New tokens:

| Token | Light | Dark | High contrast | Use |
|---|---|---|---|---|
| `raised` | `#FFFFFF` | `#1E2B41` | `#000000` | reply buttons, inputs |
| `bubble` | `#15233B` | `#E8EDF4` | `#FFFFFF` | your lines |
| `onBubble` | `#F3F6FA` | `#101826` | `#000000` | text in your lines |

Existing tokens (`ground`, `surface`, `ink`, `muted`, `cue`, `onCue`, `partner`) keep their values. In dark mode the Speak button flips to `ink` fill with `ground` text, as the bubble does.

### 5.2 Elevation

Replaces the original rule "Shadows are not used".

- **Light:** `--lift: 0 1px 2px rgb(21 35 59 / .06), 0 4px 14px rgb(21 35 59 / .07)` for replies and bubbles; `--tray: 0 10px 30px rgb(21 35 59 / .10)` plus a 1 px hairline for the tray and phone sheets.
- **Dark:** shadows don't show, so `raised` and `surface` are lighter than `ground`, and the tray gets a 1 px `ink`/7 % ring.
- **High contrast:** no shadows and no tints; every surface has a 2 px white outline, and the existing 3 px amber outline on interactive elements stays.

### 5.3 Shape, type and motion

- Corners: replies 16 px, inputs and buttons 14 px, tray 22 px (24 px top corners on phones); chips, the cue light and number badges fully round.
- Type sizes don't change: their lines 32 px (26 px on phones), replies 24 px, your lines and body 20 px, labels 15 to 16 px. One family: Atkinson Hyperlegible Next.
- Motion: the cue light fades on (150 ms), new replies cross-fade, the level meter moves while listening, "↓ Newest" fades in. Under `prefers-reduced-motion` everything is instant.

### 5.4 Colour rules

- Every text and control pair meets WCAG AA (4.5:1 text, 3:1 controls and the bubble edge) in all three themes, and still does under protanopia, deuteranopia and tritanopia simulation (Machado 2009, full severity).
- The two speakers are told apart by side, shape and label, never by colour alone.

## 6. Other screens

Setup, the demo picker, notes, suggested notes, voice and the assistant adopt the new look through shared styles (`src/components/ui.ts` and the tokens): the top bar, `raised` inputs, lifted primary surfaces, round chips. Their content, order and behaviour don't change. The welcome screen's settings disclosure is replaced by the gear in the top bar.

## 7. State and component changes

### 7.1 Conversation state

- Voice notices attach to a line: a new action `lineNote { text, note }` sets `notes[turnId]` on the newest user turn with that text. `voice.on("fallback")` and `voice.on("backup")` dispatch it instead of `notice`. `reset` clears `notes`.
- `notice` stays for screen-wide notices and gains a dismiss (`notice: null`).
- Which bubble is speaking is derived: the newest user turn whose text equals `state.speaking`.

### 7.2 Components

| New or changed | Replaces | Job |
|---|---|---|
| `top-bar.tsx` | the header in `conversation-screen.tsx`, `context-bar.tsx` layout | mark, context chips or chip, Listen, demo chip, menu, gear |
| `listen-control.tsx` (changed) | | becomes the round toggle; status text kept for screen readers |
| `thread.tsx` | `caption-log.tsx`, `spoken-caption.tsx` | lines, bubbles, speaking state, notes, following, "↓ Newest", empty state |
| `tray.tsx` | the side column in `conversation-screen.tsx` | cue row, reactions, replies, type row, voice status |
| `they-said.tsx` | `partner-input.tsx` | the "+ They said" button and its row |
| `sheet.tsx` | | bottom sheet on a native `<dialog>` |
| `settings-drawer.tsx` | `settings-panel.tsx` as a disclosure | the settings content in a side panel on a native `<dialog>` |
| `notice-banner.tsx` | the notice paragraphs in `conversation-screen.tsx` | dismissible screen-wide notice |

`reply-list.tsx`, `reaction-bar.tsx`, `cue-light.tsx`, `composer.tsx` and `profile-menu.tsx` are restyled and keep their behaviour. `demo-bar.tsx` becomes the demo chip.

### 7.3 Kept as is

Keyboard shortcuts (1 to 3, Alt+1 and Alt+2, Up from the type box, Escape), the skip link to the replies, stable replies while aiming, polite live regions, 200 % zoom and 320 px width, the one-screen layout on laptops, and every accessible name the tests use ("Type a reply", "Speak", "Listen", "Place", "Talking with", "New conversation", "What they said").

## 8. Build order

Each step leaves the app working and its tests passing.

1. **Foundation:** tokens and their tests, elevation variables, `ui.ts` styles, `sheet.tsx`, `settings-drawer.tsx`, `top-bar.tsx`.
2. **Laptop conversation screen:** `thread.tsx`, `tray.tsx`, `they-said.tsx`, `notice-banner.tsx`, the `lineNote` state change; remove `caption-log.tsx`, `spoken-caption.tsx` and `partner-input.tsx`.
3. **Phone and tablet:** context chip and sheet, ☰ menu as a sheet, docked tray, keyboard behaviour.
4. **Other screens:** restyle; these are independent and can be done in parallel by subagents, each reviewed before merging.

## 9. Testing

- **Unit tests first** (test-driven) for: the `lineNote` reducer action, the speaking bubble and Stop, notes under bubbles, following and "↓ Newest", "+ They said" (open, add, cancel, Escape, focus return), the notice banner's dismiss, the Listen states, sheets and the settings drawer opening and closing with focus return.
- **Colour test:** extend `src/styles/tokens.test.ts` so every pair in 5.4 is checked in all three themes, both as is and under the three colour-blindness simulations.
- **End to end:**
  - the existing one-screen test at 1280×720, 1440×800 and 1920×1080 (page doesn't scroll; type boxes and all three replies fully visible);
  - a phone test at 390×844: the tray, three replies and the type box fully on screen; "+ They said" works; the context sheet opens and closes;
  - axe on the conversation screen, the context sheet, the ☰ sheet and the settings drawer, in light, dark and high contrast;
  - keyboard only: every new control reachable in visual order, sheets and the drawer return focus.
- **Visual check:** screenshots of the real app at laptop and phone sizes in all three themes, compared with the approved mockups, before each step is called done.

## 10. Risks

- **Phone keyboards** behave differently across browsers. `resizes-content` covers Chrome on Android; iOS Safari ignores it, so the tray also uses `100dvh` and is checked in device emulation. A real phone check is needed and can't be automated here.
- **Test churn:** the conversation log and "Last said" tests are rewritten for the thread. Accessible names are kept so most end-to-end tests stay valid.
- **Scope creep:** anything not in sections 3 to 6 goes on a follow-up list.

## 11. Not in this work

- Changes to the flows of the other screens.
- New settings (caption size, hold to speak).
- Playing a long line's parts as they arrive (the voice follow-up from PR #24).
- Changing the default theme.
