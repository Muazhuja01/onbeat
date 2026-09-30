# OnBeat assistant (profiles stage 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A short chat, opened from the profile menu, that updates the user's notes, prepares them for an appointment, and makes quick phrases, with every change confirmed on a card; quick phrases then show in a "Your phrases" row that follows Talking with and Place.

**Architecture:** The browser keeps the chat (`AssistSession`) and sends the whole chat, the job, the notes and the quick phrases to `POST /api/assist` on every user message. The server makes one model call that returns `{ say, proposals }` as JSON, drops every proposal the check rejects, and answers. Kept cards write through the existing `MemoryStore`. A new eval drives the same session with a simulated user and judges the cards.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching route code), React 19, TypeScript, zod, vitest + Testing Library, Playwright + axe, Groq (`qwen/qwen3.8-27b`) with Cloudflare as backup, tsx for evals.

**Spec:** `docs/superpowers/specs/2026-09-30-onbeat-assistant-design.md`

## Global Constraints

- Nothing is saved without Keep (or Delete for a removal). Every kept item goes through `MemoryStore`.
- Server: same origin only, no logging of request content, body limit 64,000 characters, 10 requests a minute per address.
- Model: `qwen/qwen3.8-27b` via `providerConfigs`, `ASSIST_MODEL` overrides `GROQ_MODEL` for this route. Order `["groq", "cloudflare"]`.
- The assistant's message (`say`) is at most 400 characters. A quick phrase is at most 120 characters. A note is at most 300 characters (`NOTE_MAX`).
- A chat takes at most 20 user messages (`ASSIST_USER_MAX`).
- Notes sent: all if their text totals under 12,000 characters (`ASSIST_NOTES_CHARS`), else the about-me note plus related notes up to that total.
- The "Your phrases" row shows at most 4 phrases.
- Chat lines never reach the learning queue. A quick phrase tapped in conversation is not learned from.
- Not offered in demos.
- UI copy is plain, addressed to the user ("you"), no emoji, no exclamation marks except where existing copy has them.
- Code style: match the surrounding code (short doc comments that say why, no comment noise, Tailwind classes from `src/components/ui.ts`).
- Run commands from the worktree `C:/Users/hujai/onbeat-assist`. The eval loads keys from the main checkout's `.env.local` (`eval/learning/env.ts` already does this).

## Review Focus

1. **A card kept after the note changed elsewhere** (edited in Your notes, or by a kept suggested note while the chat was open): the card must not overwrite the newer text; it says "This note has changed since" and offers Edit and Skip. Test in Task 7.
2. **A double tap on Keep or Delete**: saves or deletes once. Test in Task 7 (session guard) and Task 9 (the card disappears at once).
3. **A reply arriving after the chat was closed or the profile switched**: thrown away, nothing written. Test in Task 7.
4. **Tapping a quick phrase in conversation**: it must not move the phrase to another person or place (today `addPhrase` overwrites `context` on every use), and must not reach learning. Tests in Task 5 and Task 10.
5. **Deleting a person or place note that quick phrases are tied to**: the phrases stay and become general; the row never shows a phrase tied to a note that is gone. Test in Task 5.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/assist/protocol.ts` (new) | Request and proposal schemas, limits, types shared by browser and server |
| `src/lib/assist/prompt.ts` (new) | Model messages and the output parser |
| `src/lib/assist/check.ts` (new) | Drops proposals that cite the wrong lines or state unbacked details |
| `src/lib/assist/server.ts` (new) | One turn: short ids, model call, one retry on unreadable output, check |
| `src/app/api/assist/route.ts` (new) | The HTTP route |
| `src/lib/assist/client.ts` (new) | `fetch` wrapper mapping statuses to outcomes |
| `src/lib/assist/notes.ts` (new) | Which notes and quick phrases a request carries |
| `src/lib/assist/session.ts` (new) | Chat state, cards, keep/skip rules, closing |
| `src/lib/types.ts` | `Phrase.quick` |
| `src/lib/memory/store.ts` | Quick phrase methods; `addPhrase` keeps a quick phrase's context; `removeNote` unties phrases |
| `src/lib/profiles/transfer.ts` | Import keeps `quick` |
| `src/lib/learning/session.ts` | Export `contentWords` |
| `src/components/suggestion-card.tsx` (new) | The card shared by Suggested notes and the assistant |
| `src/components/suggested-notes.tsx` | Uses the shared card |
| `src/components/assistant-screen.tsx` (new) | The assistant screen and its session |
| `src/components/phrase-row.tsx` (new) | "Your phrases" row |
| `src/components/quick-phrases-editor.tsx` (new) | Quick phrases section inside Your notes |
| `src/components/notes-editor.tsx` | Renders the quick phrases section |
| `src/components/profile-menu.tsx` | "Assistant" item |
| `src/components/conversation-screen.tsx` | Assistant view, phrase row, quick-phrase speaking |
| `tests/e2e/assistant.spec.ts` (new) | End to end with a mocked route |
| `eval/assist/*` (new) | Cases, simulated user, judge, gold set, runner, scoring, results |

---

### Task 1: Protocol

**Files:**
- Create: `src/lib/assist/protocol.ts`
- Test: `src/lib/assist/protocol.test.ts`

**Interfaces:**
- Produces:
  - `ASSIST_USER_MAX = 20`, `ASSIST_LINES_MAX = 40`, `ASSIST_LINE_MAX = 600`, `ASSIST_SAY_MAX = 400`, `PHRASE_MAX = 120`, `ASSIST_NOTES_CHARS = 12_000`, `ASSIST_NOTES_MAX = 200`, `ASSIST_PHRASES_MAX = 100`, `ASSIST_PROPOSALS_MAX = 8`
  - `type AssistJob = "update" | "prepare" | "phrases"`
  - `AssistRequestSchema`, `type AssistRequest`
  - `AssistProposalSchema`, `type AssistProposal` (discriminated union on `action`: `"add" | "edit" | "remove" | "phrase"`)
  - `type AssistResponse = { say: string; proposals: AssistProposal[] }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assist/protocol.test.ts
import { describe, expect, it } from "vitest";
import { AssistProposalSchema, AssistRequestSchema } from "./protocol";

const base = {
  job: "prepare",
  today: "2026-10-05",
  lines: [{ id: "u1", speaker: "user", text: "I see Dr Chen on Thursday." }],
  notes: [{ id: "n1", kind: "about-me", text: "I'm Tom." }],
  phrases: [{ id: "p1", text: "Please write it down.", for: "Dr. Chen" }],
};

describe("AssistRequestSchema", () => {
  it("accepts a chat that ends with the user's line", () => {
    expect(AssistRequestSchema.safeParse(base).success).toBe(true);
    expect(AssistRequestSchema.safeParse({ ...base, job: null }).success).toBe(true);
  });

  it("refuses a chat that ends with the assistant's line", () => {
    const lines = [...base.lines, { id: "a1", speaker: "assistant", text: "When?", proposed: [] }];
    expect(AssistRequestSchema.safeParse({ ...base, lines }).success).toBe(false);
  });

  it("refuses more than 20 user lines", () => {
    const lines = Array.from({ length: 21 }, (_, i) => ({ id: `u${i}`, speaker: "user", text: "hi" }));
    expect(AssistRequestSchema.safeParse({ ...base, lines }).success).toBe(false);
  });

  it("refuses notes over the character budget", () => {
    const notes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, kind: "routine", text: "x".repeat(300) }));
    expect(AssistRequestSchema.safeParse({ ...base, notes }).success).toBe(false);
  });
});

describe("AssistProposalSchema", () => {
  it("reads each kind", () => {
    for (const p of [
      { action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lineIds: ["u1"] },
      { action: "edit", kind: "routine", noteId: "n2", text: "Physio on Thursdays.", lineIds: ["u1"] },
      { action: "remove", noteId: "n2", lineIds: ["u1"] },
      { action: "phrase", text: "Can we go over my dose?", for: "Dr. Chen", lineIds: ["u1"] },
    ]) {
      expect(AssistProposalSchema.safeParse(p).success).toBe(true);
    }
  });

  it("refuses a phrase over 120 characters", () => {
    expect(AssistProposalSchema.safeParse({ action: "phrase", text: "x".repeat(121), lineIds: ["u1"] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assist/protocol.test.ts`
Expected: FAIL, cannot find module `./protocol`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/assist/protocol.ts
import { z } from "zod";
import { NOTE_MAX } from "@/lib/profiles/notes";

export const ASSIST_USER_MAX = 20;
/** Every user line has at most one assistant line after it. */
export const ASSIST_LINES_MAX = ASSIST_USER_MAX * 2;
export const ASSIST_LINE_MAX = 600;
export const ASSIST_SAY_MAX = 400;
export const PHRASE_MAX = 120;
/** About 40 full notes; past this only related notes are sent (spec decision 22). */
export const ASSIST_NOTES_CHARS = 12_000;
export const ASSIST_NOTES_MAX = 200;
export const ASSIST_PHRASES_MAX = 100;
/** A dated note, a person, a place and five phrases. */
export const ASSIST_PROPOSALS_MAX = 8;

export type AssistJob = "update" | "prepare" | "phrases";

const Kind = z.enum(["person", "place", "routine", "preference", "about-me"]);
const Id = z.string().min(1).max(64);

export const AssistRequestSchema = z
  .object({
    job: z.enum(["update", "prepare", "phrases"]).nullable(),
    /** The user's local date, YYYY-MM-DD. */
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lines: z
      .array(
        z.object({
          id: Id,
          speaker: z.enum(["user", "assistant"]),
          text: z.string().trim().min(1).max(ASSIST_LINE_MAX),
          /** For an assistant line: short descriptions of what it already offered. */
          proposed: z.array(z.string().max(NOTE_MAX + 40)).max(ASSIST_PROPOSALS_MAX).optional(),
        }),
      )
      .min(1)
      .max(ASSIST_LINES_MAX),
    notes: z.array(z.object({ id: Id, kind: Kind, text: z.string().max(NOTE_MAX) })).max(ASSIST_NOTES_MAX),
    phrases: z.array(z.object({ id: Id, text: z.string().max(PHRASE_MAX), for: z.string().max(80).optional() })).max(ASSIST_PHRASES_MAX),
  })
  .refine((r) => r.lines.at(-1)?.speaker === "user", "the last line is the user's")
  .refine((r) => r.lines.filter((l) => l.speaker === "user").length <= ASSIST_USER_MAX, "too many user lines")
  .refine((r) => r.notes.reduce((n, x) => n + x.text.length, 0) <= ASSIST_NOTES_CHARS, "notes over budget");

export type AssistRequest = z.infer<typeof AssistRequestSchema>;

const LineIds = z.array(z.string()).min(1).max(ASSIST_LINES_MAX);

export const AssistProposalSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), kind: Kind, name: z.string().max(60).optional(), text: z.string().min(1).max(NOTE_MAX), lineIds: LineIds }),
  z.object({ action: z.literal("edit"), kind: Kind, name: z.string().max(60).optional(), text: z.string().min(1).max(NOTE_MAX), noteId: z.string(), lineIds: LineIds }),
  z.object({ action: z.literal("remove"), noteId: z.string(), lineIds: LineIds }),
  z.object({ action: z.literal("phrase"), text: z.string().trim().min(1).max(PHRASE_MAX), for: z.string().max(80).optional(), lineIds: LineIds }),
]);

export type AssistProposal = z.infer<typeof AssistProposalSchema>;

