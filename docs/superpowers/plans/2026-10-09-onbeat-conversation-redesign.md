# Conversation redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the conversation screen as a chat thread with a reply tray, in the "Porcelain, refined" look, on laptops and phones, and give the other screens the same look.

**Architecture:** New presentational components (`Sheet`, `SettingsDrawer`, `Thread`, `TheySaid*`, `Tray`, `TopBar`, `ContextChips`/`ContextButton`, `DemoChip`, `Notice`) are built and unit-tested one at a time, then `conversation-screen.tsx` is re-assembled from them in one task. Conversation state gains one field (`lineNotes`) so voice notices attach to the line they're about. Theme colours stay in `src/styles/tokens.ts` (source of truth) mirrored in `src/app/globals.css`.

**Tech Stack:** Next.js 16.3 (App Router), React 19.2, Tailwind CSS v4 (tokens via `@theme inline`), Phosphor icons, Vitest + Testing Library (jsdom 30), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-09-onbeat-conversation-redesign-design.md`

## Global Constraints

- No new dependencies. Modal panels use the native `<dialog>` element.
- Before using any Next.js API, read its page under `node_modules/next/dist/docs/` (AGENTS.md).
- Copy: plain, active, second person, sentence case. No em dashes in any UI text.
- Accessible names that tests and users rely on stay exactly: "Type a reply", "Speak", "Listen", "Place", "Talking with", "New conversation", "What they said", the "Replies" heading, the "Conversation" region, "Add", "Clear", "Cancel".
- New accessible names: "Settings" (gear), "Close settings", "They said", "Stop speaking", "Newest", "Dismiss", "Where and who: …".
- Every control is at least 48 × 48 px; reply buttons at least 64 px tall.
- Type sizes: their lines 32 px (`text-caption`) from 1024 px, 26 px below; replies 24 px; your lines and body 20 px; labels 16 px.
- Colours only through tokens (`ground`, `surface`, `raised`, `ink`, `muted`, `cue`, `on-cue`, `partner`, `bubble`, `on-bubble`, `edge`). `tokens.ts` and `globals.css` must hold the same hex values.
- The two speakers are told apart by side, shape and label, never colour alone.
- Under `prefers-reduced-motion` every transition is instant (already global in `globals.css`).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: unit `npx vitest run <path>`, all unit `npx vitest run`, types `npm run typecheck`, lint `npx eslint src tests`, end to end `npx playwright test <path> --reporter=line` (it builds the app first, about a minute).

## Review Focus

1. **A long unbroken word** (a URL, "Sooooooo…") in their line or yours at 320 px must wrap, with no sideways scroll. Test: Task 10, step 7.
2. **Opening "+ They said" while replies are showing** must not move the replies (the form is the same height as the type row). Test: Task 10, step 7.
3. **Saying something while scrolled up** to reread must not yank the thread to the bottom; "Newest" appears instead. Test: Task 5, step 1.
4. **Number keys while Settings is open** must not speak a reply. Test: Task 10, step 1.
5. **Phone with the keyboard open** (a short window) must still show their latest line and all three replies. Test: Task 11, step 1.

---

### Task 1: Theme tokens, elevation and colour tests

**Files:**
- Modify: `src/styles/tokens.ts`
- Modify: `src/styles/tokens.test.ts`
- Modify: `src/app/globals.css:1-82`

**Interfaces:**
- Produces: tokens `raised`, `bubble`, `onBubble` in `themes.*`; `simulate(hex, kind)` and `type ColourBlindness = "protanopia" | "deuteranopia" | "tritanopia"` from `tokens.ts`; Tailwind colours `bg-raised`, `bg-bubble`, `text-on-bubble`, `border-edge`; shadows `shadow-lift`, `shadow-tray`.

- [ ] **Step 1: Write the failing tests**

Replace `src/styles/tokens.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { contrastRatio, simulate, themes, type ColourBlindness } from "./tokens";

type Key = keyof (typeof themes)["light"];

/** Text needs 4.5:1 (7:1 for body text); a surface edge needs 3:1. */
const PAIRS: [Key, Key, number][] = [
  ["ink", "ground", 7],
  ["ink", "surface", 7],
  ["ink", "raised", 7],
  ["muted", "ground", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "raised", 4.5],
  ["partner", "ground", 4.5],
  ["partner", "surface", 4.5],
  ["onCue", "cue", 4.5],
  ["onBubble", "bubble", 7],
  ["bubble", "ground", 3],
  ["bubble", "surface", 3],
];
const VISIONS: (ColourBlindness | null)[] = [null, "protanopia", "deuteranopia", "tritanopia"];