export interface AssistResponse {
  say: string;
  proposals: AssistProposal[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assist/protocol.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assist/protocol.ts src/lib/assist/protocol.test.ts
git commit -m "Add the assistant's request and proposal schemas"
```

---

### Task 2: Prompt and parser

**Files:**
- Create: `src/lib/assist/prompt.ts`
- Test: `src/lib/assist/prompt.test.ts`

**Interfaces:**
- Consumes: `AssistRequest`, `AssistJob`, `ASSIST_SAY_MAX`, `ASSIST_PROPOSALS_MAX`, `PHRASE_MAX` (Task 1); `dateLine` from `@/lib/learning/prompt`; `ChatMessage` from `@/lib/suggest/prompt`.
- Produces:
  - `buildAssistMessages(req: AssistRequest): ChatMessage[]` (req uses short ids: `U1`, `A1`, `N1`, `Q1`)
  - `interface RawAssistProposal { action: "add" | "edit" | "remove" | "phrase"; kind?: NoteKind; name?: string; text?: string; note?: string; for?: string; lines: string[] }`
  - `parseAssistOutput(output: string): { say: string; proposals: RawAssistProposal[] } | null`
  - `clipSay(text: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assist/prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildAssistMessages, clipSay, parseAssistOutput } from "./prompt";

describe("parseAssistOutput", () => {
  it("reads a pretty-printed object across lines, with a think block and a code fence around it", () => {
    const out = `<think>ok</think>\n\`\`\`json\n{\n  "say": "When is it?",\n  "proposals": [\n    {"action": "phrase", "text": "Can we go over my dose?", "for": "Dr. Chen", "lines": ["U1"]}\n  ]\n}\n\`\`\``;
    expect(parseAssistOutput(out)).toEqual({
      say: "When is it?",
      proposals: [{ action: "phrase", text: "Can we go over my dose?", for: "Dr. Chen", lines: ["U1"] }],
    });
  });

  it("skips malformed proposals and keeps the rest", () => {
    const out = JSON.stringify({
      say: "Here you go.",
      proposals: [
        { action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lines: ["U1"] },
        { action: "add", kind: "robot", text: "x", lines: ["U1"] },
        { action: "edit", kind: "routine", text: "no note id", lines: ["U1"] },
        { action: "remove", note: "N2", lines: [] },
        { action: "remove", note: "N2", lines: ["U2"] },
        { action: "phrase", text: "x".repeat(121), lines: ["U1"] },
      ],
    });
    expect(parseAssistOutput(out)?.proposals).toEqual([
      { action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lines: ["U1"] },
      { action: "remove", note: "N2", lines: ["U2"] },
    ]);
  });

  it("is null without a say", () => {
    expect(parseAssistOutput('{"proposals": []}')).toBeNull();
    expect(parseAssistOutput("Sure, here is a note.")).toBeNull();
  });

  it("keeps at most 8 proposals", () => {
    const proposals = Array.from({ length: 10 }, (_, i) => ({ action: "phrase", text: `Phrase ${i}`, lines: ["U1"] }));
    expect(parseAssistOutput(JSON.stringify({ say: "ok", proposals }))?.proposals).toHaveLength(8);
  });
});

describe("clipSay", () => {
  it("cuts a long message at the last sentence end within 400 characters", () => {
    const text = `${"A short sentence. ".repeat(30)}`;
    const clipped = clipSay(text);
    expect(clipped.length).toBeLessThanOrEqual(400);
    expect(clipped.endsWith(".")).toBe(true);
  });
});

describe("buildAssistMessages", () => {
  it("shows notes, phrases, the chat with what was proposed, and the job's guidance", () => {
    const [, user] = buildAssistMessages({
      job: "prepare",
      today: "2026-10-05",
      lines: [
        { id: "U1", speaker: "user", text: "I'd like to prepare for an appointment." },
        { id: "A1", speaker: "assistant", text: "Who is it with?", proposed: ['phrase "Hello"'] },
        { id: "U2", speaker: "user", text: "Dr Chen" },
      ],
      notes: [{ id: "N1", kind: "about-me", text: "I'm Tom." }],
      phrases: [{ id: "Q1", text: "Please write it down.", for: "Dr. Chen" }],
    });
    expect(user.content).toContain("N1 (about-me): I'm Tom.");
    expect(user.content).toContain('Q1: "Please write it down." (for Dr. Chen)');
    expect(user.content).toContain("A1 You: Who is it with? (You proposed: phrase \"Hello\")");
    expect(user.content).toContain("U2 Me: Dr Chen");
    expect(user.content).toContain("Today is Monday 5 October 2026.");
    expect(user.content).toContain("who it is with, when, where");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assist/prompt.test.ts`
Expected: FAIL, cannot find module `./prompt`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/assist/prompt.ts
import { dateLine } from "@/lib/learning/prompt";
import { NOTE_MAX } from "@/lib/profiles/notes";
import type { ChatMessage } from "@/lib/suggest/prompt";
import type { NoteKind } from "@/lib/types";
import { ASSIST_PROPOSALS_MAX, ASSIST_SAY_MAX, PHRASE_MAX, type AssistJob, type AssistRequest } from "./protocol";

const KINDS: NoteKind[] = ["about-me", "person", "place", "routine", "preference"];

const JOBS: Record<AssistJob, string> = {
  update:
    "Job: update their information. Ask what has changed, or offer to go through one group of notes with them (people, places, routines, likes). Propose adds, edits and removals.",
  prepare:
    "Job: prepare for an appointment. Find out, one question at a time: who it is with, when, where, what it is about, and what they want to say or ask. Then propose a dated note, a person or place note if their notes have none for them, and 3 to 5 quick phrases for that person or place.",
  phrases:
    "Job: make quick phrases. Ask who or where the phrases are for and what they often need to say there. Then propose 3 to 5 phrases.",
};

const NO_JOB =
  "No job picked yet. Work out which of these fits what they typed and say so: update their information, prepare for an appointment, make quick phrases. For anything else, say briefly what you can help with.";

export function buildAssistMessages(req: AssistRequest): ChatMessage[] {
  const prompt = [
    "A person who cannot speak uses an app that suggests replies for them, built from short notes about them. They are typing to you, the app's assistant. Typing is slow for them, so keep each message short and ask one question at a time.",
    "",
    req.job ? JOBS[req.job] : NO_JOB,
    "",
    dateLine(req.today),
    "",
    "Their notes:",
    req.notes.length ? req.notes.map((n) => `${n.id} (${n.kind}): ${n.text}`).join("\n") : "(none)",
    "",
    "Their quick phrases:",
    req.phrases.length ? req.phrases.map((p) => `${p.id}: "${p.text}"${p.for ? ` (for ${p.for})` : ""}`).join("\n") : "(none)",
    "",
    "Chat so far:",
    req.lines
      .map((l) =>
        l.speaker === "user" ? `${l.id} Me: ${l.text}` : `${l.id} You: ${l.text}${l.proposed?.length ? ` (You proposed: ${l.proposed.join("; ")})` : ""}`,
      )
      .join("\n"),
    "",
    "Rules:",
    "- Propose a change only for something the person said in their own lines (U lines). Never use a detail from your own lines, and never guess.",
    '- List the U lines each proposal comes from in "lines".',
    `- Notes are in first person as the person, at most ${NOTE_MAX} characters. kind is one of: about-me (who they are, health, how they communicate), person (give their name), place (give its name), routine (regular or dated events), preference (likes, dislikes, usual orders).`,
    '- A change to what a note says is an edit of that note: "action": "edit", its id in "note", and the whole new text, keeping every part that is still true.',
    '- Remove a note ("action": "remove") only when they say it is no longer true or ask you to.',
    '- Write a dated plan with its full date from the list above ("Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about my blood pressure."). Write a date only when they named the day. For a day further away than the list, ask them to type the date, and write it as they typed it.',
    `- Quick phrases are things they can say with one tap, in their own voice, at most ${PHRASE_MAX} characters, with no detail they haven't told you. "for" is the name of the person or place a phrase is for; leave it out for a phrase for anyone.`,
    "- Don't propose what a note or quick phrase already says, or anything you proposed before.",
    "- When you have what you need, propose the changes and ask if there is anything else. When they say that's all, say goodbye briefly and propose nothing.",
    `- "say" is plain text, at most ${ASSIST_SAY_MAX} characters, no lists or markdown.`,
    `- At most ${ASSIST_PROPOSALS_MAX} proposals in one answer.`,
    "",
    "Output format: one JSON object and nothing else. No markdown.",
    '{"say": "Here is a note and three phrases. Anything else?", "proposals": [',
    '  {"action": "add", "kind": "routine", "text": "Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about my blood pressure.", "lines": ["U2", "U3"]},',
    '  {"action": "edit", "note": "N2", "kind": "routine", "text": "I have physio on Thursdays at 10:30.", "lines": ["U4"]},',
    '  {"action": "remove", "note": "N5", "lines": ["U5"]},',
    '  {"action": "phrase", "text": "Can we go over my dose?", "for": "Dr. Chen", "lines": ["U3"]}',
    "]}",
    '{"say": "Who is the appointment with?", "proposals": []}',
  ].join("\n");
  return [
    { role: "system", content: "You are a careful assistant that keeps a person's notes and phrases up to date. Follow the output format exactly." },
    { role: "user", content: prompt },
  ];
}

export interface RawAssistProposal {
  action: "add" | "edit" | "remove" | "phrase";
  kind?: NoteKind;
  name?: string;
  text?: string;
  /** The note id an edit or removal targets, as the model saw it. */
  note?: string;
  for?: string;
  /** Line ids as the model saw them. */
  lines: string[];
}

/** Cuts a message at the last sentence end within the limit, or at the limit. */
export function clipSay(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= ASSIST_SAY_MAX) return t;
  const cut = t.slice(0, ASSIST_SAY_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 0 ? cut.slice(0, end + 1) : cut.trim();
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function readProposal(item: unknown): RawAssistProposal | null {
  if (!item || typeof item !== "object") return null;
  const { action, kind, name, text, note, lines } = item as Record<string, unknown>;
  const forName = str((item as Record<string, unknown>).for);
  if (!Array.isArray(lines) || lines.length === 0 || !lines.every((l) => typeof l === "string")) return null;
  const ids = lines as string[];
  if (action === "remove") return str(note) ? { action, note: str(note), lines: ids } : null;
  const body = str(text);
  if (!body) return null;
  if (action === "phrase") return body.length <= PHRASE_MAX ? { action, text: body, ...(forName ? { for: forName.slice(0, 80) } : {}), lines: ids } : null;
  if (action !== "add" && action !== "edit") return null;
  if (!KINDS.includes(kind as NoteKind) || body.length > NOTE_MAX) return null;
  if (action === "edit" && !str(note)) return null;
  const n = str(name);
  return { action, kind: kind as NoteKind, ...(n ? { name: n.slice(0, 60) } : {}), text: body, ...(action === "edit" ? { note: str(note) } : {}), lines: ids };
}

/** The model's answer, however it is wrapped. Null when there is no readable object with a message. */
export function parseAssistOutput(output: string): { say: string; proposals: RawAssistProposal[] } | null {
  const text = output.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const say = str((data as { say?: unknown }).say);
  if (!say) return null;
  const list = (data as { proposals?: unknown }).proposals;
  const proposals = (Array.isArray(list) ? list : []).map(readProposal).filter((p): p is RawAssistProposal => p !== null);
  return { say: clipSay(say), proposals: proposals.slice(0, ASSIST_PROPOSALS_MAX) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assist/prompt.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assist/prompt.ts src/lib/assist/prompt.test.ts
git commit -m "Add the assistant prompt and its output parser"
```

---

### Task 3: Server check

**Files:**
- Create: `src/lib/assist/check.ts`
- Test: `src/lib/assist/check.test.ts`

**Interfaces:**
- Consumes: `AssistProposal`, `AssistRequest`, `PHRASE_MAX` (Task 1); `checkProposals` from `@/lib/learning/check`; `extractClaims`, `claimSupported`, `isNearDuplicate` from `@/lib/suggest/validate`; `tokenize` from `@/lib/text`.
- Produces: `checkAssistProposals(proposals: AssistProposal[], req: AssistRequest): AssistProposal[]` (real ids in and out). Order out: note adds and edits, then removals, then phrases.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assist/check.test.ts
import { describe, expect, it } from "vitest";
import { checkAssistProposals } from "./check";
import type { AssistProposal, AssistRequest } from "./protocol";

const req: AssistRequest = {
  job: "prepare",
  today: "2026-10-05",
  lines: [
    { id: "u1", speaker: "user", text: "I'd like to prepare for an appointment." },
    { id: "a1", speaker: "assistant", text: "Is it with Dr. Chen at 9:00 on Thursday?" },
    { id: "u2", speaker: "user", text: "Dr. Chen, Thursday at 10:00, about my blood pressure. I get dizzy in the mornings." },
  ],
  notes: [
    { id: "n1", kind: "about-me", text: "I'm Tom. I'm Deaf and I use ASL." },
    { id: "n2", kind: "person", text: "Dr. Chen at Lakeview Clinic is my family doctor." },
    { id: "n3", kind: "routine", text: "I pick up my blood pressure medication at Riverside Pharmacy every month." },
  ],
  phrases: [{ id: "q1", text: "Please write it down.", for: "Dr. Chen" }],
};

const keep = (p: AssistProposal) => checkAssistProposals([p], req);

describe("checkAssistProposals", () => {
  it("keeps a dated note backed by the user's line", () => {
    const p: AssistProposal = { action: "add", kind: "routine", text: "Thursday 8 October, 10:00: seeing Dr. Chen about my blood pressure.", lineIds: ["u2"] };
    expect(keep(p)).toEqual([p]);
  });

  it("drops a proposal citing the assistant's line", () => {
    expect(keep({ action: "add", kind: "routine", text: "Thursday 8 October, 9:00: seeing Dr. Chen.", lineIds: ["a1"] })).toEqual([]);
    expect(keep({ action: "phrase", text: "I get dizzy in the mornings.", lineIds: ["u2", "a1"] })).toEqual([]);
  });

  it("drops a time only the assistant said", () => {
    expect(keep({ action: "add", kind: "routine", text: "Thursday 8 October, 9:15: seeing Dr. Chen.", lineIds: ["u2"] })).toEqual([]);
  });

  it("keeps a removal of a sent note, drops one of a note that wasn't sent", () => {
    expect(keep({ action: "remove", noteId: "n3", lineIds: ["u2"] })).toHaveLength(1);
    expect(keep({ action: "remove", noteId: "n9", lineIds: ["u2"] })).toEqual([]);
  });

  it("drops a removal of a note that is also edited", () => {
    const out = checkAssistProposals(
      [
        { action: "edit", kind: "person", noteId: "n2", text: "Dr. Chen at Lakeview Clinic is my family doctor. I see him about my blood pressure.", lineIds: ["u2"] },
        { action: "remove", noteId: "n2", lineIds: ["u2"] },
      ],
      req,
    );
    expect(out.map((p) => p.action)).toEqual(["edit"]);
  });

  it("keeps a phrase whose names are in the chat or the notes", () => {
    expect(keep({ action: "phrase", text: "I get dizzy in the mornings.", for: "Dr. Chen", lineIds: ["u2"] })).toHaveLength(1);
    expect(keep({ action: "phrase", text: "I pick up my meds at Riverside Pharmacy.", lineIds: ["u2"] })).toHaveLength(1);
  });

  it("drops a phrase with a name or number from nowhere", () => {
    expect(keep({ action: "phrase", text: "I take 20 mg of Lisinopril.", lineIds: ["u2"] })).toEqual([]);
    expect(keep({ action: "phrase", text: "Hello.", for: "Dr. Patel", lineIds: ["u2"] })).toEqual([]);
  });

  it("drops a phrase that repeats a quick phrase or an earlier one", () => {
    expect(keep({ action: "phrase", text: "Please write it down.", lineIds: ["u2"] })).toEqual([]);
    const twice = checkAssistProposals(
      [
        { action: "phrase", text: "I get dizzy in the mornings.", lineIds: ["u2"] },
        { action: "phrase", text: "I get dizzy in the mornings", lineIds: ["u2"] },
      ],
      req,
    );
    expect(twice).toHaveLength(1);
  });

  it("puts notes first, then removals, then phrases", () => {
    const out = checkAssistProposals(
      [
        { action: "phrase", text: "I get dizzy in the mornings.", lineIds: ["u2"] },
        { action: "remove", noteId: "n3", lineIds: ["u2"] },
        { action: "add", kind: "routine", text: "Thursday 8 October, 10:00: seeing Dr. Chen about my blood pressure.", lineIds: ["u2"] },
      ],
      req,
    );
    expect(out.map((p) => p.action)).toEqual(["add", "remove", "phrase"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assist/check.test.ts`
Expected: FAIL, cannot find module `./check`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/assist/check.ts
import { checkProposals } from "@/lib/learning/check";
import type { LearnRequest, Proposal } from "@/lib/learning/protocol";
import { claimSupported, extractClaims, isNearDuplicate } from "@/lib/suggest/validate";
import { PHRASE_MAX, type AssistProposal, type AssistRequest } from "./protocol";

type NoteProposal = Extract<AssistProposal, { action: "add" | "edit" }>;

/**
 * Drops, never repairs. Every proposal must cite only the user's own lines: the assistant's
 * lines are its own words and can't be the source of a fact. Note adds and edits then pass
 * the learning check (a detail must be in the cited lines, or the old note for an edit).
 * A removal must name a sent note that isn't also edited. A phrase may not state a name or
 * number found in no user line and no sent note, and may not repeat a quick phrase.
 */
export function checkAssistProposals(proposals: AssistProposal[], req: AssistRequest): AssistProposal[] {
  const userLines = req.lines.filter((l) => l.speaker === "user");
  const userIds = new Set(userLines.map((l) => l.id));
  const cited = proposals.filter((p) => p.lineIds.length > 0 && p.lineIds.every((id) => userIds.has(id)));

  const learnReq: LearnRequest = {
    today: req.today,
    lines: userLines.map((l) => ({ id: l.id, speaker: "user" as const, text: l.text })),
    notes: req.notes,
  };
  const noteProposals = cited.filter((p): p is NoteProposal => p.action === "add" || p.action === "edit");
  const notes: AssistProposal[] = checkProposals(
    noteProposals.map((p): Proposal => ({ action: p.action, kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, ...(p.action === "edit" ? { noteId: p.noteId } : {}), lineIds: p.lineIds })),
    learnReq,
  ).map((p) =>
    p.action === "edit"
      ? { action: "edit", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, noteId: p.noteId!, lineIds: p.lineIds }
      : { action: "add", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, lineIds: p.lineIds },
  );

  const sent = new Set(req.notes.map((n) => n.id));
  const edited = new Set(notes.flatMap((p) => (p.action === "edit" ? [p.noteId] : [])));
  const removals: AssistProposal[] = [];
  for (const p of cited) {
    if (p.action !== "remove") continue;
    if (!sent.has(p.noteId) || edited.has(p.noteId) || removals.some((r) => r.action === "remove" && r.noteId === p.noteId)) continue;
    removals.push(p);
  }

  const sources = [...userLines.map((l) => l.text), ...req.notes.map((n) => n.text)].join("\n");
  const phraseTexts = req.phrases.map((p) => p.text);
  const phrases: AssistProposal[] = [];
  for (const p of cited) {
    if (p.action !== "phrase") continue;
    const text = p.text.trim();
    if (!text || text.length > PHRASE_MAX) continue;
    if (p.for && !claimSupported(p.for, sources)) continue;
    if (!extractClaims(text).every((claim) => claimSupported(claim, sources))) continue;
    if (phraseTexts.some((t) => isNearDuplicate(text, t))) continue;
    phraseTexts.push(text);
    phrases.push({ ...p, text });
  }

  return [...notes, ...removals, ...phrases];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assist/check.test.ts`
Expected: PASS (9 tests). If "drops a time only the assistant said" fails because `extractClaims` does not treat "9:15" as a claim, read `src/lib/suggest/validate.ts` `extractClaims` and use a time the learning check tests already prove is caught (see `src/lib/learning/check.test.ts`); do not weaken the rule.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assist/check.ts src/lib/assist/check.test.ts
git commit -m "Add the assistant's proposal check"
```

---

### Task 4: Server turn and route

**Files:**
- Create: `src/lib/assist/server.ts`, `src/app/api/assist/route.ts`
- Test: `src/lib/assist/server.test.ts`, `src/app/api/assist/route.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `streamCompletion`, `AllProvidersFailedError`, `StreamOptions`, `providerConfigs`, `createCooldown` from `@/lib/server/providers`; `isSameOrigin`, `clientIp`, `json` from `@/lib/server/guard`; `createRateLimiter`.
- Produces:
  - `class AssistUnreadableError extends Error`
  - `assistTurn(req: AssistRequest, opts: AssistStreamOptions): Promise<AssistResponse>` where `type AssistStreamOptions = Pick<StreamOptions, "order" | "configs" | "cooldown" | "signal" | "fetchImpl">`
  - Route statuses: 200 `{ say, proposals }`; 400 `invalid_request`; 403 `forbidden`; 413 `too_large`; 429 `rate_limited`; 502 `unreadable`; 503 `unavailable`.

Before writing the route, read `node_modules/next/dist/docs/` for route handlers in this Next.js version, and mirror `src/app/api/learn/route.ts`, which already works on it.

- [ ] **Step 1: Write the failing server test**

Look at how `src/lib/learning/server.test.ts` (if present) or `src/lib/server/providers.test.ts` fakes a provider stream with `fetchImpl`; reuse that helper. The test below assumes a helper `sseResponse(chunks: string[]): Response` exists in `src/lib/server/sse.test.ts` style; if no shared helper is exported, write a local one that returns an OpenAI-style SSE body (`data: {"choices":[{"delta":{"content":"..."}}]}\n\n` ... `data: [DONE]\n\n`).

```ts
// src/lib/assist/server.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderId } from "@/lib/server/providers";
import type { AssistRequest } from "./protocol";
import { AssistUnreadableError, assistTurn } from "./server";

function sse(content: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const configs = {
  groq: { apiKey: "k", model: "m", url: "https://groq.test/v1/chat/completions" },
  cloudflare: { apiKey: "", model: "m", url: "https://cf.test" },
} as unknown as Record<ProviderId, ProviderConfig>;

const req: AssistRequest = {
  job: "update",
  today: "2026-10-05",
  lines: [
    { id: "user-aaa", speaker: "user", text: "My physio moved to Thursdays at 10:30." },
  ],
  notes: [
    { id: "note-me", kind: "about-me", text: "I'm Maya." },
    { id: "note-physio", kind: "routine", text: "I have physio on Tuesdays at 10:30." },
  ],
  phrases: [],
};

describe("assistTurn", () => {
  it("maps short ids back to real ones and checks proposals", async () => {
    const answer = JSON.stringify({
      say: "Done. Anything else?",
      proposals: [
        { action: "edit", note: "N2", kind: "routine", text: "I have physio on Thursdays at 10:30.", lines: ["U1"] },
        { action: "remove", note: "N7", lines: ["U1"] },
      ],
    });
    const fetchImpl = vi.fn(async () => sse(answer));
    const out = await assistTurn(req, { order: ["groq"], configs, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({
      say: "Done. Anything else?",
      proposals: [{ action: "edit", kind: "routine", text: "I have physio on Thursdays at 10:30.", noteId: "note-physio", lineIds: ["user-aaa"] }],
    });
  });

  it("asks once more when the answer is unreadable, then gives up", async () => {
    const fetchImpl = vi.fn(async () => sse("Sure! Here is your note."));
    await expect(assistTurn(req, { order: ["groq"], configs, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(AssistUnreadableError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assist/server.test.ts`
Expected: FAIL, cannot find module `./server`.

- [ ] **Step 3: Write the server turn**

```ts
// src/lib/assist/server.ts
import { AllProvidersFailedError, streamCompletion, type StreamOptions } from "@/lib/server/providers";
import { checkAssistProposals } from "./check";
import { buildAssistMessages, parseAssistOutput, type RawAssistProposal } from "./prompt";
import type { AssistProposal, AssistRequest, AssistResponse } from "./protocol";

export type AssistStreamOptions = Pick<StreamOptions, "order" | "configs" | "cooldown" | "signal" | "fetchImpl">;

export class AssistUnreadableError extends Error {
  constructor() {
    super("assistant answer unreadable");
    this.name = "AssistUnreadableError";
  }
}

async function ask(req: AssistRequest, opts: AssistStreamOptions): Promise<string> {
  const { deltas } = await streamCompletion(buildAssistMessages(req), {
    ...opts,
    maxTokens: 1500,
    temperature: 0.3,
    firstTokenTimeoutMs: 10_000,
    idleTimeoutMs: 10_000,
  });
  let output = "";
  try {
    for await (const delta of deltas) output += delta;
  } catch (err) {
    throw new AllProvidersFailedError(`stream cut: ${err instanceof Error ? err.message : String(err)}`);
  }
  return output;
}

/**
 * One chat turn. The model sees short ids (U1, A1, N1, Q1); its proposals are mapped back
 * and checked. An id the model made up maps to one nothing has, so the check drops it.
 * Unreadable output is asked for once more, then reported.
 */
export async function assistTurn(req: AssistRequest, opts: AssistStreamOptions): Promise<AssistResponse> {
  let u = 0;
  let a = 0;
  const lineIds = new Map<string, string>();
  const lines = req.lines.map((l) => {
    const short = l.speaker === "user" ? `U${++u}` : `A${++a}`;
    lineIds.set(short, l.id);
    return { ...l, id: short };
  });
  const noteIds = new Map(req.notes.map((n, i) => [`N${i + 1}`, n.id]));
  const short: AssistRequest = {
    ...req,
    lines,
    notes: req.notes.map((n, i) => ({ ...n, id: `N${i + 1}` })),
    phrases: req.phrases.map((p, i) => ({ ...p, id: `Q${i + 1}` })),
  };

  let parsed = parseAssistOutput(await ask(short, opts));
  if (!parsed) parsed = parseAssistOutput(await ask(short, opts));
  if (!parsed) throw new AssistUnreadableError();

  const real = (ids: string[]) => ids.map((id) => lineIds.get(id) ?? `unknown:${id}`);
  const note = (id?: string) => noteIds.get(id ?? "") ?? `unknown:${id}`;
  const proposals = parsed.proposals.map((p: RawAssistProposal): AssistProposal => {
    switch (p.action) {
      case "remove":
        return { action: "remove", noteId: note(p.note), lineIds: real(p.lines) };
      case "phrase":
        return { action: "phrase", text: p.text!, ...(p.for ? { for: p.for } : {}), lineIds: real(p.lines) };
      case "edit":
        return { action: "edit", kind: p.kind!, ...(p.name ? { name: p.name } : {}), text: p.text!, noteId: note(p.note), lineIds: real(p.lines) };
      default:
        return { action: "add", kind: p.kind!, ...(p.name ? { name: p.name } : {}), text: p.text!, lineIds: real(p.lines) };
    }
  });
  return { say: parsed.say, proposals: checkAssistProposals(proposals, req) };
}
```

- [ ] **Step 4: Run the server test**

Run: `npx vitest run src/lib/assist/server.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route test**

Mirror the existing route tests (look for `src/app/api/learn/route.test.ts`; if it exists copy its request helper). Mock `@/lib/assist/server` with `vi.mock`.

```ts
// src/app/api/assist/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const turn = vi.fn();
vi.mock("@/lib/assist/server", async (orig) => ({ ...(await orig<typeof import("@/lib/assist/server")>()), assistTurn: (...args: unknown[]) => turn(...args) }));

const body = {
  job: "phrases",
  today: "2026-10-05",
  lines: [{ id: "u1", speaker: "user", text: "Phrases for the café please." }],
  notes: [],
  phrases: [],
};

const post = async (data: unknown, headers: Record<string, string> = {}) => {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/assist", { method: "POST", headers: { "content-type": "application/json", host: "localhost", ...headers }, body: JSON.stringify(data) }));
};

describe("POST /api/assist", () => {
  beforeEach(() => turn.mockReset());

  it("answers with the turn", async () => {
    turn.mockResolvedValue({ say: "Who are they for?", proposals: [] });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: "Who are they for?", proposals: [] });
  });

  it("refuses another site, a bad body, and unreadable or unavailable models", async () => {
    expect((await post(body, { origin: "https://evil.test" })).status).toBe(403);
    expect((await post({ ...body, lines: [] })).status).toBe(400);
    const { AssistUnreadableError } = await import("@/lib/assist/server");
    turn.mockRejectedValueOnce(new AssistUnreadableError());
    expect((await post(body)).status).toBe(502);
    const { AllProvidersFailedError } = await import("@/lib/server/providers");
    turn.mockRejectedValueOnce(new AllProvidersFailedError("down"));
    expect((await post(body)).status).toBe(503);
  });
});
```

- [ ] **Step 6: Write the route**

```ts
// src/app/api/assist/route.ts
import { AssistRequestSchema } from "@/lib/assist/protocol";
import { AssistUnreadableError, assistTurn } from "@/lib/assist/server";
import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { AllProvidersFailedError, createCooldown, providerConfigs } from "@/lib/server/providers";
import { createRateLimiter } from "@/lib/server/rate-limit";

/** 40 chat lines, 12,000 characters of notes and 100 phrases fit under this. */
const BODY_MAX = 64_000;
// The chat is paced by the user's typing; 10 a minute leaves room for quick answers and a retry.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
const cooldown = createCooldown();

/**
 * The assistant: the chat, the notes and the quick phrases go to the model, which answers
 * and proposes changes. Nothing is stored here and nothing is logged. The user confirms
 * every proposal in the browser.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!limiter.check(clientIp(request))) return json({ error: "rate_limited" }, 429);
  if (Number(request.headers.get("content-length")) > BODY_MAX) return json({ error: "too_large" }, 413);

  const raw = await request.text();
  if (raw.length > BODY_MAX) return json({ error: "too_large" }, 413);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const parsed = AssistRequestSchema.safeParse(data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const env = process.env;
  const configs = providerConfigs({ ...env, GROQ_MODEL: env.ASSIST_MODEL ?? env.GROQ_MODEL });
  try {
    return json(await assistTurn(parsed.data, { order: ["groq", "cloudflare"], configs, cooldown, signal: request.signal }), 200);
  } catch (err) {
    if (err instanceof AssistUnreadableError) return json({ error: "unreadable" }, 502);
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
```

- [ ] **Step 7: Run both tests**

Run: `npx vitest run src/lib/assist src/app/api/assist`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/assist/server.ts src/lib/assist/server.test.ts src/app/api/assist
git commit -m "Add POST /api/assist"
```

---

### Task 5: Quick phrases in the store and in export files

**Files:**
- Modify: `src/lib/types.ts` (Phrase), `src/lib/memory/store.ts`, `src/lib/profiles/transfer.ts:13-27`
- Test: `src/lib/memory/store.test.ts`, `src/lib/profiles/transfer.test.ts`

**Interfaces:**
- Produces on `MemoryStore`:
  - `quickPhrases(ctx: { partnerId?: string; placeId?: string }, k = 4): Phrase[]`
  - `allQuickPhrases(): Phrase[]` (newest first)
  - `addQuickPhrase(text: string, tie: { partnerId?: string; placeId?: string }): Promise<Phrase | null>` (null when a quick phrase with the same words exists)
  - `updateQuickPhrase(id: string, text: string, tie: { partnerId?: string; placeId?: string }): Promise<boolean>` (false when another quick phrase has the same words, or the id is unknown)
  - `removePhrase(id: string): Promise<void>`
  - `addPhrase` unchanged in signature; for an existing quick phrase it counts the use and keeps the phrase's own context.
  - `removeNote(id)` also clears `partnerId`/`placeId` equal to `id` on every phrase.
- `Phrase` gains `quick?: true`.

- [ ] **Step 1: Write the failing store tests** (append to `src/lib/memory/store.test.ts`; follow its existing setup, which creates stores with `MemoryStore.create({ now })`)

```ts
describe("quick phrases", () => {
  const person = { id: "sam", kind: "person" as const, text: "Sam is the barista.", entities: ["Sam"], updatedAt: 0 };
  const place = { id: "cafe", kind: "place" as const, text: "Blue Door Café.", entities: ["Blue Door Café"], updatedAt: 0 };

  async function store() {
    let t = 1_000;
    const s = await MemoryStore.create({ now: () => (t += 1000) });
    await s.replaceAll([person, place], []);
    return s;
  }

  it("shows phrases for the person first, then the place, else general ones", async () => {
    const s = await store();
    await s.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await s.addQuickPhrase("Can I sit by the window?", { placeId: "cafe" });
    await s.addQuickPhrase("I type to talk.", {});
    expect(s.quickPhrases({ partnerId: "sam", placeId: "cafe" }).map((p) => p.text)).toEqual(["My usual, please.", "Can I sit by the window?"]);
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["I type to talk."]);
    expect(s.quickPhrases({ partnerId: "someone-else" }).map((p) => p.text)).toEqual(["I type to talk."]);
  });

  it("never shows everyday phrases and caps the row at 4", async () => {
    const s = await store();
    await s.addPhrase("Morning!", { now: new Date() });
    for (const t of ["One.", "Two.", "Three.", "Four.", "Five."]) await s.addQuickPhrase(t, {});
    const row = s.quickPhrases({});
    expect(row).toHaveLength(4);
    expect(row.map((p) => p.text)).not.toContain("Morning!");
  });

  it("orders by use, then newest", async () => {
    const s = await store();
    await s.addQuickPhrase("Old.", {});
    await s.addQuickPhrase("New.", {});
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["New.", "Old."]);
    await s.addPhrase("Old.", { now: new Date() });
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["Old.", "New."]);
  });

  it("keeps a quick phrase tied to its person when it is spoken elsewhere", async () => {
    const s = await store();
    await s.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await s.addPhrase("My usual, please.", { now: new Date(), partnerId: undefined, placeId: undefined });
    const [p] = s.allQuickPhrases();
    expect(p.context.partnerId).toBe("sam");
    expect(p.timesUsed).toBe(1);
  });

  it("refuses a duplicate, and turns an everyday phrase with the same words into a quick one", async () => {
    const s = await store();
    expect(await s.addQuickPhrase("My usual, please.", {})).not.toBeNull();
    expect(await s.addQuickPhrase("my usual please", {})).toBeNull();
    await s.addPhrase("See you tomorrow.", { now: new Date() });
    const made = await s.addQuickPhrase("See you tomorrow.", { partnerId: "sam" });
    expect(made?.quick).toBe(true);
    expect(s.phrases().filter((p) => p.text === "See you tomorrow.")).toHaveLength(1);
  });

  it("unties phrases from a deleted note", async () => {
    const s = await store();
    await s.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await s.removeNote("sam");
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["My usual, please."]);
    expect(s.allQuickPhrases()[0].context.partnerId).toBeUndefined();
  });

  it("edits and removes a quick phrase", async () => {
    const s = await store();
    const a = (await s.addQuickPhrase("One.", {}))!;
    await s.addQuickPhrase("Two.", {});
    expect(await s.updateQuickPhrase(a.id, "Two.", {})).toBe(false);
    expect(await s.updateQuickPhrase(a.id, "Uno.", { placeId: "cafe" })).toBe(true);
    expect(s.allQuickPhrases().find((p) => p.id === a.id)?.context.placeId).toBe("cafe");
    await s.removePhrase(a.id);
    expect(s.allQuickPhrases().map((p) => p.text)).toEqual(["Two."]);
  });
});
```

- [ ] **Step 2: Write the failing transfer test** (append to `src/lib/profiles/transfer.test.ts`, reusing its existing helpers)

```ts
it("keeps the quick flag and the note a quick phrase is tied to", () => {
  const notes = [{ id: "sam", kind: "person" as const, text: "Sam is the barista.", entities: ["Sam"], updatedAt: 0 }];
  const phrases = [{ id: "p1", text: "My usual, please.", context: { partnerId: "sam", timeOfDay: "morning" as const }, timesUsed: 0, lastUsed: 0, quick: true as const }];
  const parsed = parseImport(exportProfile("Maya", notes, phrases, new Date()))!;
  expect(parsed.phrases[0].quick).toBe(true);
  expect(parsed.phrases[0].context.partnerId).toBe(parsed.notes[0].id);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/memory/store.test.ts src/lib/profiles/transfer.test.ts`
Expected: FAIL (`addQuickPhrase` is not a function; `quick` dropped on import).

- [ ] **Step 4: Implement**

In `src/lib/types.ts`, add to `Phrase`:

```ts
  /** Made on purpose (in the assistant or Your notes), shown in the "Your phrases" row. Everyday spoken phrases never have it. */
  quick?: true;
```

In `src/lib/profiles/transfer.ts` `PhraseSchema`, add after `lastUsed: z.number(),`:

```ts
  // zod drops keys it doesn't list, so without this an import would lose the flag.
  quick: z.literal(true).optional(),
```

In `src/lib/memory/store.ts`:

Replace `addPhrase` with:

```ts
  async addPhrase(text: string, ctx: ConversationContext): Promise<Phrase> {
    const clean = text.trim();
    const key = tokenize(clean).join(" ");
    const existing = [...this.phrasesById.values()].find((p) => tokenize(p.text).join(" ") === key);
    const context = { placeId: ctx.placeId, partnerId: ctx.partnerId, timeOfDay: timeOfDay(ctx.now) };
    // A quick phrase belongs to the person or place it was made for, wherever it is said.
    const phrase: Phrase = existing
      ? { ...existing, timesUsed: existing.timesUsed + 1, lastUsed: this.now(), context: existing.quick ? existing.context : context }
      : { id: `p_${crypto.randomUUID()}`, text: clean, context, timesUsed: 1, lastUsed: this.now() };
    this.phrasesById.set(phrase.id, phrase);
    await this.save();
    return phrase;
  }
```

In `removeNote`, before `await this.save();` add:

```ts
    // Quick phrases made for this person or place stay, for anyone.
    for (const p of this.phrasesById.values()) {
      if (p.context.partnerId !== id && p.context.placeId !== id) continue;
      this.phrasesById.set(p.id, {
        ...p,
        context: { ...p.context, partnerId: p.context.partnerId === id ? undefined : p.context.partnerId, placeId: p.context.placeId === id ? undefined : p.context.placeId },
      });
    }
```

Add the new methods after `addPhrase`:

```ts
  /** Up to `k` quick phrases for who the user is talking with, then where; else those tied to no one. */
  quickPhrases(ctx: { partnerId?: string; placeId?: string }, k = 4): Phrase[] {
    const quick = this.allQuickPhrases().sort((a, b) => b.timesUsed - a.timesUsed || b.lastUsed - a.lastUsed);
    const forPartner = ctx.partnerId ? quick.filter((p) => p.context.partnerId === ctx.partnerId) : [];
    const forPlace = ctx.placeId ? quick.filter((p) => p.context.placeId === ctx.placeId && !forPartner.includes(p)) : [];
    const matched = [...forPartner, ...forPlace];
    const general = quick.filter((p) => !p.context.partnerId && !p.context.placeId);
    return (matched.length ? matched : general).slice(0, k);
  }

  /** Every quick phrase, newest first. */
  allQuickPhrases(): Phrase[] {
    return [...this.phrasesById.values()].filter((p) => p.quick).sort((a, b) => b.lastUsed - a.lastUsed);
  }

  /** Null when a quick phrase with the same words exists. An everyday phrase with the same words becomes this quick one. */
  async addQuickPhrase(text: string, tie: { partnerId?: string; placeId?: string }): Promise<Phrase | null> {
    const clean = text.trim();
    const key = tokenize(clean).join(" ");
    const same = [...this.phrasesById.values()].find((p) => tokenize(p.text).join(" ") === key);
    if (same?.quick) return null;
    const context = { partnerId: tie.partnerId, placeId: tie.placeId, timeOfDay: timeOfDay(new Date(this.now())) };
    const phrase: Phrase = same
      ? { ...same, context, lastUsed: this.now(), quick: true }
      : { id: `p_${crypto.randomUUID()}`, text: clean, context, timesUsed: 0, lastUsed: this.now(), quick: true };
    this.phrasesById.set(phrase.id, phrase);
    await this.save();
    return phrase;
  }

  /** False when the id is unknown or another quick phrase already has these words. */
  async updateQuickPhrase(id: string, text: string, tie: { partnerId?: string; placeId?: string }): Promise<boolean> {
    const current = this.phrasesById.get(id);
    if (!current?.quick) return false;
    const clean = text.trim();
    const key = tokenize(clean).join(" ");
    if ([...this.phrasesById.values()].some((p) => p.id !== id && p.quick && tokenize(p.text).join(" ") === key)) return false;
    this.phrasesById.set(id, { ...current, text: clean, context: { ...current.context, partnerId: tie.partnerId, placeId: tie.placeId } });
    await this.save();
    return true;
  }

  async removePhrase(id: string): Promise<void> {
    if (!this.phrasesById.delete(id)) return;
    await this.save();
  }
```

`timeOfDay` is already imported from `@/lib/context`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/memory src/lib/profiles`
Expected: PASS, including the existing store and transfer tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/memory/store.ts src/lib/memory/store.test.ts src/lib/profiles/transfer.ts src/lib/profiles/transfer.test.ts
git commit -m "Add quick phrases to the store and to profile exports"
```

---

### Task 6: Browser client and what a request carries

**Files:**
- Create: `src/lib/assist/client.ts`, `src/lib/assist/notes.ts`
- Modify: `src/lib/learning/session.ts` (export `contentWords`)
- Test: `src/lib/assist/client.test.ts`, `src/lib/assist/notes.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas; Task 5 `allQuickPhrases`; `MemoryStore.searchNotes`, `noteFields`, `hasName`.
- Produces:
  - `type AssistResult = { ok: true; say: string; proposals: AssistProposal[] } | { ok: false; reason: "unavailable" | "unreadable" | "rate_limited" | "refused" }`
  - `postAssist(body: AssistRequest, fetchImpl?: typeof fetch): Promise<AssistResult>`
  - `pickAssistNotes(memory: MemoryStore, userTexts: string[]): Promise<Note[]>`
  - `quickPhrasesForRequest(memory: MemoryStore): { id: string; text: string; for?: string }[]`
  - `export function contentWords(text: string): string` from `src/lib/learning/session.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/assist/client.test.ts
import { describe, expect, it, vi } from "vitest";
import { postAssist } from "./client";

const body = { job: null, today: "2026-10-05", lines: [{ id: "u1", speaker: "user" as const, text: "hi" }], notes: [], phrases: [] };
const reply = (status: number, data: unknown) => vi.fn(async () => new Response(JSON.stringify(data), { status }));

describe("postAssist", () => {
  it("returns the message and the proposals that read", async () => {
    const f = reply(200, { say: "Hello.", proposals: [{ action: "phrase", text: "Hi.", lineIds: ["u1"] }, { action: "nope" }] });
    expect(await postAssist(body, f as unknown as typeof fetch)).toEqual({ ok: true, say: "Hello.", proposals: [{ action: "phrase", text: "Hi.", lineIds: ["u1"] }] });
  });

  it("maps failures", async () => {
    expect(await postAssist(body, reply(429, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "rate_limited" });
    expect(await postAssist(body, reply(502, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "unreadable" });
    expect(await postAssist(body, reply(503, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
    expect(await postAssist(body, reply(400, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "refused" });
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await postAssist(body, down as unknown as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
  });
});
```

```ts
// src/lib/assist/notes.test.ts
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import { pickAssistNotes, quickPhrasesForRequest } from "./notes";

const note = (id: string, text: string, extra: Partial<Note> = {}): Note => ({ id, kind: "routine", text, entities: [], updatedAt: 0, ...extra });

describe("pickAssistNotes", () => {
  it("sends every note, about-me first, when they fit", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll([note("b", "I swim on Mondays."), note("me", "I'm Maya.", { kind: "about-me", pinned: true })], []);
    expect((await pickAssistNotes(m, ["hello"])).map((n) => n.id)).toEqual(["me", "b"]);
  });

  it("sends the about-me note and related notes within 12,000 characters when there are too many", async () => {
    const m = await MemoryStore.create();
    const many = Array.from({ length: 60 }, (_, i) => note(`n${i}`, `Note ${i} about gardening ${"x".repeat(250)}`));
    await m.replaceAll([note("me", "I'm Maya.", { kind: "about-me", pinned: true }), note("physio", "I have physio on Tuesdays at 10:30."), ...many], []);
    const picked = await pickAssistNotes(m, ["My physio moved."]);
    expect(picked[0].id).toBe("me");
    expect(picked.map((n) => n.id)).toContain("physio");
    expect(picked.reduce((n, x) => n + x.text.length, 0)).toBeLessThanOrEqual(12_000);
  });
});

describe("quickPhrasesForRequest", () => {
  it("names who or where each quick phrase is for", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll([{ id: "sam", kind: "person", text: "Sam: the barista.", entities: ["Sam"], updatedAt: 0 }], []);
    await m.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await m.addQuickPhrase("I type to talk.", {});
    expect(quickPhrasesForRequest(m).map(({ text, for: f }) => ({ text, for: f }))).toEqual(
      expect.arrayContaining([{ text: "My usual, please.", for: "Sam" }, { text: "I type to talk.", for: undefined }]),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/assist/client.test.ts src/lib/assist/notes.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

In `src/lib/learning/session.ts` change `function contentWords` to `export function contentWords`.

```ts
// src/lib/assist/client.ts
import { AssistProposalSchema, type AssistProposal, type AssistRequest } from "./protocol";

export type AssistResult = { ok: true; say: string; proposals: AssistProposal[] } | { ok: false; reason: "unavailable" | "unreadable" | "rate_limited" | "refused" };

const REFUSED = new Set([400, 403, 413]);

/** One chat turn. Proposals that don't read are left out; the message still shows. */
export async function postAssist(body: AssistRequest, fetchImpl: typeof fetch = fetch): Promise<AssistResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (res.status === 429) return { ok: false, reason: "rate_limited" };
  if (res.status === 502) return { ok: false, reason: "unreadable" };
  if (REFUSED.has(res.status)) return { ok: false, reason: "refused" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const data = (await res.json().catch(() => null)) as { say?: unknown; proposals?: unknown } | null;
  if (!data || typeof data.say !== "string" || !Array.isArray(data.proposals)) return { ok: false, reason: "unavailable" };
  return {
    ok: true,
    say: data.say,
    proposals: data.proposals.flatMap((p) => {
      const r = AssistProposalSchema.safeParse(p);
      return r.success ? [r.data] : [];
    }),
  };
}
```

```ts
// src/lib/assist/notes.ts
import { contentWords } from "@/lib/learning/session";
import type { MemoryStore } from "@/lib/memory/store";
import { hasName, noteFields } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { ASSIST_NOTES_CHARS } from "./protocol";

const size = (notes: Note[]) => notes.reduce((n, x) => n + x.text.length, 0);

/**
 * Every note when they fit in the budget, about-me first. Otherwise the about-me note and
 * the best matches for each of the user's lines in turn, up to the budget (spec decision 22).
 */
export async function pickAssistNotes(memory: MemoryStore, userTexts: string[]): Promise<Note[]> {
  const all = memory.notes().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  if (size(all) <= ASSIST_NOTES_CHARS) return all;
  const picked = new Map<string, Note>();
  let used = 0;
  const add = (n: Note) => {
    if (picked.has(n.id) || used + n.text.length > ASSIST_NOTES_CHARS) return;
    picked.set(n.id, n);
    used += n.text.length;
  };
  all.filter((n) => n.pinned).forEach(add);
  const perLine = await Promise.all(
    [...userTexts].reverse().map((t) => {
      const q = contentWords(t);
      return q ? memory.searchNotes(q, { now: new Date() }, 12) : Promise.resolve([]);
    }),
  );
  for (let rank = 0; rank < 12; rank++) for (const found of perLine) if (found[rank]) add(found[rank]);
  return [...picked.values()];
}

/** Quick phrases with the name of the person or place each is for. */
export function quickPhrasesForRequest(memory: MemoryStore): { id: string; text: string; for?: string }[] {
  return memory.allQuickPhrases().map((p) => {
    const tied = memory.getNote(p.context.partnerId ?? p.context.placeId ?? "");
    const name = tied && hasName(tied.kind) ? noteFields(tied).name : undefined;
    return { id: p.id, text: p.text, ...(name ? { for: name } : {}) };
  });
}
```

The newest user lines are searched first (`reverse()`), since the latest message is usually what the chat is about.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/assist src/lib/learning`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assist/client.ts src/lib/assist/client.test.ts src/lib/assist/notes.ts src/lib/assist/notes.test.ts src/lib/learning/session.ts
git commit -m "Add the assistant's browser client and note selection"
```

---

### Task 7: Assistant session

**Files:**
- Create: `src/lib/assist/session.ts`
- Test: `src/lib/assist/session.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 6; `buildNote`, `composeNoteText`, `noteFields`, `hasName`, `DraftNote` from `@/lib/profiles/notes`; `localIsoDate` from `@/lib/learning/prompt`; `tokenize`.
- Produces:

```ts
export const JOB_TEXT: Record<AssistJob, string>; // "Update my information", "Prepare for an appointment", "Make quick phrases"
export interface ChatLine { id: string; speaker: "user" | "assistant"; text: string; failed?: boolean; proposed?: string[] }
export type CardAction = "add" | "edit" | "remove" | "phrase";
export interface AssistCard {
  id: string;
  /** The assistant line it came with. */
  lineId: string;
  action: CardAction;
  /** add and edit */
  draft?: DraftNote;
  /** edit and remove */
  noteId?: string;
  /** edit and remove: the note's text when the card was made. */
  oldText?: string;
  /** phrase */
  phrase?: { text: string; forName?: string };
  /** The user's lines it came from. */
  sources: string[];
  state: "open" | "kept" | "skipped";
  /** Set when Keep found the note changed since. */
  changed?: boolean;
}
export type AssistStatus = "idle" | "waiting" | "rate_limited";
export interface AssistState { job: AssistJob | null; lines: ChatLine[]; cards: AssistCard[]; status: AssistStatus; closed: boolean }
export type KeepOutcome = "kept" | "changed" | "duplicate" | "gone";
export const SORRY = "Sorry, I didn't get that. Could you say it another way?";
export const LIMIT_TEXT = "This chat is as long as it can be. Close it and start a new one to carry on.";
export class AssistSession {
  constructor(opts: { memory: MemoryStore; post?: (body: AssistRequest) => Promise<AssistResult>; now?: () => number });
  get state(): AssistState;
  onChange(fn: () => void): () => void;
  chooseJob(job: AssistJob): Promise<void>;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  keep(cardId: string, edited?: { draft?: DraftNote; phraseText?: string }): Promise<KeepOutcome>;
  skip(cardId: string): void;
  openCount(): number;
  userCount(): number;
  close(): void;
}
```

Rules the session enforces (each has a test below):
- `send` does nothing when closed, waiting, blank, or at 20 user lines. At 20 it adds `LIMIT_TEXT` as an assistant line once (after the 20th answer).
- The request carries `job`, `today` (local date from `now`), all lines (a failed line is sent with the rest), notes from `pickAssistNotes`, phrases from `quickPhrasesForRequest`. Each assistant line carries `proposed`: short descriptions of its cards (`new note "..."`, `change "..."`, `remove "..."`, `phrase "..."`).
- On success: an assistant line with `say`, then one card per proposal, except a removal of the pinned note and a card identical to an earlier card in this chat (same action, same text or note).
- On `unreadable`: an assistant line with `SORRY`, no cards.
- On `unavailable` or `refused`: the user line gets `failed: true`; `retry()` clears it and sends again without adding a line.
- On `rate_limited`: the user line gets `failed: true` and status `rate_limited`, which returns to `idle` after 10 s (the UI shows "Please wait a moment").
- A response that arrives after `close()` is ignored.
- `keep` on a card that isn't open returns `"gone"` and changes nothing (double tap).
- add: `"duplicate"` when a note with the same words exists; else `upsertNote(buildNote(...))`.
- edit: target missing: `"gone"`. Target text differs from `oldText` and no `edited.draft`: mark `changed`, return `"changed"`. Else save with the target's id and pinned flag.
- remove: target missing: `"gone"`. Text differs from `oldText`: mark `changed`, return `"changed"`. Else `removeNote`.
- phrase: resolve `forName` against current person and place notes by name (case-insensitive), which includes notes kept earlier in this chat; `addQuickPhrase`; null: `"duplicate"`.
- A card left `open` after `"changed"` or `"duplicate"`? No: `"duplicate"` marks it `skipped` (nothing to do), `"changed"` leaves it open for Edit or Skip, `"gone"` marks it `skipped`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assist/session.test.ts
import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import type { AssistResult } from "./client";
import type { AssistRequest } from "./protocol";
import { AssistSession, LIMIT_TEXT, SORRY } from "./session";

const me: Note = { id: "me", kind: "about-me", text: "I'm Maya.", entities: [], updatedAt: 0, pinned: true };
const physio: Note = { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 0 };
const sam: Note = { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam"], updatedAt: 0 };

async function setup(answers: AssistResult[]) {
  const memory = await MemoryStore.create();
  await memory.replaceAll([me, physio, sam], []);
  const bodies: AssistRequest[] = [];
  const post = vi.fn(async (body: AssistRequest) => {
    bodies.push(body);
    return answers.shift() ?? { ok: true as const, say: "Anything else?", proposals: [] };
  });
  const session = new AssistSession({ memory, post, now: () => new Date(2026, 9, 5, 12).getTime() });
  return { memory, session, post, bodies };
}

const userId = (b: AssistRequest, i = 0) => b.lines.filter((l) => l.speaker === "user")[i].id;

describe("AssistSession", () => {
  it("starts a job with its button text and shows the answer", async () => {
    const { session, bodies } = await setup([{ ok: true, say: "What changed?", proposals: [] }]);
    await session.chooseJob("update");
    expect(bodies[0].job).toBe("update");
    expect(bodies[0].today).toBe("2026-10-05");
    expect(bodies[0].lines).toEqual([{ id: expect.any(String), speaker: "user", text: "Update my information" }]);
    expect(session.state.lines.map((l) => l.text)).toEqual(["Update my information", "What changed?"]);
  });

  it("makes cards, keeps an edit, and tells the model what it already proposed", async () => {
    const { session, memory, bodies, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here is the change.",
      proposals: [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [userId(body)] }],
    }));
    await session.send("My physio moved to Thursdays.");
    const [card] = session.state.cards;
    expect(card).toMatchObject({ action: "edit", noteId: "physio", oldText: physio.text, sources: ["My physio moved to Thursdays."], state: "open" });
    expect(await session.keep(card.id)).toBe("kept");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Thursdays at 10:30.");
    expect(await session.keep(card.id)).toBe("gone");
    await session.send("That's all.");
    expect(bodies[1].lines[1].proposed).toEqual(['change "I have physio on Thursdays at 10:30."']);
  });

  it("won't overwrite a note that changed since the card was made", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [userId(body)] }],
    }));
    await session.send("Physio is Thursdays now.");
    await memory.upsertNote({ ...physio, text: "I have physio on Wednesdays at 9:00." });
    const [card] = session.state.cards;
    expect(await session.keep(card.id)).toBe("changed");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Wednesdays at 9:00.");
    expect(session.state.cards[0]).toMatchObject({ state: "open", changed: true });
    expect(await session.keep(card.id, { draft: { kind: "routine", text: "I have physio on Thursdays at 9:00." } })).toBe("kept");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Thursdays at 9:00.");
  });

  it("removes a note, never offers removing the about-me note", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Removed?",
      proposals: [
        { action: "remove", noteId: "me", lineIds: [userId(body)] },
        { action: "remove", noteId: "physio", lineIds: [userId(body)] },
      ],
    }));
    await session.send("I stopped physio.");
    expect(session.state.cards.map((c) => c.noteId)).toEqual(["physio"]);
    expect(await session.keep(session.state.cards[0].id)).toBe("kept");
    expect(memory.getNote("physio")).toBeUndefined();
  });

  it("ties a phrase to a person kept earlier in the same chat", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [
        { action: "add", kind: "person", name: "Dr. Patel", text: "Dr. Patel is my new dentist.", lineIds: [userId(body)] },
        { action: "phrase", text: "I can't keep my mouth open for long.", for: "Dr. Patel", lineIds: [userId(body)] },
      ],
    }));
    await session.send("New dentist, Dr. Patel. I can't keep my mouth open for long.");
    const [person, phrase] = session.state.cards;
    await session.keep(person.id);
    expect(await session.keep(phrase.id)).toBe("kept");
    const patel = memory.notes().find((n) => n.entities.includes("Dr. Patel"))!;
    expect(memory.allQuickPhrases()[0].context.partnerId).toBe(patel.id);
  });

  it("says a phrase or note already exists", async () => {
    const { session, memory, post } = await setup([]);
    await memory.addQuickPhrase("My usual, please.", {});
    post.mockImplementationOnce(async (body) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "My usual please", lineIds: [userId(body)] }] }));
    await session.send("A phrase for my usual order.");
    expect(await session.keep(session.state.cards[0].id)).toBe("duplicate");
    expect(session.state.cards[0].state).toBe("skipped");
  });

  it("marks a line that couldn't be sent, and retries it without a new line", async () => {
    const { session, post } = await setup([{ ok: false, reason: "unavailable" }, { ok: true, say: "Got it.", proposals: [] }]);
    await session.send("Hello");
    expect(session.state.lines).toEqual([expect.objectContaining({ text: "Hello", failed: true })]);
    await session.retry();
    expect(session.state.lines.map((l) => [l.text, !!l.failed])).toEqual([
      ["Hello", false],
      ["Got it.", false],
    ]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("says sorry for an unreadable answer", async () => {
    const { session } = await setup([{ ok: false, reason: "unreadable" }]);
    await session.send("Hello");
    expect(session.state.lines.at(-1)?.text).toBe(SORRY);
  });

  it("ignores an answer that arrives after closing", async () => {
    const { session, post } = await setup([]);
    let release!: (r: AssistResult) => void;
    post.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const sent = session.send("Hello");
    session.close();
    release({ ok: true, say: "Late.", proposals: [] });
    await sent;
    expect(session.state.lines.map((l) => l.text)).toEqual(["Hello"]);
  });

  it("stops at 20 user messages", async () => {
    const { session, post } = await setup([]);
    for (let i = 0; i < 21; i++) await session.send(`Message ${i}`);
    expect(post).toHaveBeenCalledTimes(20);
    expect(session.state.lines.at(-1)?.text).toBe(LIMIT_TEXT);
  });

  it("drops a card identical to an earlier one", async () => {
    const { session, post } = await setup([]);
    const phrase = (body: AssistRequest) => ({ ok: true as const, say: "Here.", proposals: [{ action: "phrase" as const, text: "Thank you.", lineIds: [userId(body)] }] });
    post.mockImplementationOnce(async (b) => phrase(b)).mockImplementationOnce(async (b) => phrase(b));
    await session.send("A thank you phrase.");
    await session.send("Again?");
    expect(session.state.cards).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assist/session.test.ts`
Expected: FAIL, cannot find module `./session`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/assist/session.ts
import { localIsoDate } from "@/lib/learning/prompt";
import type { MemoryStore } from "@/lib/memory/store";
import { buildNote, composeNoteText, hasName, noteFields, type DraftNote } from "@/lib/profiles/notes";
import { tokenize } from "@/lib/text";
import { postAssist, type AssistResult } from "./client";
import { pickAssistNotes, quickPhrasesForRequest } from "./notes";
import { ASSIST_USER_MAX, type AssistJob, type AssistProposal, type AssistRequest } from "./protocol";

export const JOB_TEXT: Record<AssistJob, string> = {
  update: "Update my information",
  prepare: "Prepare for an appointment",
  phrases: "Make quick phrases",
};
export const SORRY = "Sorry, I didn't get that. Could you say it another way?";
export const LIMIT_TEXT = "This chat is as long as it can be. Close it and start a new one to carry on.";
const RATE_WAIT_MS = 10_000;

export interface ChatLine {
  id: string;
  speaker: "user" | "assistant";
  text: string;
  failed?: boolean;
  proposed?: string[];
}
export type CardAction = "add" | "edit" | "remove" | "phrase";
export interface AssistCard {
  id: string;
  lineId: string;
  action: CardAction;
  draft?: DraftNote;
  noteId?: string;
  oldText?: string;
  phrase?: { text: string; forName?: string };
  sources: string[];
  state: "open" | "kept" | "skipped";
  changed?: boolean;
}
export type AssistStatus = "idle" | "waiting" | "rate_limited";
export interface AssistState {
  job: AssistJob | null;
  lines: ChatLine[];
  cards: AssistCard[];
  status: AssistStatus;
  closed: boolean;
}
export type KeepOutcome = "kept" | "changed" | "duplicate" | "gone";

const words = (t: string) => tokenize(t).join(" ");
const newId = () => crypto.randomUUID();

/** How a card is described back to the model, so it isn't offered twice. */
function describe(card: AssistCard): string {
  switch (card.action) {
    case "add":
      return `new note "${composeNoteText(card.draft!)}"`;
    case "edit":
      return `change "${composeNoteText(card.draft!)}"`;
    case "remove":
      return `remove "${card.oldText}"`;
    default:
      return `phrase "${card.phrase!.text}"`;
  }
}

const sameCard = (a: AssistCard, b: AssistCard) => a.action === b.action && describe(a) === describe(b);

/**
 * One assistant chat. Kept in memory only: closing it discards it (spec decision 4). Every
 * change goes through a card the user keeps, and a card never overwrites a note that
 * changed after the card was made.
 */
export class AssistSession {
  private s: AssistState = { job: null, lines: [], cards: [], status: "idle", closed: false };
  private listeners = new Set<() => void>();
  private keeping = new Set<string>();
  private readonly memory: MemoryStore;
  private readonly post: (body: AssistRequest) => Promise<AssistResult>;
  private readonly now: () => number;

  constructor(opts: { memory: MemoryStore; post?: (body: AssistRequest) => Promise<AssistResult>; now?: () => number }) {
    this.memory = opts.memory;
    this.post = opts.post ?? ((body) => postAssist(body));
    this.now = opts.now ?? Date.now;
  }

  get state(): AssistState {
    return this.s;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(next: Partial<AssistState>) {
    this.s = { ...this.s, ...next };
    for (const fn of this.listeners) fn();
  }

  userCount(): number {
    return this.s.lines.filter((l) => l.speaker === "user").length;
  }

  openCount(): number {
    return this.s.cards.filter((c) => c.state === "open").length;
  }

  async chooseJob(job: AssistJob): Promise<void> {
    if (this.s.lines.length > 0) return;
    this.set({ job });
    await this.send(JOB_TEXT[job]);
  }

  async send(text: string): Promise<void> {
    const t = text.trim();
    if (!t || this.s.closed || this.s.status !== "idle" || this.userCount() >= ASSIST_USER_MAX) return;
    this.set({ lines: [...this.s.lines, { id: newId(), speaker: "user", text: t }] });
    await this.turn();
  }

  async retry(): Promise<void> {
    if (this.s.closed || this.s.status !== "idle" || !this.s.lines.some((l) => l.failed)) return;
    this.set({ lines: this.s.lines.map((l) => (l.failed ? { ...l, failed: false } : l)) });
    await this.turn();
  }

  private async turn(): Promise<void> {
    this.set({ status: "waiting" });
    const userTexts = this.s.lines.filter((l) => l.speaker === "user").map((l) => l.text);
    const notes = await pickAssistNotes(this.memory, userTexts);
    const body: AssistRequest = {
      job: this.s.job,
      today: localIsoDate(new Date(this.now())),
      lines: this.s.lines.map(({ id, speaker, text, proposed }) => ({ id, speaker, text, ...(speaker === "assistant" ? { proposed: proposed ?? [] } : {}) })),
      notes: notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text })),
      phrases: quickPhrasesForRequest(this.memory),
    };
    const result = await this.post(body);
    if (this.s.closed) return;

    const lastUser = this.s.lines.findLast((l) => l.speaker === "user")!;
    if (!result.ok && result.reason !== "unreadable") {
      this.set({ lines: this.s.lines.map((l) => (l.id === lastUser.id ? { ...l, failed: true } : l)), status: result.reason === "rate_limited" ? "rate_limited" : "idle" });
      if (result.reason === "rate_limited") setTimeout(() => !this.s.closed && this.set({ status: "idle" }), RATE_WAIT_MS);
      return;
    }

    const lineId = newId();
    const say = result.ok ? result.say : SORRY;
    const cards = result.ok ? this.toCards(result.proposals, lineId, body) : [];
    const lines: ChatLine[] = [...this.s.lines, { id: lineId, speaker: "assistant", text: say, proposed: cards.map(describe) }];
    if (lines.filter((l) => l.speaker === "user").length >= ASSIST_USER_MAX) lines.push({ id: newId(), speaker: "assistant", text: LIMIT_TEXT });
    this.set({ lines, cards: [...this.s.cards, ...cards], status: "idle" });
  }

  private toCards(proposals: AssistProposal[], lineId: string, body: AssistRequest): AssistCard[] {
    const text = new Map(body.lines.map((l) => [l.id, l.text]));
    const made: AssistCard[] = [];
    for (const p of proposals) {
      const sources = p.lineIds.map((id) => text.get(id) ?? "").filter(Boolean);
      const base = { id: newId(), lineId, sources, state: "open" as const };
      let card: AssistCard;
      if (p.action === "phrase") card = { ...base, action: "phrase", phrase: { text: p.text, ...(p.for ? { forName: p.for } : {}) } };
      else if (p.action === "remove") {
        const target = this.memory.getNote(p.noteId);
        if (!target || target.pinned) continue;
        card = { ...base, action: "remove", noteId: p.noteId, oldText: target.text };
      } else if (p.action === "edit") {
        const target = this.memory.getNote(p.noteId);
        if (!target) continue;
        card = { ...base, action: "edit", noteId: p.noteId, oldText: target.text, draft: { kind: target.kind, ...(p.name ? { name: p.name } : {}), text: p.text } };
      } else card = { ...base, action: "add", draft: { kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text } };
      if ([...this.s.cards, ...made].some((c) => sameCard(c, card))) continue;
      made.push(card);
    }
    return made;
  }

  private mark(cardId: string, patch: Partial<AssistCard>) {
    this.set({ cards: this.s.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) });
  }

  skip(cardId: string): void {
    if (this.s.cards.find((c) => c.id === cardId)?.state === "open") this.mark(cardId, { state: "skipped" });
  }

  /** Saves a card. `edited` carries what the user changed with Edit. */
  async keep(cardId: string, edited: { draft?: DraftNote; phraseText?: string } = {}): Promise<KeepOutcome> {
    const card = this.s.cards.find((c) => c.id === cardId);
    if (!card || card.state !== "open" || this.keeping.has(cardId)) return "gone";
    this.keeping.add(cardId);
    try {
      const outcome = await this.apply(card, edited);
      if (outcome === "kept") this.mark(cardId, { state: "kept" });
      else if (outcome === "changed") this.mark(cardId, { changed: true });
      else this.mark(cardId, { state: "skipped" });
      return outcome;
    } finally {
      this.keeping.delete(cardId);
    }
  }

  private async apply(card: AssistCard, edited: { draft?: DraftNote; phraseText?: string }): Promise<KeepOutcome> {
    const now = this.now();
    if (card.action === "add") {
      const draft = edited.draft ?? card.draft!;
      const text = composeNoteText(draft);
      if (this.memory.notes().some((n) => words(n.text) === words(text))) return "duplicate";
      await this.memory.upsertNote(buildNote(draft, { now }));
      return "kept";
    }
    if (card.action === "edit") {
      const target = this.memory.getNote(card.noteId!);
      if (!target) return "gone";
      if (target.text !== card.oldText && !edited.draft) return "changed";
      await this.memory.upsertNote(buildNote(edited.draft ?? card.draft!, { id: target.id, pinned: target.pinned, now }));
      return "kept";
    }
    if (card.action === "remove") {
      const target = this.memory.getNote(card.noteId!);
      if (!target) return "gone";
      if (target.text !== card.oldText) return "changed";
      await this.memory.removeNote(target.id);
      return "kept";
    }
    const name = card.phrase!.forName?.toLowerCase();
    const tied = name ? this.memory.notes().find((n) => hasName(n.kind) && noteFields(n).name.toLowerCase() === name) : undefined;
    const tie = tied ? (tied.kind === "person" ? { partnerId: tied.id } : { placeId: tied.id }) : {};
    const made = await this.memory.addQuickPhrase(edited.phraseText ?? card.phrase!.text, tie);
    return made ? "kept" : "duplicate";
  }

  close(): void {
    this.set({ closed: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assist/session.test.ts`
Expected: PASS (11 tests). The limit test sends 21 messages with the default answer; the 20th answer adds `LIMIT_TEXT`, and the 21st `send` does nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assist/session.ts src/lib/assist/session.test.ts
git commit -m "Add the assistant session: chat state, cards and keep rules"
```

---

### Task 8: Shared suggestion card

**Files:**
- Create: `src/components/suggestion-card.tsx`
- Modify: `src/components/suggested-notes.tsx`
- Test: `src/components/suggestion-card.test.tsx`; existing `src/components/suggested-notes.test.tsx` must still pass unchanged.

**Interfaces:**
- Produces:

```tsx
export interface SuggestionCardProps {
  /** Set on the <li>, so a screen can focus a card's first button. */
  id?: string;
  heading: string;
  /** For a change: the note's text now. */
  current?: string;
  /** The new text, the phrase, or for a removal the note being removed. */
  text: string;
  /** Lines it came from, already worded. */
  sources: ReactNode;
  /** Shown above the buttons, e.g. "This note has changed since." */
  notice?: string;
  /** The edit form, shown instead of the buttons while editing. */
  editForm?: ReactNode;
  editing: boolean;
  keepLabel?: string; // default "Keep"
  canKeep?: boolean; // default true
  canEdit?: boolean; // default true
  onKeep: () => void;
  onEdit: () => void;
  onSkip: () => void;
}
export function SuggestionCard(props: SuggestionCardProps): JSX.Element; // renders an <li>
```

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/suggestion-card.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SuggestionCard } from "./suggestion-card";

const handlers = () => ({ onKeep: vi.fn(), onEdit: vi.fn(), onSkip: vi.fn() });

describe("SuggestionCard", () => {
  it("shows old and new text for a change, with the three buttons", async () => {
    const h = handlers();
    render(
      <ul>
        <SuggestionCard heading="Change a note: Routines" current="Physio on Tuesdays." text="Physio on Thursdays." sources={<p>You said: moved</p>} editing={false} {...h} />
      </ul>,
    );
    expect(screen.getByRole("heading", { name: "Change a note: Routines" })).toBeVisible();
    expect(screen.getByText("Physio on Tuesdays.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Keep: Physio on Thursdays." }));
    expect(h.onKeep).toHaveBeenCalled();
  });

  it("offers only what is allowed, with a notice", () => {
    render(
      <ul>
        <SuggestionCard heading="Remove a note: Places" text="Home is on Cedar Street." sources={null} editing={false} keepLabel="Delete" canEdit={false} notice="This note has changed since." canKeep={false} {...handlers()} />
      </ul>,
    );
    expect(screen.getByText("This note has changed since.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip: Home is on Cedar Street." })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/suggestion-card.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the card** (markup and classes lifted from `suggested-notes.tsx`)

```tsx
// src/components/suggestion-card.tsx
"use client";

import type { ReactNode } from "react";
import { primaryButton, secondaryButton } from "./ui";

export interface SuggestionCardProps {
  id?: string;
  heading: string;
  current?: string;
  text: string;
  sources: ReactNode;
  notice?: string;
  editForm?: ReactNode;
  editing: boolean;
  keepLabel?: string;
  canKeep?: boolean;
  canEdit?: boolean;
  onKeep: () => void;
  onEdit: () => void;
  onSkip: () => void;
}

/** One proposed change: what it is, where it came from, and Keep, Edit, Skip. */
export function SuggestionCard({ id, heading, current, text, sources, notice, editForm, editing, keepLabel = "Keep", canKeep = true, canEdit = true, onKeep, onEdit, onSkip }: SuggestionCardProps) {
  return (
    <li id={id} className="flex flex-col gap-3 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
      <h3 className="text-reply font-bold">{heading}</h3>
      {current !== undefined ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="font-bold">Now</dt>
          <dd className="break-words">{current}</dd>
          <dt className="font-bold">New</dt>
          <dd className="break-words">{text}</dd>
        </dl>
      ) : (
        <p className="text-body break-words">{text}</p>
      )}
      {sources && <div className="flex flex-col gap-1">{sources}</div>}
      {notice && <p className="text-body font-bold">{notice}</p>}
      {editing && editForm ? (
        editForm
      ) : (
        <div className="flex flex-wrap gap-3">
          {canKeep && (
            <button type="button" aria-label={`${keepLabel}: ${text}`} className={primaryButton} onClick={onKeep}>
              {keepLabel}
            </button>
          )}
          {canEdit && (
            <button type="button" aria-label={`Edit: ${text}`} className={secondaryButton} onClick={onEdit}>
              Edit
            </button>
          )}
          <button type="button" aria-label={`Skip: ${text}`} className={secondaryButton} onClick={onSkip}>
            Skip
          </button>
        </div>
      )}
    </li>
  );
}
```

In `src/components/suggested-notes.tsx`, replace the `<li>...</li>` block inside `suggestions.map` with:

```tsx
              <SuggestionCard
                key={s.id}
                heading={target ? `Change a note: ${group}` : `New note: ${group}`}
                current={target?.text}
                text={text}
                sources={s.sources.map((line, i) => (
                  <Source key={i} line={line} now={now} />
                ))}
                editing={editing === s.id}
                editForm={
                  <NoteForm
                    kind={s.draft.kind}
                    initial={{ name: s.draft.name ?? "", text: s.draft.text }}
                    submitLabel="Keep"
                    autoFocus
                    onSave={(draft) => {
                      setEditing(null);
                      handle(s.id, () => onKeep(s, draft));
                      settle();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                }
                onKeep={() => {
                  handle(s.id, () => onKeep(s, s.draft));
                  settle();
                }}
                onEdit={() => setEditing(s.id)}
                onSkip={() => {
                  handle(s.id, () => onSkip(s.id));
                  settle();
                }}
              />
```

and import `SuggestionCard` from `./suggestion-card`. Remove the now unused `primaryButton`/`secondaryButton` imports only if the file no longer uses them (the Skip all and Done buttons still do).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components`
Expected: PASS, including every existing `suggested-notes.test.tsx` test unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/suggestion-card.tsx src/components/suggestion-card.test.tsx src/components/suggested-notes.tsx
git commit -m "Move the suggestion card into its own component"
```

---

### Task 9: Assistant screen

**Files:**
- Create: `src/components/assistant-screen.tsx`
- Test: `src/components/assistant-screen.test.tsx`

**Interfaces:**
- Consumes: `AssistSession`, `AssistCard`, `JOB_TEXT`, `KeepOutcome` (Task 7); `SuggestionCard` (Task 8); `NoteForm`, `KIND_LABELS` from `./note-form`; `primaryButton`, `secondaryButton`, `textField`, `fieldLabel`, `hint` from `./ui`.
- Produces:

```tsx
export function AssistantScreen(props: {
  memory: MemoryStore;
  /** Called after anything is saved, so the conversation screen refreshes notes and clears cached replies. */
  onChanged: () => void;
  onClose: () => void;
  announce: (text: string) => void;
  /** For tests. */
  session?: AssistSession;
}): JSX.Element;
```

Behaviour:
- Creates one `AssistSession` on mount (or uses `props.session`); calls `session.close()` on unmount. Re-renders on `session.onChange`.
- Heading "Assistant" (h2, focused on mount, `tabIndex={-1}`), a Close button at the top.
- With no lines yet: "What would you like to do?", the three job buttons, then the notice: "The assistant sends your notes and quick phrases to the AI service OnBeat uses, more than a reply does. OnBeat doesn't keep them."
- The chat: an ordered list; user lines prefixed visually and for screen readers with "You:", assistant lines with "Assistant:". A failed user line shows "Not sent." and a "Try again" button (calls `retry`).
- Cards render under their assistant line (`card.lineId`), only while `state === "open"`, using `SuggestionCard`:
  - add: heading `New note: ${KIND_LABELS[kind].group}`, text `composeNoteText(draft)`, edit form `NoteForm`.
  - edit: heading `Change a note: ${group}`, current = the note's text now (`memory.getNote(noteId)?.text`), text the new text.
  - remove: heading `Remove a note: ${group}`, text `oldText`, `keepLabel="Delete"`, `canEdit={false}`. Delete first shows, in place of the buttons, "Delete this note?" with "Delete" and "Cancel".
  - phrase: heading `Quick phrase${forName ? ` for ${forName}` : ""}`, text the phrase, edit form: one text input (label "Phrase", maxLength 120) with Keep and Cancel.
  - `changed`: `notice="This note has changed since."`, `canKeep={false}` (Edit and Skip stay; for a removal only Skip).
  - Sources: each as `You said: "..."` in the muted label style.
- On keep: `"kept"` announces "Kept" (or "Deleted" for a removal) and calls `onChanged`; `"duplicate"` announces "You already have this."; `"changed"` announces "This note has changed since."; `"gone"` does nothing.
- Status `waiting`: a "The assistant is typing" line with `role="status"`; the text box stays enabled but Send is disabled. `rate_limited`: "Please wait a moment." in the same status element.
- The text box: `<textarea>` labelled "Message to the assistant", placeholder-free, `maxLength={500}`; Enter sends, Shift+Enter makes a new line; Send button. Disabled with the hint "Close this chat and start a new one to carry on." once `userCount() >= 20`.
- Focus: after a new assistant line arrives, focus the Keep (or Delete) button of its first open card; if none, the text box. New assistant text goes to `announce`.
- Close: if `openCount() > 0`, show "Leave without keeping N changes?" (1 change / N changes) with "Leave" and "Stay"; Leave calls `onClose`. Otherwise `onClose` straight away.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/assistant-screen.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssistResult } from "@/lib/assist/client";
import type { AssistRequest } from "@/lib/assist/protocol";
import { AssistSession } from "@/lib/assist/session";
import { MemoryStore } from "@/lib/memory/store";
import { AssistantScreen } from "./assistant-screen";

async function setup(answer: (body: AssistRequest) => AssistResult) {
  const memory = await MemoryStore.create();
  await memory.replaceAll(
    [
      { id: "me", kind: "about-me", text: "I'm Tom.", entities: [], updatedAt: 0, pinned: true },
      { id: "home", kind: "place", text: "Home is my flat on Oak Road.", entities: ["Home"], updatedAt: 0 },
    ],
    [],
  );
  const session = new AssistSession({ memory, post: async (b) => answer(b) });
  const props = { memory, session, onChanged: vi.fn(), onClose: vi.fn(), announce: vi.fn() };
  render(<AssistantScreen {...props} />);
  return { ...props };
}

const uid = (b: AssistRequest) => b.lines.filter((l) => l.speaker === "user").at(-1)!.id;

describe("AssistantScreen", () => {
  it("starts with the jobs and says what is sent", async () => {
    await setup(() => ({ ok: true, say: "Hi.", proposals: [] }));
    expect(screen.getByRole("heading", { name: "Assistant" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Prepare for an appointment" })).toBeVisible();
    expect(screen.getByText(/sends your notes and quick phrases to the AI service/)).toBeVisible();
  });

  it("shows a phrase card and keeps it", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here is one.", proposals: [{ action: "phrase", text: "Please write it down.", lineIds: [uid(b)] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    const keep = await screen.findByRole("button", { name: "Keep: Please write it down." });
    await waitFor(() => expect(keep).toHaveFocus());
    await userEvent.click(keep);
    await waitFor(() => expect(p.memory.allQuickPhrases().map((x) => x.text)).toEqual(["Please write it down."]));
    expect(p.onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Keep: Please write it down." })).toBeNull();
  });

  it("asks before deleting a note", async () => {
    const p = await setup((b) => ({ ok: true, say: "Remove it?", proposals: [{ action: "remove", noteId: "home", lineIds: [uid(b)] }] }));
    await userEvent.type(screen.getByLabelText("Message to the assistant"), "I moved out of Oak Road.{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Home is my flat on Oak Road." }));
    expect(screen.getByText("Delete this note?")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(p.memory.getNote("home")).toBeUndefined());
  });

  it("asks before leaving with changes not yet kept", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [uid(b)] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await screen.findByRole("button", { name: "Keep: Thank you." });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Leave without keeping 1 change?")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("marks a message that wasn't sent and tries again", async () => {
    let fail = true;
    await setup(() => {
      if (fail) {
        fail = false;
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, say: "Got it.", proposals: [] };
    });
    await userEvent.type(screen.getByLabelText("Message to the assistant"), "Hello{Enter}");
    expect(await screen.findByText("Not sent.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Got it.")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/assistant-screen.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/assistant-screen.tsx
"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ASSIST_USER_MAX, PHRASE_MAX, type AssistJob } from "@/lib/assist/protocol";
import { AssistSession, JOB_TEXT, type AssistCard, type KeepOutcome } from "@/lib/assist/session";
import type { MemoryStore } from "@/lib/memory/store";
import { composeNoteText, type DraftNote } from "@/lib/profiles/notes";
import { KIND_LABELS, NoteForm } from "./note-form";
import { SuggestionCard } from "./suggestion-card";
import { fieldLabel, hint, primaryButton, secondaryButton, textField } from "./ui";

interface Props {
  memory: MemoryStore;
  onChanged: () => void;
  onClose: () => void;
  announce: (text: string) => void;
  session?: AssistSession;
}

const JOBS: AssistJob[] = ["update", "prepare", "phrases"];
const NOTICE = "The assistant sends your notes and quick phrases to the AI service OnBeat uses, more than a reply does. OnBeat doesn't keep them.";

function PhraseForm({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
    >
      <label className={fieldLabel} htmlFor="assist-phrase-edit">
        Phrase
      </label>
      <input id="assist-phrase-edit" className={textField} value={text} maxLength={PHRASE_MAX} autoFocus onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButton}>
          Keep
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AssistantScreen({ memory, onChanged, onClose, announce, session: given }: Props) {
  const [session] = useState(() => given ?? new AssistSession({ memory }));
  const state = useSyncExternalStore(
    (fn) => session.onChange(fn),
    () => session.state,
    () => session.state,
  );
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(0);

  useEffect(() => {
    headingRef.current?.focus();
    return () => session.close();
  }, [session]);

  // Each new assistant line is announced; focus goes to its first card, else the text box.
  useEffect(() => {
    const assistant = state.lines.filter((l) => l.speaker === "assistant");
    if (assistant.length <= seen.current) return;
    seen.current = assistant.length;
    const line = assistant.at(-1)!;
    announce(line.text);
    const first = state.cards.find((c) => c.lineId === line.id && c.state === "open");
    requestAnimationFrame(() => {
      const target = first ? document.getElementById(`assist-card-${first.id}`)?.querySelector("button") : null;
      (target ?? boxRef.current)?.focus();
    });
  }, [state.lines, state.cards, announce]);

  const full = session.userCount() >= ASSIST_USER_MAX;
  const send = () => {
    const text = draft.trim();
    if (!text || state.status !== "idle" || full) return;
    setDraft("");
    void session.send(text);
  };

  const keep = async (card: AssistCard, edited?: { draft?: DraftNote; phraseText?: string }) => {
    setEditing(null);
    setConfirmDelete(null);
    const outcome: KeepOutcome = await session.keep(card.id, edited);
    if (outcome === "kept") {
      onChanged();
      announce(card.action === "remove" ? "Deleted" : "Kept");
    } else if (outcome === "duplicate") announce("You already have this.");
    else if (outcome === "changed") announce("This note has changed since.");
    boxRef.current?.focus();
  };

  const renderCard = (card: AssistCard) => {
    const group = card.draft ? KIND_LABELS[card.draft.kind].group : KIND_LABELS[memory.getNote(card.noteId ?? "")?.kind ?? "routine"].group;
    const sources = card.sources.map((s, i) => (
      <p key={i} className="text-label text-muted break-words">
        You said: &ldquo;{s}&rdquo;
      </p>
    ));
    const notice = card.changed ? "This note has changed since." : undefined;
    const common = { id: `assist-card-${card.id}`, sources, notice, editing: editing === card.id, onEdit: () => setEditing(card.id), onSkip: () => session.skip(card.id) };
    let body;
    if (card.action === "phrase") {
      const text = card.phrase!.text;
      body = (
        <SuggestionCard
          {...common}
          heading={`Quick phrase${card.phrase!.forName ? ` for ${card.phrase!.forName}` : ""}`}
          text={text}
          onKeep={() => void keep(card)}
          editForm={<PhraseForm initial={text} onSave={(t) => void keep(card, { phraseText: t })} onCancel={() => setEditing(null)} />}
        />
      );
    } else if (card.action === "remove") {
      body =
        confirmDelete === card.id ? (
          <li key={card.id} id={`assist-card-${card.id}`} className="flex flex-col gap-3 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
            <p className="text-body font-bold">Delete this note?</p>
            <p className="text-body break-words">{card.oldText}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={primaryButton} autoFocus onClick={() => void keep(card)}>
                Delete
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
            </div>
          </li>
        ) : (
          <SuggestionCard {...common} heading={`Remove a note: ${group}`} text={card.oldText ?? ""} keepLabel="Delete" canEdit={false} canKeep={!card.changed} onKeep={() => setConfirmDelete(card.id)} />
        );
    } else {
      const text = composeNoteText(card.draft!);
      body = (
        <SuggestionCard
          {...common}
          heading={card.action === "edit" ? `Change a note: ${group}` : `New note: ${group}`}
          current={card.action === "edit" ? (memory.getNote(card.noteId!)?.text ?? card.oldText) : undefined}
          text={text}
          canKeep={!card.changed}
          onKeep={() => void keep(card)}
          editForm={
            <NoteForm
              kind={card.draft!.kind}
              initial={{ name: card.draft!.name ?? "", text: card.draft!.text }}
              submitLabel="Keep"
              autoFocus
              onSave={(d) => void keep(card, { draft: d })}
              onCancel={() => setEditing(null)}
            />
          }
        />
      );
    }
    return <Fragment key={card.id}>{body}</Fragment>;
  };

  const open = session.openCount();
  const close = () => (open > 0 ? setLeaving(true) : onClose());

  return (
    <section aria-labelledby="assistant-heading" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="assistant-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          Assistant
        </h2>
        {leaving ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body font-bold">
              Leave without keeping {open} {open === 1 ? "change" : "changes"}?
            </p>
            <button type="button" className={primaryButton} autoFocus onClick={onClose}>
              Leave
            </button>
            <button type="button" className={secondaryButton} onClick={() => setLeaving(false)}>
              Stay
            </button>
          </div>
        ) : (
          <button type="button" className={secondaryButton} onClick={close}>
            Close
          </button>
        )}
      </div>

      {state.lines.length === 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-body font-bold">What would you like to do?</p>
          <div className="flex flex-col gap-3 sm:max-w-md">
            {JOBS.map((job) => (
              <button key={job} type="button" className={`${secondaryButton} text-left`} onClick={() => void session.chooseJob(job)}>
                {JOB_TEXT[job]}
              </button>
            ))}
          </div>
          <p className="max-w-[60ch] text-body text-muted">{NOTICE}</p>
        </div>
      )}

      {state.lines.length > 0 && (
        <ol className="flex flex-col gap-4">
          {state.lines.map((line) => (
            <li key={line.id} className="flex flex-col gap-3">
              <p className={`text-body break-words ${line.speaker === "user" ? "font-semibold" : ""}`}>
                <span className="font-bold">{line.speaker === "user" ? "You: " : "Assistant: "}</span>
                {line.text}
              </p>
              {line.failed && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-body font-bold">Not sent.</p>
                  <button type="button" className={secondaryButton} onClick={() => void session.retry()} disabled={state.status !== "idle"}>
                    Try again
                  </button>
                </div>
              )}
              {line.speaker === "assistant" && state.cards.some((c) => c.lineId === line.id && c.state === "open") && (
                <ul className="flex flex-col gap-4">{state.cards.filter((c) => c.lineId === line.id && c.state === "open").map(renderCard)}</ul>
              )}
            </li>
          ))}
        </ol>
      )}

      <p role="status" className="text-body text-muted">
        {state.status === "waiting" ? "The assistant is typing" : state.status === "rate_limited" ? "Please wait a moment." : ""}
      </p>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="assist-message" className={fieldLabel}>
          Message to the assistant
        </label>
        <textarea
          id="assist-message"
          ref={boxRef}
          className={textField}
          rows={2}
          maxLength={500}
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {full && <p className={hint}>Close this chat and start a new one to carry on.</p>}
        <div>
          <button type="submit" className={primaryButton} disabled={full || state.status !== "idle" || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
```

Check `src/components/ui.ts` for the exact exported names (`fieldLabel`, `hint`, `textField`, `primaryButton`, `secondaryButton` are used by `profile-menu.tsx`, so they exist). If `KIND_LABELS` is keyed differently, read `note-form.tsx` and adjust.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/assistant-screen.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/assistant-screen.tsx src/components/assistant-screen.test.tsx
git commit -m "Add the assistant screen"
```

---

### Task 10: "Your phrases" row in conversation

**Files:**
- Create: `src/components/phrase-row.tsx`
- Modify: `src/components/conversation-screen.tsx` (speak options, the row under `ReactionBar`)
- Test: `src/components/phrase-row.test.tsx`; `src/components/conversation-screen.test.tsx` (append)

**Interfaces:**
- Consumes: `MemoryStore.quickPhrases` (Task 5).
- Produces: `PhraseRow({ phrases: Phrase[]; onSpeak: (text: string) => void })`; `speak(text, { quick: true })` in conversation-screen skips learning.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/phrase-row.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhraseRow } from "./phrase-row";

const phrase = (text: string) => ({ id: text, text, context: { timeOfDay: "morning" as const }, timesUsed: 0, lastUsed: 0, quick: true as const });

describe("PhraseRow", () => {
  it("speaks a phrase with one tap", async () => {
    const onSpeak = vi.fn();
    render(<PhraseRow phrases={[phrase("My usual, please.")]} onSpeak={onSpeak} />);
    expect(screen.getByRole("group", { name: "Your phrases" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "My usual, please." }));
    expect(onSpeak).toHaveBeenCalledWith("My usual, please.");
  });

  it("is hidden with no phrases", () => {
    const { container } = render(<PhraseRow phrases={[]} onSpeak={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

In `src/components/conversation-screen.test.tsx`, add a test in its existing style (it already renders the screen with a profile and mocked voice; follow the nearest test that checks `learning.session.addLine` or the `/api/learn` body). The test: store a quick phrase for the profile, pick nobody in Talking with, tap the phrase in "Your phrases", and assert (a) the voice was asked to speak it, (b) no learning line was queued for it, (c) the phrase's `context.partnerId` is unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/phrase-row.test.tsx src/components/conversation-screen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/phrase-row.tsx
import type { Phrase } from "@/lib/types";

/** Quick phrases for who the user is talking with or where, one tap to say. */
export function PhraseRow({ phrases, onSpeak }: { phrases: Phrase[]; onSpeak: (text: string) => void }) {
  if (phrases.length === 0) return null;
  return (
    <div role="group" aria-labelledby="phrases-label" className="flex flex-wrap items-center gap-3">
      <span id="phrases-label" className="text-label text-muted">
        Your phrases
      </span>
      {phrases.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSpeak(p.text)}
          className="min-h-12 rounded-full border-2 border-ink/15 bg-surface px-5 text-left text-body font-semibold transition-[border-color] duration-150 hover:border-ink/50 active:translate-y-px"
        >
          {p.text}
        </button>
      ))}
    </div>
  );
}
```

In `src/components/conversation-screen.tsx`:

1. `speak`'s options become `{ isReaction?: boolean; quick?: boolean }`, and the learning line is skipped for a quick phrase:

```ts
      // A reply tapped as it is came from the notes, maybe with an invented detail, and a
      // quick phrase was made on purpose: only the user's own new words are learned from.
      if (!opts?.quick && !state.replies.some((r) => r.text.trim() === t)) void learning.session?.addLine({ speaker: "user", text: t, ...lineContext() });
```

2. After `const notes = useMemo(...)`, add (the row is worked out only when the context or notes change, not on each use, so buttons never move under a finger mid-conversation):

```ts
  const [phrasesVersion, setPhrasesVersion] = useState(0);
  const quickPhrases = useMemo(
    () => (memory ? memory.quickPhrases({ partnerId: state.partnerId, placeId: state.placeId }) : []),
    [memory, state.partnerId, state.placeId, notesVersion, phrasesVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
```

3. Under `<ReactionBar ... />`:

```tsx
            <PhraseRow phrases={quickPhrases} onSpeak={(text) => speak(text, { quick: true })} />
```

`setPhrasesVersion` is used by Task 11 and Task 12 when quick phrases change outside the conversation.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/phrase-row.tsx src/components/phrase-row.test.tsx src/components/conversation-screen.tsx src/components/conversation-screen.test.tsx
git commit -m "Show quick phrases for the current person or place"
```

---

### Task 11: Quick phrases in Your notes

**Files:**
- Create: `src/components/quick-phrases-editor.tsx`
- Modify: `src/components/notes-editor.tsx`, `src/components/conversation-screen.tsx` (pass phrases and handlers)
- Test: `src/components/quick-phrases-editor.test.tsx`

**Interfaces:**
- Consumes: Task 5 store methods.
- Produces:

```tsx
export type PhraseTie = { partnerId?: string; placeId?: string };
export function QuickPhrasesEditor(props: {
  phrases: Phrase[];          // memory.allQuickPhrases()
  people: Note[];
  places: Note[];
  onAdd: (text: string, tie: PhraseTie) => Promise<boolean>;    // false: already have it
  onUpdate: (id: string, text: string, tie: PhraseTie) => Promise<boolean>;
  onRemove: (id: string) => void;
}): JSX.Element;
```

`NotesEditor` gets optional props `phrases?: Phrase[]` and the three handlers; it renders `<QuickPhrasesEditor>` as the last section when `phrases` is given.

Behaviour: section heading "Quick phrases" (h3, same style as the other groups), a hint "One tap to say these in a conversation. Phrases for a person or place show when you pick them in Talking with or Place." Each phrase in a card with its text, "For: <name>" (or "For: anyone"), Edit and Delete (Delete asks "Delete this phrase?"). "Add a phrase" opens a form: "Phrase" text input (max 120), "For" select with "Anyone" then optgroups "People" and "Places" (values `person:<id>` / `place:<id>`), Save and Cancel. Save with a phrase already there shows "You already have this phrase." and keeps the form open. Focus returns to the button that opened a form, as `NotesEditor` does.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/quick-phrases-editor.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickPhrasesEditor } from "./quick-phrases-editor";

const sam = { id: "sam", kind: "person" as const, text: "Sam is the barista.", entities: ["Sam"], updatedAt: 0 };
const phrase = { id: "p1", text: "My usual, please.", context: { partnerId: "sam", timeOfDay: "morning" as const }, timesUsed: 0, lastUsed: 0, quick: true as const };

function show(overrides = {}) {
  const props = { phrases: [phrase], people: [sam], places: [], onAdd: vi.fn(async () => true), onUpdate: vi.fn(async () => true), onRemove: vi.fn(), ...overrides };
  render(<QuickPhrasesEditor {...props} />);
  return props;
}

describe("QuickPhrasesEditor", () => {
  it("lists phrases with who they are for", () => {
    show();
    expect(screen.getByText("My usual, please.")).toBeVisible();
    expect(screen.getByText("For: Sam")).toBeVisible();
  });

  it("adds a phrase for a person", async () => {
    const p = show();
    await userEvent.click(screen.getByRole("button", { name: "Add a phrase" }));
    await userEvent.type(screen.getByLabelText("Phrase"), "Thanks, Sam.");
    await userEvent.selectOptions(screen.getByLabelText("For"), "person:sam");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onAdd).toHaveBeenCalledWith("Thanks, Sam.", { partnerId: "sam" });
  });

  it("says when the phrase is already there", async () => {
    show({ onAdd: vi.fn(async () => false) });
    await userEvent.click(screen.getByRole("button", { name: "Add a phrase" }));
    await userEvent.type(screen.getByLabelText("Phrase"), "My usual, please.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("You already have this phrase.")).toBeVisible();
  });

  it("asks before deleting", async () => {
    const p = show();
    await userEvent.click(screen.getByRole("button", { name: "Delete: My usual, please." }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(p.onRemove).toHaveBeenCalledWith("p1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/quick-phrases-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/quick-phrases-editor.tsx
"use client";

import { useState } from "react";
import { PHRASE_MAX } from "@/lib/assist/protocol";
import { noteFields } from "@/lib/profiles/notes";
import type { Note, Phrase } from "@/lib/types";
import { fieldLabel, hint, primaryButton, secondaryButton, textField } from "./ui";

export type PhraseTie = { partnerId?: string; placeId?: string };

interface Props {
  phrases: Phrase[];
  people: Note[];
  places: Note[];
  onAdd: (text: string, tie: PhraseTie) => Promise<boolean>;
  onUpdate: (id: string, text: string, tie: PhraseTie) => Promise<boolean>;
  onRemove: (id: string) => void;
}

const tieValue = (p?: Phrase) => (p?.context.partnerId ? `person:${p.context.partnerId}` : p?.context.placeId ? `place:${p.context.placeId}` : "");
const toTie = (v: string): PhraseTie => (v.startsWith("person:") ? { partnerId: v.slice(7) } : v.startsWith("place:") ? { placeId: v.slice(6) } : {});

function PhraseForm({ phrase, people, places, onSave, onCancel }: { phrase?: Phrase; people: Note[]; places: Note[]; onSave: (text: string, tie: PhraseTie) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(phrase?.text ?? "");
  const [tie, setTie] = useState(tieValue(phrase));
  const [taken, setTaken] = useState(false);
  const id = phrase?.id ?? "new";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const ok = await onSave(text.trim(), toTie(tie));
        setTaken(!ok);
      }}
    >
      <label htmlFor={`phrase-text-${id}`} className={fieldLabel}>
        Phrase
      </label>
      <input id={`phrase-text-${id}`} className={textField} value={text} maxLength={PHRASE_MAX} autoFocus onChange={(e) => setText(e.target.value)} />
      <label htmlFor={`phrase-for-${id}`} className={fieldLabel}>
        For
      </label>
      <select id={`phrase-for-${id}`} className={textField} value={tie} onChange={(e) => setTie(e.target.value)}>
        <option value="">Anyone</option>
        {people.length > 0 && (
          <optgroup label="People">
            {people.map((n) => (
              <option key={n.id} value={`person:${n.id}`}>
                {noteFields(n).name || n.text}
              </option>
            ))}
          </optgroup>
        )}
        {places.length > 0 && (
          <optgroup label="Places">
            {places.map((n) => (
              <option key={n.id} value={`place:${n.id}`}>
                {noteFields(n).name || n.text}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {taken && (
        <p role="alert" className="text-body font-bold">
          You already have this phrase.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButton}>
          Save
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Quick phrases, made here or in the assistant: shown in a conversation's "Your phrases" row. */
export function QuickPhrasesEditor({ phrases, people, places, onAdd, onUpdate, onRemove }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const forName = (p: Phrase) => {
    const n = [...people, ...places].find((x) => x.id === (p.context.partnerId ?? p.context.placeId));
    return n ? noteFields(n).name || n.text : "anyone";
  };
  const refocus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

  return (
    <section aria-labelledby="notes-group-phrases" className="flex flex-col gap-3 border-t-2 border-ink/15 pt-4">
      <h3 id="notes-group-phrases" className="text-reply font-bold">
        Quick phrases
      </h3>
      <p className={hint}>One tap to say these in a conversation. Phrases for a person or place show when you pick them in Talking with or Place.</p>
      {phrases.length > 0 && (
        <ul className="flex flex-col gap-3">
          {phrases.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
              {editing === p.id ? (
                <PhraseForm
                  phrase={p}
                  people={people}
                  places={places}
                  onSave={async (text, tie) => {
                    const ok = await onUpdate(p.id, text, tie);
                    if (ok) {
                      setEditing(null);
                      refocus(`phrase-edit-${p.id}`);
                    }
                    return ok;
                  }}
                  onCancel={() => {
                    setEditing(null);
                    refocus(`phrase-edit-${p.id}`);
                  }}
                />
              ) : confirming === p.id ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-body font-bold">Delete this phrase?</p>
                  <button type="button" className={primaryButton} autoFocus onClick={() => onRemove(p.id)}>
                    Delete
                  </button>
                  <button type="button" className={secondaryButton} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-body break-words">{p.text}</p>
                  <p className="text-label text-muted">For: {forName(p)}</p>
                  <div className="flex flex-wrap gap-3">
                    <button id={`phrase-edit-${p.id}`} type="button" aria-label={`Edit: ${p.text}`} className={secondaryButton} onClick={() => setEditing(p.id)}>
                      Edit
                    </button>
                    <button type="button" aria-label={`Delete: ${p.text}`} className={secondaryButton} onClick={() => setConfirming(p.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <PhraseForm
          people={people}
          places={places}
          onSave={async (text, tie) => {
            const ok = await onAdd(text, tie);
            if (ok) {
              setAdding(false);
              refocus("phrase-add");
            }
            return ok;
          }}
          onCancel={() => {
            setAdding(false);
            refocus("phrase-add");
          }}
        />
      ) : (
        <div>
          <button id="phrase-add" type="button" className={secondaryButton} onClick={() => setAdding(true)}>
            Add a phrase
          </button>
        </div>
      )}
    </section>
  );
}
```

In `notes-editor.tsx`, add optional props:

```ts
  phrases?: Phrase[];
  onAddPhrase?: (text: string, tie: PhraseTie) => Promise<boolean>;
  onUpdatePhrase?: (id: string, text: string, tie: PhraseTie) => Promise<boolean>;
  onRemovePhrase?: (id: string) => void;
```

and render, after the note groups and before the document import section:

```tsx
      {phrases && onAddPhrase && onUpdatePhrase && onRemovePhrase && (
        <QuickPhrasesEditor
          phrases={phrases}
          people={notes.filter((n) => n.kind === "person")}
          places={notes.filter((n) => n.kind === "place")}
          onAdd={onAddPhrase}
          onUpdate={onUpdatePhrase}
          onRemove={onRemovePhrase}
        />
      )}
```

In `conversation-screen.tsx`, pass to `NotesEditor` (the store writes, then the row and the reply cache refresh):

```tsx
            phrases={memory.allQuickPhrases()}
            onAddPhrase={async (text, tie) => {
              const made = await memory.addQuickPhrase(text, tie);
              setPhrasesVersion((v) => v + 1);
              if (made) announce("Phrase saved");
              return made !== null;
            }}
            onUpdatePhrase={async (id, text, tie) => {
              const ok = await memory.updateQuickPhrase(id, text, tie);
              setPhrasesVersion((v) => v + 1);
              if (ok) announce("Phrase saved");
              return ok;
            }}
            onRemovePhrase={(id) =>
              void memory.removePhrase(id).then(() => {
                setPhrasesVersion((v) => v + 1);
                announce("Phrase deleted");
              })
            }
```

`NotesEditor` re-renders on `phrasesVersion` because the conversation screen re-renders; `memory.allQuickPhrases()` is read on each render.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/quick-phrases-editor.tsx src/components/quick-phrases-editor.test.tsx src/components/notes-editor.tsx src/components/conversation-screen.tsx
git commit -m "Add a Quick phrases section to Your notes"
```

---

### Task 12: Open the assistant from the profile menu

**Files:**
- Modify: `src/components/profile-menu.tsx`, `src/components/conversation-screen.tsx`
- Test: `src/components/profile-components.test.tsx` (append), `tests/e2e/assistant.spec.ts` (new)

**Interfaces:**
- Consumes: `AssistantScreen` (Task 9).
- Produces: `ProfileMenu` prop `onAssistant?: () => void` (item "Assistant", after "Your notes"); conversation-screen view `"assistant"`.

- [ ] **Step 1: Write the failing unit test** (append to `profile-components.test.tsx`, using its existing menu render helper)

```tsx
it("offers the assistant only when given a handler", async () => {
  const onAssistant = vi.fn();
  renderMenu({ onAssistant }); // the file's existing helper; pass through extra props
  await userEvent.click(screen.getByRole("button", { name: /Priya/ }));
  await userEvent.click(screen.getByRole("button", { name: "Assistant" }));
  expect(onAssistant).toHaveBeenCalled();
});
```

If the file has no helper, render `<ProfileMenu>` with the same props its other tests use.

- [ ] **Step 2: Write the failing e2e test**

```ts
// tests/e2e/assistant.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function setUp(page: Page) {
  await page.getByLabel("What's your name?").fill("Tom");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("About you", { exact: true }).fill("I'm Deaf and I use ASL.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Assistant" }).click();
  await expect(page.getByRole("heading", { name: "Assistant" })).toBeFocused();
}

test("prepare an appointment, keep the cards, see the phrases with that person", async ({ page }) => {
  await prepare(page);
  let turn = 0;
  await page.route("**/api/assist", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string; speaker: string }[] };
    const last = body.lines.filter((l) => l.speaker === "user").at(-1)!.id;
    turn++;
    const answer =
      turn === 1
        ? { say: "Who is the appointment with, and when?", proposals: [] }
        : {
            say: "Here is a note, the doctor, and two phrases. Anything else?",
            proposals: [
              { action: "add", kind: "routine", text: "Thursday 8 October, 10:00: seeing Dr. Chen about my blood pressure.", lineIds: [last] },
              { action: "add", kind: "person", name: "Dr. Chen", text: "Dr. Chen is my family doctor.", lineIds: [last] },
              { action: "phrase", text: "I get dizzy in the mornings.", for: "Dr. Chen", lineIds: [last] },
              { action: "phrase", text: "Please write it down for me.", for: "Dr. Chen", lineIds: [last] },
            ],
          };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
  });
  await setUp(page);
  await openAssistant(page);
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Prepare for an appointment" }).click();
  await expect(page.getByText("Who is the appointment with, and when?")).toBeVisible();
  await page.getByLabel("Message to the assistant").fill("Dr. Chen, my family doctor, Thursday at 10:00 about my blood pressure. I get dizzy in the mornings.");
  await page.keyboard.press("Enter");
  for (const name of ["Keep: Thursday 8 October", "Keep: Dr. Chen", "Keep: I get dizzy", "Keep: Please write it down"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  }
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Talking with").selectOption({ label: "Dr. Chen" });
  const row = page.getByRole("group", { name: "Your phrases" });
  await expect(row.getByRole("button", { name: "I get dizzy in the mornings." })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
});

test("closing with changes not kept asks first", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/assist", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string; speaker: string }[] };
    const last = body.lines.filter((l) => l.speaker === "user").at(-1)!.id;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [last] }] }) });
  });
  await setUp(page);
  await openAssistant(page);
  await page.getByRole("button", { name: "Make quick phrases" }).click();
  await expect(page.getByRole("button", { name: "Keep: Thank you." })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Leave without keeping 1 change?")).toBeVisible();
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page.getByRole("heading", { name: "Assistant" })).toHaveCount(0);
});

test("a removal asks before deleting", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/assist", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string; speaker: string }[]; notes: { id: string; text: string }[] };
    const last = body.lines.filter((l) => l.speaker === "user").at(-1)!.id;
    const target = body.notes.find((n) => n.text.includes("Lakeview"))!;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ say: "Remove it?", proposals: [{ action: "remove", noteId: target.id, lineIds: [last] }] }) });
  });
  await setUp(page);
  // A note to remove, added through Your notes.
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Your notes" }).click();
  await page.getByRole("button", { name: /Add.*place/i }).click();
  await page.getByLabel("Name").fill("Lakeview Clinic");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await openAssistant(page);
  await page.getByLabel("Message to the assistant").fill("I don't go to Lakeview Clinic any more.");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Delete: Lakeview/ }).click();
  await expect(page.getByText("Delete this note?")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Your notes" }).click();
  await expect(page.getByText("Lakeview Clinic")).toHaveCount(0);
});

test("demos have no assistant", async ({ page }) => {
  await prepare(page);
  await page.getByRole("button", { name: "Try a demo first" }).click();
  await page.getByRole("button", { name: /Maya/ }).first().click();
  await page.getByRole("button", { name: /Demo: Maya/ }).click();
  await expect(page.getByRole("button", { name: "Assistant" })).toHaveCount(0);
});
```

Check `tests/e2e/helpers.ts` and `tests/e2e/profiles.spec.ts` for the exact labels used for adding a place note and for opening a demo, and use those; the selectors above are the intended flow.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/components/profile-components.test.tsx` then `npx playwright test tests/e2e/assistant.spec.ts`
Expected: FAIL (no Assistant item).