describe("theme tokens", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("leaves black and white alone when simulating colour blindness", () => {
    for (const kind of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      expect(simulate("#FFFFFF", kind)).toBe("#ffffff");
      expect(simulate("#000000", kind)).toBe("#000000");
    }
  });

  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      for (const [fg, bg, min] of PAIRS) {
        for (const vision of VISIONS) {
          it(`${fg} on ${bg} meets ${min}:1${vision ? ` with ${vision}` : ""}`, () => {
            const a = vision ? simulate(t[fg], vision) : t[fg];
            const b = vision ? simulate(t[bg], vision) : t[bg];
            expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(min);
          });
        }
      }
      it("the cue light is visible (fill or its ink border meets 3:1)", () => {
        const fill = contrastRatio(t.cue, t.ground);
        const border = contrastRatio(t.ink, t.ground);
        expect(Math.max(fill, border)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: FAIL, `simulate` is not exported and `raised`/`bubble`/`onBubble` are missing.

- [ ] **Step 3: Add the tokens and the simulation**

In `src/styles/tokens.ts`, add three entries to each theme (after `partner`):

```ts
  light: {
    // ...existing seven entries...
    raised: "#FFFFFF",
    bubble: "#15233B",
    onBubble: "#F3F6FA",
  },
  dark: {
    // ...existing seven entries...
    raised: "#1E2B41",
    bubble: "#E8EDF4",
    onBubble: "#101826",
  },
  contrast: {
    // ...existing seven entries...
    raised: "#000000",
    bubble: "#FFFFFF",
    onBubble: "#000000",
  },
```

Append to the end of `src/styles/tokens.ts`:

```ts
export type ColourBlindness = "protanopia" | "deuteranopia" | "tritanopia";

/** Machado, Oliveira and Fernandes (2009) at full severity, applied to linear RGB. */
const CVD: Record<ColourBlindness, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** How `hex` looks to someone with the given colour blindness, as a lower-case hex colour. */
export function simulate(hex: string, kind: ColourBlindness): string {
  const n = hex.replace("#", "");
  const lin = [0, 2, 4].map((i) => channel(parseInt(n.slice(i, i + 2), 16)));
  const out = CVD[kind].map((row) => clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
  return `#${out.map((v) => Math.round(clamp(toSrgb(v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: PASS (all pairs were checked while writing the spec; the tightest clears its minimum by 29 %).

- [ ] **Step 5: Mirror the tokens in CSS**

In `src/app/globals.css`, add these lines to each theme block. Add them to **both** copies of dark (the `prefers-color-scheme` block and `[data-theme="dark"]`) and **both** copies of high contrast (`[data-theme="contrast"]` and the `prefers-contrast` block):

```css
/* light (:root, [data-theme="light"]) */
  --raised: #ffffff;
  --bubble: #15233b;
  --on-bubble: #f3f6fa;
  --edge: rgb(21 35 59 / 0.1);
  --elev-lift: 0 1px 2px rgb(21 35 59 / 0.06), 0 4px 14px rgb(21 35 59 / 0.07);
  --elev-tray: 0 10px 30px rgb(21 35 59 / 0.1);

/* dark (both copies) */
  --raised: #1e2b41;
  --bubble: #e8edf4;
  --on-bubble: #101826;
  --edge: rgb(232 237 244 / 0.08);
  --elev-lift: none;
  --elev-tray: 0 0 0 1px rgb(232 237 244 / 0.07), 0 12px 30px rgb(0 0 0 / 0.35);

/* high contrast (both copies): no shadows or tints, white edges */
  --raised: #000000;
  --bubble: #ffffff;
  --on-bubble: #000000;
  --edge: #ffffff;
  --elev-lift: none;
  --elev-tray: none;
```

In the `@theme inline` block, add:

```css
  --color-raised: var(--raised);
  --color-bubble: var(--bubble);
  --color-on-bubble: var(--on-bubble);
  --color-edge: var(--edge);
  --shadow-lift: var(--elev-lift);
  --shadow-tray: var(--elev-tray);
```

- [ ] **Step 6: Check nothing else broke**

Run: `npm run typecheck && npx vitest run`
Expected: types clean, all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/styles/tokens.ts src/styles/tokens.test.ts src/app/globals.css
git commit -m "Tokens for raised surfaces, your bubbles and soft shadows, checked for colour blindness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Native dialog support and the Sheet

**Files:**
- Modify: `vitest.setup.ts`
- Create: `src/components/sheet.tsx`
- Create: `src/components/sheet.test.tsx`
- Modify: `src/app/globals.css` (append sheet styles)

**Interfaces:**
- Produces: `Sheet({ open, onClose, title, side?: "bottom" | "right", closeLabel, children })` from `src/components/sheet.tsx`. Content renders only while open. Escape, the close button and a backdrop click close it; focus returns to what opened it unless something else took focus meanwhile.

- [ ] **Step 1: Teach jsdom about `<dialog>`**

jsdom 30 reflects `open` but has no `showModal`, `show` or `close`. Append to `vitest.setup.ts`:

```ts
// jsdom has no showModal/close. Enough of them for components built on <dialog>:
// open the dialog, move focus into it like a browser does, and fire "close" when it closes.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  const focusFirst = (dialog: HTMLDialogElement) =>
    dialog.querySelector<HTMLElement>("[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
    focusFirst(this);
  };
  HTMLDialogElement.prototype.show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, value?: string) {
    if (!this.open) return;
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    this.dispatchEvent(new Event("close"));
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/components/sheet.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./sheet";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Where and who" closeLabel="Close">
        <p>Inside</p>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("shows its content only while open, and gives focus back when closed", async () => {
    render(<Harness />);
    expect(screen.queryByText("Inside")).toBeNull();
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Where and who" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByText("Inside")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(screen.queryByText("Inside")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on Escape without the page's own Escape running", async () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Where and who" });
    await userEvent.keyboard("{Escape}");
    expect(dialog).not.toHaveAttribute("open");
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("closes when the backdrop is clicked", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Where and who" });
    await userEvent.click(dialog);
    expect(dialog).not.toHaveAttribute("open");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/components/sheet.test.tsx`
Expected: FAIL, cannot resolve `./sheet`.

- [ ] **Step 4: Write the Sheet**

Create `src/components/sheet.tsx`:

```tsx
"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "bottom" slides up from the bottom edge (phones); "right" is a side panel. */
  side?: "bottom" | "right";
  /** The close button's accessible name, e.g. "Close settings". */
  closeLabel: string;
  children: ReactNode;
}

/**
 * A modal panel on a native <dialog>: focus stays inside, the page behind is inert, and
 * Escape, the close button or the backdrop close it. Focus goes back to what opened it.
 */
export function Sheet({ open, onClose, title, side = "bottom", closeLabel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`sheet ${side === "right" ? "sheet-right" : "sheet-bottom"}`}
      onClose={() => {
        // Only when focus would otherwise be lost: something opened from inside may have taken it.
        const active = document.activeElement;
        if (!active || active === document.body || ref.current?.contains(active)) opener.current?.focus();
        opener.current = null;
        onCloseRef.current();
      }}
      onKeyDown={(e) => {
        // Handled here, not by the browser, so the screen's own Escape (stop speaking, clear the box) doesn't run too.
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        ref.current?.close();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-reply font-bold">
              {title}
            </h2>
            <button
              type="button"
              aria-label={closeLabel}
              onClick={() => ref.current?.close()}
              className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-edge bg-raised transition-[border-color] duration-150 hover:border-ink"
            >
              <X aria-hidden="true" size={22} weight="bold" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
```

- [ ] **Step 5: Style it**

Append to `src/app/globals.css` (outside any layer):

```css
.sheet {
  margin: 0;
  padding: 0;
  border: 2px solid var(--edge);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--elev-tray);
  overflow-y: auto;
}
.sheet::backdrop {
  background: rgb(16 24 38 / 0.45);
}
.sheet-bottom {
  inset: auto 0 0 0;
  width: 100%;
  max-width: 100%;
  max-height: 85dvh;
  border-radius: 1.5rem 1.5rem 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.sheet-right {
  inset: 0 0 0 auto;
  width: min(28rem, 100%);
  max-width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  border-radius: 1.375rem 0 0 1.375rem;
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/components/sheet.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add vitest.setup.ts src/components/sheet.tsx src/components/sheet.test.tsx src/app/globals.css
git commit -m "Sheet: a modal panel on a native dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings in a drawer

**Files:**
- Modify: `src/components/settings-panel.tsx`
- Create: `src/components/settings-drawer.tsx`
- Modify: `src/components/components.test.tsx` (SettingsPanel tests; new SettingsDrawer test)
- Modify: `src/components/conversation-screen.tsx` (header and bottom of page)
- Modify: `src/components/conversation-screen.test.tsx` (three `getByText("Settings")`)
- Modify: `tests/e2e/conversation.spec.ts`, `tests/e2e/voice.spec.ts`, `tests/e2e/listening.spec.ts` (Settings clicks)

**Interfaces:**
- Consumes: `Sheet` (Task 2).
- Produces: `SettingsButton({ onOpen })` and `SettingsDrawer({ open, onClose, ...SettingsPanel props })` from `src/components/settings-drawer.tsx`. `SettingsPanel` now renders its content directly (no disclosure).

- [ ] **Step 1: Write the failing test**

In `src/components/components.test.tsx`: add `useState` to the React import (`import { useState } from "react";`), import `within` from `@testing-library/react`, import `{ SettingsButton, SettingsDrawer } from "./settings-drawer"`, delete the five lines `await userEvent.click(screen.getByText("Settings"));` in the `SettingsPanel` tests, and add:

```tsx
describe("SettingsDrawer", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <SettingsButton onOpen={() => setOpen(true)} />
        <SettingsDrawer
          open={open}
          onClose={() => setOpen(false)}
          theme="system"
          digitKeys
          cloudCaptions={false}
          learning
          joinLines
          onTheme={() => {}}
          onDigitKeys={() => {}}
          onCloudCaptions={() => {}}
          onLearning={() => {}}
          onJoinLines={() => {}}
        />
      </>
    );
  }

  it("opens from the gear and closes with its close button, giving focus back to the gear", async () => {
    render(<Harness />);
    const gear = screen.getByRole("button", { name: "Settings" });
    await userEvent.click(gear);
    const drawer = screen.getByRole("dialog", { name: "Settings" });
    expect(within(drawer).getByRole("radio", { name: "Match this device" })).toBeChecked();
    await userEvent.click(within(drawer).getByRole("button", { name: "Close settings" }));
    expect(drawer).not.toHaveAttribute("open");
    expect(gear).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/components.test.tsx`
Expected: FAIL, cannot resolve `./settings-drawer`; the SettingsPanel tests fail too because the content is still inside a closed `<details>`.

- [ ] **Step 3: Make SettingsPanel plain content**

In `src/components/settings-panel.tsx`: remove the `CaretDown, GearSix` import, and replace the outer `<details>…<summary>…</summary><div className="flex flex-col gap-6 px-4 pt-2 pb-5">` with `<div className="flex flex-col gap-6">`, closing it where `</div></details>` closed (drop the `</details>`). The fieldsets, toggles and shortcut list inside stay exactly as they are.

- [ ] **Step 4: Write the drawer**

Create `src/components/settings-drawer.tsx`:

```tsx
"use client";

import { GearSix } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { SettingsPanel } from "./settings-panel";
import { Sheet } from "./sheet";

/** The gear in the top bar. */
export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Settings"
      onClick={onOpen}
      className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-edge bg-raised shadow-lift transition-[border-color] duration-150 hover:border-ink"
    >
      <GearSix aria-hidden="true" size={22} />
    </button>
  );
}

/** Settings in a panel from the right edge. */
export function SettingsDrawer({ open, onClose, ...panel }: { open: boolean; onClose: () => void } & ComponentProps<typeof SettingsPanel>) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings" side="right" closeLabel="Close settings">
      <SettingsPanel {...panel} />
    </Sheet>
  );
}
```

- [ ] **Step 5: Run to see it pass**

Run: `npx vitest run src/components/components.test.tsx`
Expected: PASS.

- [ ] **Step 6: Use the drawer on the screen**

In `src/components/conversation-screen.tsx`:

1. Replace `import { SettingsPanel } from "./settings-panel";` with `import { SettingsButton, SettingsDrawer } from "./settings-drawer";`.
2. In `Screen`, next to the other `useState` calls, add:

```tsx
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Runs once the settings drawer has closed, so a screen it opens gets focus after the drawer gives it back. */
  const afterSettings = useRef<(() => void) | null>(null);
  const closeSettings = () => {
    setSettingsOpen(false);
    const next = afterSettings.current;
    afterSettings.current = null;
    next?.();
  };
```

3. In the `<header>`, wrap the menu so the gear sits after it:

```tsx
        <div className="flex items-center gap-2">
          {showMenu && (
            <ProfileMenu /* ...props unchanged... */ />
          )}
          <SettingsButton onOpen={() => setSettingsOpen(true)} />
        </div>
```

4. Replace the whole `<div className="mt-10 max-w-xl"><SettingsPanel … /></div>` block with:

```tsx
        <SettingsDrawer
          open={settingsOpen}
          onClose={closeSettings}
          theme={settings.theme}
          digitKeys={settings.digitKeys}
          cloudCaptions={settings.cloudCaptions}
          learning={settings.learning}
          joinLines={settings.joinLines}
          voiceLabel={settingsVoice ? describeVoice(settingsVoice) : undefined}
          voiceBasic={voiceMode === "basic"}
          onVoice={
            settingsVoice
              ? () => {
                  afterSettings.current = () => leaveConversation("voice");
                  setSettingsOpen(false);
                }
              : undefined
          }
          onTheme={setTheme}
          onDigitKeys={setDigitKeys}
          onCloudCaptions={setCloudCaptions}
          onLearning={toggleLearning}
          onJoinLines={setJoinLines}
        />
```

5. In the `useReplyShortcuts({...})` call, change `enabled: !conversationHidden,` to `enabled: !conversationHidden && !settingsOpen,`.

- [ ] **Step 7: Update the tests that opened the old disclosure**

- `src/components/conversation-screen.test.tsx`: replace each `await userEvent.click(screen.getByText("Settings"));` (three places) with `await userEvent.click(screen.getByRole("button", { name: "Settings" }));`.
- `tests/e2e/conversation.spec.ts`, `tests/e2e/voice.spec.ts`, `tests/e2e/listening.spec.ts`: replace `page.getByText("Settings", { exact: true })` and `page.getByText("Settings")` with `page.getByRole("button", { name: "Settings", exact: true })`.
- `tests/e2e/conversation.spec.ts`, test "number keys can be turned off for voice control users": after the `.uncheck()` line, add `await page.getByRole("button", { name: "Close settings" }).click();` (the drawer is modal, so the page behind can't be used until it closes).

- [ ] **Step 8: Run everything touched**

Run: `npm run typecheck && npx vitest run src/components && npx playwright test tests/e2e/conversation.spec.ts tests/e2e/voice.spec.ts tests/e2e/listening.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/settings-panel.tsx src/components/settings-drawer.tsx src/components/components.test.tsx src/components/conversation-screen.tsx src/components/conversation-screen.test.tsx tests/e2e
git commit -m "Settings open from a gear into a side panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Notes on your lines in the conversation state

**Files:**
- Modify: `src/lib/conversation/reducer.ts`
- Modify: `src/lib/conversation/reducer.test.ts`

**Interfaces:**
- Produces: `ConversationState.lineNotes: Record<string, string>` (turn id → note); action `{ type: "lineNote"; text: string; note: string }`.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe("conversationReducer", …)` in `src/lib/conversation/reducer.test.ts`:

```ts
  it("attaches a note to the newest line you said with that text", () => {
    let s = r(s0, { type: "speakStart", id: "a", text: "Hello", at: 1 });
    s = r(s, { type: "speakStart", id: "b", text: "Hello", at: 2 });
    s = r(s, { type: "lineNote", text: " Hello ", note: "Said in the backup voice: yours wasn't ready in time." });
    expect(s.lineNotes).toEqual({ b: "Said in the backup voice: yours wasn't ready in time." });
  });

  it("ignores a note for a line that isn't there, and a reset clears the notes", () => {
    expect(r(s0, { type: "lineNote", text: "Nope", note: "x" })).toBe(s0);
    const s = r(r(s0, { type: "speakStart", id: "a", text: "Hi", at: 1 }), { type: "lineNote", text: "Hi", note: "x" });
    expect(r(s, { type: "reset" }).lineNotes).toEqual({});
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/conversation/reducer.test.ts`
Expected: FAIL (type error on `lineNote`, `lineNotes` undefined).

- [ ] **Step 3: Implement**

In `src/lib/conversation/reducer.ts`:

```ts
// In ConversationState, after `notice`:
  /** Notes under your lines, by turn id: which voice said it when it wasn't yours. */
  lineNotes: Record<string, string>;

// In ConversationAction:
  /** A note for the newest line you said with this text. */
  | { type: "lineNote"; text: string; note: string }

// In initialConversation:
  lineNotes: {},

// In the reducer switch, before `case "reset":`
    case "lineNote": {
      const text = action.text.trim();
      const turn = state.turns.findLast((t) => t.speaker === "user" && t.text === text);
      return turn ? { ...state, lineNotes: { ...state.lineNotes, [turn.id]: action.note } } : state;
    }
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/lib/conversation && npm run typecheck`
Expected: PASS, types clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversation/reducer.ts src/lib/conversation/reducer.test.ts
git commit -m "Conversation state keeps notes for your lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The thread

**Files:**
- Create: `src/components/thread.tsx`
- Create: `src/components/thread.test.tsx`
- Modify: `src/components/ui.ts` (add `quietButton`)

**Interfaces:**
- Consumes: `primaryButton`, `secondaryButton` from `ui.ts`.
- Produces: `Thread({ turns, partnerName, partial?, speaking?, waiting?, lineNotes?, onStop?, onNewConversation?, footer? })`; `quietButton` in `ui.ts`. The section is the "Conversation" region; its list is "Conversation lines" with one `listitem` per line. Partner list items' text stays `"<Name><text>"` and `"<Name> (still talking)<text>…"`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/thread.test.tsx`:

```tsx
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "@/lib/types";
import { Thread } from "./thread";

const turns: Turn[] = [
  { id: "1", speaker: "partner", text: "What size?", at: 1 },
  { id: "2", speaker: "user", text: "Large, please.", at: 2 },
];

/** Gives the list a scroll position jsdom can't compute. */
function fakeScroll(list: HTMLElement) {
  let top = 0;
  Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 200 });
  Object.defineProperty(list, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
  return { get: () => top, set: (v: number) => (top = v) };
}

describe("Thread", () => {
  it("labels who said each line: their name on the left, You in a bubble", () => {
    render(<Thread turns={turns} partnerName="Sam" />);
    const items = within(screen.getByRole("region", { name: "Conversation" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["SamWhat size?", "YouLarge, please."]);
  });

  it("shows a live line while they are still talking", () => {
    render(<Thread turns={[]} partnerName="Sam" partial="What size" />);
    expect(screen.getByRole("listitem")).toHaveTextContent("Sam (still talking)What size…");
    expect(screen.queryByText("Ready when you are")).toBeNull();
  });

  it("says what to do before anyone talks", () => {
    render(<Thread turns={[]} partnerName="Sam" />);
    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("marks the line being spoken, with a Stop button, and the wait for your voice", async () => {
    const onStop = vi.fn();
    const said: Turn[] = [...turns, { id: "3", speaker: "user", text: "Thanks.", at: 3 }];
    const { rerender } = render(<Thread turns={said} partnerName="Sam" speaking="Thanks." waiting onStop={onStop} />);
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveTextContent(/^You/);
    expect(within(items[2]).getByText("Getting your voice ready…")).toBeInTheDocument();
    rerender(<Thread turns={said} partnerName="Sam" speaking="Thanks." onStop={onStop} />);
    expect(within(items[2]).getByText("Speaking")).toBeInTheDocument();
    await userEvent.click(within(items[2]).getByRole("button", { name: "Stop speaking" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows a note under the line it is about", () => {
    render(<Thread turns={turns} partnerName="Sam" lineNotes={{ "2": "Said in your device's voice: yours wasn't ready in time." }} />);
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Said in your device's voice: yours wasn't ready in time.");
  });

  it("follows new lines until you scroll back, then offers Newest instead of jumping", async () => {
    const { rerender } = render(<Thread turns={turns} partnerName="Sam" partial="What" />);
    const list = screen.getByRole("list", { name: "Conversation lines" });
    const top = fakeScroll(list);

    rerender(<Thread turns={turns} partnerName="Sam" partial="What size" />);
    expect(top.get()).toBe(1000);
    expect(screen.queryByRole("button", { name: "Newest" })).toBeNull();

    // You scroll back to reread, then say something: the thread stays where you are.
    top.set(300);
    act(() => list.dispatchEvent(new Event("scroll")));
    const more: Turn[] = [...turns, { id: "3", speaker: "user", text: "Thanks.", at: 3 }];
    rerender(<Thread turns={more} partnerName="Sam" partial="What size" />);
    expect(top.get()).toBe(300);

    await userEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(top.get()).toBe(1000);
    expect(screen.queryByRole("button", { name: "Newest" })).toBeNull();
  });

  it("asks before clearing the conversation", async () => {
    const onNew = vi.fn();
    render(<Thread turns={turns} partnerName="Sam" onNewConversation={onNew} />);
    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.getByText("Clear this conversation? It isn't saved anywhere.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onNew).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/thread.test.tsx`
Expected: FAIL, cannot resolve `./thread`.

- [ ] **Step 3: Add the quiet button style**

Append to `src/components/ui.ts`:

```ts
/** A low-key action that shouldn't compete with the replies, such as New conversation. */
export const quietButton =
  "min-h-12 rounded-control border-2 border-edge bg-raised px-4 text-label font-bold transition-[border-color] duration-150 hover:border-ink disabled:cursor-not-allowed disabled:opacity-60";
```

- [ ] **Step 4: Write the thread**

Create `src/components/thread.tsx`:

```tsx
"use client";

import { ArrowDown, Info, SpeakerHigh, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Turn } from "@/lib/types";
import { primaryButton, quietButton, secondaryButton } from "./ui";

/** How close to the end of the list still counts as following the newest line. */
const NEAR_END_PX = 64;

interface Props {
  turns: Turn[];
  partnerName: string;
  /** What they have said so far in the turn they are still speaking. */
  partial?: string;
  /** The line being spoken now, and whether it is still waiting for the chosen voice. */
  speaking?: string | null;
  waiting?: boolean;
  /** Notes under your lines, by turn id. */
  lineNotes?: Record<string, string>;
  onStop?: () => void;
  /** Clears the screen for the next conversation; asked about first. */
  onNewConversation?: () => void;
  /** Shown at the bottom on their side, such as "+ They said" on phones. */
  footer?: ReactNode;
}

export function Thread({ turns, partnerName, partial = "", speaking = null, waiting = false, lineNotes = {}, onStop, onNewConversation, footer }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const [confirming, setConfirming] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // Set by Cancel: the New conversation button gets focus back once it's shown again.
  const cancelled = useRef(false);
  const hasLines = turns.length > 0 || partial !== "";
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      newButton.current?.focus();
    }
  }, [confirming]);

  // False once you scroll back to read an earlier line; true again near the end.
  const following = useRef(true);
  const [behind, setBehind] = useState(false);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END_PX;
    setBehind(!following.current);
  };
  // The last line can grow when they carry it on after a pause.
  const lastText = turns.at(-1)?.text;
  useEffect(() => {
    // Scroll only the list, never the page. Instant, so reduced motion is respected.
    const el = list.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [turns.length, lastText, partial]);
  const toNewest = () => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    following.current = true;
    setBehind(false);
  };

  // The newest of your lines with the text being spoken.
  const speakingId = speaking === null ? undefined : turns.findLast((t) => t.speaker === "user" && t.text === speaking)?.id;

  return (
    <section aria-labelledby="conversation-heading" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="conversation-heading" className="text-label font-bold text-muted">
          Conversation
        </h2>
        {onNewConversation && hasLines && !confirming && (
          <button ref={newButton} type="button" className={`${quietButton} min-w-0 [overflow-wrap:anywhere]`} onClick={() => setConfirming(true)}>
            New conversation
          </button>
        )}
      </div>
      {confirming && hasLines && (
        <div className="flex flex-col gap-3">
          <p className="text-body font-bold break-words">Clear this conversation? It isn&apos;t saved anywhere.</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                setConfirming(false);
                onNewConversation?.();
              }}
            >
              Clear
            </button>
            <button
              ref={cancelButton}
              type="button"
              className={secondaryButton}
              onClick={() => {
                cancelled.current = true;
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!hasLines ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
          <p className="text-reply font-bold">Ready when you are</p>
          <p className="max-w-[32rem] text-body text-muted">
            Press <strong className="text-ink">Listen</strong> and their words will show up here in large text. You can also type them with{" "}
            <strong className="text-ink">+ They said</strong>.
          </p>
          {footer}
        </div>
      ) : (
        <div className="relative flex min-h-24 flex-1 flex-col">
          <ol
            ref={list}
            onScroll={onScroll}
            // A tab stop, so keyboard users can scroll back through earlier lines with the arrow keys.
            tabIndex={0}
            aria-label="Conversation lines"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-1 pb-3"
          >
            {turns.map((t) =>
              t.speaker === "partner" ? (
                <li key={t.id} className="max-w-[92%] self-start border-l-4 border-partner pl-4">
                  <span className="block text-label font-bold text-partner">{partnerName}</span>
                  <span className="block text-[1.625rem] leading-[2.0625rem] font-medium break-words lg:text-caption">{t.text}</span>
                </li>
              ) : (
                <li key={t.id} className="flex max-w-[80%] flex-col items-end gap-1 self-end lg:max-w-[72%]">
                  <div className="flex flex-col gap-1 rounded-[1.25rem] rounded-br-md bg-bubble px-4 py-3 text-on-bubble shadow-lift">
                    <span className="flex flex-wrap items-center gap-2 text-label font-bold">
                      <span className="flex items-center gap-2 opacity-80">
                        {t.id === speakingId && <SpeakerHigh aria-hidden="true" size={16} weight="bold" />}
                        {t.id === speakingId ? (waiting ? "Getting your voice ready…" : "Speaking") : "You"}
                      </span>
                      {t.id === speakingId && onStop && (
                        <button
                          type="button"
                          aria-label="Stop speaking"
                          onClick={onStop}
                          className="ml-auto flex min-h-12 items-center gap-1 rounded-full border-2 border-on-bubble bg-cue px-4 text-label font-bold text-on-cue"
                        >
                          <Stop aria-hidden="true" size={14} weight="fill" />
                          Stop
                        </button>
                      )}
                    </span>
                    <span className="block text-body break-words">{t.text}</span>
                  </div>
                  {lineNotes[t.id] && (
                    <p className="flex items-center gap-1 text-label text-muted">
                      <Info aria-hidden="true" size={16} />
                      {lineNotes[t.id]}
                    </p>
                  )}
                </li>
              ),
            )}
            {partial && (
              <li className="max-w-[92%] self-start border-l-4 border-dashed border-partner pl-4">
                <span className="block text-label font-bold text-partner">
                  {partnerName} <span className="font-medium text-muted">(still talking)</span>
                </span>
                <span className="block text-[1.625rem] leading-[2.0625rem] font-medium break-words lg:text-caption">{partial}…</span>
              </li>
            )}
          </ol>
          {behind && (
            <button
              type="button"
              onClick={toNewest}
              className="absolute bottom-3 left-1/2 flex min-h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-5 text-label font-bold text-ground shadow-lift"
            >
              <ArrowDown aria-hidden="true" size={16} weight="bold" />
              Newest
            </button>
          )}
          {footer}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run src/components/thread.test.tsx && npm run typecheck`
Expected: PASS (7 tests), types clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/thread.tsx src/components/thread.test.tsx src/components/ui.ts
git commit -m "Thread: their lines on the left, yours in bubbles, with Stop, notes and Newest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "+ They said"

**Files:**
- Create: `src/components/they-said.tsx`
- Create: `src/components/they-said.test.tsx`

**Interfaces:**
- Produces: `TheySaidButton({ onOpen, pill? })` (accessible name "They said") and `TheySaidForm({ onSubmit, onClose })` (input named "What they said", id `partner-input`; Add submits and closes; Escape and Cancel close; Escape never reaches the window).

- [ ] **Step 1: Write the failing tests**

Create `src/components/they-said.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TheySaidButton, TheySaidForm } from "./they-said";

function Harness({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return open ? <TheySaidForm onSubmit={onSubmit} onClose={() => setOpen(false)} /> : <TheySaidButton onOpen={() => setOpen(true)} />;
}

describe("They said", () => {
  it("opens a box for their words, adds the line on Enter and closes", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    const box = screen.getByLabelText("What they said");
    expect(box).toHaveFocus();
    await userEvent.type(box, "Hot or iced?{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Hot or iced?");
    expect(screen.queryByLabelText("What they said")).toBeNull();
    expect(screen.getByRole("button", { name: "They said" })).toBeInTheDocument();
  });

  it("does nothing with an empty box, and closes on Cancel", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("What they said")).toBeNull();
  });

  it("closes on Escape without the page's own Escape running", async () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("What they said")).toBeNull();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/they-said.test.tsx`
Expected: FAIL, cannot resolve `./they-said`.

- [ ] **Step 3: Write the components**

Create `src/components/they-said.tsx`:

```tsx
"use client";

import { Plus } from "@phosphor-icons/react";
import { useState } from "react";

/** Opens the box for typing what the other person said. `pill` is the small version on their side of the thread (phones). */
export function TheySaidButton({ onOpen, pill = false }: { onOpen: () => void; pill?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        pill
          ? "flex min-h-12 items-center gap-2 self-start rounded-full border-2 border-partner/40 bg-surface px-4 text-label font-bold text-partner"
          : "flex min-h-14 shrink-0 items-center gap-2 rounded-control border-2 border-edge bg-raised px-4 text-label font-bold text-muted transition-[border-color] duration-150 hover:border-ink"
      }
    >
      <Plus aria-hidden="true" size={18} weight="bold" />
      They said
    </button>
  );
}

/**
 * One line for what the other person said. It has the same shape as the type row (a label above
 * one row), so opening it doesn't move the replies. Enter adds the line; Escape or Cancel closes it.
 */
export function TheySaidForm({ onSubmit, onClose }: { onSubmit: (text: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-2 border-l-4 border-partner pl-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(value);
        onClose();
      }}
      onKeyDown={(e) => {
        // Handled here, so the screen's own Escape (stop speaking, clear the reply box) doesn't run too.
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <label htmlFor="partner-input" className="text-label font-bold text-partner">
        What they said
      </label>
      <div className="flex flex-wrap gap-3">
        <input
          id="partner-input"
          name="partner"
          type="text"
          autoComplete="off"
          autoFocus
          placeholder="Type what the other person said…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-14 min-w-32 flex-1 rounded-control border-2 border-ink/30 bg-raised px-4 text-body text-ink placeholder:text-muted"
        />
        <button type="submit" className="min-h-14 rounded-control border-2 border-partner bg-partner px-5 text-body font-bold text-ground">
          Add
        </button>
        <button type="button" onClick={onClose} className="min-h-14 rounded-control border-2 border-edge bg-raised px-5 text-body font-bold">
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components/they-said.test.tsx && npx eslint src/components/they-said.tsx`
Expected: PASS (3 tests); lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/they-said.tsx src/components/they-said.test.tsx
git commit -m "They said: a button and a one-line box for the other person's words

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Listen as a round toggle

**Files:**
- Modify: `src/components/listen-control.tsx`
- Modify: `src/components/components.test.tsx` (ListenControl tests)

**Interfaces:**
- Produces: `ListenControl` with the same props. Accessible name always "Listen" (`aria-pressed`). The status sentence is always in a `role="status"` span; it's visible only for `denied`, `unavailable`, `error`, `interrupted`, as a callout under the button.

- [ ] **Step 1: Write the failing tests**

In the `describe("ListenControl", …)` block of `src/components/components.test.tsx`, add:

```tsx
  it("keeps the status sentence for screen readers, and shows it on screen only when something is wrong", () => {
    const { rerender } = render(<ListenControl hearing={null} status="listening" progress={100} onToggle={() => {}} />);
    expect(screen.getByText("Listening. Their words appear in the conversation.").closest("p")).toHaveClass("sr-only");
    rerender(<ListenControl hearing={null} status="denied" progress={0} onToggle={() => {}} />);
    expect(screen.getByText(/Microphone is off/).closest("p")).not.toHaveClass("sr-only");
  });

  it("shows the download progress on the button without changing its name", () => {
    render(<ListenControl hearing={null} status="loading" progress={42} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Listen" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("Listen42%");
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/components.test.tsx -t ListenControl`
Expected: FAIL (the sentence isn't `sr-only`; the percentage isn't on the button).

- [ ] **Step 3: Rewrite the component body**

In `src/components/listen-control.tsx`, keep `TEXT` and the imports, add the problem set, and replace `ListenControl` and `LevelMeter` with:

```tsx
/** States where the sentence tells the user what went wrong and what to do; only these show on screen. */
const PROBLEMS = new Set<HearingStatus>(["denied", "unavailable", "error", "interrupted"]);

export function ListenControl({ hearing, status, progress, onToggle }: Props) {
  const on = status === "listening" || status === "loading";
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        className={`inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-5 text-body font-bold transition-[border-color,background-color] duration-150 ${
          status === "listening" ? "border-transparent bg-cue text-on-cue" : "border-edge bg-raised text-ink shadow-lift hover:border-ink"
        }`}
      >
        {on ? <Microphone aria-hidden="true" size={22} weight="bold" /> : <MicrophoneSlash aria-hidden="true" size={22} />}
        Listen
        {status === "loading" && (
          <span aria-hidden="true" className="tabular-nums font-medium text-muted">
            {Math.max(0, Math.min(100, progress))}%
          </span>
        )}
        {status === "listening" && <LevelMeter hearing={hearing} />}
      </button>
      {/* Always read out; on screen only when something went wrong. */}
      <p
        className={
          PROBLEMS.has(status)
            ? "absolute top-full left-0 z-10 mt-2 w-max max-w-[min(22rem,calc(100vw-2rem))] rounded-control border-2 border-edge bg-surface p-3 text-label shadow-tray"
            : "sr-only"
        }
      >
        <span role="status">{TEXT[status]}</span>
      </p>
    </div>
  );
}

/** How loud the microphone is right now. Subscribes itself so level updates don't re-render the screen. */
function LevelMeter({ hearing }: { hearing: Hearing | null }) {
  const [level, setLevel] = useState(0);
  useEffect(() => (hearing ? hearing.on("level", setLevel) : undefined), [hearing]);
  return (
    <span aria-hidden="true" className="block h-3 w-12 overflow-hidden rounded-full border-2 border-on-cue/50">
      <span className="block h-full bg-on-cue transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
    </span>
  );
}
```

In the existing test "shows progress while getting ready, then says it is listening", keep `expect(screen.getByText("42%"))` (it now finds the span on the button).

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components/components.test.tsx -t ListenControl`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/listen-control.tsx src/components/components.test.tsx
git commit -m "Listen becomes a round toggle; its status shows only when something is wrong

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Tray pieces

**Files:**
- Create: `src/components/tray.tsx`
- Modify: `src/components/reply-list.tsx`, `src/components/cue-light.tsx`, `src/components/reaction-bar.tsx`, `src/components/phrase-row.tsx`, `src/components/voice-status.tsx`, `src/components/composer.tsx`
- Modify: `src/components/components.test.tsx`, `src/components/voice-status.test.tsx`

**Interfaces:**
- Produces:
  - `Tray({ children })`: the card, with class `tray` (used by Task 11's CSS).
  - `ReplyList` gains `aside?: ReactNode` (right of the cue light) and `below?: ReactNode` (under the cue row). Its "Replies" `h2` is visually hidden.
  - `ReactionBar` and `PhraseRow` roots carry class `tray-extras`.
  - `VoiceStatus` renders nothing when `source === "awake"`.
  - `Composer` gains `before?: ReactNode` (rendered before the input).

- [ ] **Step 1: Write the failing tests**

In `src/components/components.test.tsx`:

```tsx
// Replace the "explains the empty state" test body's expectation:
    expect(screen.getByText("Replies show up here when someone talks to you, or as you type.")).toBeInTheDocument();

// Add to describe("ReplyList"):
  it("puts the cue light first, with anything else beside and under it", () => {
    render(<ReplyList replies={replies} speaking={null} status="ready" onSpeak={vi.fn()} onStop={vi.fn()} aside={<button type="button">Mm-hmm</button>} below={<p>Your phrases</p>} />);
    expect(screen.getByRole("heading", { name: "Replies" })).toHaveClass("sr-only");
    expect(screen.getByText("Replies ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mm-hmm" })).toBeInTheDocument();
    expect(screen.getByText("Your phrases")).toBeInTheDocument();
  });

// Add to describe("Composer"):
  it("shows what comes before the box", () => {
    render(<Composer value="" onChange={vi.fn()} onSpeak={vi.fn()} onFocusReplies={vi.fn()} before={<button type="button">They said</button>} />);
    expect(screen.getByRole("button", { name: "They said" })).toBeInTheDocument();
  });
```

In `src/components/voice-status.test.tsx`, add (importing `render` from `@testing-library/react` and `VoiceStatus` from `./voice-status`):

```tsx
  it("shows nothing once your own voice is ready", () => {
    const { container } = render(<VoiceStatus mode="natural" source="awake" progress={100} />);
    expect(container).toBeEmptyDOMElement();
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/components.test.tsx src/components/voice-status.test.tsx`
Expected: FAIL (new text, `aside`/`below`/`before` not rendered, VoiceStatus not empty).

- [ ] **Step 3: Implement**

`src/components/tray.tsx` (new):

```tsx
import type { ReactNode } from "react";

/** The card at the bottom of the conversation: replies, then the type row. Docked to the bottom edge below 1024 px. */
export function Tray({ children }: { children: ReactNode }) {
  return (
    <div className="tray flex shrink-0 flex-col gap-3 rounded-[1.375rem] border-2 border-edge bg-surface p-3 shadow-tray sm:p-4 max-lg:-mx-4 max-lg:rounded-b-none max-lg:border-x-0 max-lg:border-b-0 max-lg:pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      {children}
    </div>
  );
}
```

`src/components/reply-list.tsx`: add `import type { ReactNode } from "react";` (merge with the existing react import), add to `Props`:

```ts
  /** Shown to the right of the cue light (quick reactions). */
  aside?: ReactNode;
  /** Shown under the cue row (your phrases). */
  below?: ReactNode;
```

destructure `aside, below`, and replace the header and empty text:

```tsx
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="replies-heading" className="sr-only">
          Replies
        </h2>
        <CueLight status={status} />
        <div className="ml-auto">{aside}</div>
      </div>
      {below}
      {replies.length === 0 ? (
        // min-h: three 4rem slots and the gaps between them.
        <p className={`text-body text-muted ${reserve ? "min-h-[13.5rem]" : ""}`}>Replies show up here when someone talks to you, or as you type.</p>
      ) : (
```

and in the reply button's class string replace `"border-ink/15 bg-surface text-ink hover:border-ink/50"` with `"border-edge bg-raised text-ink shadow-lift hover:border-ink/50"`, and `rounded-control` on that button with `rounded-2xl`. In the number badge, replace `border-ink/30 text-muted` with `border-transparent bg-ground text-ink`.

`src/components/cue-light.tsx`: replace the lamp span's class string with:

```tsx
        className={`inline-block size-6 rounded-full border-2 transition-[background-color,border-color,box-shadow] duration-150 ${
          on ? "border-ink bg-cue shadow-[0_0_0_6px_color-mix(in_srgb,var(--cue)_25%,transparent)]" : "border-muted bg-transparent"
        }`}
```

`src/components/reaction-bar.tsx`: add `tray-extras` to both roots (`<div aria-hidden="true" className="tray-extras min-h-12" />` and the group's `className="tray-extras flex flex-wrap items-center gap-3"`), change the label span to `className="sr-only"`, and in the chip buttons replace `border-ink/15 bg-surface` with `border-edge bg-raised shadow-lift`.

`src/components/phrase-row.tsx`: add `tray-extras` to the group's class (`"tray-extras flex flex-wrap items-center gap-3"`) and in the chips replace `border-ink/15 bg-surface` with `border-edge bg-raised shadow-lift`.

`src/components/voice-status.tsx`: in `VoiceStatus`, before the return, add `if (source === "awake") return null;` with the comment `// Nothing to say when your own voice is ready.`

`src/components/composer.tsx`: add `before?: ReactNode;` to `Props` (import `type ReactNode` from "react"), destructure it, render `{before}` as the first child of the `<div className="flex flex-wrap gap-3">`, and change the input's `bg-surface` to `bg-raised`.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/components && npm run typecheck`
Expected: PASS. (The conversation screen still uses these pieces in its old layout; it keeps working.)

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "Tray pieces: cue row with reactions, raised replies, voice status only when needed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Top bar, context chips, demo chip, notices, menu

**Files:**
- Create: `src/lib/use-media.ts`, `src/lib/use-media.test.ts`
- Create: `src/components/top-bar.tsx`, `src/components/demo-chip.tsx`, `src/components/notice-banner.tsx`
- Modify: `src/components/context-bar.tsx` (rewrite)
- Modify: `src/components/profile-menu.tsx`
- Create: `src/components/top-bar.test.tsx`
- Modify: `src/components/profile-components.test.tsx` (ProfileMenu: Settings item)

**Interfaces:**
- Consumes: `Sheet` (Task 2).
- Produces:
  - `useMedia(query: string, serverValue = true): boolean` and `WIDE = "(min-width: 40rem)"` from `src/lib/use-media.ts`.
  - `TopBar({ start?, end?, below? })`.
  - `ContextChips(props)` (two select chips, labelled "Place" and "Talking with") and `ContextButton(props)` (one chip named "Where and who: <place>, <person>" that opens a "Where and who" sheet with the same two selects and Done), both with props `{ places: Note[]; people: Note[]; placeId?: string; partnerId?: string; onChange: (placeId?: string, partnerId?: string) => void }`.
  - `DemoChip({ onSetup })`: "Demo" badge, "Nothing you do here is saved." (shown from 1536 px, so the bar stays one row at 1280 px), "Set up your own".
  - `Notice({ text, onDismiss? })`.
  - `ProfileMenu` gains `compact?: boolean` (☰ icon, name unchanged) and `onSettings?: () => void` (a "Settings" item).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/use-media.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMedia } from "./use-media";

describe("useMedia", () => {
  afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

  it("uses the given value when the browser can't tell", () => {
    expect(renderHook(() => useMedia("(min-width: 40rem)")).result.current).toBe(true);
    expect(renderHook(() => useMedia("(min-width: 40rem)", false)).result.current).toBe(false);
  });

  it("follows the media query as it changes", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    window.matchMedia = ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useMedia("(min-width: 40rem)"));
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });
});
```

Create `src/components/top-bar.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/types";
import { ContextButton, ContextChips } from "./context-bar";
import { DemoChip } from "./demo-chip";
import { Notice } from "./notice-banner";
import { TopBar } from "./top-bar";

const note = (id: string, kind: Note["kind"], name: string): Note => ({ id, kind, text: name, entities: [name], updatedAt: 1 });
const places = [note("p1", "place", "Blue Door Café")];
const people = [note("s1", "person", "Sam")];

describe("TopBar", () => {
  it("shows the mark and what it is given", () => {
    render(<TopBar start={<button type="button">Listen</button>} end={<button type="button">Settings</button>} />);
    expect(screen.getByText("OnBeat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("ContextChips", () => {
  it("chooses the place and the person", async () => {
    const onChange = vi.fn();
    render(<ContextChips places={places} people={people} placeId="p1" onChange={onChange} />);
    expect(screen.getByLabelText("Place")).toHaveValue("p1");
    await userEvent.selectOptions(screen.getByLabelText("Talking with"), "s1");
    expect(onChange).toHaveBeenCalledWith("p1", "s1");
  });
});

describe("ContextButton", () => {
  it("names where and who, and changes them in a sheet", async () => {
    const onChange = vi.fn();
    render(<ContextButton places={places} people={people} placeId="p1" partnerId="s1" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Where and who: Blue Door Café, Sam" }));
    const sheet = screen.getByRole("dialog", { name: "Where and who" });
    await userEvent.selectOptions(within(sheet).getByLabelText("Place"), "");
    expect(onChange).toHaveBeenCalledWith(undefined, "s1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(sheet).not.toHaveAttribute("open");
  });
});

describe("DemoChip", () => {
  it("says nothing is saved and offers your own profile", async () => {
    const onSetup = vi.fn();
    render(<DemoChip onSetup={onSetup} />);
    expect(screen.getByText("Nothing you do here is saved.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set up your own" }));
    expect(onSetup).toHaveBeenCalled();
  });
});

describe("Notice", () => {
  it("can be dismissed when it allows it", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Notice text="Suggestions are paused." onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(<Notice text="Profiles and notes won't be saved in this window." />);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
```

In `src/components/profile-components.test.tsx`, inside `describe("ProfileMenu", …)`, add (reuse the file's `profiles` and `handlers()`; the toggle's name is the active profile's name):

```tsx
  it("offers Settings when asked, as on phones", async () => {
    const onSettings = vi.fn();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} onDemo={vi.fn()} {...handlers()} compact onSettings={onSettings} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSettings).toHaveBeenCalled();
  });
```

(If `handlers()` already includes `onDemo`, drop the explicit `onDemo` prop.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/use-media.test.ts src/components/top-bar.test.tsx src/components/profile-components.test.tsx`
Expected: FAIL, missing modules and props.

- [ ] **Step 3: Implement `useMedia`**

Create `src/lib/use-media.ts`:

```ts
import { useCallback, useSyncExternalStore } from "react";

/** From this width the top bar has room for the place and person chips, the gear and "+ They said" in the type row. */
export const WIDE = "(min-width: 40rem)";

/** Whether a media query matches. `serverValue` is used on the server and where the browser can't tell. */
export function useMedia(query: string, serverValue = true): boolean {
  const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function";
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!supported()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => (supported() ? window.matchMedia(query).matches : serverValue), () => serverValue);
}
```

- [ ] **Step 4: Implement the bar pieces**

Create `src/components/top-bar.tsx`:

```tsx
import type { ReactNode } from "react";

/** The bar along the top of every screen: the mark, then `start`, with `end` pushed to the right. `below` is a second row. */
export function TopBar({ start, end, below }: { start?: ReactNode; end?: ReactNode; below?: ReactNode }) {
  return (
    <header className="border-b border-edge bg-surface">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
        <p className="mr-2 flex items-center gap-2 text-2xl font-extrabold tracking-tight" translate="no">
          <span aria-hidden="true" className="size-3 rounded-full bg-cue shadow-[0_0_0_3px_color-mix(in_srgb,var(--cue)_25%,transparent)]" />
          OnBeat
        </p>
        {start}
        <div className="ml-auto flex items-center gap-2">{end}</div>
      </div>
      {below}
    </header>
  );
}
```

Replace `src/components/context-bar.tsx` with:

```tsx
"use client";

import { MapPin, User } from "@phosphor-icons/react";
import { useState } from "react";
import type { Note } from "@/lib/types";
import { Sheet } from "./sheet";
import { primaryButton } from "./ui";

interface Props {
  places: Note[];
  people: Note[];
  placeId?: string;
  partnerId?: string;
  onChange: (placeId?: string, partnerId?: string) => void;
}

const nameOf = (n: Note) => n.entities[0] ?? n.text;
const chip = "min-h-12 max-w-[16rem] rounded-full border-2 border-edge bg-raised pr-3 pl-10 text-body font-semibold text-ink shadow-lift";
const field = "min-h-12 w-full rounded-control border-2 border-ink/30 bg-raised px-3 text-body text-ink";

function PlaceSelect({ places, placeId, partnerId, onChange, className }: Props & { className: string }) {
  return (
    <select className={className} value={placeId ?? ""} onChange={(e) => onChange(e.target.value || undefined, partnerId)}>
      <option value="">Not set</option>
      {places.map((p) => (
        <option key={p.id} value={p.id}>
          {nameOf(p)}
        </option>
      ))}
    </select>
  );
}

function PersonSelect({ people, placeId, partnerId, onChange, className }: Props & { className: string }) {
  return (
    <select className={className} value={partnerId ?? ""} onChange={(e) => onChange(placeId, e.target.value || undefined)}>
      <option value="">Someone new</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {nameOf(p)}
        </option>
      ))}
    </select>
  );
}

/** Wide screens: the place and the person as two chips in the top bar. */
export function ContextChips(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex items-center">
        <span className="sr-only">Place</span>
        <MapPin aria-hidden="true" size={20} className="pointer-events-none absolute left-3.5 text-muted" />
        <PlaceSelect {...props} className={chip} />
      </label>
      <label className="relative flex items-center">
        <span className="sr-only">Talking with</span>
        <User aria-hidden="true" size={20} className="pointer-events-none absolute left-3.5 text-muted" />
        <PersonSelect {...props} className={chip} />
      </label>
    </div>
  );
}

/** Phones: one chip naming both, which opens a sheet to change them. */
export function ContextButton(props: Props) {
  const [open, setOpen] = useState(false);
  const place = props.places.find((p) => p.id === props.placeId);
  const person = props.people.find((p) => p.id === props.partnerId);
  const placeName = place ? nameOf(place) : "No place";
  const personName = person ? nameOf(person) : "Someone new";
  return (
    <>
      <button
        type="button"
        aria-label={`Where and who: ${placeName}, ${personName}`}
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center gap-2 rounded-control border-2 border-edge bg-raised px-4 text-left text-body font-semibold shadow-lift"
      >
        <MapPin aria-hidden="true" size={20} className="shrink-0 text-muted" />
        <span className="truncate">{placeName}</span>
        <span aria-hidden="true" className="text-muted">
          ·
        </span>
        <User aria-hidden="true" size={20} className="shrink-0 text-muted" />
        <span className="truncate">{personName}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Where and who" closeLabel="Close where and who">
        <label className="flex flex-col gap-1 text-label text-muted">
          Place
          <PlaceSelect {...props} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-label text-muted">
          Talking with
          <PersonSelect {...props} className={field} />
        </label>
        <button type="button" onClick={() => setOpen(false)} className={primaryButton}>
          Done
        </button>
      </Sheet>
    </>
  );
}
```

Create `src/components/demo-chip.tsx`:

```tsx
import { secondaryButton } from "./ui";

/** Shown in the top bar while a demo is open, so nobody mistakes the example person's notes for their own. */
export function DemoChip({ onSetup }: { onSetup: () => void }) {
  return (
    <p className="flex items-center gap-3 text-label">
      <span className="rounded-full bg-cue px-3 py-1 font-bold text-on-cue">Demo</span>
      <span className="hidden 2xl:inline">Nothing you do here is saved.</span>
      <button type="button" onClick={onSetup} className={secondaryButton}>
        Set up your own
      </button>
    </p>
  );
}
```

Create `src/components/notice-banner.tsx`:

```tsx
import { Info, X } from "@phosphor-icons/react";

/** A screen-wide notice under the top bar. Ones that can be dismissed have a close button. */
export function Notice({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-control border-2 border-edge bg-surface py-2 pr-2 pl-4 text-body shadow-lift">
      <Info aria-hidden="true" size={20} className="shrink-0 text-muted" />
      <p className="flex-1 py-1">{text}</p>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-ground">
          <X aria-hidden="true" size={20} weight="bold" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Give the profile menu its phone form and a Settings item**

In `src/components/profile-menu.tsx`:

1. Import `List` with the other icons: `import { CaretDown, List, UserCircle } from "@phosphor-icons/react";`.
2. Add to `Props`:

```ts
  /** Phones: the toggle shows ☰ only (its name stays the profile's) and the panel rises from the bottom. */
  compact?: boolean;
  /** Phones: Settings lives in this menu instead of behind a gear. */
  onSettings?: () => void;
```

3. Replace the toggle's contents and class with:

```tsx
        className={`flex min-h-12 max-w-full items-center gap-2 rounded-full border-2 border-edge bg-raised px-4 text-label font-bold shadow-lift transition-[border-color] duration-150 hover:border-ink sm:max-w-[16rem] sm:text-body ${props.compact ? "min-w-12 justify-center px-3" : ""}`}
      >
        {props.compact ? <List aria-hidden="true" size={22} className="shrink-0" /> : <UserCircle aria-hidden="true" size={22} className="shrink-0" />}
        <span className={props.compact ? "sr-only" : "truncate"}>{label}</span>
        {count > 0 && (
          <span aria-hidden="true" className="shrink-0 rounded-full border-2 border-ink bg-ink px-2 text-label text-surface">
            {count}
          </span>
        )}
        {!props.compact && <CaretDown aria-hidden="true" size={18} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />}
```

4. Replace the panel's class with:

```tsx
          className={`z-20 flex flex-col gap-3 border-2 border-edge bg-surface p-4 shadow-tray ${
            props.compact
              ? "fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+1rem)]"
              : "absolute top-full right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-control"
          }`}
```

5. In the list mode, as the last item (after "Try a demo" in the profile branch, and after the profile list in the demo branch, so it shows in both), add:

```tsx
              {props.onSettings && (
                <button type="button" onClick={() => act(props.onSettings!)} className={item}>
                  Settings
                </button>
              )}
```

Place it once, directly before the closing `</>` of the list-mode fragment, outside the `{!demoName && active && (…)}` block.

- [ ] **Step 6: Run to see them pass**

Run: `npx vitest run src/lib/use-media.test.ts src/components/top-bar.test.tsx src/components/profile-components.test.tsx && npm run typecheck && npx eslint src`
Expected: PASS, types and lint clean. (`ContextBar`'s old export is gone; `conversation-screen.tsx` fails to type-check until Task 10. If so, keep a temporary `export const ContextBar = ContextChips;` at the bottom of `context-bar.tsx` and delete it in Task 10.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/use-media.ts src/lib/use-media.test.ts src/components/top-bar.tsx src/components/top-bar.test.tsx src/components/context-bar.tsx src/components/demo-chip.tsx src/components/notice-banner.tsx src/components/profile-menu.tsx src/components/profile-components.test.tsx
git commit -m "Top bar pieces: context chips and sheet, demo chip, notices, phone menu with Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Assemble the conversation screen

**Files:**
- Modify: `src/components/conversation-screen.tsx`
- Delete: `src/components/caption-log.tsx`, `src/components/spoken-caption.tsx`, `src/components/partner-input.tsx`, `src/components/demo-bar.tsx`
- Modify: `src/app/globals.css` (remove `.conv-grid`, `.conv-fit`, `--header-h`)
- Modify: `src/components/components.test.tsx` (remove the CaptionLog tests and import)
- Modify: `src/components/conversation-screen.test.tsx`
- Modify: `tests/e2e/helpers.ts`, `tests/e2e/conversation.spec.ts`, `tests/e2e/listening.spec.ts`, `tests/e2e/learning.spec.ts`, `tests/e2e/profiles.spec.ts`, `tests/e2e/chatterbox.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 9.
- Produces: the finished screen. Voice notices dispatch `lineNote` with `VOICE_FALLBACK = "Said in your device's voice: yours wasn't ready in time."` and `VOICE_BACKUP = "Said in the backup voice: yours wasn't ready in time."`. E2E helper `theySaid(page, text)`.

- [ ] **Step 1: Update the unit tests to the new screen (they fail first)**

In `src/components/conversation-screen.test.tsx`:

```tsx
// partnerSays helper:
async function partnerSays(text: string) {
  await userEvent.click(screen.getByRole("button", { name: "They said" }));
  await userEvent.type(screen.getByLabelText("What they said"), text);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
}
```

- Test "stops speech with Escape…": replace `act(() => screen.getByLabelText("What they said").focus());` with `await userEvent.click(screen.getByRole("button", { name: "They said" }));` (the box takes focus) and keep the following Escape and expectation.
- Test "clears the lines, replies, last said line and reply box…": before `await userEvent.type(screen.getByLabelText("What they said"), "Anything");` add `await userEvent.click(screen.getByRole("button", { name: "They said" }));`; replace `expect(screen.queryByText("Last said")).toBeNull();` with `expect(screen.getByText("Ready when you are")).toBeInTheDocument();`; replace `expect(screen.getByLabelText("What they said")).toHaveValue("");` with `expect(screen.queryByLabelText("What they said")).toBeNull();`.
- Test "says the voice is getting ready while a line waits for it": replace `screen.getByRole("region", { name: "What you said" })` with `screen.getByRole("region", { name: "Conversation" })`.
- Test "says when the device voice said a line instead of the chosen one":

```tsx
  it("notes under the line when the device voice said it instead of the chosen one", async () => {
    await startWithMaya();
    await userEvent.type(screen.getByLabelText("Type a reply"), "Hello there{Enter}");
    act(() => h.emit("fallback", "Hello there"));
    const line = within(screen.getByRole("region", { name: "Conversation" })).getAllByRole("listitem").at(-1)!;
    expect(line).toHaveTextContent("Said in your device's voice: yours wasn't ready in time.");
  });
```

- Test "tells the user when the backup voice said a line":

```tsx
  it("notes under the line when the backup voice said it", async () => {
    await startWithMaya();
    await userEvent.type(screen.getByLabelText("Type a reply"), "Hello{Enter}");
    act(() => h.emit("backup", "Hello"));
    expect(await screen.findByText("Said in the backup voice: yours wasn't ready in time.")).toBeVisible();
  });
```

- Add a test for Review Focus 4 in `describe("ConversationScreen voice", …)`:

```tsx
  it("doesn't speak a reply when a number is pressed while Settings is open", async () => {
    const speak = vi.spyOn(h.voice, "speak");
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.keyboard("1");
    expect(speak).not.toHaveBeenCalled();
    speak.mockRestore();
  });
```

- Line 381 (`queryByText("Nothing you do here is saved.")`) and line 306 (`findByText("Profiles and notes won't be saved in this window.")`) stay as they are.

In `tests/e2e/profiles.spec.ts`, line 52, the sentence is now hidden below 1536 px: replace `await expect(page.getByText("Nothing you do here is saved.")).toBeVisible();` with `await expect(page.getByText("Demo", { exact: true })).toBeVisible();`.

In `src/components/components.test.tsx`, delete the `describe("CaptionLog", …)` block and its import (the Thread tests cover it).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/conversation-screen.test.tsx`
Expected: FAIL ("They said" button not found, notes not under lines).

- [ ] **Step 3: Rewire the screen's imports and state**

In `src/components/conversation-screen.tsx`:

1. Imports: remove `CaptionLog`, `ContextBar`, `DemoBar`, `PartnerInput`, `SpokenCaption`. Add:

```tsx
import { useMedia, WIDE } from "@/lib/use-media";
import { ContextButton, ContextChips } from "./context-bar";
import { DemoChip } from "./demo-chip";
import { Notice } from "./notice-banner";
import { TheySaidButton, TheySaidForm } from "./they-said";
import { Thread } from "./thread";
import { TopBar } from "./top-bar";
import { Tray } from "./tray";
```

2. Constants: replace `VOICE_BACKUP` and `VOICE_FALLBACK` with:

```tsx
const VOICE_BACKUP = "Said in the backup voice: yours wasn't ready in time.";
const VOICE_FALLBACK = "Said in your device's voice: yours wasn't ready in time.";
```

3. State: delete `conversationKey`/`setConversationKey` and its comment. Add:

```tsx
  const wide = useMedia(WIDE);
  const [theySaidOpen, setTheySaidOpen] = useState(false);
  /** Set when "+ They said" closes, so focus goes back to the reply box once it is shown again. */
  const refocusComposer = useRef(false);
  useEffect(() => {
    if (theySaidOpen || !refocusComposer.current) return;
    refocusComposer.current = false;
    document.getElementById("composer")?.focus();
  }, [theySaidOpen]);
  const closeTheySaid = () => {
    refocusComposer.current = true;
    setTheySaidOpen(false);
  };
```

4. Voice events: replace the `fallback` and `backup` lines with:

```tsx
      voice.on("fallback", (text) => dispatch({ type: "lineNote", text, note: VOICE_FALLBACK })),
      voice.on("backup", (text) => dispatch({ type: "lineNote", text, note: VOICE_BACKUP })),
```

5. `newConversation`: delete `setConversationKey((k) => k + 1);` and replace `document.getElementById("composer")?.focus();` with:

```tsx
    if (theySaidOpen) closeTheySaid();
    else document.getElementById("composer")?.focus();
```

- [ ] **Step 4: Replace the returned layout**

Replace everything from `return (` to the end of `Screen` with the layout below. The six `{view === …}` blocks for setup, the demo picker, the assistant, notes, suggestions and voice are existing code: cut them from the old layout and paste them, unchanged, where the comment marks.

```tsx
  const inConversation = !conversationHidden;
  const contextProps = {
    places,
    people,
    placeId: state.placeId,
    partnerId: state.partnerId,
    onChange: (placeId?: string, partnerId?: string) => dispatch({ type: "setContext", placeId, partnerId }),
  };
  const listen = <ListenControl hearing={hearing} status={hearingStatus} progress={hearingProgress} onToggle={toggleListening} />;
  const openTheySaid = () => setTheySaidOpen(true);

  return (
    <div className={inConversation ? "flex h-dvh flex-col" : undefined}>
      <TopBar
        start={
          inConversation && wide ? (
            <>
              <ContextChips {...contextProps} />
              {listen}
            </>
          ) : undefined
        }
        end={
          <>
            {inConversation && !wide && listen}
            {demo && inConversation && wide && <DemoChip onSetup={() => leaveConversation("setup")} />}
            {showMenu && (
              <ProfileMenu
                profiles={profiles}
                activeId={registry?.active()?.id ?? null}
                demoName={demo?.name ?? null}
                onSwitch={(id) => void switchTo(id)}
                onNotes={() => goTo("notes")}
                voiceLabel={activeVoice ? describeVoice(activeVoice) : undefined}
                onVoice={activeVoice ? () => goTo("voice") : undefined}
                onNew={() => goTo("setup")}
                onExport={exportActive}
                onImport={(file) => void importFile(file)}
                onRename={(name) => void renameActive(name)}
                onDelete={() => void deleteActive()}
                onDemo={() => goTo("demo-picker")}
                suggestionCount={learning.suggestions.length}
                onSuggestions={() => goTo("suggestions")}
                onAssistant={demo || !ASSISTANT_ENABLED ? undefined : openAssistant}
                compact={!wide}
                onSettings={wide ? undefined : () => setSettingsOpen(true)}
              />
            )}
            {(wide || !showMenu) && <SettingsButton onOpen={() => setSettingsOpen(true)} />}
          </>
        }
        below={
          inConversation && !wide ? (
            <div className="px-4 pb-3">
              <ContextButton {...contextProps} />
            </div>
          ) : undefined
        }
      />
      <main
        id="main"
        className={
          inConversation
            ? "flex min-h-0 flex-1 flex-col overflow-y-auto"
            : "mx-auto w-full max-w-[90rem] px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:px-8"
        }
      >
        <h1 className="sr-only">{view === "conversation" ? "Conversation" : "OnBeat"}</h1>
        {/* Always mounted, so screen readers hear a notice when its text changes. */}
        <div role="status" className="mx-auto flex w-full max-w-[54rem] flex-col gap-2 px-4 pt-3 empty:hidden">
          {registry && !registry.durable && <Notice text="Profiles and notes won't be saved in this window." />}
          {state.notice && <Notice text={state.notice} onDismiss={() => dispatch({ type: "notice", text: null })} />}
        </div>
        {/* Move the six existing blocks here exactly as they are today: from `{view === "setup" && (` through the end of `{view === "voice" && activeProfile && activeVoice && (…)}`. */}
        <div className="mx-auto flex min-h-0 w-full max-w-[54rem] flex-1 flex-col gap-3 px-4 pt-3 lg:pb-4" hidden={conversationHidden}>
          <Thread
            turns={state.turns}
            partnerName={partnerName}
            partial={state.partnerPartial}
            speaking={state.speaking}
            waiting={voiceWaiting}
            lineNotes={state.lineNotes}
            onStop={stop}
            onNewConversation={newConversation}
            footer={!wide && !theySaidOpen ? <TheySaidButton pill onOpen={openTheySaid} /> : undefined}
          />
          <Tray>
            <ReplyList
              ref={replyListRef}
              replies={state.replies}
              reserve={conversationStarted}
              speaking={state.speaking}
              status={state.status}
              onSpeak={speak}
              onStop={stop}
              aside={<ReactionBar reactions={state.reactions} reserve={conversationStarted} onReact={(text) => speak(text, { isReaction: true })} />}
              below={<PhraseRow phrases={quickPhrases} onSpeak={(text) => speak(text, { quick: true })} />}
            />
            {theySaidOpen && (
              <TheySaidForm onSubmit={(text) => dispatch({ type: "partnerSaid", id: crypto.randomUUID(), text, at: Date.now() })} onClose={closeTheySaid} />
            )}
            <div hidden={theySaidOpen}>
              <Composer
                value={state.typed}
                onChange={(text) => dispatch({ type: "typed", text })}
                onSpeak={speak}
                onFocusReplies={focusReplies}
                before={wide ? <TheySaidButton onOpen={openTheySaid} /> : undefined}
              />
            </div>
            <VoiceStatus mode={voiceMode} source={voiceSource} progress={voiceProgress} />
            {showTimer && <ResponseGap gaps={gaps} />}
          </Tray>
        </div>
      </main>
      <SettingsDrawer
        open={settingsOpen}
        onClose={closeSettings}
        theme={settings.theme}
        digitKeys={settings.digitKeys}
        cloudCaptions={settings.cloudCaptions}
        learning={settings.learning}
        joinLines={settings.joinLines}
        voiceLabel={settingsVoice ? describeVoice(settingsVoice) : undefined}
        voiceBasic={voiceMode === "basic"}
        onVoice={
          settingsVoice
            ? () => {
                afterSettings.current = () => leaveConversation("voice");
                setSettingsOpen(false);
              }
            : undefined
        }
        onTheme={setTheme}
        onDigitKeys={setDigitKeys}
        onCloudCaptions={setCloudCaptions}
        onLearning={toggleLearning}
        onJoinLines={setJoinLines}
      />
    </div>
  );
}
```

Delete `src/components/caption-log.tsx`, `src/components/spoken-caption.tsx`, `src/components/partner-input.tsx` and `src/components/demo-bar.tsx`, and the temporary `ContextBar` alias if Task 9 added one.

In `src/app/globals.css`, delete the `--header-h` line and its comment in `html`, and the whole `@layer components { .conv-grid … }` block and the `.conv-fit` media block.

- [ ] **Step 5: Run the unit tests**

Run: `npm run typecheck && npx eslint src && npx vitest run`
Expected: types and lint clean, all unit tests pass.

- [ ] **Step 6: Update the end-to-end tests**

Add to `tests/e2e/helpers.ts`:

```ts
/** Types a line for the other person with "+ They said". */
export async function theySaid(page: Page, text: string) {
  await page.getByRole("button", { name: "They said", exact: true }).click();
  await page.getByLabel("What they said").fill(text);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}
```

Then:

- `tests/e2e/conversation.spec.ts`: import `theySaid`; replace every two-line `getByLabel("What they said").fill(X)` + `getByRole("button", { name: "Add" }).click()` with `await theySaid(page, X);`. Replace `page.getByRole("region", { name: "What you said" })).toContainText("Large, please.")` with `page.getByRole("list", { name: "Conversation lines" }).getByRole("listitem").last()).toContainText("Large, please.")` (both places). Replace `getByText("What the other person says will appear here in large text.")` with `getByText("Ready when you are")`. Replace `expect(page.getByRole("region", { name: "What you said" })).toHaveCount(0)` with `expect(page.getByRole("list", { name: "Conversation lines" })).toHaveCount(0)`.
- `tests/e2e/learning.spec.ts`: make `say(page, text)` call `theySaid(page, text)` (import it).
- `tests/e2e/profiles.spec.ts`: replace the fill and Add lines with `await theySaid(page, "How do you talk to people?");` (import it).
- `tests/e2e/chatterbox.spec.ts`: replace `await expect(page.getByText("Your voice is ready.")).toBeVisible();` with `await expect(page.getByText("Waking your voice…")).toHaveCount(0);` and the fallback text with `"Said in your device's voice: yours wasn't ready in time."`.
- `tests/e2e/listening.spec.ts`:
  - In the "long lines" tests, replace `page.getByLabel("What they said")` in the in-viewport list with `page.getByRole("button", { name: "They said", exact: true })`; replace `await expect(page.getByRole("region", { name: "What you said" })).toContainText(said);` with `await expect(page.getByRole("list", { name: "Conversation lines" }).getByText(said)).toBeInViewport();`; delete the three `fontPx` lines.
  - Replace the phone test ("live captions don't scroll the page away from the replies on a phone") with:

```ts
test("live captions don't move the page or the replies on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await installFakeHearing(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  for (const line of ["Good morning!", "How are you today?", "What size would you like?", "Anything to eat?", "Oat milk again?", "For here or to go?", "Is that everything?"]) {
    await hear(page, "turnEnd", line);
  }
  const log = page.getByRole("list", { name: "Conversation lines" });
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const reply = page.getByRole("button", { name: "Large, please." });
  await expect(reply).toBeInViewport({ ratio: 1 });
  const replyTop = (await reply.boundingBox())?.y;

  // Only captions change from here: requests made while they talk never answer.
  await page.route("**/api/suggest", () => {});
  for (const words of ["Would", "Would you like", "Would you like a pastry", "Would you like a pastry with that"]) {
    await hear(page, "partial", words);
    await expect(page.getByText(`${words}…`)).toBeAttached();
  }
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await reply.boundingBox())?.y).toBe(replyTop);
  await expect(reply).toBeInViewport({ ratio: 1 });
  await expect(page.getByLabel("Type a reply")).toBeInViewport({ ratio: 1 });
});
```

- [ ] **Step 7: Add the Review Focus end-to-end checks**

Append to `tests/e2e/conversation.spec.ts` (import `theySaid`):

```ts
test("a long unbroken word wraps in both speakers' lines at 320 px", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await startWithMaya(page);
  const word = "https://example.com/" + "a".repeat(120);
  await theySaid(page, word);
  await page.getByLabel("Type a reply").fill(word);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Conversation lines" }).getByRole("listitem")).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("opening + They said doesn't move the replies", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  const reply = page.getByRole("button", { name: "Large, please." });
  await expect(reply).toBeVisible();
  const before = (await reply.boundingBox())?.y;
  await page.getByRole("button", { name: "They said", exact: true }).click();
  await expect(page.getByLabel("What they said")).toBeFocused();
  expect((await reply.boundingBox())?.y).toBe(before);
});

test("the controls are reached with Tab in the order they appear", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  // Start from the first thing on the page, as a keyboard user would.
  await page.getByRole("link", { name: "Skip to replies" }).focus();
  const names: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute("aria-label") ?? (el?.tagName === "SELECT" ? (el.closest("label")?.textContent ?? "") : (el?.textContent ?? "")).trim();
      }),
    );
  }
  const expected = ["Place", "Talking with", "Listen", "Set up your own", "Demo: Maya", "Settings", "New conversation", "Conversation lines", "Mm-hmm", "Large, please.", "They said", "Speak"];
  let at = 0;
  for (const name of names) if (at < expected.length && name.includes(expected[at])) at++;
  expect(at, `missing or out of order: ${expected[at]} in ${names.join(" | ")}`).toBe(expected.length);
});
```

- [ ] **Step 8: Run all end-to-end tests**

Run: `npx playwright test --reporter=line`
Expected: all pass (live-model specs skip without `ONBEAT_LIVE=1`).

- [ ] **Step 9: Commit**

```bash
git add -A src tests
git commit -m "Conversation screen: top bar, thread and reply tray

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Phones and tablets