- [ ] **Step 4: Implement**

`profile-menu.tsx`: add `onAssistant?: () => void;` to `Props`, and after the "Your notes" button:

```tsx
                  {props.onAssistant && (
                    <button type="button" onClick={() => act(props.onAssistant!)} className={item}>
                      Assistant
                    </button>
                  )}
```

`conversation-screen.tsx`:

1. `type View = ... | "assistant";`
2. Import `AssistantScreen`.
3. A function to open it (listening and speech stop first, spec decision 2):

```ts
  const openAssistant = () => {
    hearing?.stop();
    gapTimer.reset();
    leaveConversation("assistant");
  };
```

4. `ProfileMenu` gets `onAssistant={demo ? undefined : openAssistant}`.
5. The view, next to the notes view:

```tsx
        {view === "assistant" && memory && !demo && (
          <AssistantScreen
            key={activeProfileId ?? "none"}
            memory={memory}
            announce={announce}
            onChanged={() => {
              // Notes or phrases changed: cached replies are stale (R13), and a removed note may be the current Talking with or Place.
              client?.clearCache();
              setNotesVersion((v) => v + 1);
              setPhrasesVersion((v) => v + 1);
              if ((state.partnerId && !memory.getNote(state.partnerId)) || (state.placeId && !memory.getNote(state.placeId))) {
                dispatch({
                  type: "setContext",
                  partnerId: state.partnerId && memory.getNote(state.partnerId) ? state.partnerId : undefined,
                  placeId: state.placeId && memory.getNote(state.placeId) ? state.placeId : undefined,
                });
              }
            }}
            onClose={() => {
              setView("conversation");
              resetFocusToTop();
            }}
          />
        )}
```