**Files:**
- Modify: `src/app/layout.tsx` (viewport)
- Modify: `src/app/globals.css` (rows that step aside while typing)
- Modify: `src/components/thread.tsx` (header row class), `src/components/composer.tsx` (label class), `src/components/conversation-screen.tsx` (context row and voice status classes)
- Create: `tests/e2e/phone.spec.ts`

**Interfaces:**
- Consumes: `.tray` and `.tray-extras` classes (Task 8), `ContextButton`, compact `ProfileMenu` (Task 9), the assembled screen (Task 10).

- [ ] **Step 1: Write the failing end-to-end tests**

Create `tests/e2e/phone.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { prepare, startWithMaya, theySaid } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("on a phone the replies and the type box are on screen without scrolling", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "They said", exact: true }).click();
  await page.getByLabel("What they said").fill("What size would you like?");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  for (const name of ["Large, please.", "Hi Sam, my usual please.", "What sizes do you have?"]) {
    await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByLabel("Type a reply")).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("the reactions step aside while you type, and come back after", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();
  await page.getByLabel("Type a reply").focus();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeHidden();
  await page.locator("body").click();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();
});

test("with the keyboard open, their latest line and all three replies still show", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "Would you like that hot or iced, and do you want it in a mug?");
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  // An open keyboard leaves about 600 px of an 844 px phone; resizes-content shrinks the page to that.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.getByLabel("Type a reply").focus();
  await expect(page.getByRole("list", { name: "Conversation lines" }).getByRole("listitem").last()).toBeInViewport();
  for (const name of ["Large, please.", "Hi Sam, my usual please.", "What sizes do you have?"]) {
    await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
});

test("place and person change in a sheet, and Settings is in the menu", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: /^Where and who/ }).click();
  const sheet = page.getByRole("dialog", { name: "Where and who" });
  await sheet.getByLabel("Talking with").selectOption({ label: "Someone new" });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Where and who: Blue Door Café, Someone new" })).toBeVisible();

  await page.getByRole("button", { name: "Demo: Maya" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

for (const theme of [undefined, "dark", "contrast"]) {
  test(`the phone screen and its sheet pass axe (${theme ?? "light"})`, async ({ page }) => {
    await prepare(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startWithMaya(page);
    await theySaid(page, "What size would you like?");
    await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
    const screen = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(screen.violations).toEqual([]);
    await page.getByRole("button", { name: /^Where and who/ }).click();
    const sheet = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(sheet.violations).toEqual([]);
  });
}
```