Switching profile goes through `showMemory`, which sets the view to `"conversation"`; that unmounts `AssistantScreen`, whose cleanup calls `session.close()`, so a late answer is ignored (spec decision 4, as decided: no question on switch).

- [ ] **Step 5: Run tests**

Run: `npx vitest run` then `npx playwright test tests/e2e/assistant.spec.ts tests/e2e/learning.spec.ts`
Expected: all unit tests PASS; the 4 new e2e tests and the learning e2e tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/profile-menu.tsx src/components/profile-components.test.tsx src/components/conversation-screen.tsx tests/e2e/assistant.spec.ts
git commit -m "Open the assistant from the profile menu"
```

---

### Task 13: Eval harness: cases, simulated user, judge, scoring, runner

**Files:**
- Create: `eval/assist/cases.ts`, `eval/assist/sim-user.ts`, `eval/assist/judge.ts`, `eval/assist/score.ts`, `eval/assist/run.ts`
- Test: `eval/assist/cases.test.ts`, `eval/assist/sim-user.test.ts`, `eval/assist/judge.test.ts`, `eval/assist/score.test.ts`
- Modify: `package.json` (script `"eval:assist": "tsx eval/assist/run.ts"`), `.gitignore` (`eval/assist/results/*.json`, `eval/assist/.cache/`)

**Interfaces:**
- Consumes: `AssistSession`, `JOB_TEXT` (Task 7); `assistTurn` (Task 4); `personas`; `providerConfigs`; `judgeChat`, `judgeEndpoints` from `eval/judge.ts`; `withRetry` from `eval/retry.ts`; `loadLocalEnv` from `eval/learning/env.ts`; `EVAL_TODAY` from `eval/learning/scenarios.ts`.
- Produces:

```ts
// cases.ts
export interface ExpectedChange { action: "add" | "edit" | "remove" | "phrase"; noteId?: string; fact: string }
export interface AssistCase {
  id: string;
  split: "dev" | "test";
  persona: "maya" | "tom" | "aisha";
  /** A job button, or null for a first message typed freely. */
  job: AssistJob | null;
  /** The first message when job is null. */
  opener?: string;
  /** What the simulated user wants and every fact they may type, in plain words. Never shown to the assistant. */
  brief: string;
  /** Quick phrases the user already has, as [text, tied note id or undefined]. */
  quick?: [string, string | undefined][];
  /** Empty when the right answer is to change nothing. */
  expected: ExpectedChange[];
  about: string;
}
export const assistCases: AssistCase[];

// sim-user.ts
export const DONE = "[done]";
export function simUserMessages(brief: string, lines: { speaker: "user" | "assistant"; text: string }[]): ChatMessage[];
export function parseSimReply(text: string): { text: string; done: boolean };

// judge.ts
export const ASSIST_JUDGE_VERSION = 1;
export interface ShownCard { action: "add" | "edit" | "remove" | "phrase"; text: string; oldText?: string; forName?: string }
export interface AssistJudgeInput { today: string; brief: string; notes: string[]; lines: { speaker: "user" | "assistant"; text: string }[]; expected: ExpectedChange[]; cards: ShownCard[] }
export interface CardVerdict { n: number; keep: boolean; invented: string[]; matches: number | null; sayable: boolean | null }
export interface AssistVerdict { cards: CardVerdict[]; leak: boolean }
export function assistJudgeMessages(j: AssistJudgeInput): ChatMessage[];
export function parseAssistVerdict(text: string, count: number): AssistVerdict | null;
export function voteAssist(sets: (AssistVerdict | null)[]): AssistVerdict | null;

// score.ts
export interface AssistCaseResult { id: string; model: string; expected: ExpectedChange[]; cards: (ShownCard & { noteId?: string })[]; userMessages: number; verdict: AssistVerdict | null; error?: string }
export interface AssistSummary { cases: number; void: number; shown: number; keep: [number, number]; invented: [number, number]; editsRight: [number, number]; recall: [number, number]; sayable: [number, number]; medianUserMessages: number }
export function summarizeAssist(results: AssistCaseResult[]): AssistSummary;
export function assistMarkdown(split: string, votes: number, rows: { model: string; summary: AssistSummary }[]): string;
```

Scoring rules (write them as the doc comment of `summarizeAssist`):
- A case with `verdict.leak === true` is void: counted in `void`, left out of every other number. A case with an error or no verdict is left out and reported.
- `shown`: all cards in counted cases. `keep`: cards judged keep. `invented`: cards with any invented detail. `sayable`: of phrase cards, those judged sayable.
- `editsRight`: of expected changes with action `edit` or `remove`, those matched (by the judge's `matches`) by a card with the same action on the same `noteId`.
- `recall`: expected changes matched by any kept card.
- `medianUserMessages`: median of `userMessages` over counted cases that expected at least one change.

Runner flow per case (`run.ts`), `--split dev|test`, `--votes` (1 dev, 3 test), `--only id,id`, `--rejudge <file>`, `--delay ms` (default 2000):
1. A `MemoryStore` with the persona's notes and the case's `quick` phrases (via `addQuickPhrase`).
2. An `AssistSession` with `post = (body) => withRetry(case.id, (cooldown) => assistTurn(body, { order: ["groq"], configs, cooldown })).then(r => ({ ok: true, ...r }), err => err instanceof AssistUnreadableError ? { ok: false, reason: "unreadable" } : Promise.reject(err))` and `now` fixed at `EVAL_TODAY` noon.
3. Start: `chooseJob(case.job)` or `send(case.opener)`.
4. Loop up to 8 user turns: after each assistant line, ask the simulated user (`gpt-oss-120b` on Groq, reasoning effort low, temperature 0.3, via `judgeChat` with the endpoint's `extraBody` overridden to `{ reasoning_effort: "low" }`) for the next message; `done` ends the loop; else `session.send(text)`.
5. Shown cards: every card still `open` at the end (the simulated user never keeps or skips).
6. Judge with `assistJudgeMessages` (cached by prompt hash in `eval/assist/.cache/judge.json`, as learning does), majority of `votes`.
7. Save `eval/assist/results/<timestamp>-<split>-<model>.json` (cards are kept even when judging fails, so `--rejudge` can finish them) and `eval/assist/results/latest-<split>.md`.

- [ ] **Step 1: Write the failing tests**

```ts
// eval/assist/cases.test.ts
import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { assistCases } from "./cases";