- [ ] **Step 2: Run to see them fail**

Run: `npx playwright test tests/e2e/phone.spec.ts --reporter=line`
Expected: the reactions test and the keyboard test fail (nothing steps aside yet). The others may already pass; that's fine.

- [ ] **Step 3: Implement**

`src/app/layout.tsx`, in `viewport`, add (Next.js 16 supports it; see `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md`):

```ts
  // An open on-screen keyboard shrinks the page, so the reply tray stays above it.
  interactiveWidget: "resizes-content",
```

`src/app/globals.css`, append:

```css
/*
 * Phones and tablets: while you type, the keyboard takes much of the screen. Rows you don't need for
 * typing step aside so their latest line and all three replies keep their room. The type box's
 * label is only hidden from sight; screen readers still hear it.
 */
@media (width < 64rem) {
  body:has(#composer:focus) :is(.tray-extras, .typing-hide) {
    display: none;
  }
  body:has(#composer:focus) .typing-quiet {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
```

Then mark the rows:

- `src/components/thread.tsx`: add `typing-hide` to the class of the header row (the `<div className="flex flex-wrap items-center justify-between gap-3">` holding the "Conversation" heading).
- `src/components/composer.tsx`: add `typing-quiet` to the class of `<label htmlFor="composer">`.
- `src/components/conversation-screen.tsx`: make the context row wrapper `<div className="typing-hide px-4 pb-3">`, and wrap `<VoiceStatus … />` in `<div className="typing-hide">…</div>`.