describe("assistCases", () => {
  it("has 48 cases, 16 per job, 32 dev and 16 test, unique ids", () => {
    expect(assistCases).toHaveLength(48);
    expect(new Set(assistCases.map((c) => c.id)).size).toBe(48);
    expect(assistCases.filter((c) => c.split === "test")).toHaveLength(16);
    const job = (c: (typeof assistCases)[number]) => c.job ?? c.about.split(":")[0];
    for (const j of ["update", "prepare", "phrases"]) expect(assistCases.filter((c) => job(c) === j)).toHaveLength(16);
  });

  it("names only notes the persona has, and gives an opener when there is no job", () => {
    for (const c of assistCases) {
      const ids = new Set(personas.find((p) => p.id === c.persona)!.notes.map((n) => n.id));
      for (const e of c.expected) if (e.noteId) expect(ids.has(e.noteId), `${c.id} ${e.noteId}`).toBe(true);
      if (c.job === null) expect(c.opener, c.id).toBeTruthy();
    }
  });
});
```

```ts
// eval/assist/sim-user.test.ts
import { describe, expect, it } from "vitest";
import { parseSimReply, simUserMessages } from "./sim-user";

describe("simulated user", () => {
  it("sees the brief and the chat from the user's side", () => {
    const [, user] = simUserMessages("You want phrases for Sam.", [
      { speaker: "user", text: "Make quick phrases" },
      { speaker: "assistant", text: "Who are they for?" },
    ]);
    expect(user.content).toContain("You want phrases for Sam.");
    expect(user.content).toContain("Assistant: Who are they for?");
    expect(user.content).toContain("You: Make quick phrases");
  });

  it("reads a reply and the done marker", () => {
    expect(parseSimReply("  Sam at the café  ")).toEqual({ text: "Sam at the café", done: false });
    expect(parseSimReply("That's all, thanks [done]")).toEqual({ text: "That's all, thanks", done: true });
    expect(parseSimReply("[done]")).toEqual({ text: "", done: true });
  });
});
```

```ts
// eval/assist/judge.test.ts
import { describe, expect, it } from "vitest";
import { parseAssistVerdict, voteAssist } from "./judge";

describe("assist judge", () => {
  it("reads verdicts, with sayable only for phrases", () => {
    const text = '{"leak": false, "cards": [{"n": 1, "keep": true, "invented": [], "matches": 1, "sayable": null}, {"n": 2, "keep": false, "invented": ["20 mg"], "matches": null, "sayable": true}]}';
    expect(parseAssistVerdict(text, 2)).toEqual({
      leak: false,
      cards: [
        { n: 1, keep: true, invented: [], matches: 1, sayable: null },
        { n: 2, keep: false, invented: ["20 mg"], matches: null, sayable: true },
      ],
    });
    expect(parseAssistVerdict('{"cards": []}', 1)).toBeNull();
  });

  it("takes the majority", () => {
    const v = (keep: boolean, leak = false) => ({ leak, cards: [{ n: 1, keep, invented: [], matches: 1, sayable: null }] });
    expect(voteAssist([v(true), v(false), v(true, true)])).toEqual({ leak: false, cards: [{ n: 1, keep: true, invented: [], matches: 1, sayable: null }] });
  });
});
```

```ts
// eval/assist/score.test.ts
import { describe, expect, it } from "vitest";
import { summarizeAssist, type AssistCaseResult } from "./score";

const base: AssistCaseResult = {
  id: "a",
  model: "m",
  expected: [{ action: "edit", noteId: "m-physio", fact: "Physio moved to Thursdays." }],
  cards: [{ action: "edit", text: "I have physio on Thursdays at 10:30.", noteId: "m-physio" }],
  userMessages: 3,
  verdict: { leak: false, cards: [{ n: 1, keep: true, invented: [], matches: 1, sayable: null }] },
};