- [ ] **Step 4: Run to see them pass, then everything**

Run: `npx playwright test tests/e2e/phone.spec.ts --reporter=line && npx playwright test --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css src/components/thread.tsx src/components/composer.tsx src/components/conversation-screen.tsx tests/e2e/phone.spec.ts
git commit -m "Phones: the tray rides above the keyboard, and the reactions step aside while typing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The other screens take the new look

The six edits in step 2 are independent of each other and can be done by parallel subagents, each reviewed before merging.

**Files:**
- Modify: `src/components/ui.ts`
- Modify: `src/components/profile-setup.tsx:90`, `src/components/profile-picker.tsx:6`, `src/components/notes-editor.tsx:44`, `src/components/suggested-notes.tsx:66`, `src/components/voice-picker.tsx` (`VoiceScreen` root section), `src/components/assistant-screen.tsx:233`

**Interfaces:**
- Produces: `screenCard` in `ui.ts`; restyled `primaryButton`, `secondaryButton`, `textField`, `textArea`.

- [ ] **Step 1: Restyle the shared classes**

In `src/components/ui.ts`:

```ts
export const primaryButton =
  "min-h-12 rounded-control border-2 border-ink bg-ink px-5 text-body font-bold text-ground shadow-lift transition-[transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryButton =
  "min-h-12 rounded-control border-2 border-edge bg-raised px-5 text-body font-bold shadow-lift transition-[border-color] duration-150 hover:border-ink disabled:cursor-not-allowed disabled:opacity-60";
export const textField = "min-h-12 w-full rounded-control border-2 border-ink/30 bg-raised px-4 text-body text-ink placeholder:text-muted";
export const textArea = "min-h-28 w-full rounded-control border-2 border-ink/30 bg-raised px-4 py-3 text-body text-ink placeholder:text-muted";
/** The lifted card each non-conversation screen sits on. */
export const screenCard = "mx-auto w-full rounded-[1.375rem] border-2 border-edge bg-surface p-5 shadow-tray sm:p-8";
```

- [ ] **Step 2: Put each screen on a card**

In each file, import `screenCard` from `./ui` (merge with the existing `./ui` import) and change the root section's `className` from the literal to a template that starts with `screenCard`:

| File | Before | After |
|---|---|---|
| `profile-setup.tsx` | `className="flex max-w-2xl flex-col gap-6"` | ``className={`${screenCard} flex max-w-2xl flex-col gap-6`}`` |
| `profile-picker.tsx` | `className="flex max-w-3xl flex-col gap-4"` | ``className={`${screenCard} flex max-w-3xl flex-col gap-4`}`` |
| `notes-editor.tsx` | `className="flex max-w-3xl flex-col gap-6"` (the `notes-heading` section) | ``className={`${screenCard} flex max-w-3xl flex-col gap-6`}`` |
| `suggested-notes.tsx` | `className="flex max-w-3xl flex-col gap-6"` (the `suggestions-heading` section) | ``className={`${screenCard} flex max-w-3xl flex-col gap-6`}`` |
| `voice-picker.tsx` | `className="flex max-w-2xl flex-col gap-6"` (the `voice-heading` section) | ``className={`${screenCard} flex max-w-2xl flex-col gap-6`}`` |
| `assistant-screen.tsx` | `className="flex max-w-3xl flex-col gap-6"` (the `assistant-heading` section) | ``className={`${screenCard} flex max-w-3xl flex-col gap-6`}`` |

- [ ] **Step 3: Check every screen still passes its tests and axe**

Run: `npm run typecheck && npx vitest run && npx playwright test tests/e2e/profiles.spec.ts tests/e2e/voice.spec.ts tests/e2e/assistant.spec.ts tests/e2e/learning.spec.ts tests/e2e/conversation.spec.ts --reporter=line`
Expected: all pass (the axe tests on the setup, picker and conversation screens run in all three themes).

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "The other screens sit on lifted cards with the new buttons and fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Final check against the mockups

**Files:**
- Create (temporary, not committed): `tests/e2e/zz-shots.spec.ts`

- [ ] **Step 1: Run every check**

Run: `npm run typecheck && npx eslint src tests && npx vitest run && npx playwright test --reporter=line`
Expected: all clean and passing. Record the counts for the pull request.

- [ ] **Step 2: Take screenshots of the real app**

Create `tests/e2e/zz-shots.spec.ts`:

```ts
import { test } from "@playwright/test";
import { prepare, startWithMaya, theySaid } from "./helpers";