describe("summarizeAssist", () => {
  it("counts keep, invented, edits right, recall and messages", () => {
    const s = summarizeAssist([base]);
    expect(s).toMatchObject({ cases: 1, void: 0, shown: 1, keep: [1, 1], invented: [0, 1], editsRight: [1, 1], recall: [1, 1], medianUserMessages: 3 });
  });

  it("an edit on the wrong note is not right", () => {
    const s = summarizeAssist([{ ...base, cards: [{ ...base.cards[0], noteId: "m-books" }] }]);
    expect(s.editsRight).toEqual([0, 1]);
  });

  it("leaves out a case where the simulated user leaked a fact", () => {
    const s = summarizeAssist([{ ...base, verdict: { ...base.verdict!, leak: true } }]);
    expect(s).toMatchObject({ cases: 0, void: 1, shown: 0 });
  });

  it("counts sayable phrases", () => {
    const s = summarizeAssist([
      {
        ...base,
        expected: [],
        cards: [{ action: "phrase", text: "Please write it down." }],
        verdict: { leak: false, cards: [{ n: 1, keep: true, invented: [], matches: null, sayable: true }] },
      },
    ]);
    expect(s.sayable).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run eval/assist`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `cases.ts`**

Write all 48 cases from this table. Keep the `about` field as `"<job>: <what it tests>"` (the job part lets the count test group free-typed cases). Write each `brief` in second person ("You want...", "If asked, ..."), listing every fact the user may type, and nothing more. Write the `fact` of each expected change in plain words. Cases marked "typed" have `job: null` and the given `opener`.

| id | split | persona | job / opener | brief (facts the user knows) | expected |
|---|---|---|---|---|---|
| maya-physio-moved | dev | maya | update | Physio moved from Tuesdays to Thursdays, still 10:30. | edit m-physio: physio on Thursdays at 10:30 |
| maya-new-carer | dev | maya | typed: "I have a new carer" | Carer is Ana, comes weekday mornings from 8 to 10. | add person: Ana, carer, weekday mornings 8 to 10 |
| maya-leila-works | dev | maya | update | Leila finished university and now works in Montreal. | edit m-leila: Leila works in Montreal (finished university) |
| maya-soy-latte | dev | maya | update | Usual order is now a large soy latte, no sugar. | edit m-usual: large soy latte, no sugar |
| tom-new-role | dev | tom | update | Now a UX designer at Brightline Studio. | edit t-work: UX designer at Brightline Studio |
| tom-new-doctor | dev | tom | typed: "My doctor changed" | Dr. Chen retired. New family doctor is Dr. Osei, same clinic (Lakeview Clinic). | edit t-doctor: Dr. Osei at Lakeview Clinic is family doctor |
| tom-shellfish | dev | tom | update | Also allergic to shellfish. | edit t-allergy: allergic to penicillin and shellfish |
| aisha-standup-930 | dev | aisha | update | Stand-up moved to 9:30, still every weekday. | edit a-standup: stand-up weekdays at 9:30 |
| aisha-harbor-shipped | dev | aisha | update | Harbor redesign shipped; wants the note gone. | remove a-harbor |
| maya-biscuit-gone | dev | maya | update | Biscuit died last month; wants the note removed. | remove m-biscuit |
| aisha-lunch-same | dev | aisha | update | Wants to check the lunch note; it is still right; nothing else. | (none) |
| tom-pharmacy-moved | test | tom | update | Riverside Pharmacy closed. Now uses Oak Street Pharmacy for prescriptions and the monthly blood pressure medication. | edit t-pharmacy: Oak Street Pharmacy; edit t-meds: monthly at Oak Street Pharmacy |
| maya-moved-home | test | maya | update | Moved to a flat on Birch Road. | edit m-home: flat on Birch Road |
| aisha-jen-left | test | aisha | update | Jen left Northline Design; wants her note gone. | remove a-jen |
| tom-people-fine | test | tom | update | Wants to go through people notes; all still right. | (none) |
| aisha-pottery | test | aisha | typed: "I started a new class" | Pottery class on Wednesdays at 7pm. | add routine: pottery Wednesdays 7pm |
| tom-checkup | dev | tom | prepare | Dr. Chen, Thursday at 10:00, Lakeview Clinic, blood pressure check. Wants to say: dizzy in the mornings; ask whether the dose should change. | add routine: Thursday 8 October 10:00 Dr. Chen, blood pressure; phrase: dizzy in the mornings (for Dr. Chen); phrase: ask about the dose (for Dr. Chen) |
| maya-new-dentist | dev | maya | typed: "I have a dentist appointment on Friday" | Dr. Patel at Smile Dental, Friday at 3pm, a cleaning. Wants to say: can't keep mouth open long; needs breaks. | add routine: Friday 9 October 3pm Dr. Patel at Smile Dental, cleaning; add person: Dr. Patel, dentist; add place: Smile Dental; phrase: can't keep mouth open long (for Dr. Patel) |
| aisha-review | dev | aisha | prepare | Performance review with Marco on Wednesday at 2pm. Wants to ask about a promotion and about working from home on Fridays. | add routine: Wednesday 7 October 2pm review with Marco; phrase: promotion (for Marco); phrase: home on Fridays (for Marco) |
| maya-bank | dev | maya | prepare | Northside Bank, next Tuesday at 11:00 (13 October), opening a joint account with Leila. Wants to say: has ALS, types to talk, needs time. | add routine: Tuesday 13 October 11:00 Northside Bank, joint account with Leila; add place: Northside Bank; phrase: ALS, types, needs time |
| tom-flu-jab | dev | tom | prepare | Flu jab at Riverside Pharmacy tomorrow at 4pm. Wants to say: allergic to penicillin. | add routine: Tuesday 6 October 4pm flu jab at Riverside Pharmacy; phrase: allergic to penicillin (for Riverside Pharmacy or Priya) |
| aisha-ent | dev | aisha | prepare | Dr. Rao at St Mary's ENT clinic, Monday 12 October at 9:00, throat check. Wants to say: has a stoma, please don't cover it. | add routine: Monday 12 October 9:00 Dr. Rao at St Mary's, throat check; add person: Dr. Rao; add place: St Mary's ENT clinic; phrase: stoma, don't cover it (for Dr. Rao) |
| maya-vet | dev | maya | prepare | Biscuit to Paws Vet on Friday at 5pm, limping on a back leg. | add routine: Friday 9 October 5pm Paws Vet, Biscuit limping; add place: Paws Vet; phrase: limping on back leg |
| tom-interview | dev | tom | prepare | Job interview at Brightline Studio on Wednesday at 1pm; an ASL interpreter is booked. Wants to say: please look at me, not the interpreter. | add routine: Wednesday 7 October 1pm interview at Brightline Studio, interpreter booked; add place: Brightline Studio; phrase: look at me, not the interpreter |
| aisha-far-date | dev | aisha | prepare | Parent-teacher meeting at Hillside School. If asked for the date, types "3 November at 4pm". | add routine: 3 November 4pm parent-teacher meeting at Hillside School; add place: Hillside School |
| maya-no-date | dev | maya | prepare | Physio assessment at Cedar Health "sometime next month"; doesn't know the day. Wants to say: my right hand is weaker. | add routine: physio assessment at Cedar Health next month (no date); phrase: right hand is weaker |
| tom-cancelled | test | tom | prepare | Starts to prepare, then says the appointment was cancelled; nothing to save. | (none) |
| maya-optician | test | maya | prepare | Clearview Opticians, Thursday at 11:30, eye test. Wants to say: can't read small print on screens; has ALS. | add routine: Thursday 8 October 11:30 eye test at Clearview Opticians; add place: Clearview Opticians; phrase: small print |
| tom-dentist | test | tom | typed: "Help me get ready for the dentist" | Dr. Kim at Bright Smile Dental, Monday 12 October at 8:45. Wants to say: I'm Deaf, please face me when you talk. | add routine: Monday 12 October 8:45 Dr. Kim, Bright Smile Dental; add person: Dr. Kim; add place: Bright Smile Dental; phrase: Deaf, face me |
| aisha-pitch | test | aisha | prepare | Pitch to Lumen Foods at their office, Friday at 10:00, with Marco. Wants to say: I'll type my part, it will show on the screen. | add routine: Friday 9 October 10:00 pitch to Lumen Foods with Marco; phrase: type my part |
| maya-gp | test | maya | prepare | Dr. Ahmed at Cedar Health, Tuesday at 2:30pm, breathing check. Wants to say: more tired than usual; short of breath at night. | add routine: Tuesday 6 October 2:30pm Dr. Ahmed at Cedar Health, breathing check; add person: Dr. Ahmed; phrase: tired; phrase: short of breath at night |
| aisha-meeting-off | test | aisha | prepare | Wanted to prepare a meeting with Jen but it's off; just wants to stop. | (none) |
| maya-cafe | dev | maya | phrases | For Sam at Blue Door Café: "the usual please", "can you bring it to my table", "just a small one today". | 3 phrases for Sam (usual, bring to table, small one) |
| tom-pharmacy-phrases | dev | tom | phrases | For Priya: "is my prescription ready", "please write it down", "can I pay by card". | 3 phrases for Priya |
| aisha-standup-phrases | dev | aisha | phrases | For stand-up at the office: "I'll type my update", "give me a moment", "nothing blocking me". | 3 phrases for the Northline Design office |
| maya-general | dev | maya | typed: "I want some phrases for anyone" | For anyone: "I have ALS and I type to talk", "please give me a moment to type", "I can hear you fine". | 3 phrases for anyone |
| tom-bus | dev | tom | phrases | For buses, anyone: "I'm Deaf, can you write it down", "does this bus go to the station". | 2 phrases for anyone |
| aisha-thai | dev | aisha | phrases | For the Thai place downstairs: "the green curry please", "to take away". | 2 phrases (for anyone, or a new place note for the Thai place; both fine) |
| maya-leila-phrases | dev | maya | phrases | For Leila: "call me when you land", "love you", "how was your exam". | 3 phrases for Leila |
| tom-chen-phrases | dev | tom | phrases | For Dr. Chen: "can you write that down", "can you say that again slowly". | 2 phrases for Dr. Chen |
| aisha-jen-phrases | dev | aisha | phrases | For Jen: "want to grab lunch", "can you check the website build". | 2 phrases for Jen |
| maya-ruth | dev | maya | phrases | For new neighbour Ruth (not in notes; she has a spare key): "thanks for checking on me", "could you walk Biscuit today". | add person: Ruth, neighbour with a spare key; 2 phrases for Ruth |
| tom-have-it | dev | tom | phrases | Wants "please write it down" for Priya, which is already a quick phrase (`quick: [["Please write it down.", "t-priya"]]`); nothing else. | (none) |
| maya-physio-phrases | test | maya | phrases | For physio sessions, anyone: "that hurts", "can we slow down", "I need a rest". | 3 phrases for anyone |
| tom-work-phrases | test | tom | phrases | For work meetings, anyone: "please turn on captions", "can you type that in the chat". | 2 phrases for anyone |
| aisha-marco-phrases | test | aisha | typed: "Phrases for my manager" | For Marco: "can we talk after stand-up", "I'll send it by end of day". | 2 phrases for Marco |
| maya-emergency | test | maya | phrases | For anyone, emergencies: "I need help", "please call my daughter Leila", "I can't speak but I can hear". | 3 phrases for anyone |
| aisha-enough | test | aisha | phrases | Asks for phrases, then says she already has enough; nothing to save. | (none) |

Split check: update 11 dev + 5 test, prepare 10 dev + 6 test, phrases 11 dev + 5 test: 32 dev, 16 test.

Expected "phrase" facts: write one `ExpectedChange` per phrase with `fact: "phrase for <who>: <gist>"`.

- [ ] **Step 4: Write `sim-user.ts`**

```ts
// eval/assist/sim-user.ts
import type { ChatMessage } from "@/lib/suggest/prompt";

export const DONE = "[done]";

/** The simulated user sees only their brief and the chat, never the notes or the assistant's instructions. */
export function simUserMessages(brief: string, lines: { speaker: "user" | "assistant"; text: string }[]): ChatMessage[] {
  const content = [
    "You are playing a person who cannot speak and types to an app's assistant. Typing is slow for you, so you answer in a few words.",
    "",
    "What you want, and everything you know (never say anything that isn't here):",
    brief,
    "",
    "The chat so far:",
    lines.map((l) => `${l.speaker === "user" ? "You" : "Assistant"}: ${l.text}`).join("\n"),
    "",
    "Write your next message only. Answer what the assistant asked; don't add facts it didn't ask for unless your brief says you want to tell it. If you have nothing more to add, or the assistant has done what you wanted and asks if there is anything else, reply with a short goodbye followed by " + DONE + ".",
  ].join("\n");
  return [
    { role: "system", content: "You play a user in a test. Stay in character. Output only the message you would type." },
    { role: "user", content },
  ];
}

export function parseSimReply(text: string): { text: string; done: boolean } {
  const done = text.includes(DONE);
  return { text: text.replace(DONE, "").trim(), done };
}
```

- [ ] **Step 5: Write `judge.ts`**

```ts
// eval/assist/judge.ts
import { dateLine } from "@/lib/learning/prompt";
import type { ChatMessage } from "@/lib/suggest/prompt";
import type { ExpectedChange } from "./cases";

/** Bump when the prompt below changes, so cached verdicts aren't reused. */
export const ASSIST_JUDGE_VERSION = 1;

export interface ShownCard {
  action: "add" | "edit" | "remove" | "phrase";
  text: string;
  oldText?: string;
  forName?: string;
}
export interface AssistJudgeInput {
  today: string;
  brief: string;
  notes: string[];
  lines: { speaker: "user" | "assistant"; text: string }[];
  expected: ExpectedChange[];
  cards: ShownCard[];
}
export interface CardVerdict {
  n: number;
  keep: boolean;
  invented: string[];
  matches: number | null;
  sayable: boolean | null;
}
export interface AssistVerdict {
  cards: CardVerdict[];
  leak: boolean;
}

const cardLine = (c: ShownCard, i: number) => {
  const n = i + 1;
  if (c.action === "edit") return `${n}. [change note] "${c.oldText ?? ""}" -> "${c.text}"`;
  if (c.action === "remove") return `${n}. [remove note] "${c.text}"`;
  if (c.action === "phrase") return `${n}. [quick phrase${c.forName ? ` for ${c.forName}` : ""}] "${c.text}"`;
  return `${n}. [new note] "${c.text}"`;
};

export function assistJudgeMessages(j: AssistJudgeInput): ChatMessage[] {
  const content = [
    "A person who cannot speak uses an app that suggests replies built from notes about them, and quick phrases they can say with one tap. They chatted with the app's assistant, which proposed changes. Judge each proposal, and check the person's own messages.",
    "",
    dateLine(j.today),
    "",
    "What the person wanted and knew (their brief):",
    j.brief,
    "",
    "Notes the app had:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    "",
    "The chat (Me is the person):",
    j.lines.map((l) => `- ${l.speaker === "user" ? "Me" : "Assistant"}: ${l.text}`).join("\n"),
    "",
    "Changes a careful helper would have proposed:",
    j.expected.length ? j.expected.map((e, i) => `${i + 1}. [${e.action}] ${e.fact}`).join("\n") : "(none: nothing should change)",
    "",
    "Proposals:",
    j.cards.map(cardLine).join("\n"),
    "",
    "For each proposal:",
    "- keep: true if it is true to what the person said and worth saving. For a change, also false if it drops something the old note said that is still true. For a removal, true only if the person said the note is no longer true or asked for it to go.",
    "- invented: every detail (name, number, time, date, place, claim) in it found in none of the person's messages, the notes, or the date list. [] if none.",
    "- matches: the number of the listed change it makes, or null.",
    "- sayable: for a quick phrase, true if the person could say it as it is, in their own voice, in that setting; null for anything else.",
    "Also: leak is true if any of the person's messages states a fact that is not in their brief.",
    "",
    'Reply with JSON only: {"leak": false, "cards": [{"n": 1, "keep": true, "invented": [], "matches": 1, "sayable": null}]}',
  ].join("\n");
  return [
    { role: "system", content: "You check an assistant's proposals against a chat. Be strict about invented details. Answer with JSON only." },
    { role: "user", content },
  ];
}

export function parseAssistVerdict(text: string, count: number): AssistVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const { cards: list, leak } = data as { cards?: unknown; leak?: unknown };
  if (!Array.isArray(list) || typeof leak !== "boolean") return null;
  const cards: CardVerdict[] = [];
  for (let n = 1; n <= count; n++) {
    const v = list.find((x) => (x as { n?: unknown })?.n === n) as Record<string, unknown> | undefined;
    if (!v || typeof v.keep !== "boolean" || !Array.isArray(v.invented)) return null;
    cards.push({ n, keep: v.keep, invented: v.invented.map(String), matches: typeof v.matches === "number" ? v.matches : null, sayable: typeof v.sayable === "boolean" ? v.sayable : null });
  }
  return { cards, leak };
}

const majority = (xs: boolean[]) => xs.filter(Boolean).length * 2 > xs.length;

/** Majority per card and for the leak flag, over the readable calls. */
export function voteAssist(sets: (AssistVerdict | null)[]): AssistVerdict | null {
  const readable = sets.filter((s): s is AssistVerdict => s !== null);
  if (readable.length === 0) return null;
  const cards = readable[0].cards.map((_, i) => {
    const calls = readable.map((s) => s.cards[i]);
    const inventedCalls = calls.filter((c) => c.invented.length > 0);
    const counts = new Map<number | null, number>();
    for (const c of calls) counts.set(c.matches, (counts.get(c.matches) ?? 0) + 1);
    const sayableCalls = calls.map((c) => c.sayable).filter((s): s is boolean => s !== null);
    return {
      n: i + 1,
      keep: majority(calls.map((c) => c.keep)),
      invented: majority(calls.map((c) => c.invented.length > 0)) ? inventedCalls[0].invented : [],
      matches: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0],
      sayable: sayableCalls.length ? majority(sayableCalls) : null,
    };
  });
  return { cards, leak: majority(readable.map((s) => s.leak)) };
}
```

- [ ] **Step 6: Write `score.ts`**

```ts
// eval/assist/score.ts
import type { ExpectedChange } from "./cases";
import type { AssistVerdict, ShownCard } from "./judge";

export interface AssistCaseResult {
  id: string;
  model: string;
  expected: ExpectedChange[];
  cards: (ShownCard & { noteId?: string })[];
  userMessages: number;
  verdict: AssistVerdict | null;
  error?: string;
}
export interface AssistSummary {
  cases: number;
  void: number;
  shown: number;
  keep: [number, number];
  invented: [number, number];
  editsRight: [number, number];
  recall: [number, number];
  sayable: [number, number];
  medianUserMessages: number;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A case where the simulated user typed a fact outside its brief is void and left out.
 * Cases with an error or no verdict are left out. Edits right: expected edits and
 * removals matched by a card with the same action on the same note. Recall: expected
 * changes matched by a kept card. Median user messages: over cases expecting a change.
 */
export function summarizeAssist(results: AssistCaseResult[]): AssistSummary {
  const judged = results.filter((r) => !r.error && r.verdict);
  const counted = judged.filter((r) => !r.verdict!.leak);
  const s: AssistSummary = { cases: counted.length, void: judged.length - counted.length, shown: 0, keep: [0, 0], invented: [0, 0], editsRight: [0, 0], recall: [0, 0], sayable: [0, 0], medianUserMessages: 0 };
  for (const r of counted) {
    const v = r.verdict!.cards;
    s.shown += r.cards.length;
    s.keep = [s.keep[0] + v.filter((c) => c.keep).length, s.keep[1] + r.cards.length];
    s.invented = [s.invented[0] + v.filter((c) => c.invented.length > 0).length, s.invented[1] + r.cards.length];
    r.cards.forEach((card, i) => {
      if (card.action === "phrase" && v[i].sayable !== null) s.sayable = [s.sayable[0] + (v[i].sayable ? 1 : 0), s.sayable[1] + 1];
    });
    r.expected.forEach((e, i) => {
      const n = i + 1;
      const matched = r.cards.map((c, j) => ({ c, v: v[j] })).filter((x) => x.v.matches === n);
      if (e.action === "edit" || e.action === "remove") {
        const right = matched.some((x) => x.c.action === e.action && x.c.noteId === e.noteId);
        s.editsRight = [s.editsRight[0] + (right ? 1 : 0), s.editsRight[1] + 1];
      }
      s.recall = [s.recall[0] + (matched.some((x) => x.v.keep) ? 1 : 0), s.recall[1] + 1];
    });
  }
  s.medianUserMessages = median(counted.filter((r) => r.expected.length > 0).map((r) => r.userMessages));
  return s;
}

const pct = ([a, b]: [number, number]) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : "n/a");

export function assistMarkdown(split: string, votes: number, rows: { model: string; summary: AssistSummary }[]): string {
  return [
    `${split} split, ${votes} judge vote(s)`,
    "",
    "| Model | Cases (void) | Shown | Worth keeping (target 90%) | Invented (target under 5%) | Edits right (target 90%) | Recall (target 80%) | Phrases sayable (target 80%) | Median user messages (target 5 or fewer) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map(({ model, summary: s }) => `| ${model} | ${s.cases} (${s.void}) | ${s.shown} | ${pct(s.keep)} | ${pct(s.invented)} | ${pct(s.editsRight)} | ${pct(s.recall)} | ${pct(s.sayable)} | ${s.medianUserMessages} |`),
    "",
  ].join("\n");
}
```

- [ ] **Step 7: Write `run.ts`**

Model it on `eval/learning/run.ts` (same `arg`, cache, `--rejudge`, results file, and markdown writing). The per-case part:

```ts
async function runCase(c: AssistCase, model: string): Promise<{ lines: ChatLine[]; cards: AssistCard[]; notes: string[]; userMessages: number }> {
  const persona = personas.find((p) => p.id === c.persona)!;
  const memory = await MemoryStore.create();
  await memory.replaceAll(persona.notes, []);
  for (const [text, tied] of c.quick ?? []) {
    const note = tied ? persona.notes.find((n) => n.id === tied) : undefined;
    await memory.addQuickPhrase(text, note?.kind === "place" ? { placeId: note.id } : note ? { partnerId: note.id } : {});
  }
  const configs = providerConfigs({ ...process.env, GROQ_MODEL: model });
  const session = new AssistSession({
    memory,
    now: () => new Date(`${EVAL_TODAY}T12:00:00`).getTime(),
    post: async (body) => {
      try {
        const r = await withRetry(c.id, (cooldown) => assistTurn(body, { order: ["groq"], configs, cooldown }));
        return { ok: true, ...r };
      } catch (err) {
        if (err instanceof AssistUnreadableError) return { ok: false, reason: "unreadable" };
        throw err;
      }
    },
  });
  if (c.job) await session.chooseJob(c.job);
  else await session.send(c.opener!);
  for (let turn = 1; turn < 8; turn++) {
    const reply = await withRetry(`${c.id}:user`, async () => (await judgeChat(simUserMessages(c.brief, session.state.lines), { endpoints: simEndpoints })).text);
    const { text, done } = parseSimReply(reply);
    if (done || !text) break;
    await session.send(text);
    await sleep(delay);
  }
  return {
    lines: session.state.lines,
    cards: session.state.cards.filter((card) => card.state === "open"),
    notes: persona.notes.map((n) => n.text),
    userMessages: session.userCount(),
  };
}
```

with `simEndpoints = judgeEndpoints().filter((e) => e.name === "groq").map((e) => ({ ...e, extraBody: { ...e.extraBody, reasoning_effort: "low" } }))`. Check `eval/judge.ts` for how `judgeChat` sets temperature; if it is fixed at 0, pass the simulated user through a small local `fetch` call instead, using the same endpoint url and key, `temperature: 0.3`. `withRetry`'s callback takes a `cooldown` argument; ignore it where not needed.

Cards to `ShownCard`: add, edit → `text: composeNoteText(draft)`, edit also `oldText`; remove → `text: oldText`; phrase → `text`, `forName`. Keep `noteId` for scoring.

- [ ] **Step 8: Run tests**

Run: `npx vitest run eval/assist`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 9: Commit**

```bash
git add eval/assist package.json .gitignore
git commit -m "Add the assistant eval: cases, simulated user, judge, scoring and runner"
```

---

### Task 14: Judge gold set and calibration

**Files:**
- Create: `eval/assist/judge-gold.ts`, `eval/assist/judge-check.ts`
- Modify: `package.json` (script `"eval:assist-judge-check": "tsx eval/assist/judge-check.ts"`)

This task needs a live model (Groq quota) and a human-style labelling pass. It is not TDD; it gates the judge before any number is reported.

- [ ] **Step 1: Make chats to label.** Run 8 dev cases with no judging: add a `--no-judge` flag to `run.ts` that saves chats and cards with `verdict: null`, then run `npm run eval:assist -- --split dev --no-judge --only maya-physio-moved,maya-new-dentist,tom-checkup,aisha-far-date,maya-no-date,maya-cafe,maya-ruth,tom-have-it`.

- [ ] **Step 2: Label by hand.** For each of those chats, and for 7 more made by editing their cards to be wrong on purpose (an invented time, a removal nobody asked for, an edit that drops a still-true part, a phrase with a name from nowhere, a phrase that isn't sayable, a user line with a fact outside the brief, a correct card on a case expecting nothing), write an entry in `judge-gold.ts` in the shape of `eval/learning/judge-gold.ts`: the judge input plus the expected `keep`, `invented` (empty or not), `sayable` per card and the `leak` flag. About 15 entries, about 40 cards.

- [ ] **Step 3: Write `judge-check.ts`** modelled on `eval/learning/judge-check.ts`: run the judge once per entry at the judge's normal settings and print agreement on keep, invented (empty or not), sayable and leak.

- [ ] **Step 4: Run it**

Run: `npm run eval:assist-judge-check`
Expected: agreement at least 90% on keep and on invented, and leak right on every entry. If it is lower, read each disagreement: fix a gold label only when the label is wrong (write down which and why in RESULTS.md), else tighten the judge prompt, bump `ASSIST_JUDGE_VERSION`, and run again. Do not use the judge for reported numbers until it passes.

- [ ] **Step 5: Commit**

```bash
git add eval/assist/judge-gold.ts eval/assist/judge-check.ts eval/assist/run.ts package.json
git commit -m "Add the assistant judge's gold set and calibration check"
```

---

### Task 15: Dev runs, tuning, then the held-out test

**Files:**
- Modify: `src/lib/assist/prompt.ts`, `src/lib/assist/check.ts` (only as the dev runs show), `eval/assist/RESULTS.md` (new)

- [ ] **Step 1: Baseline.** `npm run eval:assist -- --split dev` (1 vote). Record the table as D1 in `eval/assist/RESULTS.md`, with a short list of every failed card and why.

- [ ] **Step 2: Tune on dev only.** One change at a time (prompt rule, example, check rule), each followed by a dev run recorded as D2, D3, and so on, with what changed and what it fixed. Every change to `prompt.ts` or `check.ts` keeps the unit tests passing, with a test added for any new check rule. Stop when all six targets are met on dev or after 5 rounds, whichever is first.

- [ ] **Step 3: Held-out test, once.** `npm run eval:assist -- --split test --votes 3` with the final code. Do not change `prompt.ts` or `check.ts` after this run. If the judge runs out of quota, finish with `--rejudge`.

- [ ] **Step 4: Write up.** `eval/assist/RESULTS.md` in the style of `eval/learning/RESULTS.md`: the cases, the simulated user, the judge and its calibration, the dev table, what each change fixed, the test table, every test failure quoted with its chat line, and a plain statement of any missed target.

- [ ] **Step 5: Commit**

```bash
git add eval/assist/RESULTS.md src/lib/assist
git commit -m "Tune the assistant on dev and add the held-out test results"
```

---

### Task 16: Final checks and pull request

- [ ] **Step 1: Full checks**

Run: `npm run typecheck`, `npm run lint`, `npx vitest run`, `npx playwright test`
Expected: all pass (the 2 live-model e2e tests stay skipped as before).

- [ ] **Step 2: Whole-branch review.** A fresh reviewer reads the spec, this plan and `git diff feat/learning...HEAD`, and reports critical, important and minor findings. Fix critical and important ones with tests; list minor ones in the PR.

- [ ] **Step 3: Push and open a draft PR against `feat/learning`** (it builds on PR #11; retarget to `main` after #11 merges). The body, in the owner's plain style: what changes for the user, how it works, the eval tables, decisions made while the owner was away (the spec's "(decided)" items), deferred minors, and the attribution line.

```bash
git push -u origin feat/assistant
gh pr create --draft --base feat/learning --title "Assistant: update notes, prepare for appointments, make quick phrases" --body-file .superpowers/pr-body-assistant.md
```