// Point SHOTS_DIR at the session's scratchpad directory, never at a path in the repo.
const OUT = process.env.SHOTS_DIR ?? "shots";
const sizes = { laptop: { width: 1430, height: 785 }, phone: { width: 390, height: 844 } };

for (const [device, viewport] of Object.entries(sizes)) {
  for (const theme of [undefined, "dark", "contrast"]) {
    test(`${device} ${theme ?? "light"}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await prepare(page, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await startWithMaya(page);
      await page.screenshot({ path: `${OUT}/${device}-${theme ?? "light"}-empty.png` });
      await theySaid(page, "Good morning! What can I get started for you today?");
      await page.getByRole("button", { name: "Large, please." }).click();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}/${device}-${theme ?? "light"}-talking.png` });
    });
  }
}
```

Run it with `SHOTS_DIR=<scratchpad> npx playwright test tests/e2e/zz-shots.spec.ts --reporter=line`, then delete the file.

- [ ] **Step 3: Compare with the approved mockups**

Open each screenshot next to `.superpowers/brainstorm/973-1791558340/content/laptop-states.html`, `phone-v2.html` and `themes.html`. Check: the top bar order, the thread with bubbles on the right, the tray with the cue row, three reply slots and the type row, the docked tray on the phone, and that the dark bubble is light with dark text. Fix any difference with a small commit of its own and rerun step 1.

- [ ] **Step 4: Open the pull request**

Push the branch and open a pull request against `main` titled "Conversation redesign: chat thread, reply tray and the Porcelain look". The body lists what changed (with before and after screenshots), what to know (phone keyboard behaviour still needs a check on a real phone), and the check counts from step 1, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
