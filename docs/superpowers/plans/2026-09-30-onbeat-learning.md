# OnBeat Learning (Profiles Stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OnBeat notices new facts in conversations (the user's own typed lines and the partner's speech), suggests them as new notes or edits to existing notes, and saves nothing until the user taps Keep.

**Architecture:** The browser queues lines per profile in IndexedDB. A batcher sends them to a new `/api/learn` route after a quiet minute, at 12 lines, or when the page is hidden, together with the pinned note and the notes related to the lines. The route asks the model for up to 5 proposals and drops any that cite unknown lines, invent a detail, or repeat a note. Proposals go into a per-profile pending list that the user reviews on a "Suggested notes" screen opened from the profile menu. A learning eval measures precision, invented details, edit targeting and recall.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TypeScript, zod 4, idb-keyval, Orama (via `MemoryStore`), Vitest 5 + Testing Library, Playwright 1.63, tsx for evals, Groq and Cloudflare Workers AI through `src/lib/server/providers.ts`.

**Spec:** `docs/superpowers/specs/2026-09-30-onbeat-learning-design.md`

**Branch:** `feat/learning` in the worktree `C:/Users/hujai/onbeat-learning`. It is stacked on `feat/cloud-captions` (PR #10), which adds `src/lib/server/guard.ts` and the Clearer captions setting. Open the PR against `main` once #10 is merged; until then, open it against `feat/cloud-captions`.

## Global Constraints

- Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md: this Next.js version has breaking changes).
- Node 24.x. Run commands from the worktree root.
- Each note is at most 300 characters (`NOTE_MAX` in `src/lib/profiles/notes.ts`).
- Queue: at most 40 lines, a line at most 500 characters, lines older than 24 hours are dropped.
- Batch: sent when at least 2 lines are queued and (60 s without a new line, or 12 lines, or the page is hidden). One batch in flight. After 3 failed batches in a row, wait 10 minutes.
- Batch body: at most 40 lines and 9 notes (the pinned about-me note plus up to 8 related). Never the whole profile.
- `/api/learn`: same origin only, 6 requests a minute per address, body at most 64,000 characters, content never logged.
- The model returns at most 5 proposals. Pending list at most 30. Skip memory at most 200.
- IndexedDB keys, in the existing `onbeat` / `memory` store: `learn-queue:<profileId>`, `learn-pending:<profileId>`, `learn-skipped:<profileId>`.
- localStorage keys: `onbeat:learning` ("off" when turned off, absent when on), `onbeat:learning-told` ("yes").
- Demos never queue or suggest anything.
- User-facing copy, exactly:
  - Settings checkbox: "Suggest notes from my conversations". Hint: "After a pause, OnBeat sends recent lines from your conversations, and the notes they relate to, to its AI service to spot new facts. Nothing is saved until you choose Keep."
  - Setup, last step: "OnBeat will suggest notes from your conversations. You choose what to keep. You can turn this off in Settings."
  - One-time notice: "New: OnBeat can suggest notes from your conversations for you to review. Turn it off in Settings."
  - Review screen empty state: "Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep."
- Writing style for docs, READMEs and results: plain developer voice. No emoji, no em dashes, no marketing tables.
- Commit messages: plain sentences like the existing history ("Add ...", "Fix ..."), each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Checks before every commit: `npm test -- <changed test files>`. Before the last commit of each task: `npm run typecheck` and `npm run lint`.

## Review Focus

1. **Switching profile while a batch is in flight.** Expected: the result lands in the profile it was sent for, never the open one. Pinned by the session test "writes a late result to the profile it was sent for" (Task 8).
2. **A reply the user tapped as-is.** Expected: it never reaches the queue, because it came from the notes and may carry an invented detail. Pinned by the screen test "does not learn from a reply tapped as it is" (Task 12).
3. **An edit whose note was deleted or changed after the suggestion was made.** Expected: a deleted target shows as a new note and Keep adds it; a changed target shows its current text under "Now". Pinned by the component tests (Task 10) and the session test "an edit of a deleted note becomes a new note" (Task 8).
4. **The server refuses a batch (400 or 413).** Expected: those lines are dropped, not re-sent forever. Pinned by the client test (Task 8) and the session test "drops a batch the server refused" (Task 8).
5. **Storage blocked or full.** Expected: queue and pending list keep working in memory for the visit, and no error reaches the conversation. Pinned by the queue test "keeps working when storage fails" (Task 2) and the pending test "keeps working when storage fails" (Task 7).

---

## File Structure

New, under `src/lib/learning/`:

| File | Responsibility |
|---|---|
| `types.ts` | `Speaker`, `QueuedLine`, `SourceLine`, `PendingSuggestion` |
| `protocol.ts` | zod schemas and limits for the `/api/learn` request and a proposal |
| `keys.ts` | IndexedDB key names for one profile |
| `queue.ts` | `LearningQueue`: queued lines, age and size limits, failure backoff |
| `batcher.ts` | `Batcher`: when a batch is sent |
| `prompt.ts` | date helpers, `buildLearnMessages`, `parseProposals` |
| `check.ts` | `checkProposals`: server-side drop rules |
| `server.ts` | `learnFromBatch`: short ids, model call, parse, map back, check |
| `pending.ts` | `PendingStore`: pending list, merge rules, skip memory |
| `client.ts` | `postLearnBatch`: browser call to `/api/learn` |
| `session.ts` | `LearningSession`, `relatedNotes`, `toPending`: ties queue, batcher, pending and memory together |
| `use-learning.ts` | `useLearningSession`: React lifecycle for one profile's session |

Also new: `src/app/api/learn/route.ts`, `src/components/suggested-notes.tsx`, `tests/e2e/learning.spec.ts`, `eval/learning/*`.

Changed: `src/lib/profiles/notes.ts` (`composeNoteText`), `src/lib/settings.ts`, `src/lib/profiles/registry.ts`, `src/lib/profiles/transfer.ts`, `src/components/settings-panel.tsx`, `src/components/profile-menu.tsx`, `src/components/profile-setup.tsx`, `src/components/conversation-screen.tsx`, `tests/e2e/helpers.ts`, `eval/judge.ts`, `package.json`, `README.md`.

---

### Task 1: Learning types, wire schema and note text helper

**Files:**
- Create: `src/lib/learning/types.ts`, `src/lib/learning/protocol.ts`, `src/lib/learning/keys.ts`
- Modify: `src/lib/profiles/notes.ts`
- Test: `src/lib/learning/protocol.test.ts`, `src/lib/profiles/notes.test.ts`

**Interfaces:**
- Consumes: `DraftNote`, `NOTE_MAX`, `hasName` from `src/lib/profiles/notes.ts`; `NoteKind` from `src/lib/types.ts`.
- Produces:
  - `composeNoteText(draft: DraftNote): string` in `notes.ts`.
  - `types.ts`: `Speaker = "user" | "partner"`; `QueuedLine { id; speaker; text; at: number; partnerName?; placeName? }`; `SourceLine { speaker; text; at; partnerName? }`; `PendingSuggestion { id; action: "add" | "edit"; draft: DraftNote; noteId?; oldText?; sources: SourceLine[]; createdAt: number }`.
  - `protocol.ts`: `LEARN_LINES_MAX = 40`, `LEARN_LINE_MAX = 500`, `LEARN_NOTES_MAX = 9`, `PROPOSALS_MAX = 5`, `LearnRequestSchema`, `type LearnRequest`, `ProposalSchema`, `type Proposal { action; kind; name?; text; noteId?; lineIds: string[] }`.
  - `keys.ts`: `queueKey(id)`, `pendingKey(id)`, `skippedKey(id)`, `learningKeys(id): string[]`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/profiles/notes.test.ts` (import `composeNoteText` alongside the existing imports):

```ts
describe("composeNoteText", () => {
  it("stores a draft the same way buildNote does", () => {
    expect(composeNoteText({ kind: "person", name: "Ana", text: "my new carer" })).toBe("Ana: my new carer");
    expect(composeNoteText({ kind: "person", name: "Ana", text: "Ana is my new carer." })).toBe("Ana is my new carer.");
    expect(composeNoteText({ kind: "routine", name: "ignored", text: "  Physio on Thursdays. " })).toBe("Physio on Thursdays.");
    const draft = { kind: "place" as const, name: "Home", text: "my flat on Cedar Street" };
    expect(buildNote(draft, { now: 1 }).text).toBe(composeNoteText(draft));
  });
});
```

Create `src/lib/learning/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LearnRequestSchema, ProposalSchema } from "./protocol";

const line = (i: number) => ({ id: `l${i}`, speaker: "partner" as const, text: "Your physio moved to Thursdays." });

describe("LearnRequestSchema", () => {
  it("accepts a batch", () => {
    const body = { today: "2026-09-30", lines: [line(1), { ...line(2), speaker: "user", partnerName: "Leila", placeName: "Home" }], notes: [{ id: "n1", kind: "routine", text: "Physio on Tuesdays." }] };
    expect(LearnRequestSchema.safeParse(body).success).toBe(true);
  });

  it("refuses a batch that is empty, too big, or has a bad date or line", () => {
    const ok = { today: "2026-09-30", lines: [line(1)], notes: [] };
    expect(LearnRequestSchema.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, lines: Array.from({ length: 41 }, (_, i) => line(i)) }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, today: "30/09/2026" }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, lines: [{ ...line(1), text: "   " }] }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, lines: [{ ...line(1), text: "x".repeat(501) }] }).success).toBe(false);
    const notes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, kind: "routine", text: "x" }));
    expect(LearnRequestSchema.safeParse({ ...ok, notes }).success).toBe(false);
  });
});

describe("ProposalSchema", () => {
  it("needs a kind, text and at least one line", () => {
    expect(ProposalSchema.safeParse({ action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lineIds: ["l1"] }).success).toBe(true);
    expect(ProposalSchema.safeParse({ action: "add", kind: "friend", text: "x", lineIds: ["l1"] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ action: "add", kind: "routine", text: "x", lineIds: [] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ action: "add", kind: "routine", text: "x".repeat(301), lineIds: ["l1"] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -- src/lib/learning/protocol.test.ts src/lib/profiles/notes.test.ts`
Expected: FAIL. `./protocol` can't be resolved and `composeNoteText` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/profiles/notes.ts`, add `composeNoteText` above `buildNote` and make `buildNote` use it:

```ts
/** The text a draft is stored as: "Name: description" for a person or place, unless the description already names them. */
export function composeNoteText(draft: DraftNote): string {
  const name = hasName(draft.kind) ? (draft.name ?? "").trim() : "";
  const body = draft.text.trim();
  const mentions = name && body.toLowerCase().includes(name.toLowerCase());
  return clip(name && !mentions ? (body ? `${name}: ${body}` : name) : body);
}

export function buildNote(draft: DraftNote, opts: { id?: string; pinned?: boolean; now: number }): Note {
  const name = hasName(draft.kind) ? (draft.name ?? "").trim() : "";
  const text = composeNoteText(draft);
  const entities = [...new Set([...(name ? [name] : []), ...guessEntities(text)])];
  return {
    id: opts.id ?? `n_${crypto.randomUUID()}`,
    kind: draft.kind,
    text,
    entities,
    updatedAt: opts.now,
    ...(opts.pinned ? { pinned: true } : {}),
  };
}
```

Create `src/lib/learning/types.ts`:

```ts
import type { DraftNote } from "@/lib/profiles/notes";

export type Speaker = "user" | "partner";

/** A line of conversation waiting to be learned from. */
export interface QueuedLine {
  id: string;
  speaker: Speaker;
  text: string;
  at: number;
  /** Who the user was talking with, from the Talking with list. */
  partnerName?: string;
  /** Where, from the Place list. */
  placeName?: string;
}

/** The line a suggestion came from, as the review screen quotes it. */
export interface SourceLine {
  speaker: Speaker;
  text: string;
  at: number;
  partnerName?: string;
}

/** A suggested note waiting for the user to keep, edit or skip it. */
export interface PendingSuggestion {
  id: string;
  action: "add" | "edit";
  draft: DraftNote;
  /** For an edit: the note it changes. */
  noteId?: string;
  /** For an edit: the note's text when the change was suggested. */
  oldText?: string;
  sources: SourceLine[];
  createdAt: number;
}
```

Create `src/lib/learning/protocol.ts`:

```ts
import { z } from "zod";
import { NOTE_MAX } from "@/lib/profiles/notes";

export const LEARN_LINES_MAX = 40;
export const LEARN_LINE_MAX = 500;
/** The pinned about-me note plus up to 8 related notes. */
export const LEARN_NOTES_MAX = 9;
export const PROPOSALS_MAX = 5;

const Kind = z.enum(["person", "place", "routine", "preference", "about-me"]);

export const LearnRequestSchema = z.object({
  /** The user's local date, YYYY-MM-DD, so dates in notes match their calendar. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        speaker: z.enum(["user", "partner"]),
        text: z.string().trim().min(1).max(LEARN_LINE_MAX),
        partnerName: z.string().max(60).optional(),
        placeName: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(LEARN_LINES_MAX),
  notes: z.array(z.object({ id: z.string().min(1).max(64), kind: Kind, text: z.string().max(NOTE_MAX) })).max(LEARN_NOTES_MAX),
});

export type LearnRequest = z.infer<typeof LearnRequestSchema>;

export const ProposalSchema = z.object({
  action: z.enum(["add", "edit"]),
  kind: Kind,
  name: z.string().max(60).optional(),
  text: z.string().min(1).max(NOTE_MAX),
  noteId: z.string().optional(),
  lineIds: z.array(z.string()).min(1).max(LEARN_LINES_MAX),
});

export type Proposal = z.infer<typeof ProposalSchema>;
```

Create `src/lib/learning/keys.ts`:

```ts
/** Where one profile's learning data lives, next to `profile:<id>` in the same store. */
export const queueKey = (profileId: string) => `learn-queue:${profileId}`;
export const pendingKey = (profileId: string) => `learn-pending:${profileId}`;
export const skippedKey = (profileId: string) => `learn-skipped:${profileId}`;
export const learningKeys = (profileId: string) => [queueKey(profileId), pendingKey(profileId), skippedKey(profileId)];
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test -- src/lib/learning/protocol.test.ts src/lib/profiles/notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learning src/lib/profiles/notes.ts src/lib/profiles/notes.test.ts
git commit -m "Add the learning types, the /api/learn request schema and a note text helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Learning queue

**Files:**
- Create: `src/lib/learning/queue.ts`
- Test: `src/lib/learning/queue.test.ts`

**Interfaces:**
- Consumes: `KeyValue`, `memoryKeyValue` (`src/lib/profiles/kv.ts`); `queueKey` (Task 1); `QueuedLine` (Task 1).
- Produces: `QUEUE_MAX = 40`, `LINE_MAX_AGE_MS`, `BACKOFF_MS`; `class LearningQueue` with `static open(kv: KeyValue, profileId: string, now?: () => number): Promise<LearningQueue>`, `take(): QueuedLine[]`, `add(line: QueuedLine): Promise<void>`, `ack(ids: string[]): Promise<void>`, `fail(): Promise<void>`, `clear(): Promise<void>`; `clearQueues(kv: KeyValue, profileIds: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/learning/queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { memoryKeyValue, type KeyValue } from "@/lib/profiles/kv";
import { queueKey } from "./keys";
import { BACKOFF_MS, clearQueues, LearningQueue, LINE_MAX_AGE_MS, QUEUE_MAX } from "./queue";
import type { QueuedLine } from "./types";

const line = (id: string, at = 1_000): QueuedLine => ({ id, speaker: "partner", text: `line ${id}`, at });
const ids = (q: LearningQueue) => q.take().map((l) => l.id);

describe("LearningQueue", () => {
  it("keeps lines across a reload", async () => {
    const kv = memoryKeyValue();
    const q = await LearningQueue.open(kv, "p1", () => 2_000);
    await q.add(line("a"));
    expect(ids(await LearningQueue.open(kv, "p1", () => 2_000))).toEqual(["a"]);
    expect(ids(await LearningQueue.open(kv, "p2", () => 2_000))).toEqual([]);
  });

  it(`holds at most ${QUEUE_MAX} lines, dropping the oldest`, async () => {
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => 2_000);
    for (let i = 0; i < QUEUE_MAX + 5; i++) await q.add(line(`l${i}`));
    expect(q.take()).toHaveLength(QUEUE_MAX);
    expect(q.take()[0].id).toBe("l5");
  });

  it("drops lines older than a day", async () => {
    let now = 1_000;
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => now);
    await q.add(line("old", 1_000));
    now = 1_000 + LINE_MAX_AGE_MS + 1;
    await q.add(line("new", now));
    expect(ids(q)).toEqual(["new"]);
  });

  it("removes only the lines a batch sent", async () => {
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => 2_000);
    await q.add(line("a"));
    await q.add(line("b"));
    const sent = q.take();
    await q.add(line("c"));
    await q.ack(sent.slice(0, 1).map((l) => l.id));
    expect(ids(q)).toEqual(["b", "c"]);
  });

  it("waits 10 minutes after three failed batches in a row", async () => {
    let now = 0;
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => now);
    await q.add(line("a", 0));
    await q.fail();
    await q.fail();
    expect(ids(q)).toEqual(["a"]);
    await q.fail();
    expect(ids(q)).toEqual([]);
    now = BACKOFF_MS - 1;
    expect(ids(q)).toEqual([]);
    now = BACKOFF_MS;
    expect(ids(q)).toEqual(["a"]);
  });

  it("starts counting failures again after a batch goes through", async () => {
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => 2_000);
    await q.add(line("a"));
    await q.fail();
    await q.fail();
    await q.ack([]);
    await q.fail();
    expect(ids(q)).toEqual(["a"]);
  });

  it("clears one queue, or every profile's", async () => {
    const kv = memoryKeyValue();
    const q1 = await LearningQueue.open(kv, "p1", () => 2_000);
    await q1.add(line("a"));
    await q1.clear();
    expect(ids(q1)).toEqual([]);
    const q2 = await LearningQueue.open(kv, "p2", () => 2_000);
    await q2.add(line("b"));
    await clearQueues(kv, ["p1", "p2"]);
    expect(await kv.get(queueKey("p2"))).toBeUndefined();
  });

  it("keeps working when storage fails", async () => {
    const broken: KeyValue = {
      get: async () => {
        throw new Error("blocked");
      },
      set: async () => {
        throw new Error("full");
      },
      del: async () => {
        throw new Error("blocked");
      },
    };
    const q = await LearningQueue.open(broken, "p1", () => 2_000);
    await q.add(line("a"));
    expect(ids(q)).toEqual(["a"]);
    await expect(clearQueues(broken, ["p1"])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/learning/queue.test.ts`
Expected: FAIL. `./queue` can't be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/learning/queue.ts`:

```ts
import type { KeyValue } from "@/lib/profiles/kv";
import { queueKey } from "./keys";
import type { QueuedLine } from "./types";

export const QUEUE_MAX = 40;
export const LINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FAILURES_BEFORE_BACKOFF = 3;
export const BACKOFF_MS = 10 * 60 * 1000;

interface QueueState {
  version: 1;
  lines: QueuedLine[];
  failures: number;
  backoffUntil: number;
}

const EMPTY: QueueState = { version: 1, lines: [], failures: 0, backoffUntil: 0 };

/**
 * One profile's lines waiting to be learned from. Kept in memory and saved on every
 * change, so a reload doesn't lose them; if storage fails they still work for the visit.
 */
export class LearningQueue {
  private constructor(
    private readonly kv: KeyValue,
    private readonly key: string,
    private state: QueueState,
    private readonly now: () => number,
  ) {}

  static async open(kv: KeyValue, profileId: string, now: () => number = Date.now): Promise<LearningQueue> {
    const saved = await kv.get<QueueState>(queueKey(profileId)).catch(() => undefined);
    return new LearningQueue(kv, queueKey(profileId), saved?.version === 1 ? saved : EMPTY, now);
  }

  /** Lines young enough to send, oldest first; none while backing off after failures. */
  take(): QueuedLine[] {
    return this.now() < this.state.backoffUntil ? [] : this.fresh();
  }

  async add(line: QueuedLine): Promise<void> {
    await this.write({ ...this.state, lines: [...this.fresh(), line].slice(-QUEUE_MAX) });
  }

  /** A batch went through: its lines are done, and failures start counting again. */
  async ack(ids: string[]): Promise<void> {
    const sent = new Set(ids);
    await this.write({ ...this.state, lines: this.fresh().filter((l) => !sent.has(l.id)), failures: 0, backoffUntil: 0 });
  }

  /** A batch failed: its lines stay. After three failures in a row, wait before trying again. */
  async fail(): Promise<void> {
    const failures = this.state.failures + 1;
    if (failures < FAILURES_BEFORE_BACKOFF) await this.write({ ...this.state, failures });
    else await this.write({ ...this.state, failures: 0, backoffUntil: this.now() + BACKOFF_MS });
  }

  async clear(): Promise<void> {
    await this.write(EMPTY);
  }

  private fresh(): QueuedLine[] {
    const cutoff = this.now() - LINE_MAX_AGE_MS;
    return this.state.lines.filter((l) => l.at >= cutoff);
  }

  private async write(state: QueueState): Promise<void> {
    this.state = state;
    try {
      await this.kv.set(this.key, state);
    } catch {
      // Storage full or blocked: the queue still works for this visit.
    }
  }
}

/** Turning learning off empties every profile's queue, not only the open one. */
export async function clearQueues(kv: KeyValue, profileIds: string[]): Promise<void> {
  for (const id of profileIds) await kv.del(queueKey(id)).catch(() => {});
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/lib/learning/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learning/queue.ts src/lib/learning/queue.test.ts
git commit -m "Add the per-profile learning queue with age and size limits and a failure backoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Batcher

**Files:**
- Create: `src/lib/learning/batcher.ts`
- Test: `src/lib/learning/batcher.test.ts`

**Interfaces:**
- Consumes: `LearningQueue` (Task 2), `QueuedLine` (Task 1).
- Produces: `QUIET_MS = 60_000`, `BATCH_LINES = 12`, `MIN_LINES = 2`, `type SendResult = "sent" | "failed"`, `class Batcher { constructor(queue: LearningQueue, send: (lines: QueuedLine[]) => Promise<SendResult>); lineAdded(): void; pageHidden(): void; flush(): Promise<void>; dispose(): void }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/learning/batcher.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKeyValue } from "@/lib/profiles/kv";
import { Batcher, BATCH_LINES, QUIET_MS, type SendResult } from "./batcher";
import { LearningQueue } from "./queue";
import type { QueuedLine } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(result: SendResult = "sent") {
  const queue = await LearningQueue.open(memoryKeyValue(), "p1");
  const send = vi.fn<(lines: QueuedLine[]) => Promise<SendResult>>(async () => result);
  const batcher = new Batcher(queue, send);
  let n = 0;
  const add = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      await queue.add({ id: `l${n++}`, speaker: "partner", text: "hello", at: Date.now() });
      batcher.lineAdded();
    }
  };
  return { queue, send, batcher, add };
}

describe("Batcher", () => {
  it("sends after a minute with no new line", async () => {
    const { queue, send, add } = await setup();
    await add(2);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].map((l) => l.id)).toEqual(["l0", "l1"]);
    expect(queue.take()).toEqual([]);
  });

  it("doesn't send a single line", async () => {
    const { send, add } = await setup();
    await add(1);
    await vi.advanceTimersByTimeAsync(QUIET_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it("starts the wait again with each new line", async () => {
    const { send, add } = await setup();
    await add(2);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1_000);
    await add(1);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1_000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send.mock.calls[0][0]).toHaveLength(3);
  });

  it(`sends at once when ${BATCH_LINES} lines build up`, async () => {
    const { send, add } = await setup();
    await add(BATCH_LINES);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(BATCH_LINES);
  });

  it("sends when the page is hidden", async () => {
    const { send, batcher, add } = await setup();
    await add(2);
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the lines when a batch fails, and tries again after the next quiet minute", async () => {
    const { queue, send, batcher, add } = await setup("failed");
    await add(2);
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.take()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("counts a thrown error as a failed batch", async () => {
    const { queue, send, batcher, add } = await setup();
    send.mockRejectedValueOnce(new Error("offline"));
    await add(2);
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.take()).toHaveLength(2);
  });

  it("sends one batch at a time, then waits a quiet minute for lines that came in meanwhile", async () => {
    const { send, batcher, add } = await setup();
    let release!: (r: SendResult) => void;
    send.mockImplementationOnce(() => new Promise<SendResult>((r) => (release = r)));
    await add(2);
    batcher.pageHidden();
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await add(2);
    release("sent");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].map((l) => l.id)).toEqual(["l2", "l3"]);
  });

  it("stops when disposed", async () => {
    const { send, batcher, add } = await setup();
    await add(2);
    batcher.dispose();
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/learning/batcher.test.ts`
Expected: FAIL. `./batcher` can't be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/learning/batcher.ts`:

```ts
import type { LearningQueue } from "./queue";
import type { QueuedLine } from "./types";

export const QUIET_MS = 60_000;
export const BATCH_LINES = 12;
export const MIN_LINES = 2;

export type SendResult = "sent" | "failed";

/** Decides when queued lines go out: after a quiet minute, at 12 lines, or when the page is hidden. One batch at a time. */
export class Batcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly queue: LearningQueue,
    private readonly send: (lines: QueuedLine[]) => Promise<SendResult>,
  ) {}

  /** Call after each line is queued. */
  lineAdded(): void {
    if (this.disposed) return;
    if (this.queue.take().length >= BATCH_LINES) void this.flush();
    else this.restartTimer();
  }

  pageHidden(): void {
    void this.flush();
  }

  flush(): Promise<void> {
    this.stopTimer();
    if (this.disposed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const lines = this.queue.take();
    if (lines.length < MIN_LINES) return Promise.resolve();
    this.inFlight = this.run(lines).finally(() => {
      this.inFlight = null;
      // Lines that arrived while this batch was out get their own quiet wait.
      if (!this.disposed && this.queue.take().length > 0) this.restartTimer();
    });
    return this.inFlight;
  }

  /** Stops the timer. A batch already sent still finishes and writes to its own profile. */
  dispose(): void {
    this.disposed = true;
    this.stopTimer();
  }

  private async run(lines: QueuedLine[]): Promise<void> {
    let result: SendResult;
    try {
      result = await this.send(lines);
    } catch {
      result = "failed";
    }
    if (result === "sent") await this.queue.ack(lines.map((l) => l.id));
    else await this.queue.fail();
  }

  private restartTimer(): void {
    this.stopTimer();
    this.timer = setTimeout(() => void this.flush(), QUIET_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/lib/learning/batcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learning/batcher.ts src/lib/learning/batcher.test.ts
git commit -m "Send queued lines after a quiet minute, at 12 lines, or when the page is hidden

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prompt, dates and parsing

**Files:**
- Create: `src/lib/learning/prompt.ts`
- Test: `src/lib/learning/prompt.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (`src/lib/suggest/prompt.ts`), `createObjectSplitter` (`src/lib/suggest/protocol.ts`), `NOTE_MAX`, `LearnRequest`, `PROPOSALS_MAX` (Task 1).
- Produces: `localIsoDate(d: Date): string`; `longDate(iso: string, days?: number, withYear?: boolean): string`; `comingDays(today: string): { offset: number; weekday: string; day: number; month: string }[]` (today and the next 14 days); `dateLine(today: string): string`; `buildLearnMessages(req: LearnRequest): ChatMessage[]`; `interface RawProposal { action: "add" | "edit"; kind: NoteKind; name?: string; text: string; note?: string; lines: string[] }`; `parseProposals(output: string): RawProposal[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/learning/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLearnMessages, comingDays, dateLine, localIsoDate, longDate, parseProposals } from "./prompt";

describe("dates", () => {
  it("writes the user's local calendar date", () => {
    expect(localIsoDate(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
  });

  it("names days in full, across months and years", () => {
    expect(longDate("2026-09-30", 0, true)).toBe("Wednesday 30 September 2026");
    expect(longDate("2026-09-30", 1)).toBe("Thursday 1 October");
    expect(longDate("2026-12-31", 1)).toBe("Friday 1 January");
  });

  it("gives today and the next 14 days as parts", () => {
    const days = comingDays("2026-09-30");
    expect(days).toHaveLength(15);
    expect(days[0]).toEqual({ offset: 0, weekday: "Wednesday", day: 30, month: "September" });
    expect(days[14]).toEqual({ offset: 14, weekday: "Wednesday", day: 14, month: "October" });
  });

  it("lists today and the next 14 days", () => {
    const line = dateLine("2026-09-30");
    expect(line.startsWith("Today is Wednesday 30 September 2026. Coming days: Thursday 1 October, Friday 2 October,")).toBe(true);
    expect(line.endsWith("Wednesday 14 October.")).toBe(true);
  });
});

describe("buildLearnMessages", () => {
  it("shows ids, who said each line, the notes and the dates", () => {
    const [system, user] = buildLearnMessages({
      today: "2026-09-30",
      lines: [
        { id: "L1", speaker: "partner", text: "Your physio moved to Thursdays.", partnerName: "Leila", placeName: "Home" },
        { id: "L2", speaker: "user", text: "Thanks, noted." },
      ],
      notes: [{ id: "N1", kind: "routine", text: "I have physio on Tuesdays at 10:30." }],
    });
    expect(system.role).toBe("system");
    expect(user.content).toContain("L1 Leila (at Home): Your physio moved to Thursdays.");
    expect(user.content).toContain("L2 Me: Thanks, noted.");
    expect(user.content).toContain("N1 (routine): I have physio on Tuesdays at 10:30.");
    expect(user.content).toContain("Today is Wednesday 30 September 2026.");
  });

  it("says when there are no notes", () => {
    const [, user] = buildLearnMessages({ today: "2026-09-30", lines: [{ id: "L1", speaker: "user", text: "Hi" }], notes: [] });
    expect(user.content).toContain("(none)");
  });
});

describe("parseProposals", () => {
  it("reads one proposal per line", () => {
    const out = [
      '{"action": "add", "kind": "person", "name": "Ana", "text": "Ana is my new carer.", "lines": ["L1"]}',
      '{"action": "edit", "note": "N1", "kind": "routine", "text": "I have physio on Thursdays at 10:30.", "lines": ["L2"]}',
    ].join("\n");
    expect(parseProposals(out)).toEqual([
      { action: "add", kind: "person", name: "Ana", text: "Ana is my new carer.", lines: ["L1"] },
      { action: "edit", kind: "routine", note: "N1", text: "I have physio on Thursdays at 10:30.", lines: ["L2"] },
    ]);
  });

  it("reads pretty-printed, fenced output after some reasoning", () => {
    const out = 'Here are the notes:\n```json\n{\n  "action": "add",\n  "kind": "preference",\n  "text": "I like green tea.",\n  "lines": ["L3"]\n}\n```';
    expect(parseProposals(out)).toEqual([{ action: "add", kind: "preference", text: "I like green tea.", lines: ["L3"] }]);
  });

  it("skips anything malformed", () => {
    const out = [
      '{"action": "add", "kind": "friend", "text": "x", "lines": ["L1"]}',
      '{"action": "edit", "kind": "routine", "text": "no note id", "lines": ["L1"]}',
      '{"action": "add", "kind": "routine", "text": "no lines", "lines": []}',
      '{"action": "add", "kind": "routine", "text": "   ", "lines": ["L1"]}',
      `{"action": "add", "kind": "routine", "text": "${"x".repeat(301)}", "lines": ["L1"]}`,
      '{"action": "remove", "kind": "routine", "text": "x", "lines": ["L1"]}',
      "{not json}",
    ].join("\n");
    expect(parseProposals(out)).toEqual([]);
  });

  it("keeps at most five", () => {
    const one = '{"action": "add", "kind": "routine", "text": "x", "lines": ["L1"]}';
    expect(parseProposals(Array(7).fill(one).join("\n"))).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/learning/prompt.test.ts`
Expected: FAIL. `./prompt` can't be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/learning/prompt.ts`:

```ts
import { NOTE_MAX } from "@/lib/profiles/notes";
import type { ChatMessage } from "@/lib/suggest/prompt";
import { createObjectSplitter } from "@/lib/suggest/protocol";
import type { NoteKind } from "@/lib/types";
import { PROPOSALS_MAX, type LearnRequest } from "./protocol";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KINDS: NoteKind[] = ["about-me", "person", "place", "routine", "preference"];

const pad = (n: number) => String(n).padStart(2, "0");

/** The user's local calendar date as YYYY-MM-DD. */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Thursday 1 October", `days` after a YYYY-MM-DD date. Calendar arithmetic in UTC, so no time zone moves the day. */
export function longDate(iso: string, days = 0, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const text = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return withYear ? `${text} ${date.getUTCFullYear()}` : text;
}

/** Today (offset 0) and the next 14 days, as parts, for checking a date the model wrote. */
export function comingDays(today: string): { offset: number; weekday: string; day: number; month: string }[] {
  return Array.from({ length: 15 }, (_, offset) => {
    const [weekday, day, month] = longDate(today, offset).split(" ");
    return { offset, weekday, day: Number(day), month };
  });
}

/** Today and the next 14 days in full, so the model can write "Thursday" as its date. */
export function dateLine(today: string): string {
  const coming = Array.from({ length: 14 }, (_, i) => longDate(today, i + 1));
  return `Today is ${longDate(today, 0, true)}. Coming days: ${coming.join(", ")}.`;
}

function who(line: LearnRequest["lines"][number]): string {
  const name = line.speaker === "user" ? "Me" : (line.partnerName ?? "Them");
  return line.placeName ? `${name} (at ${line.placeName})` : name;
}

export function buildLearnMessages(req: LearnRequest): ChatMessage[] {
  const prompt = [
    "A person who cannot speak uses an app that suggests replies for them. Below are lines from their recent conversations and the notes the app already has about them. Suggest notes to add or change, so future replies know about new facts.",
    "",
    dateLine(req.today),
    "",
    "Notes the app has:",
    req.notes.length ? req.notes.map((n) => `${n.id} (${n.kind}): ${n.text}`).join("\n") : "(none)",
    "",
    'Conversation lines ("Me" is the person; lines from others are automatic captions and can be misheard):',
    req.lines.map((l) => `${l.id} ${who(l)}: ${l.text}`).join("\n"),
    "",
    "Rules:",
    "- Only facts the lines state. Never guess, and never add a detail that isn't in a line or a note.",
    "- Keep facts about the person and their people, places, routines, likes and dislikes, and plans with a date.",
    `- Write each note in first person as the person ("My physio is on Thursdays at 10:30."). At most ${NOTE_MAX} characters.`,
    '- Write a dated plan with its full date from the list above ("Dentist on Thursday 1 October at 3pm."), never "tomorrow" or "next week".',
    "- Skip small talk, questions, guesses, jokes, and things with no later use (today's weather, what's for lunch today).",
    "- Skip anything a note already says.",
    '- If a line changes or adds to what a note says, change that note: "action": "edit", its id in "note", and the whole new text, keeping the rest of its wording.',
    "- Leave out facts about other people unless they matter to the person (who someone is to them, when they visit).",
    "- Skip a caption that doesn't make sense.",
    "- kind is one of: about-me (who they are, health, how they communicate), person (someone in their life; give their name), place (somewhere they go; give its name), routine (regular events and times), preference (likes, dislikes, usual orders).",
    `- At most ${PROPOSALS_MAX} notes, most useful first. If nothing is worth keeping, output nothing.`,
    "",
    "Output format: one JSON object per line and nothing else. No markdown.",
    '{"action": "add", "kind": "person", "name": "Ana", "text": "Ana is my new carer. She comes on weekday mornings.", "lines": ["L1"]}',
    '{"action": "edit", "note": "N2", "kind": "routine", "text": "I have physio on Thursdays at 10:30.", "lines": ["L4"]}',
  ].join("\n");
  return [
    { role: "system", content: "You keep short notes about a person up to date from their conversations. Follow the output format exactly." },
    { role: "user", content: prompt },
  ];
}

export interface RawProposal {
  action: "add" | "edit";
  kind: NoteKind;
  name?: string;
  text: string;
  /** The note id an edit changes, as the model saw it. */
  note?: string;
  /** Line ids as the model saw them. */
  lines: string[];
}

/** Proposals in the model's output, however it is laid out. Malformed ones are skipped, never repaired. */
export function parseProposals(output: string): RawProposal[] {
  const found: RawProposal[] = [];
  const splitter = createObjectSplitter((json) => {
    if (found.length >= PROPOSALS_MAX) return;
    let item: unknown;
    try {
      item = JSON.parse(json);
    } catch {
      return;
    }
    if (!item || typeof item !== "object") return;
    const { action, kind, name, text, note, lines } = item as Record<string, unknown>;
    if (action !== "add" && action !== "edit") return;
    if (!KINDS.includes(kind as NoteKind)) return;
    if (typeof text !== "string" || !text.trim() || text.trim().length > NOTE_MAX) return;
    if (!Array.isArray(lines) || lines.length === 0 || !lines.every((l) => typeof l === "string")) return;
    if (action === "edit" && typeof note !== "string") return;
    found.push({
      action,
      kind: kind as NoteKind,
      ...(typeof name === "string" && name.trim() ? { name: name.trim().slice(0, 60) } : {}),
      text: text.trim(),
      ...(action === "edit" ? { note: note as string } : {}),
      lines: lines as string[],
    });
  });
  splitter.push(output);
  splitter.flush();
  return found;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/lib/learning/prompt.test.ts`
Expected: PASS. If the `toEqual` on the first parse test fails only on key order, it doesn't matter to `toEqual`. A real mismatch means the parser is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learning/prompt.ts src/lib/learning/prompt.test.ts
git commit -m "Add the learning prompt, full-date helpers and a tolerant proposal parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Proposal checks

**Files:**
- Create: `src/lib/learning/check.ts`
- Test: `src/lib/learning/check.test.ts`

**Interfaces:**
- Consumes: `composeNoteText` (Task 1), `extractClaims`, `claimSupported`, `isNearDuplicate` (`src/lib/suggest/validate.ts`), `tokenize` (`src/lib/text.ts`), `comingDays` (Task 4), `LearnRequest`, `Proposal` (Task 1).
- Produces: `checkProposals(proposals: Proposal[], req: LearnRequest): Proposal[]`. An add in the result never has `noteId`.

**Dates, and why not the spec's date line:** the spec said to accept a converted date by adding the 14-day date line to the sources. That list holds the day numbers 1 to 14 and 30, so any small invented number ("4pm") would pass. Instead, a full date in a proposal ("Thursday 1 October", or "1 October") is accepted only when it is one of the coming 15 days and a cited line names that weekday, or says "tomorrow" (offset 1) or "today"/"tonight" (offset 0). The date is then taken out of the text before the usual claim check, which uses only the cited lines, their partner and place names, and the sent notes. The spec's decision 10 already says this.

- [ ] **Step 1: Write the failing test**

Create `src/lib/learning/check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkProposals } from "./check";
import type { LearnRequest, Proposal } from "./protocol";

const req: LearnRequest = {
  today: "2026-09-30",
  lines: [
    { id: "a", speaker: "partner", text: "Your physio moved to Thursdays, same time.", partnerName: "Leila" },
    { id: "b", speaker: "user", text: "My new carer Ana starts on Monday." },
    { id: "c", speaker: "partner", text: "The dentist can see you on Thursday at 3." },
    { id: "d", speaker: "partner", text: "Your haircut is tomorrow at 2." },
  ],
  notes: [
    { id: "me", kind: "about-me", text: "I'm Maya. I type to talk." },
    { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30." },
  ],
};

const add = (text: string, lineIds = ["b"], extra: Partial<Proposal> = {}): Proposal => ({ action: "add", kind: "routine", text, lineIds, ...extra });
const edit = (text: string, noteId = "physio", lineIds = ["a"]): Proposal => ({ action: "edit", kind: "routine", noteId, text, lineIds });

describe("checkProposals", () => {
  it("keeps a new note backed by its line", () => {
    const p = add("Ana is my new carer. She starts on Monday.", ["b"], { kind: "person", name: "Ana" });
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("keeps an edit backed by its line and the old note", () => {
    const p = edit("I have physio on Thursdays at 10:30.");
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("accepts a day turned into its full date", () => {
    const p = add("Dentist on Thursday 1 October at 3pm.", ["c"]);
    expect(checkProposals([p], req)).toEqual([p]);
    const short = add("Dentist on 1 October at 3pm.", ["c"]);
    expect(checkProposals([short], req)).toEqual([short]);
  });

  it("accepts tomorrow turned into its date", () => {
    const p = add("Haircut on Thursday 1 October at 2pm.", ["d"]);
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("drops a date the cited line doesn't name, or one outside the coming two weeks", () => {
    expect(checkProposals([add("Dentist on Friday 2 October at 3pm.", ["c"])], req)).toEqual([]);
    expect(checkProposals([add("Haircut on Friday 2 October at 2pm.", ["d"])], req)).toEqual([]);
    expect(checkProposals([add("Dentist on Thursday 22 October at 3pm.", ["c"])], req)).toEqual([]);
  });

  it("accepts the partner's name from the line", () => {
    const p = add("Leila told me my physio moved to Thursdays.", ["a"]);
    expect(checkProposals([p], req)).toEqual([p]);
  });

  it("drops an invented time or name, even a number that is also a day of the month", () => {
    expect(checkProposals([add("Dentist on Thursday at 4pm.", ["c"])], req)).toEqual([]);
    expect(checkProposals([add("Dentist on Thursday 1 October at 4pm.", ["c"])], req)).toEqual([]);
    expect(checkProposals([add("Anna is my new carer.", ["b"], { kind: "person", name: "Anna" })], req)).toEqual([]);
  });

  it("drops a detail that is only in a line the proposal doesn't cite", () => {
    expect(checkProposals([add("My new carer Ana starts on Monday.", ["c"])], req)).toEqual([]);
  });

  it("drops a proposal citing a line that wasn't sent", () => {
    expect(checkProposals([add("Ana is my carer.", ["zzz"])], req)).toEqual([]);
    expect(checkProposals([add("Ana is my carer.", ["b", "zzz"])], req)).toEqual([]);
  });

  it("drops an edit of a note that wasn't sent, or one that changes nothing", () => {
    expect(checkProposals([edit("I have physio on Thursdays at 10:30.", "other")], req)).toEqual([]);
    expect(checkProposals([edit("I have physio on Tuesdays at 10:30!")], req)).toEqual([]);
  });

  it("drops a new note that repeats a note or an earlier proposal", () => {
    expect(checkProposals([add("I have physio on Tuesdays at 10:30", ["a"])], req)).toEqual([]);
    const first = add("Ana is my new carer.", ["b"]);
    expect(checkProposals([first, add("Ana is my new carer!", ["b"])], req)).toEqual([first]);
  });

  it("keeps only the first edit of a note", () => {
    const first = edit("I have physio on Thursdays at 10:30.");
    expect(checkProposals([first, edit("Physio moved to Thursdays at 10:30.")], req)).toEqual([first]);
  });

  it("never lets a new note carry a note id", () => {
    const [kept] = checkProposals([add("Ana is my new carer.", ["b"], { noteId: "physio" })], req);
    expect(kept).not.toHaveProperty("noteId");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/learning/check.test.ts`
Expected: FAIL. `./check` can't be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/learning/check.ts`:

```ts
import { composeNoteText } from "@/lib/profiles/notes";
import { claimSupported, extractClaims, isNearDuplicate } from "@/lib/suggest/validate";
import { tokenize } from "@/lib/text";
import { comingDays } from "./prompt";
import type { LearnRequest, Proposal } from "./protocol";

const sameWords = (a: string, b: string) => tokenize(a).join(" ") === tokenize(b).join(" ");

/**
 * Takes out the full dates ("Thursday 1 October", "1 October") a model wrote for a day its
 * lines named. Null when a date isn't one of the coming days, or no cited line names it
 * (its weekday, or "tomorrow"/"today"/"tonight" for those days).
 */
function withoutNamedDates(text: string, lineText: string, today: string): string | null {
  const said = lineText.toLowerCase();
  let rest = text;
  for (const d of comingDays(today)) {
    const date = new RegExp(`\\b(?:${d.weekday}\\s+)?${d.day}(?:st|nd|rd|th)?\\s+${d.month}\\b`, "gi");
    if (!date.test(rest)) continue;
    const named =
      said.includes(d.weekday.toLowerCase()) || (d.offset === 1 && /\btomorrow\b/.test(said)) || (d.offset === 0 && /\b(?:today|tonight)\b/.test(said));
    if (!named) return null;
    rest = rest.replace(date, " ");
  }
  // A month written with a day that isn't one of the coming days is a date the model made up.
  const MONTHS = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
  return MONTHS.test(rest) ? null : rest;
}

/**
 * Drops, never repairs, a proposal that cites no line or one that wasn't sent; edits a
 * note that wasn't sent, or into the same words; repeats a sent note or an earlier
 * proposal; writes a date its lines don't name; or states a detail (name, number, time,
 * day) found in none of its cited lines and the sent notes. Only the first edit of each
 * note stays.
 */
export function checkProposals(proposals: Proposal[], req: LearnRequest): Proposal[] {
  const lines = new Map(req.lines.map((l) => [l.id, l]));
  const notes = new Map(req.notes.map((n) => [n.id, n.text]));
  const kept: Proposal[] = [];
  const keptTexts: string[] = [];

  for (const p of proposals) {
    if (p.lineIds.length === 0 || !p.lineIds.every((id) => lines.has(id))) continue;
    const text = composeNoteText({ kind: p.kind, name: p.name, text: p.text });
    if (!text) continue;

    if (p.action === "edit") {
      const oldText = notes.get(p.noteId ?? "");
      if (oldText === undefined || sameWords(text, oldText)) continue;
      if (kept.some((k) => k.action === "edit" && k.noteId === p.noteId)) continue;
    } else if ([...notes.values(), ...keptTexts].some((t) => isNearDuplicate(text, t))) {
      continue;
    }

    const cited = p.lineIds.map((id) => {
      const l = lines.get(id)!;
      return [l.text, l.partnerName ?? "", l.placeName ?? ""].join("\n");
    });
    const checked = withoutNamedDates(text, cited.join("\n"), req.today);
    if (checked === null) continue;
    const sources = [...cited, ...notes.values()].join("\n");
    if (!extractClaims(checked).every((claim) => claimSupported(claim, sources))) continue;

    kept.push(
      p.action === "edit" ? p : { action: "add", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, lineIds: p.lineIds },
    );
    keptTexts.push(text);
  }
  return kept;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/lib/learning/check.test.ts`
Expected: PASS. If a date test fails, print `withoutNamedDates`'s result and `extractClaims` of it. The remaining claims should be only words and numbers from the cited line ("Dentist", "3"). Fix the regex, not the test, unless the test data is wrong. Don't loosen the check.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learning/check.ts src/lib/learning/check.test.ts
git commit -m "Drop learned notes that invent a detail, cite unknown lines or repeat a note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `/api/learn` route

**Files:**
- Create: `src/lib/learning/server.ts`, `src/app/api/learn/route.ts`
- Test: `src/app/api/learn/route.test.ts`

**Interfaces:**
- Consumes: `streamCompletion`, `providerConfigs`, `createCooldown`, `AllProvidersFailedError`, `StreamOptions` (`src/lib/server/providers.ts`); `isSameOrigin`, `clientIp`, `json` (`src/lib/server/guard.ts`, from PR #10); `createRateLimiter` (`src/lib/server/rate-limit.ts`); `buildLearnMessages`, `parseProposals` (Task 4); `checkProposals` (Task 5); `LearnRequestSchema`, `LearnRequest`, `Proposal` (Task 1).
- Produces:
  - `learnFromBatch(req: LearnRequest, opts: LearnStreamOptions): Promise<Proposal[]>` with `type LearnStreamOptions = Pick<StreamOptions, "order" | "configs" | "cooldown" | "signal" | "fetchImpl">`. It throws `AllProvidersFailedError` when no provider answers or the stream is cut.
  - `POST /api/learn`: body `LearnRequest`, response `200 { proposals: Proposal[] }` or `{ error }` with 400, 403, 413, 429 or 503.
  - Env `LEARN_MODEL` (optional) overrides the Groq model for this route only.

- [ ] **Step 1: Read the Next.js route handler guide**

Run: `ls node_modules/next/dist/docs/` and read the route handlers guide there (the file whose name mentions route handlers). Confirm that `export async function POST(request: Request)` in `app/api/learn/route.ts` is still the convention. Follow any deprecation notice.

- [ ] **Step 2: Write the failing test**

Create `src/app/api/learn/route.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamCompletion = vi.fn();
vi.mock("@/lib/server/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/server/providers")>()), streamCompletion }));

async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

const body = {
  today: "2026-09-30",
  lines: [
    { id: "line-uuid-1", speaker: "user", text: "My new carer Ana starts on Monday." },
    { id: "line-uuid-2", speaker: "partner", text: "Nice weather today." },
  ],
  notes: [{ id: "note-uuid-1", kind: "about-me", text: "I'm Maya." }],
};

let ipCount = 0;
function post(data: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/learn", {
    method: "POST",
    body: typeof data === "string" ? data : JSON.stringify(data),
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost", "x-forwarded-for": `10.1.0.${++ipCount}`, ...headers },
  });
}

describe("POST /api/learn", () => {
  beforeEach(() => streamCompletion.mockReset());

  it("returns checked proposals with the browser's ids, sending the model short ones", async () => {
    streamCompletion.mockResolvedValue({
      provider: "groq",
      deltas: chunks('{"action": "add", "kind": "person", "name": "Ana", ', '"text": "Ana is my new carer. She starts on Monday.", "lines": ["L1"]}\n'),
    });
    const { POST } = await import("./route");
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      proposals: [{ action: "add", kind: "person", name: "Ana", text: "Ana is my new carer. She starts on Monday.", lineIds: ["line-uuid-1"] }],
    });
    const sent = streamCompletion.mock.calls[0][0].at(-1).content as string;
    expect(sent).toContain("L1 Me: My new carer Ana starts on Monday.");
    expect(sent).toContain("N1 (about-me): I'm Maya.");
    expect(sent).not.toContain("line-uuid-1");
    expect(streamCompletion.mock.calls[0][1]).toMatchObject({ order: ["groq", "cloudflare"], temperature: 0.2 });
  });

  it("drops a proposal with an invented detail or an unknown line", async () => {
    streamCompletion.mockResolvedValue({
      provider: "groq",
      deltas: chunks(
        '{"action": "add", "kind": "person", "name": "Ana", "text": "Ana is my new carer. She starts on Tuesday.", "lines": ["L1"]}\n',
        '{"action": "add", "kind": "routine", "text": "My new carer starts on Monday.", "lines": ["L9"]}\n',
      ),
    });
    const { POST } = await import("./route");
    expect(await (await POST(post(body))).json()).toEqual({ proposals: [] });
  });

  it("refuses other sites, bad bodies and big bodies without calling the model", async () => {
    const { POST } = await import("./route");
    expect((await POST(post(body, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post("{not json"))).status).toBe(400);
    expect((await POST(post({ ...body, lines: [] }))).status).toBe(400);
    expect((await POST(post("x".repeat(70_000)))).status).toBe(413);
    expect(streamCompletion).not.toHaveBeenCalled();
  });

  it("limits each address to 6 batches a minute", async () => {
    streamCompletion.mockImplementation(async () => ({ provider: "groq", deltas: chunks("") }));
    const { POST } = await import("./route");
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await POST(post(body, { "x-forwarded-for": "10.9.9.8" }))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });

  it("says when the AI is unavailable, before or during the answer", async () => {
    const { AllProvidersFailedError } = await import("@/lib/server/providers");
    const { POST } = await import("./route");
    streamCompletion.mockRejectedValueOnce(new AllProvidersFailedError("down"));
    expect((await POST(post(body))).status).toBe(503);
    async function* broken() {
      yield '{"action": "add", ';
      throw new Error("stream cut");
    }
    streamCompletion.mockResolvedValueOnce({ provider: "groq", deltas: broken() });
    expect((await POST(post(body))).status).toBe(503);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- src/app/api/learn/route.test.ts`
Expected: FAIL. `./route` can't be resolved.

- [ ] **Step 4: Implement**

Create `src/lib/learning/server.ts`:

```ts
import { AllProvidersFailedError, streamCompletion, type StreamOptions } from "@/lib/server/providers";
import { checkProposals } from "./check";
import { buildLearnMessages, parseProposals } from "./prompt";
import type { LearnRequest, Proposal } from "./protocol";

export type LearnStreamOptions = Pick<StreamOptions, "order" | "configs" | "cooldown" | "signal" | "fetchImpl">;

/**
 * One batch. The model sees short ids (L1, N1) instead of the browser's long ones,
 * which saves tokens and copying mistakes; its proposals are mapped back and checked.
 * An id the model made up maps to one no line or note has, so the check drops it.
 */
export async function learnFromBatch(req: LearnRequest, opts: LearnStreamOptions): Promise<Proposal[]> {
  const lineIds = new Map(req.lines.map((l, i) => [`L${i + 1}`, l.id]));
  const noteIds = new Map(req.notes.map((n, i) => [`N${i + 1}`, n.id]));
  const short: LearnRequest = {
    today: req.today,
    lines: req.lines.map((l, i) => ({ ...l, id: `L${i + 1}` })),
    notes: req.notes.map((n, i) => ({ ...n, id: `N${i + 1}` })),
  };
  const { deltas } = await streamCompletion(buildLearnMessages(short), {
    ...opts,
    maxTokens: 1200,
    temperature: 0.2,
    firstTokenTimeoutMs: 10_000,
    idleTimeoutMs: 10_000,
  });
  let output = "";
  try {
    for await (const delta of deltas) output += delta;
  } catch (err) {
    // A cut-off answer is retried whole later, like a provider that never answered.
    throw new AllProvidersFailedError(`stream cut: ${err instanceof Error ? err.message : String(err)}`);
  }
  const proposals: Proposal[] = parseProposals(output).map((p) => ({
    action: p.action,
    kind: p.kind,
    ...(p.name ? { name: p.name } : {}),
    text: p.text,
    ...(p.note ? { noteId: noteIds.get(p.note) ?? `unknown:${p.note}` } : {}),
    lineIds: p.lines.map((id) => lineIds.get(id) ?? `unknown:${id}`),
  }));
  return checkProposals(proposals, req);
}
```

Create `src/app/api/learn/route.ts`:

```ts
import { LearnRequestSchema } from "@/lib/learning/protocol";
import { learnFromBatch } from "@/lib/learning/server";
import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { AllProvidersFailedError, createCooldown, providerConfigs } from "@/lib/server/providers";
import { createRateLimiter } from "@/lib/server/rate-limit";

/** 40 lines of 500 characters and 9 notes of 300 fit well under this. */
const BODY_MAX = 64_000;
// A browser sends a batch at most every few minutes; this leaves room for a few tabs.
const limiter = createRateLimiter({ limit: 6, windowMs: 60_000 });
const cooldown = createCooldown();

/**
 * Suggested notes: recent conversation lines and the notes they relate to go to the
 * model, which proposes new or changed notes. Nothing is stored here, and neither the
 * lines nor the notes are logged. The user confirms every proposal in the browser.
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
  const parsed = LearnRequestSchema.safeParse(data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const env = process.env;
  const configs = providerConfigs({ ...env, GROQ_MODEL: env.LEARN_MODEL ?? env.GROQ_MODEL });
  try {
    const proposals = await learnFromBatch(parsed.data, { order: ["groq", "cloudflare"], configs, cooldown, signal: request.signal });
    return json({ proposals }, 200);
  } catch (err) {
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- src/app/api/learn/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint and commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add src/lib/learning/server.ts src/app/api/learn
git commit -m "Add /api/learn: short ids for the model, checked proposals back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pending suggestions store

**Files:**
- Create: `src/lib/learning/pending.ts`
- Test: `src/lib/learning/pending.test.ts`

**Interfaces:**
- Consumes: `KeyValue` (`src/lib/profiles/kv.ts`), `composeNoteText` (Task 1), `isNearDuplicate` (`src/lib/suggest/validate.ts`), `tokenize` (`src/lib/text.ts`), `pendingKey`, `skippedKey` (Task 1), `PendingSuggestion` (Task 1), `Note` (`src/lib/types.ts`).
- Produces: `PENDING_MAX = 30`, `SKIPPED_MAX = 200`; `class PendingStore` with `static open(kv: KeyValue, profileId: string): Promise<PendingStore>`, `list(): PendingSuggestion[]` (newest first), `onChange(cb: () => void): () => void`, `merge(incoming: PendingSuggestion[], notes: Note[]): Promise<number>`, `remove(id: string): Promise<void>`, `skip(id: string): Promise<void>`, `skipAll(): Promise<void>`, `replaceAll(items: PendingSuggestion[]): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/learning/pending.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { memoryKeyValue, type KeyValue } from "@/lib/profiles/kv";
import type { Note } from "@/lib/types";
import { PENDING_MAX, PendingStore } from "./pending";
import type { PendingSuggestion } from "./types";

const sug = (id: string, text: string, extra: Partial<PendingSuggestion> = {}): PendingSuggestion => ({
  id,
  action: "add",
  draft: { kind: "routine", text },
  sources: [{ speaker: "partner", text: "source line", at: 1 }],
  createdAt: 1,
  ...extra,
});
const notes: Note[] = [{ id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 1 }];
const ids = (s: PendingStore) => s.list().map((p) => p.id);

describe("PendingStore", () => {
  it("adds newest first, keeping a batch in its own order, and keeps them across a reload", async () => {
    const kv = memoryKeyValue();
    const store = await PendingStore.open(kv, "p1");
    expect(await store.merge([sug("a1", "I like green tea."), sug("a2", "My sister Hana visits on Sundays.")], notes)).toBe(2);
    await store.merge([sug("b", "My dentist is Dr Osei.")], notes);
    expect(ids(store)).toEqual(["b", "a1", "a2"]);
    expect(ids(await PendingStore.open(kv, "p1"))).toEqual(["b", "a1", "a2"]);
  });

  it("drops a new note that repeats an existing note, and an edit that is already applied", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    const repeat = sug("r", "I have physio on Tuesdays at 10:30");
    const applied = sug("e", "I have physio on Tuesdays at 10:30.", { action: "edit", noteId: "physio" });
    expect(await store.merge([repeat, applied], notes)).toBe(0);
    expect(ids(store)).toEqual([]);
  });

  it("replaces a waiting edit of the same note, and a near copy of a waiting suggestion", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    await store.merge([sug("e1", "I have physio on Wednesdays at 10:30.", { action: "edit", noteId: "physio" }), sug("t1", "I like green tea.")], notes);
    await store.merge([sug("e2", "I have physio on Thursdays at 10:30.", { action: "edit", noteId: "physio" }), sug("t2", "I like green tea!")], notes);
    expect(ids(store)).toEqual(["e2", "t2"]);
  });

  it(`keeps at most ${PENDING_MAX}`, async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    for (let i = 0; i < PENDING_MAX + 3; i++) await store.merge([sug(`s${i}`, `Fact number ${i} about zebra${i}.`)], notes);
    expect(store.list()).toHaveLength(PENDING_MAX);
    expect(store.list()[0].id).toBe(`s${PENDING_MAX + 2}`);
  });

  it("remembers what was skipped, so it isn't suggested again", async () => {
    const kv = memoryKeyValue();
    const store = await PendingStore.open(kv, "p1");
    await store.merge([sug("a", "I like green tea."), sug("b", "My sister Hana visits on Sundays.")], notes);
    await store.skip("a");
    expect(ids(store)).toEqual(["b"]);
    const again = await PendingStore.open(kv, "p1");
    expect(await again.merge([sug("a2", "I like green tea!")], notes)).toBe(0);
    await again.skipAll();
    expect(ids(again)).toEqual([]);
    expect(await again.merge([sug("b2", "My sister Hana visits on Sundays.")], notes)).toBe(0);
  });

  it("removes a kept suggestion without remembering it as skipped", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    await store.merge([sug("a", "I like green tea.")], notes);
    await store.remove("a");
    expect(await store.merge([sug("a2", "I like green tea.")], notes)).toBe(1);
  });

  it("tells listeners about every change", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    const cb = vi.fn();
    const off = store.onChange(cb);
    await store.merge([sug("a", "I like green tea.")], notes);
    await store.skip("a");
    await store.replaceAll([sug("b", "x")]);
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    await store.remove("b");
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("keeps working when storage fails", async () => {
    const broken: KeyValue = {
      get: async () => {
        throw new Error("blocked");
      },
      set: async () => {
        throw new Error("full");
      },
      del: async () => {},
    };
    const store = await PendingStore.open(broken, "p1");
    await store.merge([sug("a", "I like green tea.")], notes);
    expect(ids(store)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/learning/pending.test.ts`
Expected: FAIL. `./pending` can't be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/learning/pending.ts`:

```ts
import type { KeyValue } from "@/lib/profiles/kv";
import { composeNoteText } from "@/lib/profiles/notes";
import { isNearDuplicate } from "@/lib/suggest/validate";
import { tokenize } from "@/lib/text";
import type { Note } from "@/lib/types";
import { pendingKey, skippedKey } from "./keys";
import type { PendingSuggestion } from "./types";

export const PENDING_MAX = 30;
export const SKIPPED_MAX = 200;

const words = (text: string) => tokenize(text).join(" ");
const textOf = (s: PendingSuggestion) => composeNoteText(s.draft);

/** One profile's suggested notes waiting for review, plus what the user skipped so it isn't suggested again. */
export class PendingStore {
  private readonly listeners = new Set<() => void>();

  private constructor(
    private readonly kv: KeyValue,
    private readonly profileId: string,
    private items: PendingSuggestion[],
    private skipped: string[],
  ) {}

  static async open(kv: KeyValue, profileId: string): Promise<PendingStore> {
    const [items, skipped] = await Promise.all([
      kv.get<PendingSuggestion[]>(pendingKey(profileId)).catch(() => undefined),
      kv.get<string[]>(skippedKey(profileId)).catch(() => undefined),
    ]);
    return new PendingStore(kv, profileId, items ?? [], skipped ?? []);
  }

  /** Newest first. */
  list(): PendingSuggestion[] {
    return [...this.items];
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Adds suggestions, newest first, keeping one batch in the model's order. Drops one
   * the user skipped before, a new note that repeats a note, and an edit already made.
   * Replaces a waiting edit of the same note and a waiting near copy. Returns how many were added.
   */
  async merge(incoming: PendingSuggestion[], notes: Note[]): Promise<number> {
    let items = this.items;
    let added = 0;
    for (const s of [...incoming].reverse()) {
      const text = textOf(s);
      if (this.skipped.some((f) => isNearDuplicate(text, f))) continue;
      const target = s.noteId ? notes.find((n) => n.id === s.noteId) : undefined;
      if (target ? words(target.text) === words(text) : notes.some((n) => isNearDuplicate(text, n.text))) continue;
      items = [s, ...items.filter((p) => !((s.noteId && p.noteId === s.noteId) || isNearDuplicate(textOf(p), text)))];
      added++;
    }
    if (added === 0) return 0;
    this.items = items.slice(0, PENDING_MAX);
    await this.save(false);
    return added;
  }

  /** After Keep: gone from the list, not remembered as skipped. */
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((p) => p.id !== id);
    await this.save(false);
  }

  async skip(id: string): Promise<void> {
    const s = this.items.find((p) => p.id === id);
    if (!s) return;
    this.skipped = [...this.skipped, words(textOf(s))].slice(-SKIPPED_MAX);
    this.items = this.items.filter((p) => p.id !== id);
    await this.save(true);
  }

  async skipAll(): Promise<void> {
    this.skipped = [...this.skipped, ...this.items.map((s) => words(textOf(s)))].slice(-SKIPPED_MAX);
    this.items = [];
    await this.save(true);
  }

  /** For an imported profile. */
  async replaceAll(items: PendingSuggestion[]): Promise<void> {
    this.items = items.slice(0, PENDING_MAX);
    await this.save(false);
  }

  private async save(withSkipped: boolean): Promise<void> {
    this.listeners.forEach((cb) => cb());
    try {
      await this.kv.set(pendingKey(this.profileId), this.items);
      if (withSkipped) await this.kv.set(skippedKey(this.profileId), this.skipped);
    } catch {
      // Storage full or blocked: suggestions still work for this visit.
    }
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/lib/learning/pending.test.ts`
Expected: PASS. If the cap test drops more than expected, the "zebraN" texts are colliding as near copies. Make them more distinct in the test, don't change `isNearDuplicate`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learning/pending.ts src/lib/learning/pending.test.ts
git commit -m "Add the pending suggestions list with merge rules and skip memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser client and learning session

**Files:**
- Create: `src/lib/learning/client.ts`, `src/lib/learning/session.ts`
- Test: `src/lib/learning/client.test.ts`, `src/lib/learning/session.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` (`src/lib/memory/store.ts`: `notes()`, `getNote(id)`, `searchNotes(query, ctx, k)`); `KeyValue`; `hasName`, `noteFields`, `NOTE_MAX` (`src/lib/profiles/notes.ts`); `Batcher`, `SendResult` (Task 3); `LearningQueue` (Task 2); `PendingStore` (Task 7); `localIsoDate` (Task 4); `ProposalSchema`, `LearnRequest`, `Proposal`, `LEARN_LINE_MAX`, `LEARN_NOTES_MAX` (Task 1).
- Produces:
  - `client.ts`: `type LearnResult = { ok: true; proposals: Proposal[] } | { ok: false; retry: boolean }`; `postLearnBatch(body: LearnRequest, fetchImpl?: typeof fetch): Promise<LearnResult>`.
  - `session.ts`: `interface NewLine { speaker: Speaker; text: string; partnerName?: string; placeName?: string }`; `relatedNotes(memory: MemoryStore, lines: QueuedLine[]): Promise<Note[]>`; `toPending(p: Proposal, lines: Map<string, QueuedLine>, memory: MemoryStore, now: number): PendingSuggestion`; `class LearningSession { static open(opts: { kv: KeyValue; profileId: string; memory: MemoryStore; enabled: boolean; post?: (body: LearnRequest) => Promise<LearnResult>; now?: () => number }): Promise<LearningSession>; readonly pending: PendingStore; addLine(line: NewLine): Promise<void>; setEnabled(on: boolean): Promise<void>; pageHidden(): void; dispose(): void }`.

- [ ] **Step 1: Write the failing client test**

Create `src/lib/learning/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { postLearnBatch } from "./client";
import type { LearnRequest } from "./protocol";

const body: LearnRequest = { today: "2026-09-30", lines: [{ id: "a", speaker: "user", text: "Hi" }], notes: [] };
const respond = (status: number, data: unknown) => vi.fn(async () => new Response(JSON.stringify(data), { status })) as unknown as typeof fetch;

describe("postLearnBatch", () => {
  it("posts the batch and returns well-formed proposals only", async () => {
    const good = { action: "add", kind: "preference", text: "I like tea.", lineIds: ["a"] };
    const fetchImpl = respond(200, { proposals: [good, { action: "add", kind: "friend", text: "x", lineIds: ["a"] }] });
    expect(await postLearnBatch(body, fetchImpl)).toEqual({ ok: true, proposals: [good] });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/learn");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("retries later when the service is busy, unreachable or answers nonsense", async () => {
    expect(await postLearnBatch(body, respond(503, { error: "unavailable" }))).toEqual({ ok: false, retry: true });
    expect(await postLearnBatch(body, respond(429, { error: "rate_limited" }))).toEqual({ ok: false, retry: true });
    expect(await postLearnBatch(body, respond(200, { nope: true }))).toEqual({ ok: false, retry: true });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await postLearnBatch(body, offline)).toEqual({ ok: false, retry: true });
  });

  it("gives up on a batch the server refuses, so it isn't sent forever", async () => {
    expect(await postLearnBatch(body, respond(400, { error: "invalid_request" }))).toEqual({ ok: false, retry: false });
    expect(await postLearnBatch(body, respond(413, { error: "too_large" }))).toEqual({ ok: false, retry: false });
    expect(await postLearnBatch(body, respond(403, { error: "forbidden" }))).toEqual({ ok: false, retry: false });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/learning/client.test.ts`
Expected: FAIL. `./client` can't be resolved.

- [ ] **Step 3: Implement the client**

Create `src/lib/learning/client.ts`:

```ts
import { ProposalSchema, type LearnRequest, type Proposal } from "./protocol";

export type LearnResult = { ok: true; proposals: Proposal[] } | { ok: false; retry: boolean };

/** Refused batches: sending the same lines again would be refused again. */
const REFUSED = new Set([400, 403, 413]);

/** Sends one batch. A busy or unreachable service is worth another try; a refused batch is not. */
export async function postLearnBatch(body: LearnRequest, fetchImpl: typeof fetch = fetch): Promise<LearnResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/learn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, retry: true };
  }
  if (REFUSED.has(res.status)) return { ok: false, retry: false };
  if (!res.ok) return { ok: false, retry: true };
  const data = (await res.json().catch(() => null)) as { proposals?: unknown } | null;
  if (!data || !Array.isArray(data.proposals)) return { ok: false, retry: true };
  return {
    ok: true,
    proposals: data.proposals.flatMap((p) => {
      const r = ProposalSchema.safeParse(p);
      return r.success ? [r.data] : [];
    }),
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/lib/learning/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing session test**

Create `src/lib/learning/session.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import { memoryKeyValue } from "@/lib/profiles/kv";
import type { Note } from "@/lib/types";
import { QUIET_MS } from "./batcher";
import type { LearnResult } from "./client";
import { PendingStore } from "./pending";
import type { LearnRequest, Proposal } from "./protocol";
import { LearningSession } from "./session";

const notes: Note[] = [
  { id: "me", kind: "about-me", text: "I'm Maya. I type to talk.", entities: ["Maya"], updatedAt: 0, pinned: true },
  { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 0 },
  { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam", "Blue Door Café"], updatedAt: 0 },
];

type Post = (body: LearnRequest) => Promise<LearnResult>;
const answer = (make: (body: LearnRequest) => Proposal[]) => vi.fn<Post>(async (body) => ({ ok: true, proposals: make(body) }));

async function open(post: Post, opts: { enabled?: boolean; kv?: ReturnType<typeof memoryKeyValue>; profileId?: string } = {}) {
  const memory = await MemoryStore.create();
  await memory.replaceAll(notes, []);
  const kv = opts.kv ?? memoryKeyValue();
  const session = await LearningSession.open({ kv, profileId: opts.profileId ?? "p1", memory, enabled: opts.enabled ?? true, post });
  return { session, memory, kv };
}

async function talk(session: LearningSession) {
  await session.addLine({ speaker: "partner", text: "Your physio moved to Thursdays, same time.", partnerName: "Leila", placeName: "Home" });
  await session.addLine({ speaker: "user", text: "OK, thank you." });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LearningSession", () => {
  it("sends a quiet batch with the pinned note and the notes the lines relate to", async () => {
    const post = answer(() => []);
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0][0];
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.lines.map((l) => [l.speaker, l.text, l.partnerName, l.placeName])).toEqual([
      ["partner", "Your physio moved to Thursdays, same time.", "Leila", "Home"],
      ["user", "OK, thank you.", undefined, undefined],
    ]);
    const sentIds = body.notes.map((n) => n.id);
    expect(sentIds[0]).toBe("me");
    expect(sentIds).toContain("physio");
    expect(sentIds.length).toBeLessThanOrEqual(9);
  });

  it("turns proposals into suggestions that quote their lines", async () => {
    const post = answer((body) => [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [body.lines[0].id] }]);
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(session.pending.list()).toMatchObject([
      {
        action: "edit",
        noteId: "physio",
        oldText: "I have physio on Tuesdays at 10:30.",
        draft: { kind: "routine", text: "I have physio on Thursdays at 10:30." },
        sources: [{ speaker: "partner", text: "Your physio moved to Thursdays, same time.", partnerName: "Leila" }],
      },
    ]);
  });

  it("an edit of a person keeps their name, and an edit of a deleted note becomes a new note", async () => {
    const post = answer((body) => [
      { action: "edit", kind: "person", noteId: "sam", text: "moving to Leeds in May", lineIds: [body.lines[0].id] },
      { action: "edit", kind: "routine", noteId: "gone", text: "Swimming on Fridays.", lineIds: [body.lines[0].id] },
    ]);
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    const [sam, swim] = session.pending.list();
    expect(sam).toMatchObject({ action: "edit", noteId: "sam", draft: { kind: "person", name: "Sam", text: "moving to Leeds in May" } });
    expect(swim.action).toBe("add");
    expect(swim).not.toHaveProperty("noteId");
  });

  it("keeps the lines when the service is busy and sends them again later", async () => {
    const post = vi.fn<Post>(async () => ({ ok: false, retry: true }));
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].lines.map((l) => l.text)).toEqual(post.mock.calls[0][0].lines.map((l) => l.text));
  });

  it("drops a batch the server refused", async () => {
    const post = vi.fn<Post>(async () => ({ ok: false, retry: false }));
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("queues nothing while off, and empties the queue when turned off", async () => {
    const post = answer(() => []);
    const { session } = await open(post, { enabled: false });
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).not.toHaveBeenCalled();

    await session.setEnabled(true);
    await talk(session);
    await session.setEnabled(false);
    await session.setEnabled(true);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores empty lines and sends when the page is hidden", async () => {
    const post = answer(() => []);
    const { session } = await open(post);
    await session.addLine({ speaker: "user", text: "   " });
    await talk(session);
    session.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(post.mock.calls[0][0].lines).toHaveLength(2);
  });

  it("writes a late result to the profile it was sent for", async () => {
    let release!: (r: LearnResult) => void;
    const post = vi.fn<Post>(() => new Promise<LearnResult>((r) => (release = r)));
    const kv = memoryKeyValue();
    const { session } = await open(post, { kv, profileId: "p1" });
    await talk(session);
    session.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    session.dispose();
    const lineId = post.mock.calls[0][0].lines[0].id;
    release({ ok: true, proposals: [{ action: "add", kind: "preference", text: "I like green tea.", lineIds: [lineId] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect((await PendingStore.open(kv, "p1")).list()).toHaveLength(1);
    expect((await PendingStore.open(kv, "p2")).list()).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npm test -- src/lib/learning/session.test.ts`
Expected: FAIL. `./session` can't be resolved.

- [ ] **Step 7: Implement the session**

Create `src/lib/learning/session.ts`:

```ts
import type { MemoryStore } from "@/lib/memory/store";
import type { KeyValue } from "@/lib/profiles/kv";
import { hasName, NOTE_MAX, noteFields } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { Batcher, type SendResult } from "./batcher";
import { postLearnBatch, type LearnResult } from "./client";
import { PendingStore } from "./pending";
import { localIsoDate } from "./prompt";
import { LEARN_LINE_MAX, LEARN_NOTES_MAX, type LearnRequest, type Proposal } from "./protocol";
import { LearningQueue } from "./queue";
import type { PendingSuggestion, QueuedLine, Speaker } from "./types";

export interface NewLine {
  speaker: Speaker;
  text: string;
  partnerName?: string;
  placeName?: string;
}

const RELATED_PER_LINE = 3;

/** The pinned about-me note, then the best matches for each line in turn, at most 9 notes in all. */
export async function relatedNotes(memory: MemoryStore, lines: QueuedLine[]): Promise<Note[]> {
  const picked = new Map<string, Note>();
  const pinned = memory.notes().find((n) => n.pinned);
  if (pinned) picked.set(pinned.id, pinned);
  const perLine = await Promise.all(lines.map((l) => memory.searchNotes(l.text, { now: new Date() }, RELATED_PER_LINE)));
  for (let rank = 0; rank < RELATED_PER_LINE; rank++) {
    for (const found of perLine) {
      const note = found[rank];
      if (note && picked.size < LEARN_NOTES_MAX) picked.set(note.id, note);
    }
  }
  return [...picked.values()];
}

/** A checked proposal as the review screen shows it. An edit of a note that is gone becomes a new note. */
export function toPending(p: Proposal, lines: Map<string, QueuedLine>, memory: MemoryStore, now: number): PendingSuggestion {
  const target = p.action === "edit" && p.noteId ? memory.getNote(p.noteId) : undefined;
  const kind = target?.kind ?? p.kind;
  const name = hasName(kind) ? (p.name ?? (target ? noteFields(target).name : "")) : "";
  return {
    id: `s_${crypto.randomUUID()}`,
    action: target ? "edit" : "add",
    draft: { kind, ...(name ? { name } : {}), text: p.text },
    ...(target ? { noteId: target.id, oldText: target.text } : {}),
    sources: p.lineIds.flatMap((id) => {
      const l = lines.get(id);
      return l ? [{ speaker: l.speaker, text: l.text, at: l.at, ...(l.partnerName ? { partnerName: l.partnerName } : {}) }] : [];
    }),
    createdAt: now,
  };
}

/** Learning for one open profile: lines in, suggestions out. Demos never get one. */
export class LearningSession {
  private constructor(
    private readonly queue: LearningQueue,
    readonly pending: PendingStore,
    private readonly batcher: Batcher,
    private enabled: boolean,
    private readonly now: () => number,
  ) {}

  static async open(opts: {
    kv: KeyValue;
    profileId: string;
    memory: MemoryStore;
    enabled: boolean;
    post?: (body: LearnRequest) => Promise<LearnResult>;
    now?: () => number;
  }): Promise<LearningSession> {
    const now = opts.now ?? Date.now;
    const post = opts.post ?? ((body: LearnRequest) => postLearnBatch(body));
    const { memory } = opts;
    const [queue, pending] = await Promise.all([LearningQueue.open(opts.kv, opts.profileId, now), PendingStore.open(opts.kv, opts.profileId)]);

    const send = async (lines: QueuedLine[]): Promise<SendResult> => {
      const notes = await relatedNotes(memory, lines);
      const body: LearnRequest = {
        today: localIsoDate(new Date(now())),
        lines: lines.map(({ id, speaker, text, partnerName, placeName }) => ({
          id,
          speaker,
          text,
          ...(partnerName ? { partnerName } : {}),
          ...(placeName ? { placeName } : {}),
        })),
        notes: notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text.slice(0, NOTE_MAX) })),
      };
      const result = await post(body);
      // A refused batch counts as sent, so its lines are dropped instead of sent forever.
      if (!result.ok) return result.retry ? "failed" : "sent";
      const byId = new Map(lines.map((l) => [l.id, l]));
      await pending.merge(
        result.proposals.map((p) => toPending(p, byId, memory, now())),
        memory.notes(),
      );
      return "sent";
    };

    return new LearningSession(queue, pending, new Batcher(queue, send), opts.enabled, now);
  }

  async addLine(line: NewLine): Promise<void> {
    const text = line.text.trim().slice(0, LEARN_LINE_MAX);
    if (!this.enabled || !text) return;
    await this.queue.add({
      id: crypto.randomUUID(),
      speaker: line.speaker,
      text,
      at: this.now(),
      ...(line.partnerName ? { partnerName: line.partnerName.slice(0, 60) } : {}),
      ...(line.placeName ? { placeName: line.placeName.slice(0, 80) } : {}),
    });
    this.batcher.lineAdded();
  }

  /** Turning learning off empties the queue; suggestions already made stay for review. */
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    if (!on) await this.queue.clear();
  }

  pageHidden(): void {
    if (this.enabled) this.batcher.pageHidden();
  }

  dispose(): void {
    this.batcher.dispose();
  }
}
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `npm test -- src/lib/learning/session.test.ts src/lib/learning/client.test.ts`
Expected: PASS. If "sends a quiet batch" doesn't find `physio` among the sent notes, check that `MemoryStore.searchNotes` without an embedder matches "physio" by text. The query "Your physio moved to Thursdays, same time." contains "physio", so text search should find it.

- [ ] **Step 9: Typecheck, lint and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add src/lib/learning/client.ts src/lib/learning/client.test.ts src/lib/learning/session.ts src/lib/learning/session.test.ts
git commit -m "Add the learning session: related notes, the /api/learn call, suggestions per profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Profiles keep and carry their suggestions

**Files:**
- Modify: `src/lib/profiles/registry.ts`, `src/lib/profiles/transfer.ts`
- Test: `src/lib/profiles/registry.test.ts`, `src/lib/profiles/transfer.test.ts`

**Interfaces:**
- Consumes: `learningKeys`, `pendingKey` (Task 1), `PendingSuggestion` (Task 1).
- Produces:
  - `ProfileRegistry.keyValue: KeyValue` (getter). `remove(id)` also deletes `learn-queue:<id>`, `learn-pending:<id>` and `learn-skipped:<id>`.
  - `exportProfile(name, notes, phrases, now, suggestions?: PendingSuggestion[])` writes a `suggestions` field.
  - `parseImport(text)` returns `{ name, notes, phrases, suggestions: PendingSuggestion[] }`. Suggestions get new ids. An edit's `noteId` is mapped to the imported note's new id, and an edit whose note isn't in the file becomes an add.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/profiles/registry.test.ts` (import `pendingKey`, `queueKey`, `skippedKey` from `@/lib/learning/keys`, and `memoryKeyValue` if it isn't already imported):

```ts
it("deleting a profile deletes its learning data too", async () => {
  const kv = memoryKeyValue();
  const reg = await ProfileRegistry.open(kv);
  const p = await reg.create("Priya");
  for (const key of [queueKey(p.id), pendingKey(p.id), skippedKey(p.id)]) await kv.set(key, ["x"]);
  expect(reg.keyValue).toBe(kv);
  await reg.remove(p.id);
  for (const key of [queueKey(p.id), pendingKey(p.id), skippedKey(p.id)]) expect(await kv.get(key)).toBeUndefined();
});
```

Add to `src/lib/profiles/transfer.test.ts` (import `PendingSuggestion` from `@/lib/learning/types`, and `Note` if it isn't already imported):

```ts
describe("suggested notes in exports", () => {
  const notes: Note[] = [{ id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 1 }];
  const edit: PendingSuggestion = {
    id: "s1",
    action: "edit",
    noteId: "physio",
    oldText: "I have physio on Tuesdays at 10:30.",
    draft: { kind: "routine", text: "I have physio on Thursdays at 10:30." },
    sources: [{ speaker: "partner", text: "Your physio moved to Thursdays.", at: 5, partnerName: "Leila" }],
    createdAt: 5,
  };
  const now = new Date("2026-09-30T12:00:00Z");

  it("carry over, pointing at the imported notes", () => {
    const parsed = parseImport(exportProfile("Maya", notes, [], now, [edit]))!;
    expect(parsed.suggestions).toHaveLength(1);
    const [s] = parsed.suggestions;
    expect(s.id).not.toBe("s1");
    expect(s).toMatchObject({ action: "edit", noteId: parsed.notes[0].id, oldText: edit.oldText, draft: edit.draft, sources: edit.sources });
  });

  it("an edit whose note isn't in the file becomes a new note", () => {
    const parsed = parseImport(exportProfile("Maya", [], [], now, [edit]))!;
    expect(parsed.suggestions[0].action).toBe("add");
    expect(parsed.suggestions[0]).not.toHaveProperty("noteId");
  });

  it("older exports without suggestions still import", () => {
    const old = JSON.parse(exportProfile("Maya", notes, [], now));
    delete old.suggestions;
    expect(parseImport(JSON.stringify(old))!.suggestions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/lib/profiles/registry.test.ts src/lib/profiles/transfer.test.ts`
Expected: FAIL. `keyValue` is undefined, and `suggestions` is missing from the export and import.

- [ ] **Step 3: Implement**

In `src/lib/profiles/registry.ts`:

```ts
import { learningKeys } from "@/lib/learning/keys";
```

Add inside the class, after `active()`:

```ts
  /** The storage profiles use. Learning keeps each profile's queue and suggestions here too. */
  get keyValue(): KeyValue {
    return this.kv;
  }
```

Change `remove`:

```ts
  async remove(id: string): Promise<void> {
    const profiles = this.state.profiles.filter((p) => p.id !== id);
    const activeId = this.state.activeId === id ? (profiles[0]?.id ?? null) : this.state.activeId;
    await this.kv.del(`profile:${id}`);
    for (const key of learningKeys(id)) await this.kv.del(key);
    await this.write({ ...this.state, activeId, profiles });
  }
```

In `src/lib/profiles/transfer.ts`, add `import type { PendingSuggestion } from "@/lib/learning/types";`. Put `Kind` right after the imports, above `NoteSchema`, and change `NoteSchema`'s `kind` to `kind: Kind` (same values):

```ts
const Kind = z.enum(["person", "place", "routine", "preference", "about-me"]);
```

Then add this schema above `ExportSchema`:

```ts
const SuggestionSchema = z.object({
  id: z.string(),
  action: z.enum(["add", "edit"]),
  draft: z.object({ kind: Kind, name: z.string().max(200).optional(), text: z.string().max(2000) }),
  noteId: z.string().optional(),
  oldText: z.string().max(2000).optional(),
  sources: z
    .array(z.object({ speaker: z.enum(["user", "partner"]), text: z.string().max(2000), at: z.number(), partnerName: z.string().max(200).optional() }))
    .max(40),
  createdAt: z.number(),
});
```

Add `suggestions: z.array(SuggestionSchema).max(30).optional(),` to `ExportSchema`. Then:

```ts
export function exportProfile(name: string, notes: Note[], phrases: Phrase[], now: Date, suggestions: PendingSuggestion[] = []): string {
  return JSON.stringify({ format: "onbeat-profile", version: 1, exportedAt: now.toISOString(), profile: { name }, notes, phrases, suggestions }, null, 2);
}
```

In `parseImport`, change the return type to `{ name: string; notes: Note[]; phrases: Phrase[]; suggestions: PendingSuggestion[] } | null`, and before the `return` add:

```ts
  const suggestions: PendingSuggestion[] = (parsed.data.suggestions ?? []).map((s) => {
    const noteId = s.noteId ? ids.get(s.noteId) : undefined;
    return {
      id: `s_${crypto.randomUUID()}`,
      action: noteId ? "edit" : "add",
      draft: s.draft,
      ...(noteId ? { noteId, ...(s.oldText ? { oldText: s.oldText } : {}) } : {}),
      sources: s.sources,
      createdAt: s.createdAt,
    };
  });
  return { name, notes, phrases, suggestions };
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -- src/lib/profiles/registry.test.ts src/lib/profiles/transfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`. The existing call sites of `exportProfile` and `parseImport` still compile: the new parameter is optional and the extra return field is ignored.

```bash
git add src/lib/profiles/registry.ts src/lib/profiles/registry.test.ts src/lib/profiles/transfer.ts src/lib/profiles/transfer.test.ts
git commit -m "Delete learning data with its profile, and carry suggested notes in exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Suggested notes screen

**Files:**
- Create: `src/components/suggested-notes.tsx`
- Test: `src/components/suggested-notes.test.tsx`

**Interfaces:**
- Consumes: `composeNoteText`, `DraftNote` (Task 1); `PendingSuggestion`, `SourceLine` (Task 1); `KIND_LABELS`, `NoteForm` (`src/components/note-form.tsx`); `primaryButton`, `secondaryButton` (`src/components/ui.ts`); `Note`.
- Produces: `SuggestedNotes(props: { suggestions: PendingSuggestion[]; notes: Note[]; onKeep: (s: PendingSuggestion, draft: DraftNote) => void; onSkip: (id: string) => void; onSkipAll: () => void; onDone: () => void; now?: Date })` and `whenSaid(at: number, now: Date): string`.

- [ ] **Step 1: Write the failing test**

Create `src/components/suggested-notes.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PendingSuggestion } from "@/lib/learning/types";
import type { Note } from "@/lib/types";
import { SuggestedNotes, whenSaid } from "./suggested-notes";

const now = new Date(2026, 8, 30, 16, 0);
const at = new Date(2026, 8, 30, 15, 12).getTime();
const physio: Note = { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 1 };
const add: PendingSuggestion = {
  id: "s1",
  action: "add",
  draft: { kind: "person", name: "Ana", text: "Ana is my new carer." },
  sources: [{ speaker: "user", text: "My new carer Ana starts Monday.", at }],
  createdAt: at,
};
const edit: PendingSuggestion = {
  id: "s2",
  action: "edit",
  noteId: "physio",
  oldText: physio.text,
  draft: { kind: "routine", text: "I have physio on Thursdays at 10:30." },
  sources: [{ speaker: "partner", partnerName: "Leila", text: "Your physio moved to Thursdays.", at }],
  createdAt: at,
};

function show(suggestions: PendingSuggestion[], notes: Note[] = [physio]) {
  const handlers = { onKeep: vi.fn(), onSkip: vi.fn(), onSkipAll: vi.fn(), onDone: vi.fn() };
  render(<SuggestedNotes suggestions={suggestions} notes={notes} now={now} {...handlers} />);
  return handlers;
}

describe("whenSaid", () => {
  it("says today or yesterday with the time", () => {
    expect(whenSaid(at, now)).toMatch(/^today /);
    expect(whenSaid(new Date(2026, 8, 29, 9, 0).getTime(), now)).toMatch(/^yesterday /);
    expect(whenSaid(new Date(2026, 8, 20, 9, 0).getTime(), now)).toMatch(/September/);
  });
});

describe("SuggestedNotes", () => {
  it("shows a new note with the line it came from, heading focused", () => {
    show([add]);
    expect(screen.getByRole("heading", { name: "Suggested notes" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "New note: People" })).toBeInTheDocument();
    expect(screen.getByText("Ana is my new carer.")).toBeInTheDocument();
    expect(screen.getByText(/You said: .My new carer Ana starts Monday.., today/)).toBeInTheDocument();
  });

  it("shows a change with the note as it is now and the new text", () => {
    show([edit]);
    expect(screen.getByRole("heading", { name: "Change a note: Routines" })).toBeInTheDocument();
    expect(screen.getByText("I have physio on Tuesdays at 10:30.")).toBeInTheDocument();
    expect(screen.getByText("I have physio on Thursdays at 10:30.")).toBeInTheDocument();
    expect(screen.getByText(/Leila said: .Your physio moved to Thursdays../)).toBeInTheDocument();
  });

  it("compares against the note as it is now if it changed since", () => {
    show([edit], [{ ...physio, text: "I have physio on Wednesdays." }]);
    expect(screen.getByText("I have physio on Wednesdays.")).toBeInTheDocument();
    expect(screen.queryByText("I have physio on Tuesdays at 10:30.")).toBeNull();
  });

  it("shows an edit of a deleted note as a new note", () => {
    show([edit], []);
    expect(screen.getByRole("heading", { name: "New note: Routines" })).toBeInTheDocument();
  });

  it("keeps, edits then keeps, and skips", async () => {
    const h = show([add, edit]);
    await userEvent.click(screen.getByRole("button", { name: "Keep: Ana is my new carer." }));
    expect(h.onKeep).toHaveBeenCalledWith(add, add.draft);

    await userEvent.click(screen.getByRole("button", { name: "Edit: I have physio on Thursdays at 10:30." }));
    const field = screen.getByLabelText("Routine");
    await userEvent.clear(field);
    await userEvent.type(field, "I have physio on Thursdays at 11.");
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(h.onKeep).toHaveBeenLastCalledWith(edit, { kind: "routine", text: "I have physio on Thursdays at 11." });

    await userEvent.click(screen.getByRole("button", { name: "Skip: Ana is my new carer." }));
    expect(h.onSkip).toHaveBeenCalledWith("s1");
  });

  it("asks before skipping everything", async () => {
    const h = show([add, edit]);
    await userEvent.click(screen.getByRole("button", { name: "Skip all" }));
    expect(screen.getByText("Skip all 2 suggestions?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onSkipAll).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Skip all" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip all" }));
    expect(h.onSkipAll).toHaveBeenCalled();
  });

  it("says when there is nothing to review", async () => {
    const h = show([]);
    expect(screen.getByText("Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip all" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(h.onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/components/suggested-notes.test.tsx`
Expected: FAIL. `./suggested-notes` can't be resolved.

- [ ] **Step 3: Implement**

Create `src/components/suggested-notes.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingSuggestion, SourceLine } from "@/lib/learning/types";
import { composeNoteText, type DraftNote } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { KIND_LABELS, NoteForm } from "./note-form";
import { primaryButton, secondaryButton } from "./ui";

interface Props {
  suggestions: PendingSuggestion[];
  /** The profile's notes now, so an edit is compared with what is really there. */
  notes: Note[];
  onKeep: (suggestion: PendingSuggestion, draft: DraftNote) => void;
  onSkip: (id: string) => void;
  onSkipAll: () => void;
  onDone: () => void;
  now?: Date;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "today 3:12 pm", "yesterday 9:00 am", or the weekday and date. */
export function whenSaid(at: number, now: Date): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return `today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} ${time}`;
}

function Source({ line, now }: { line: SourceLine; now: Date }) {
  const who = line.speaker === "user" ? "You" : (line.partnerName ?? "The other person");
  return (
    <p className="text-label text-muted break-words">
      {who} said: &ldquo;{line.text}&rdquo;, {whenSaid(line.at, now)}
    </p>
  );
}

export function SuggestedNotes({ suggestions, notes, onKeep, onSkip, onSkipAll, onDone, now = new Date() }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);
  // The card that had focus goes away; the heading is the next sensible place.
  const settle = () => headingRef.current?.focus();

  return (
    <section aria-labelledby="suggestions-heading" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="suggestions-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          Suggested notes
        </h2>
        <p className="max-w-[60ch] text-body text-muted">OnBeat noticed these in your conversations. Nothing is saved until you choose Keep.</p>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-body">Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((s) => {
            const target = s.noteId ? notes.find((n) => n.id === s.noteId) : undefined;
            const text = composeNoteText(s.draft);
            const group = KIND_LABELS[s.draft.kind].group;
            return (
              <li key={s.id} className="flex flex-col gap-3 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
                <h3 className="text-reply font-bold">{target ? `Change a note: ${group}` : `New note: ${group}`}</h3>
                {target ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
                    <dt className="font-bold">Now</dt>
                    <dd className="break-words">{target.text}</dd>
                    <dt className="font-bold">New</dt>
                    <dd className="break-words">{text}</dd>
                  </dl>
                ) : (
                  <p className="text-body break-words">{text}</p>
                )}
                <div className="flex flex-col gap-1">
                  {s.sources.map((line, i) => (
                    <Source key={i} line={line} now={now} />
                  ))}
                </div>
                {editing === s.id ? (
                  <NoteForm
                    kind={s.draft.kind}
                    initial={{ name: s.draft.name ?? "", text: s.draft.text }}
                    submitLabel="Keep"
                    autoFocus
                    onSave={(draft) => {
                      setEditing(null);
                      onKeep(s, draft);
                      settle();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      aria-label={`Keep: ${text}`}
                      className={primaryButton}
                      onClick={() => {
                        onKeep(s, s.draft);
                        settle();
                      }}
                    >
                      Keep
                    </button>
                    <button type="button" aria-label={`Edit: ${text}`} className={secondaryButton} onClick={() => setEditing(s.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Skip: ${text}`}
                      className={secondaryButton}
                      onClick={() => {
                        onSkip(s.id);
                        settle();
                      }}
                    >
                      Skip
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {suggestions.length > 1 &&
          (confirmingAll ? (
            <>
              <p className="text-body font-bold">Skip all {suggestions.length} suggestions?</p>
              <button
                type="button"
                className={primaryButton}
                onClick={() => {
                  setConfirmingAll(false);
                  onSkipAll();
                  settle();
                }}
              >
                Skip all
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmingAll(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={secondaryButton} onClick={() => setConfirmingAll(true)}>
              Skip all
            </button>
          ))}
        <button type="button" onClick={onDone} className={primaryButton}>
          Done
        </button>
      </div>
    </section>
  );
}
```

The spec shows "Skip all" at the bottom. It's hidden when there is one suggestion or none, because a single card already has its own Skip.

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/components/suggested-notes.test.tsx`
Expected: PASS. If the edit test can't find the label "Routine", check `KIND_LABELS.routine.text` in `note-form.tsx` (it is "Routine").

- [ ] **Step 5: Lint and commit**

Run: `npm run lint`

```bash
git add src/components/suggested-notes.tsx src/components/suggested-notes.test.tsx
git commit -m "Add the Suggested notes screen: keep, edit or skip each suggestion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Settings switch, menu badge and setup line

**Files:**
- Modify: `src/lib/settings.ts`, `src/components/settings-panel.tsx`, `src/components/profile-menu.tsx`, `src/components/profile-setup.tsx`
- Test: `src/lib/settings.test.ts`, `src/components/components.test.tsx`, `src/components/profile-components.test.tsx`

**Interfaces:**
- Produces:
  - `Settings.learning: boolean` (default true); `setLearning(on: boolean)`; `learningTold(): boolean`; `markLearningTold(): void`.
  - `SettingsPanel` props gain `learning: boolean; onLearning: (on: boolean) => void`.
  - `ProfileMenu` props gain `suggestionCount?: number; onSuggestions?: () => void`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/settings.test.ts`, import `learningTold`, `markLearningTold` and `setLearning` as well. Change the defaults test's expectation to `{ theme: "system", digitKeys: true, cloudCaptions: false, learning: true }`, and add:

```ts
  it("saves learning turned off, and forgets it when turned back on", () => {
    setLearning(false);
    expect(localStorage.getItem("onbeat:learning")).toBe("off");
    forgetSettings();
    expect(getSettings().learning).toBe(false);
    setLearning(true);
    expect(localStorage.getItem("onbeat:learning")).toBeNull();
  });

  it("remembers that the user was told about suggested notes", () => {
    expect(learningTold()).toBe(false);
    markLearningTold();
    expect(learningTold()).toBe(true);
    expect(localStorage.getItem("onbeat:learning-told")).toBe("yes");
  });
```

In `src/components/components.test.tsx`, add `learning={true} onLearning={() => {}}` to each existing `<SettingsPanel ... />` render, and add inside `describe("SettingsPanel")`:

```tsx
  it("turns suggested notes off, saying what is sent", async () => {
    const onLearning = vi.fn();
    render(
      <SettingsPanel theme="system" digitKeys={true} cloudCaptions={false} learning={true} onTheme={() => {}} onDigitKeys={() => {}} onCloudCaptions={() => {}} onLearning={onLearning} />,
    );
    await userEvent.click(screen.getByText("Settings"));
    const box = screen.getByRole("checkbox", { name: "Suggest notes from my conversations" });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription(/sends recent lines from your conversations, and the notes they relate to/);
    await userEvent.click(box);
    expect(onLearning).toHaveBeenCalledWith(false);
  });
```

In `src/components/profile-components.test.tsx`, inside `describe("ProfileMenu")`, add:

```tsx
  it("shows how many suggested notes wait, and opens them", async () => {
    const h = handlers();
    const onSuggestions = vi.fn();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} suggestionCount={3} onSuggestions={onSuggestions} {...h} />);
    const toggle = screen.getByRole("button", { name: "Maya, 3 suggested notes" });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Suggested notes (3)" }));
    expect(onSuggestions).toHaveBeenCalled();
  });

  it("names the button plainly with nothing to review, and hides suggestions in a demo", async () => {
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} suggestionCount={0} onSuggestions={vi.fn()} {...handlers()} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    expect(screen.getByRole("button", { name: "Suggested notes" })).toBeInTheDocument();
  });
```

In the `ProfileSetup` tests in the same file, add:

```tsx
  it("says on the last step that notes will be suggested", async () => {
    render(<ProfileSetup onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Priya{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("OnBeat will suggest notes from your conversations. You choose what to keep. You can turn this off in Settings.")).toBeInTheDocument();
  });
```

(Check the existing `ProfileSetup` tests for the required props and match them. If `onDone` alone isn't enough, pass what the other tests pass.)

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/lib/settings.test.ts src/components/components.test.tsx src/components/profile-components.test.tsx`
Expected: FAIL on the new tests and the defaults test.

- [ ] **Step 3: Implement**

`src/lib/settings.ts`: add `learning` to `Settings`, then add the keys, the read, the setter and the told flag.

```ts
export interface Settings {
  theme: ThemeChoice;
  digitKeys: boolean;
  /** Send the other person's finished lines to Deepgram Nova-3 for more accurate captions. Off unless the user turns it on. */
  cloudCaptions: boolean;
  /** Suggest notes from conversations. On unless the user turns it off. */
  learning: boolean;
}

const LEARNING_KEY = "onbeat:learning";
const LEARNING_TOLD_KEY = "onbeat:learning-told";
```

In `getSettings()` add `learning: read(LEARNING_KEY) !== "off",`. Change `SERVER_SETTINGS` to `{ theme: "system", digitKeys: true, cloudCaptions: false, learning: true }`. Add:

```ts
export function setLearning(on: boolean) {
  write(LEARNING_KEY, on ? null : "off");
  update({ learning: on });
}

/** Set once the user has been told notes are suggested; holds for this page even when storage is blocked. */
let toldThisPage = false;

export function learningTold(): boolean {
  return toldThisPage || read(LEARNING_TOLD_KEY) === "yes";
}

export function markLearningTold() {
  toldThisPage = true;
  write(LEARNING_TOLD_KEY, "yes");
}
```

Also reset `toldThisPage = false;` inside `forgetSettings()`, so tests start clean.

`src/components/settings-panel.tsx`: add `learning: boolean;` and `onLearning: (on: boolean) => void;` to `Props` and to the destructuring. Add this block after the Clearer captions block:

```tsx
        <div className="flex flex-col gap-1">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
            <input
              type="checkbox"
              checked={learning}
              onChange={(e) => onLearning(e.target.checked)}
              aria-describedby="learning-hint"
              className="size-6 shrink-0 accent-ink"
            />
            Suggest notes from my conversations
          </label>
          <p id="learning-hint" className="text-label text-muted">
            After a pause, OnBeat sends recent lines from your conversations, and the notes they relate to, to its AI service to spot new facts.
            Nothing is saved until you choose Keep.
          </p>
        </div>
```

`src/components/profile-menu.tsx`: add to `Props`:

```ts
  /** Suggested notes waiting for review. */
  suggestionCount?: number;
  onSuggestions?: () => void;
```

In the component, add `const count = props.suggestionCount ?? 0;`. In the toggle button, after `<span className="truncate">{label}</span>`:

```tsx
        {count > 0 && (
          <>
            <span aria-hidden="true" className="shrink-0 rounded-full border-2 border-ink bg-ink px-2 text-label text-surface">
              {count}
            </span>
            <span className="sr-only">
              , {count} suggested {count === 1 ? "note" : "notes"}
            </span>
          </>
        )}
```

In the `!demoName && active` block, right after the "Your notes" button:

```tsx
                  {props.onSuggestions && (
                    <button type="button" onClick={() => act(props.onSuggestions!)} className={item}>
                      Suggested notes{count > 0 ? ` (${count})` : ""}
                    </button>
                  )}
```

`src/components/profile-setup.tsx`: in step 2 (index 2), put this paragraph just before the `<div className="flex flex-wrap gap-3">` that holds Back and Finish:

```tsx
          <p className={hint}>OnBeat will suggest notes from your conversations. You choose what to keep. You can turn this off in Settings.</p>
```

(`hint` is already imported from `./ui` in this file; if not, add it to that import.)

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -- src/lib/settings.test.ts src/components/components.test.tsx src/components/profile-components.test.tsx`
Expected: PASS. If the accessible name comes out as "Maya , 3 suggested notes" or without the comma, don't change the test. Adjust the JSX spacing so the name reads "Maya, 3 suggested notes".

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npm run typecheck && npm run lint`. `conversation-screen.tsx` now fails typecheck because `SettingsPanel` needs `learning` and `onLearning`. Pass `learning={settings.learning} onLearning={setLearning}` there for now (import `setLearning`); Task 12 replaces it with the full handler.

```bash
git add src/lib/settings.ts src/lib/settings.test.ts src/components/settings-panel.tsx src/components/profile-menu.tsx src/components/profile-setup.tsx src/components/components.test.tsx src/components/profile-components.test.tsx src/components/conversation-screen.tsx
git commit -m "Add the suggested notes setting, a count on the profile menu, and a line in setup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Wire learning into the conversation screen

**Files:**
- Create: `src/lib/learning/use-learning.ts`
- Modify: `src/components/conversation-screen.tsx`
- Test: `src/components/conversation-screen.test.tsx`

**Interfaces:**
- Consumes: `LearningSession`, `NewLine` (Task 8); `PendingStore` (Task 7); `clearQueues` (Task 2); `PendingSuggestion` (Task 1); `SuggestedNotes` (Task 10); `ProfileRegistry.keyValue`, `exportProfile(..., suggestions)`, `parseImport(...).suggestions` (Task 9); `setLearning`, `learningTold`, `markLearningTold` (Task 11); `buildNote`, `DraftNote` (`src/lib/profiles/notes.ts`).
- Produces: `useLearningSession(opts: { kv: KeyValue | null; profileId: string | null; memory: MemoryStore | null; enabled: boolean }): { session: LearningSession | null; suggestions: PendingSuggestion[] }`, and the `"suggestions"` view.

- [ ] **Step 1: Write the failing screen tests**

In `src/components/conversation-screen.test.tsx`, add a learning mock next to the other `vi.mock` calls. It must come before `import { ConversationScreen } ...`, and its state goes in the existing `vi.hoisted` block. Add to the object `h` returns:

```ts
  const learnBodies: import("@/lib/learning/protocol").LearnRequest[] = [];
  let learnAnswer: (body: import("@/lib/learning/protocol").LearnRequest) => import("@/lib/learning/protocol").Proposal[] = () => [];
  const setLearnAnswer = (f: typeof learnAnswer) => {
    learnAnswer = f;
  };
  const postLearn = async (body: import("@/lib/learning/protocol").LearnRequest) => {
    learnBodies.push(body);
    return { ok: true as const, proposals: learnAnswer(body) };
  };
```

and return `learnBodies, setLearnAnswer, postLearn` from the hoisted function. Then:

```ts
vi.mock("@/lib/learning/client", () => ({ postLearnBatch: (body: import("@/lib/learning/protocol").LearnRequest) => h.postLearn(body) }));
```

In `beforeEach`, add `h.learnBodies.length = 0; h.setLearnAnswer(() => []);`. Add these helpers below `partnerSays`:

```ts
async function setUpPriya() {
  render(<ConversationScreen />);
  await userEvent.type(await screen.findByLabelText("What's your name?"), "Priya{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  await screen.findByRole("heading", { name: "Replies" });
}

/** The page goes to the background, which sends any queued lines. */
async function hidePage() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  await waitFor(() => expect(h.learnBodies.length).toBeGreaterThan(0));
}
```

Add a new `describe` block:

```tsx
describe("ConversationScreen learning", () => {
  it("learns from the partner and the user, and a kept suggestion becomes a note", async () => {
    h.setLearnAnswer((body) => [{ action: "add", kind: "person", name: "Ana", text: "Ana is my new carer. She starts on Monday.", lineIds: [body.lines[0].id] }]);
    await setUpPriya();
    await partnerSays("Your new carer Ana starts on Monday.");
    await userEvent.type(screen.getByLabelText("Type a reply"), "Great, thanks for telling me{Enter}");
    await hidePage();
    expect(h.learnBodies[0].lines.map((l) => [l.speaker, l.text])).toEqual([
      ["partner", "Your new carer Ana starts on Monday."],
      ["user", "Great, thanks for telling me"],
    ]);

    const toggle = await screen.findByRole("button", { name: "Priya, 1 suggested note" });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Suggested notes (1)" }));
    expect(screen.getByText(/The other person said: .Your new carer Ana starts on Monday../)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep: Ana is my new carer. She starts on Monday." }));
    expect(await screen.findByText("Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: "Your notes" }));
    expect(screen.getByText("Ana is my new carer. She starts on Monday.")).toBeInTheDocument();
  });

  it("does not learn from a reply tapped as it is", async () => {
    await setUpPriya();
    await partnerSays("How was your weekend?");
    answer("It was lovely, thanks.");
    await userEvent.click(await screen.findByRole("button", { name: /It was lovely, thanks\./ }));
    await partnerSays("Did you do anything fun?");
    await hidePage();
    expect(h.learnBodies[0].lines.map((l) => l.text)).toEqual(["How was your weekend?", "Did you do anything fun?"]);
  });

  it("never learns in a demo", async () => {
    await startWithMaya();
    await partnerSays("Your physio moved to Thursdays.");
    await partnerSays("Same time as before.");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.learnBodies).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Demo: Maya" }));
    expect(screen.queryByRole("button", { name: /Suggested notes/ })).toBeNull();
  });

  it("learns nothing with the setting off", async () => {
    await setUpPriya();
    await userEvent.click(screen.getByText("Settings"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Suggest notes from my conversations" }));
    await partnerSays("Your physio moved to Thursdays.");
    await partnerSays("Same time as before.");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.learnBodies).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox", { name: "Suggest notes from my conversations" }));
  });
});
```

The last test turns the setting back on at the end, because settings live in `localStorage` across tests in this file.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/components/conversation-screen.test.tsx`
Expected: the new tests FAIL (no batch is sent, no count on the menu). The existing tests still pass.

- [ ] **Step 3: Implement the hook**

Create `src/lib/learning/use-learning.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import type { MemoryStore } from "@/lib/memory/store";
import type { KeyValue } from "@/lib/profiles/kv";
import { LearningSession } from "./session";
import type { PendingSuggestion } from "./types";

interface Live {
  memory: MemoryStore;
  session: LearningSession;
  suggestions: PendingSuggestion[];
}

/**
 * A learning session for the open profile and its waiting suggestions. None for a demo
 * (no profile id). Each profile switch opens a new memory store, so a session is only
 * used while its own store is the open one.
 */
export function useLearningSession(opts: { kv: KeyValue | null; profileId: string | null; memory: MemoryStore | null; enabled: boolean }) {
  const { kv, profileId, memory, enabled } = opts;
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    if (!kv || !profileId || !memory) return;
    let cancelled = false;
    let opened: LearningSession | null = null;
    let off = () => {};
    void LearningSession.open({ kv, profileId, memory, enabled }).then((session) => {
      if (cancelled) {
        session.dispose();
        return;
      }
      opened = session;
      off = session.pending.onChange(() =>
        setLive((cur) => (cur?.session === session ? { ...cur, suggestions: session.pending.list() } : cur)),
      );
      setLive({ memory, session, suggestions: session.pending.list() });
    });
    return () => {
      cancelled = true;
      off();
      opened?.dispose();
    };
    // `enabled` is applied to the open session by the effect below, not by reopening it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kv, profileId, memory]);

  const current = live && profileId && live.memory === memory ? live : null;
  const session = current?.session ?? null;

  useEffect(() => {
    void session?.setEnabled(enabled);
  }, [session, enabled]);

  useEffect(() => {
    if (!session) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") session.pageHidden();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session]);

  return { session, suggestions: current?.suggestions ?? [] };
}
```

- [ ] **Step 4: Wire the screen**

In `src/components/conversation-screen.tsx`:

1. Imports: add

```ts
import { PendingStore } from "@/lib/learning/pending";
import { clearQueues } from "@/lib/learning/queue";
import type { PendingSuggestion } from "@/lib/learning/types";
import { useLearningSession } from "@/lib/learning/use-learning";
import { buildNote, type DraftNote } from "@/lib/profiles/notes";
import { SuggestedNotes } from "./suggested-notes";
```

and add `learningTold, markLearningTold, setLearning` to the `@/lib/settings` import.

2. `type View = "loading" | "setup" | "demo-picker" | "notes" | "suggestions" | "conversation";`

3. Below `SAVE_FAILED`:

```ts
const LEARNING_NOTICE = "New: OnBeat can suggest notes from your conversations for you to review. Turn it off in Settings.";
```

4. Right after `const client = useMemo(...)`:

```ts
  const activeProfileId = demo ? null : (registry?.active()?.id ?? null);
  const learning = useLearningSession({
    kv: registry?.keyValue ?? null,
    profileId: activeProfileId,
    memory,
    // Nothing is queued until the user has been told notes are suggested.
    enabled: settings.learning && learningTold(),
  });
  /** Who the user is talking with and where, for the lines learning keeps. */
  const lineContext = useCallback(
    () => ({
      partnerName: state.partnerId ? memory?.getNote(state.partnerId)?.entities[0] : undefined,
      placeName: state.placeId ? memory?.getNote(state.placeId)?.entities[0] : undefined,
    }),
    [memory, state.partnerId, state.placeId],
  );
```

5. In `speak`, after the reaction early return and before `memory?.addPhrase(...)`:

```ts
      // A reply tapped as it is came from the notes, maybe with an invented detail: only
      // the user's own words are learned from.
      if (!state.replies.some((r) => r.text.trim() === t)) void learning.session?.addLine({ speaker: "user", text: t, ...lineContext() });
```

Add `state.replies, learning.session, lineContext` to its dependency list.

6. After the effect that announces partner lines:

```ts
  // Each line from the partner goes to learning once.
  const learnedTurnIds = useRef(new Set<string>());
  useEffect(() => {
    for (const turn of state.turns) {
      if (turn.speaker !== "partner" || learnedTurnIds.current.has(turn.id)) continue;
      learnedTurnIds.current.add(turn.id);
      void learning.session?.addLine({ speaker: "partner", text: turn.text, ...lineContext() });
    }
  }, [state.turns, learning.session, lineContext]);

  // Profiles made before learning existed are told once, the first time they open.
  useEffect(() => {
    if (!memory || demo || view !== "conversation" || !settings.learning || learningTold()) return;
    markLearningTold();
    dispatch({ type: "notice", text: LEARNING_NOTICE });
  }, [memory, demo, view, settings.learning]);
```

7. In `finishSetup`, add `markLearningTold();` just before `setDemo(null);`. Setup already told the user.

8. In `exportActive`, pass the suggestions: `exportProfile(active.name, memory.notes(), memory.phrases(), now, learning.suggestions)`.

9. In `importFile`: before `let store: MemoryStore;` add `const told = learningTold(); markLearningTold();`. After the `persistFor(...).save(...)` line add:

```ts
      if (parsed.suggestions.length) await (await PendingStore.open(registry.keyValue, profile.id)).replaceAll(parsed.suggestions);
```

Change the final notice to:

```ts
    dispatch({ type: "notice", text: told || !settings.learning ? `Imported ${name}.` : `Imported ${name}. ${LEARNING_NOTICE}` });
```

10. Add handlers after `removeNote`:

```ts
  const keepSuggestion = async (s: PendingSuggestion, draft: DraftNote) => {
    if (!memory || !learning.session) return;
    const target = s.noteId ? memory.getNote(s.noteId) : undefined;
    const note = buildNote(draft, target ? { id: target.id, pinned: target.pinned, now: Date.now() } : { now: Date.now() });
    try {
      await memory.upsertNote(note);
    } catch {
      dispatch({ type: "notice", text: SAVE_FAILED });
      return;
    }
    // Notes changed, so cached suggestions are stale (R13).
    client?.clearCache();
    setNotesVersion((v) => v + 1);
    await learning.session.pending.remove(s.id);
    announce("Kept");
  };

  const toggleLearning = (on: boolean) => {
    setLearning(on);
    if (!on && registry) void clearQueues(registry.keyValue, registry.list().map((p) => p.id));
  };
```

11. `ProfileMenu` gets two more props:

```tsx
            suggestionCount={learning.suggestions.length}
            onSuggestions={() => leaveConversation("suggestions")}
```

12. After the `view === "notes"` block:

```tsx
        {view === "suggestions" && memory && (
          <SuggestedNotes
            suggestions={learning.suggestions}
            notes={notes}
            onKeep={(s, draft) => void keepSuggestion(s, draft)}
            onSkip={(id) => {
              void learning.session?.pending.skip(id);
              announce("Skipped");
            }}
            onSkipAll={() => {
              void learning.session?.pending.skipAll();
              announce("Skipped all");
            }}
            onDone={() => {
              setView("conversation");
              resetFocusToTop();
            }}
          />
        )}
```

13. `SettingsPanel`: `learning={settings.learning}` and `onLearning={toggleLearning}`.

- [ ] **Step 5: Run the screen tests**

Run: `npm test -- src/components/conversation-screen.test.tsx`
Expected: PASS, old and new. If the lint rule `react-hooks/set-state-in-effect` flags the hook, the `setLive` calls happen in a promise callback, not synchronously in the effect, so they are allowed. If it still flags them, report the exact rule name instead of disabling it broadly.

- [ ] **Step 6: Full unit run, typecheck, lint, commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add src/lib/learning/use-learning.ts src/components/conversation-screen.tsx src/components/conversation-screen.test.tsx
git commit -m "Learn from conversations: queue lines, review suggested notes, keep them as notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end test

**Files:**
- Modify: `tests/e2e/helpers.ts`
- Create: `tests/e2e/learning.spec.ts`

**Interfaces:**
- Consumes: the whole feature; `prepare(page)` from `tests/e2e/helpers.ts`.

- [ ] **Step 1: Stub `/api/learn` for every e2e test**

In `tests/e2e/helpers.ts`, inside `prepare`, next to the other `page.route` calls:

```ts
  // No suggested notes unless a test asks for them.
  await page.route("**/api/learn", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposals: [] }) }));
```

- [ ] **Step 2: Write the test**

Create `tests/e2e/learning.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function setUp(page: Page) {
  await page.getByLabel("What's your name?").fill("Priya");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("About you", { exact: true }).fill("I type to talk.");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("OnBeat will suggest notes from your conversations.")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
}

async function say(page: Page, text: string) {
  await page.getByLabel("What they said").fill(text);
  await page.getByRole("button", { name: "Add" }).click();
}

async function hidePage(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
}

test("a suggested note is reviewed, kept, and used by the next reply", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/learn", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string }[] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ proposals: [{ action: "add", kind: "person", name: "Ana", text: "Ana is my new carer. She comes on weekday mornings.", lineIds: [body.lines[0].id] }] }),
    });
  });
  const suggestBodies: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/suggest")) suggestBodies.push(r.postData() ?? "");
  });
  await page.goto("/");
  await setUp(page);
  await say(page, "Your new carer Ana comes on weekday mornings.");
  await say(page, "She starts on Monday.");
  await hidePage(page);

  const menu = page.getByRole("button", { name: "Priya, 1 suggested note" });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole("button", { name: "Suggested notes (1)" }).click();
  await expect(page.getByRole("heading", { name: "New note: People" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Keep: Ana is my new carer. She comes on weekday mornings." }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await say(page, "Is Ana coming tomorrow?");
  await expect(page.locator("#replies").getByText("Replies ready")).toBeVisible();
  expect(suggestBodies.at(-1)).toContain("Ana is my new carer.");
});

test("an existing profile is told about suggested notes once", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page);
  await page.evaluate(() => localStorage.removeItem("onbeat:learning-told"));
  await page.reload();
  const notice = page.getByText("New: OnBeat can suggest notes from your conversations for you to review. Turn it off in Settings.");
  await expect(notice).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Priya", exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `npm run e2e -- tests/e2e/learning.spec.ts`, then `npm run e2e`.
Expected: the new tests pass, and every existing e2e test still passes (the default `/api/learn` stub returns no proposals, so menu names are unchanged). `live-hearing.spec.ts` downloads real models and may be skipped or slow; follow what its own header says.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers.ts tests/e2e/learning.spec.ts
git commit -m "Add end-to-end tests for suggested notes and the one-time notice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Learning eval harness

**Files:**
- Modify: `eval/judge.ts`, `package.json`
- Create: `eval/learning/scenarios.ts`, `eval/learning/judge.ts`, `eval/learning/score.ts`, `eval/learning/run.ts`
- Test: `eval/learning/judge.test.ts`, `eval/learning/score.test.ts`, `eval/learning/scenarios.test.ts`

**Interfaces:**
- Consumes: `judgeEndpoints`, `JudgeEndpoint`, `JUDGE_VOTES` (`eval/judge.ts`); `withRetry` (`eval/retry.ts`); `personas` (`src/data/personas.ts`); `MemoryStore`; `memoryKeyValue`; `relatedNotes`, `toPending` (Task 8); `PendingStore` (Task 7); `learnFromBatch` (Task 6); `providerConfigs`, `ProviderId` (`src/lib/server/providers.ts`); `composeNoteText` (Task 1); `dateLine` (Task 4).
- Produces:
  - `eval/judge.ts`: `judgeChat(messages: ChatMessage[], opts)`. `judge(input, opts)` becomes `judgeChat(judgeMessages(input), opts)`.
  - `eval/learning/scenarios.ts`: `ExpectedFact`, `LearnScenario`, `EVAL_TODAY = "2026-10-05"`, `learnScenarios: LearnScenario[]`.
  - `eval/learning/judge.ts`: `LEARN_JUDGE_VERSION`, `ShownSuggestion { action: "add" | "edit"; text: string; oldText?: string; noteId?: string }`, `learnJudgeMessages(input): ChatMessage[]`, `LearnVerdict { n: number; keep: boolean; invented: string[]; matches: number | null }`, `parseLearnVerdicts(text: string, count: number): LearnVerdict[] | null`, `voteLearn(sets: (LearnVerdict[] | null)[]): LearnVerdict[] | null`.
  - `eval/learning/score.ts`: `LearnScenarioResult`, `LearnSummary`, `summarizeLearning(model: string, results: LearnScenarioResult[]): LearnSummary`, `learningMarkdown(summaries: LearnSummary[]): string`.
  - `npm run eval:learning -- [--split dev|test] [--models groq:<model>,...] [--votes n] [--delay ms] [--only id]`.

- [ ] **Step 1: Split `judge()` so the learning judge can reuse its endpoints and retries**

In `eval/judge.ts`, rename the body of `judge` into:

```ts
export async function judgeChat(
  messages: ChatMessage[],
  opts: { endpoints: JudgeEndpoint[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; spent?: Set<string> },
): Promise<{ text: string; endpoint: string; model: string; finishReason?: string }> {
  // ...the existing body, with `messages: judgeMessages(input)` replaced by `messages`...
}

export function judge(
  input: JudgeInput,
  opts: { endpoints: JudgeEndpoint[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; spent?: Set<string> },
): ReturnType<typeof judgeChat> {
  return judgeChat(judgeMessages(input), opts);
}
```

Keep the doc comment on `judgeChat`. Run `npm test -- eval/judge.test.ts`: Expected PASS with no test changes.

- [ ] **Step 2: Write the failing tests for the learning judge and score**

Create `eval/learning/judge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { learnJudgeMessages, parseLearnVerdicts, voteLearn, type LearnVerdict } from "./judge";

describe("learnJudgeMessages", () => {
  it("lists the lines, notes, expected facts and suggestions", () => {
    const [, user] = learnJudgeMessages({
      today: "2026-10-05",
      lines: [{ speaker: "partner", text: "Your physio moved to Thursdays.", partnerName: "Leila" }, { speaker: "user", text: "OK." }],
      notes: ["I have physio on Tuesdays at 10:30."],
      expected: [{ action: "edit", fact: "Physio is now on Thursdays at 10:30.", oldText: "I have physio on Tuesdays at 10:30." }],
      shown: [{ action: "edit", text: "I have physio on Thursdays at 10:30.", oldText: "I have physio on Tuesdays at 10:30." }],
    });
    expect(user.content).toContain("- Leila: Your physio moved to Thursdays.");
    expect(user.content).toContain("- Me: OK.");
    expect(user.content).toContain('1. [change to: "I have physio on Tuesdays at 10:30."] Physio is now on Thursdays at 10:30.');
    expect(user.content).toContain('1. [change] "I have physio on Tuesdays at 10:30." -> "I have physio on Thursdays at 10:30."');
    expect(user.content).toContain("Today is Monday 5 October 2026.");
  });

  it("says when nothing is worth a note", () => {
    const [, user] = learnJudgeMessages({ today: "2026-10-05", lines: [{ speaker: "user", text: "Hi" }], notes: [], expected: [], shown: [{ action: "add", text: "x" }] });
    expect(user.content).toContain("(none: nothing here is worth a note)");
  });
});

describe("parseLearnVerdicts", () => {
  it("reads one verdict per suggestion", () => {
    const text = '{"suggestions": [{"n": 1, "keep": true, "invented": [], "matches": 1}, {"n": 2, "keep": false, "invented": ["4pm"], "matches": null}]}';
    expect(parseLearnVerdicts(text, 2)).toEqual([
      { n: 1, keep: true, invented: [], matches: 1 },
      { n: 2, keep: false, invented: ["4pm"], matches: null },
    ]);
  });

  it("refuses an answer that skips a suggestion or isn't JSON", () => {
    expect(parseLearnVerdicts('{"suggestions": [{"n": 1, "keep": true, "invented": [], "matches": null}]}', 2)).toBeNull();
    expect(parseLearnVerdicts("I think they are fine", 1)).toBeNull();
  });
});

describe("voteLearn", () => {
  const v = (keep: boolean, invented: string[], matches: number | null): LearnVerdict[] => [{ n: 1, keep, invented, matches }];
  it("takes the majority for each suggestion", () => {
    expect(voteLearn([v(true, [], 1), v(false, ["x"], null), v(true, [], 1)])).toEqual([{ n: 1, keep: true, invented: [], matches: 1 }]);
  });
  it("ignores unreadable calls, and gives up if all are unreadable", () => {
    expect(voteLearn([null, v(false, ["x"], null)])).toEqual([{ n: 1, keep: false, invented: ["x"], matches: null }]);
    expect(voteLearn([null, null])).toBeNull();
  });
});
```

Create `eval/learning/score.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { learningMarkdown, summarizeLearning, type LearnScenarioResult } from "./score";

const result = (over: Partial<LearnScenarioResult>): LearnScenarioResult => ({
  id: "x",
  model: "m",
  expected: [],
  shown: [],
  verdicts: [],
  ms: 1000,
  ...over,
});

describe("summarizeLearning", () => {
  it("counts precision, invented details, edit targeting and recall", () => {
    const s = summarizeLearning("m", [
      result({
        expected: [{ action: "edit", noteId: "physio", fact: "physio on Thursdays" }, { action: "add", fact: "Ana is the new carer" }],
        shown: [
          { action: "edit", noteId: "physio", text: "a" },
          { action: "add", text: "b" },
          { action: "add", text: "c" },
        ],
        verdicts: [
          { n: 1, keep: true, invented: [], matches: 1 },
          { n: 2, keep: true, invented: [], matches: 2 },
          { n: 3, keep: false, invented: ["4pm"], matches: null },
        ],
      }),
      result({ expected: [{ action: "edit", noteId: "sam", fact: "Sam moves" }], shown: [{ action: "add", text: "d" }], verdicts: [{ n: 1, keep: true, invented: [], matches: 1 }] }),
      result({ shown: [{ action: "add", text: "e" }], verdicts: null }),
      result({ error: "timeout", verdicts: null }),
    ]);
    expect(s).toMatchObject({ scenarios: 4, shown: 4, kept: 3, invented: 1, expected: 3, found: 3, edits: 2, editsRight: 1, unjudged: 1, errors: 1 });
  });

  it("writes a table with the targets", () => {
    const md = learningMarkdown([summarizeLearning("groq:qwen", [])]);
    expect(md).toContain("| Model |");
    expect(md).toContain("Worth keeping (target 80%)");
    expect(md).toContain("Invented (target under 5%)");
    expect(md).toContain("Edits right (target 90%)");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm test -- eval/learning`
Expected: FAIL. The modules don't exist.

- [ ] **Step 4: Implement the scenario types, judge and score**

Create `eval/learning/scenarios.ts` with the types, the date, and the first three scenarios. Task 15 adds the rest.

```ts
import type { Speaker } from "@/lib/learning/types";

/** Monday. Fixed, so "Thursday" always means Thursday 8 October in expected facts. */
export const EVAL_TODAY = "2026-10-05";

export interface ExpectedFact {
  /** add: a new note. edit: a change to the persona note `noteId`. */
  action: "add" | "edit";
  noteId?: string;
  /** The fact in plain words, for the judge to match suggestions against. */
  fact: string;
}

export interface LearnScenario {
  id: string;
  split: "dev" | "test";
  persona: "maya" | "tom" | "aisha";
  /** Who the user is talking with and where, as persona note ids. */
  partnerId?: string;
  placeId?: string;
  /** Partner lines may carry caption errors on purpose (dropped words, misheard names). */
  lines: { speaker: Speaker; text: string }[];
  /** Empty when nothing in the lines is worth a note. */
  expected: ExpectedFact[];
  /** What the scenario tests, for reading results. */
  about: string;
}

export const learnScenarios: LearnScenario[] = [
  {
    id: "maya-edit-physio",
    split: "dev",
    persona: "maya",
    partnerId: "m-leila",
    about: "partner changes a routine",
    lines: [
      { speaker: "partner", text: "Mum, the clinic called. Your physio is moving to Thursdays from next week, same time." },
      { speaker: "user", text: "Thursdays are fine." },
    ],
    expected: [{ action: "edit", noteId: "m-physio", fact: "Physio is on Thursdays at 10:30 now." }],
  },
  {
    id: "tom-small-talk",
    split: "dev",
    persona: "tom",
    partnerId: "t-priya",
    placeId: "t-pharmacy",
    about: "nothing worth a note",
    lines: [
      { speaker: "partner", text: "Busy in here today, isn't it?" },
      { speaker: "user", text: "Very busy. Rain always brings people in." },
      { speaker: "partner", text: "Here you go, have a good one." },
    ],
    expected: [],
  },
  {
    id: "aisha-new-person",
    split: "test",
    persona: "aisha",
    partnerId: "a-marco",
    placeId: "a-office",
    about: "user states a new person",
    lines: [
      { speaker: "partner", text: "Have you met the new intern yet?" },
      { speaker: "user", text: "Yes, Tariq. He's shadowing me on the Harbor redesign this month." },
    ],
    expected: [{ action: "add", fact: "Tariq is an intern shadowing Aisha on the Harbor redesign this month." }],
  },
];
```

Create `eval/learning/scenarios.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { learnScenarios } from "./scenarios";

describe("learning scenarios", () => {
  it("have unique ids and point at real persona notes", () => {
    expect(new Set(learnScenarios.map((s) => s.id)).size).toBe(learnScenarios.length);
    for (const s of learnScenarios) {
      const ids = new Set(personas.find((p) => p.id === s.persona)!.notes.map((n) => n.id));
      for (const id of [s.partnerId, s.placeId, ...s.expected.map((e) => e.noteId)]) if (id) expect(ids.has(id), `${s.id}: ${id}`).toBe(true);
      for (const e of s.expected) expect(e.action === "edit", `${s.id}: an edit names its note`).toBe(Boolean(e.noteId));
      expect(s.lines.length, s.id).toBeGreaterThanOrEqual(2);
    }
  });
});
```

Create `eval/learning/judge.ts`:

```ts
import { dateLine } from "@/lib/learning/prompt";
import type { Speaker } from "@/lib/learning/types";
import type { ChatMessage } from "@/lib/suggest/prompt";

/** Bump when the prompt below changes, so old cached verdicts aren't reused. */
export const LEARN_JUDGE_VERSION = 1;

export interface ShownSuggestion {
  action: "add" | "edit";
  text: string;
  oldText?: string;
  noteId?: string;
}

export interface LearnJudgeInput {
  today: string;
  lines: { speaker: Speaker; text: string; partnerName?: string }[];
  /** Texts of the notes the app had. */
  notes: string[];
  expected: { action: "add" | "edit"; fact: string; oldText?: string }[];
  shown: ShownSuggestion[];
}

export interface LearnVerdict {
  n: number;
  keep: boolean;
  invented: string[];
  matches: number | null;
}

export function learnJudgeMessages(j: LearnJudgeInput): ChatMessage[] {
  const content = [
    "A person who cannot speak uses an app that suggests replies built from notes about them. After a conversation the app suggested new notes, or changes to notes. Judge each suggestion.",
    "",
    dateLine(j.today),
    "",
    'Conversation ("Me" is the person; other lines are automatic captions and may contain errors):',
    j.lines.map((l) => `- ${l.speaker === "user" ? "Me" : (l.partnerName ?? "Them")}: ${l.text}`).join("\n"),
    "",
    "Notes the app already had:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    "",
    "Facts a careful helper would have noted:",
    j.expected.length
      ? j.expected.map((e, i) => `${i + 1}. ${e.action === "edit" ? `[change to: "${e.oldText ?? ""}"]` : "[new note]"} ${e.fact}`).join("\n")
      : "(none: nothing here is worth a note)",
    "",
    "Suggestions:",
    j.shown.map((s, i) => `${i + 1}. ${s.action === "edit" ? `[change] "${s.oldText ?? ""}" -> "${s.text}"` : `[new note] "${s.text}"`}`).join("\n"),
    "",
    "For each suggestion:",
    "- keep: true if it is true to the conversation and worth saving for future replies: a fact about the person, their people, places, routines or likes, or a dated plan. False for small talk, guesses, a misheard caption taken literally, facts about other people that don't matter to the person, or something the notes already say.",
    '- invented: every detail (name, number, time, date, place, claim) in the suggestion found in none of the conversation, the notes, or the date list. Writing "Thursday" as its date from the list is not invented. [] if none.',
    "- matches: the number of the listed fact it records, or null.",
    "",
    'Reply with JSON only: {"suggestions": [{"n": 1, "keep": true, "invented": [], "matches": 1}]}',
  ].join("\n");
  return [
    { role: "system", content: "You check suggested notes against a conversation. Be strict about invented details. Answer with JSON only." },
    { role: "user", content },
  ];
}

export function parseLearnVerdicts(text: string, count: number): LearnVerdict[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (data as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return null;
  const verdicts: LearnVerdict[] = [];
  for (let n = 1; n <= count; n++) {
    const v = list.find((x) => (x as { n?: unknown })?.n === n) as Record<string, unknown> | undefined;
    if (!v || typeof v.keep !== "boolean" || !Array.isArray(v.invented)) return null;
    const matches = typeof v.matches === "number" ? v.matches : null;
    verdicts.push({ n, keep: v.keep, invented: v.invented.map(String), matches });
  }
  return verdicts;
}

/** Majority per suggestion over the readable calls: keep, whether anything is invented, and the most common match. */
export function voteLearn(sets: (LearnVerdict[] | null)[]): LearnVerdict[] | null {
  const readable = sets.filter((s): s is LearnVerdict[] => s !== null);
  if (readable.length === 0) return null;
  return readable[0].map((_, i) => {
    const calls = readable.map((s) => s[i]);
    const keep = calls.filter((c) => c.keep).length * 2 > calls.length;
    const inventedCalls = calls.filter((c) => c.invented.length > 0);
    const invented = inventedCalls.length * 2 > calls.length ? inventedCalls[0].invented : [];
    const counts = new Map<number | null, number>();
    for (const c of calls) counts.set(c.matches, (counts.get(c.matches) ?? 0) + 1);
    const matches = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { n: i + 1, keep, invented, matches };
  });
}
```

Create `eval/learning/score.ts`:

```ts
import { percentile } from "@/lib/stats";
import type { LearnVerdict, ShownSuggestion } from "./judge";
import type { ExpectedFact } from "./scenarios";

export interface LearnScenarioResult {
  id: string;
  model: string;
  expected: ExpectedFact[];
  shown: ShownSuggestion[];
  /** Null when the judge couldn't be read. */
  verdicts: LearnVerdict[] | null;
  ms: number;
  error?: string;
}

export interface LearnSummary {
  model: string;
  scenarios: number;
  /** Suggestions shown in judged scenarios. */
  shown: number;
  kept: number;
  invented: number;
  expected: number;
  /** Expected facts recorded by a suggestion judged worth keeping. */
  found: number;
  edits: number;
  /** Expected edits recorded as an edit of the right note. */
  editsRight: number;
  unjudged: number;
  errors: number;
  p50ms: number | null;
}

export function summarizeLearning(model: string, results: LearnScenarioResult[]): LearnSummary {
  const s: LearnSummary = { model, scenarios: results.length, shown: 0, kept: 0, invented: 0, expected: 0, found: 0, edits: 0, editsRight: 0, unjudged: 0, errors: 0, p50ms: null };
  for (const r of results) {
    if (r.error) {
      s.errors++;
      continue;
    }
    s.expected += r.expected.length;
    s.edits += r.expected.filter((e) => e.action === "edit").length;
    if (!r.verdicts) {
      s.unjudged++;
      continue;
    }
    s.shown += r.shown.length;
    const found = new Set<number>();
    r.verdicts.forEach((v, i) => {
      if (v.keep) s.kept++;
      if (v.invented.length > 0) s.invented++;
      if (v.keep && v.matches !== null) {
        found.add(v.matches);
        const e = r.expected[v.matches - 1];
        const shown = r.shown[i];
        if (e?.action === "edit" && shown.action === "edit" && shown.noteId === e.noteId) s.editsRight++;
      }
    });
    s.found += found.size;
  }
  s.p50ms = percentile(results.filter((r) => !r.error).map((r) => r.ms), 50);
  return s;
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}% (${a}/${b})`);

export function learningMarkdown(summaries: LearnSummary[]): string {
  const head = "| Model | Scenarios | Shown | Worth keeping (target 80%) | Invented (target under 5%) | Edits right (target 90%) | Recall | Batch p50 |";
  const rule = "|---|---|---|---|---|---|---|---|";
  const rows = summaries.map(
    (s) =>
      `| ${s.model} | ${s.scenarios}${s.errors ? ` (${s.errors} failed)` : ""}${s.unjudged ? ` (${s.unjudged} unjudged)` : ""} | ${s.shown} | ${pct(s.kept, s.shown)} | ${pct(s.invented, s.shown)} | ${pct(s.editsRight, s.edits)} | ${pct(s.found, s.expected)} | ${s.p50ms === null ? "n/a" : `${s.p50ms} ms`} |`,
  );
  return [head, rule, ...rows].join("\n");
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test -- eval/learning eval/judge.test.ts`
Expected: PASS. In the score test, the second scenario's expected edit is matched by an add, so it counts as found but not as an edit made right.

- [ ] **Step 6: Implement the runner**

Create `eval/learning/run.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { personas } from "@/data/personas";
import { PendingStore } from "@/lib/learning/pending";
import { learnFromBatch } from "@/lib/learning/server";
import { relatedNotes, toPending } from "@/lib/learning/session";
import type { QueuedLine } from "@/lib/learning/types";
import { MemoryStore } from "@/lib/memory/store";
import { memoryKeyValue } from "@/lib/profiles/kv";
import { composeNoteText } from "@/lib/profiles/notes";
import { providerConfigs, type ProviderId } from "@/lib/server/providers";
import { judgeChat, judgeEndpoints } from "../judge";
import { withRetry } from "../retry";
import { LEARN_JUDGE_VERSION, learnJudgeMessages, parseLearnVerdicts, voteLearn, type LearnVerdict, type ShownSuggestion } from "./judge";
import { EVAL_TODAY, learnScenarios, type LearnScenario } from "./scenarios";
import { learningMarkdown, summarizeLearning, type LearnScenarioResult } from "./score";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Keys can also come from the environment.
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const CACHE = "eval/learning/.cache/judge.json";

/** Judge answers by prompt hash, so re-scoring the same suggestions costs nothing. */
function loadCache(): Record<string, string> {
  return existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string>) : {};
}

async function runScenario(sc: LearnScenario, provider: ProviderId, model: string): Promise<{ shown: ShownSuggestion[]; notes: string[]; ms: number }> {
  const persona = personas.find((p) => p.id === sc.persona)!;
  const memory = await MemoryStore.create();
  await memory.replaceAll(persona.notes, []);
  const name = (id?: string) => (id ? memory.getNote(id)?.entities[0] : undefined);
  const at = new Date(`${EVAL_TODAY}T12:00:00`).getTime();
  const lines: QueuedLine[] = sc.lines.map((l, i) => ({
    id: `line-${i + 1}`,
    speaker: l.speaker,
    text: l.text,
    at,
    ...(name(sc.partnerId) ? { partnerName: name(sc.partnerId) } : {}),
    ...(name(sc.placeId) ? { placeName: name(sc.placeId) } : {}),
  }));
  const notes = await relatedNotes(memory, lines);
  const body = {
    today: EVAL_TODAY,
    lines: lines.map(({ id, speaker, text, partnerName, placeName }) => ({ id, speaker, text, ...(partnerName ? { partnerName } : {}), ...(placeName ? { placeName } : {}) })),
    notes: notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text })),
  };
  const configs = providerConfigs({ ...process.env, ...(provider === "groq" ? { GROQ_MODEL: model } : { CLOUDFLARE_MODEL: model }) });
  const started = Date.now();
  const proposals = await withRetry(sc.id, (cooldown) => learnFromBatch(body, { order: [provider], configs, cooldown }));
  const ms = Date.now() - started;
  // What the user would see: through the same merge rules as the app.
  const pending = await PendingStore.open(memoryKeyValue(), "eval");
  const byId = new Map(lines.map((l) => [l.id, l]));
  await pending.merge(proposals.map((p) => toPending(p, byId, memory, at)), memory.notes());
  const shown = pending.list().map((s) => ({ action: s.action, text: composeNoteText(s.draft), ...(s.oldText ? { oldText: s.oldText } : {}), ...(s.noteId ? { noteId: s.noteId } : {}) }));
  return { shown, notes: notes.map((n) => n.text), ms };
}

async function main() {
  const split = (arg("split") ?? "dev") as "dev" | "test";
  const models = (arg("models") ?? "groq:qwen/qwen3.8-27b").split(",").map((m) => {
    const [provider, ...rest] = m.split(":");
    return { provider: provider as ProviderId, model: rest.join(":"), label: m };
  });
  const votes = Number(arg("votes") ?? (split === "test" ? 3 : 1));
  const delay = Number(arg("delay") ?? 3000);
  const only = arg("only");
  const scenarios = learnScenarios.filter((s) => s.split === split && (!only || s.id === only));
  const endpoints = judgeEndpoints();
  const spent = new Set<string>();
  const cache = loadCache();
  mkdirSync("eval/learning/.cache", { recursive: true });
  mkdirSync("eval/learning/results", { recursive: true });

  const summaries = [];
  for (const m of models) {
    const results: LearnScenarioResult[] = [];
    for (const sc of scenarios) {
      const persona = personas.find((p) => p.id === sc.persona)!;
      try {
        const { shown, notes, ms } = await runScenario(sc, m.provider, m.model);
        let verdicts: LearnVerdict[] | null = [];
        if (shown.length > 0) {
          const messages = learnJudgeMessages({
            today: EVAL_TODAY,
            lines: sc.lines.map((l) => ({ ...l, ...(l.speaker === "partner" && sc.partnerId ? { partnerName: persona.notes.find((n) => n.id === sc.partnerId)?.entities[0] } : {}) })),
            notes,
            expected: sc.expected.map((e) => ({ ...e, ...(e.noteId ? { oldText: persona.notes.find((n) => n.id === e.noteId)?.text } : {}) })),
            shown,
          });
          const sets = [];
          for (let v = 0; v < votes; v++) {
            const key = createHash("sha256").update(JSON.stringify({ LEARN_JUDGE_VERSION, messages, v })).digest("hex");
            cache[key] ??= (await judgeChat(messages, { endpoints, spent })).text;
            writeFileSync(CACHE, JSON.stringify(cache));
            sets.push(parseLearnVerdicts(cache[key], shown.length));
          }
          verdicts = voteLearn(sets);
        }
        results.push({ id: sc.id, model: m.label, expected: sc.expected, shown, verdicts, ms });
        console.log(`${m.label} ${sc.id}: ${shown.length} shown, ${verdicts ? verdicts.filter((v) => v.keep).length : "?"} worth keeping`);
      } catch (err) {
        results.push({ id: sc.id, model: m.label, expected: sc.expected, shown: [], verdicts: null, ms: 0, error: err instanceof Error ? err.message : String(err) });
        console.log(`${m.label} ${sc.id}: failed (${err instanceof Error ? err.message : String(err)})`);
      }
      await sleep(delay);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(`eval/learning/results/${stamp}-${split}-${m.label.replace(/[^a-z0-9.-]+/gi, "_")}.json`, JSON.stringify(results, null, 2));
    summaries.push(summarizeLearning(m.label, results));
  }
  console.log(`\n${split} split, ${votes} judge vote(s)\n`);
  console.log(learningMarkdown(summaries));
}

void main();
```

Add to `package.json` `scripts`: `"eval:learning": "tsx eval/learning/run.ts"`. Add `eval/learning/.cache/` to `.gitignore` next to the existing eval cache lines.

- [ ] **Step 7: Smoke-run the runner on one scenario**

Run: `npm run eval:learning -- --only maya-edit-physio`
Expected: one line of output for `maya-edit-physio` and a table. A Groq free-tier 429 is retried by `withRetry` and `judgeChat`. If no key is set, the scenario shows as failed. That's fine for the smoke run: the table still prints.

- [ ] **Step 8: Typecheck, lint and commit**

Run: `npm run typecheck && npm run lint && npm test -- eval`

```bash
git add eval/judge.ts eval/learning package.json .gitignore
git commit -m "Add the learning eval: scenarios, a judge for suggested notes, scoring and a runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Write the learning scenarios and the judge gold set

**Files:**
- Modify: `eval/learning/scenarios.ts`
- Create: `eval/learning/judge-gold.ts`, `eval/learning/judge-check.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `LearnScenario`, `ExpectedFact` (Task 14), `learnJudgeMessages`, `parseLearnVerdicts` (Task 14), `judgeChat`, `judgeEndpoints` (Task 14 / `eval/judge.ts`), persona notes (`src/data/personas.ts`).
- Produces: 60 scenarios (40 dev, 20 test); `learnGold: { scenarioId: string; shown: ShownSuggestion[]; labels: { keep: boolean; invented: boolean; matches: number | null }[] }[]` with 12 entries; `npm run eval:learning-judge-check`.

- [ ] **Step 1: Write the scenarios**

Extend `learnScenarios` to exactly 60 entries (keep the three from Task 14). Split them across personas (20 each, roughly) and categories as below. Dev and test get the same mix, with test at about one third of each category.

| Category | Count | Dev / test | What makes it |
|---|---|---|---|
| New fact from the user | 10 | 7 / 3 | The user states a durable fact ("My sister Hana visits on Sundays.") |
| New fact from the partner | 10 | 7 / 3 | The partner states a fact about the user's life ("Your new carer starts Monday, her name's Ana.") |
| Change to an existing note | 12 | 8 / 4 | A line contradicts or extends a persona note. `expected` is an edit with that `noteId`. Cover each persona's routine, person, place and preference notes. |
| Dated one-off | 6 | 4 / 2 | "tomorrow", "on Thursday", "next Friday" relative to `EVAL_TODAY` (Monday 5 October 2026). The expected fact states the full date ("Thursday 8 October"). |
| Nothing worth a note | 10 | 7 / 3 | Small talk, questions, weather, what's for lunch today, thanks. `expected: []`. |
| Other people's business | 4 | 2 / 2 | Gossip about a third party that doesn't affect the user. `expected: []`. |
| Misheard captions | 5 | 3 / 2 | A partner line with realistic Moonshine errors (dropped words, a name misheard as a common word, "fourteen" for "forty"). Where the meaning is still clear, expect the fact with the right detail; where it isn't, `expected: []`. Base the errors on real misrecognitions in `eval/hearing/results/` (look at a Moonshine tiny run's JSON for pairs of reference and hypothesis). |
| Mixed | 3 | 2 / 1 | Two or three facts plus small talk in one batch, including one change and one add. |

Rules for writing them:
- Every scenario has 2 to 8 lines, and ids are `<persona>-<short-slug>`, unique.
- Use persona note ids exactly as in `src/data/personas.ts` (for example `m-physio`, `t-doctor`, `a-standup`). The scenario test from Task 14 checks this.
- Write `fact` as what a careful helper would note, in plain words. Don't write the note text itself (the judge matches meaning, not wording).
- No fact may rely on anything outside the lines and the persona notes.
- Examples of each category, to set the level:

```ts
  {
    id: "maya-sister-visits",
    split: "dev",
    persona: "maya",
    about: "user states a new person",
    lines: [
      { speaker: "partner", text: "Any plans this weekend?" },
      { speaker: "user", text: "My sister Hana is coming up from Leeds. She visits every other Sunday." },
    ],
    expected: [{ action: "add", fact: "Maya's sister Hana lives in Leeds and visits every other Sunday." }],
  },
  {
    id: "tom-dentist-thursday",
    split: "dev",
    persona: "tom",
    partnerId: "t-doctor",
    about: "dated one-off from the partner",
    lines: [
      { speaker: "partner", text: "We've booked your blood test for Thursday at nine in the morning." },
      { speaker: "user", text: "Thursday at 9 works." },
    ],
    expected: [{ action: "add", fact: "Blood test on Thursday 8 October at 9am." }],
  },
  {
    id: "aisha-gossip",
    split: "test",
    persona: "aisha",
    partnerId: "a-jen",
    placeId: "a-office",
    about: "other people's business",
    lines: [
      { speaker: "partner", text: "Did you hear Dev from sales is dating someone from legal?" },
      { speaker: "user", text: "No idea, I don't follow that." },
    ],
    expected: [],
  },
  {
    id: "maya-misheard-order",
    split: "dev",
    persona: "maya",
    partnerId: "m-sam",
    placeId: "m-cafe",
    about: "misheard caption, meaning still clear",
    lines: [
      { speaker: "partner", text: "we are out of oat milk so I made your latte with all mund milk is that ok" },
      { speaker: "user", text: "Almond is fine, I actually prefer it now. Make that my usual." },
    ],
    expected: [{ action: "edit", noteId: "m-usual", fact: "Maya's usual order is a large almond milk latte, no sugar." }],
  },
```

- [ ] **Step 2: Check the scenario set**

Run: `npm test -- eval/learning/scenarios.test.ts`, then:

```bash
npx tsx -e "import('./eval/learning/scenarios.ts').then(({ learnScenarios: s }) => { const c = (f) => s.filter(f).length; console.log({ total: s.length, dev: c(x => x.split === 'dev'), test: c(x => x.split === 'test'), empty: c(x => !x.expected.length), edits: c(x => x.expected.some(e => e.action === 'edit')) }); })"
```

Expected: `total: 60, dev: 40, test: 20`, about 16 empty and about 15 with an edit.

- [ ] **Step 3: Write the judge gold set**

Create `eval/learning/judge-gold.ts`. It holds 12 hand-labelled entries drawn from dev scenarios only. Each entry lists suggestions as the app would show them, including deliberately bad ones, with the labels a careful person would give. Cover: a correct edit; a correct add; a correct dated one-off written with its full date (not invented); an add with an invented time; an add with a wrong name from a misheard caption; small talk saved as a note (keep false); gossip (keep false); a repeat of an existing note (keep false); an edit that loses part of the old note; and an add that matches no expected fact but is true and useful (keep true, matches null).

```ts
import type { ShownSuggestion } from "./judge";

export interface LearnGoldEntry {
  scenarioId: string;
  shown: ShownSuggestion[];
  labels: { keep: boolean; invented: boolean; matches: number | null }[];
}

export const learnGold: LearnGoldEntry[] = [
  {
    scenarioId: "maya-edit-physio",
    shown: [
      { action: "edit", noteId: "m-physio", oldText: "I have physio on Tuesdays at 10:30.", text: "I have physio on Thursdays at 10:30." },
      { action: "add", text: "Physio on Thursdays at 11:30." },
    ],
    labels: [
      { keep: true, invented: false, matches: 1 },
      { keep: false, invented: true, matches: null },
    ],
  },
  // ...11 more entries as described above, each with one label per suggestion...
];
```

Write all 12 entries out in full. A partial set doesn't calibrate anything.

- [ ] **Step 4: Write the judge check**

Create `eval/learning/judge-check.ts`:

```ts
import { personas } from "@/data/personas";
import { judgeChat, judgeEndpoints } from "../judge";
import { learnJudgeMessages, parseLearnVerdicts } from "./judge";
import { learnGold } from "./judge-gold";
import { EVAL_TODAY, learnScenarios } from "./scenarios";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Keys can also come from the environment.
}

/** Judges every gold entry once per endpoint and reports agreement with the hand labels. */
async function main() {
  for (const ep of judgeEndpoints()) {
    let keepAgree = 0;
    let inventedAgree = 0;
    let total = 0;
    for (const g of learnGold) {
      const sc = learnScenarios.find((s) => s.id === g.scenarioId)!;
      const persona = personas.find((p) => p.id === sc.persona)!;
      const partnerName = sc.partnerId ? persona.notes.find((n) => n.id === sc.partnerId)?.entities[0] : undefined;
      const messages = learnJudgeMessages({
        today: EVAL_TODAY,
        lines: sc.lines.map((l) => ({ ...l, ...(l.speaker === "partner" && partnerName ? { partnerName } : {}) })),
        notes: persona.notes.map((n) => n.text),
        expected: sc.expected.map((e) => ({ ...e, ...(e.noteId ? { oldText: persona.notes.find((n) => n.id === e.noteId)?.text } : {}) })),
        shown: g.shown,
      });
      const verdicts = parseLearnVerdicts((await judgeChat(messages, { endpoints: [ep] })).text, g.shown.length);
      g.labels.forEach((label, i) => {
        total++;
        const v = verdicts?.[i];
        if (v && v.keep === label.keep) keepAgree++;
        else console.log(`${ep.name} ${g.scenarioId} #${i + 1}: keep ${v?.keep} vs ${label.keep}`);
        if (v && v.invented.length > 0 === label.invented) inventedAgree++;
        else console.log(`${ep.name} ${g.scenarioId} #${i + 1}: invented ${JSON.stringify(v?.invented)} vs ${label.invented}`);
      });
    }
    console.log(`${ep.name}: keep ${keepAgree}/${total}, invented ${inventedAgree}/${total}`);
  }
}

void main();
```

Add `"eval:learning-judge-check": "tsx eval/learning/judge-check.ts"` to `package.json`.

The gold notes list is the persona's full notes rather than the notes sent. That is deliberate: a gold label must not depend on what search happened to send.

- [ ] **Step 5: Commit**

```bash
git add eval/learning package.json
git commit -m "Add 60 learning scenarios and a hand-labelled gold set for the learning judge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Measure, tune, and report

**Files:**
- Modify (only as the measurements call for it): `src/lib/learning/prompt.ts`, `src/app/api/learn/route.ts`, `eval/learning/judge.ts`
- Create: `eval/learning/RESULTS.md`
- Modify: `README.md`

This task needs `GROQ_API_KEY` (and optionally the Cloudflare keys) in `.env.local`. Groq is on the free tier: expect the judge to pace itself. Run one eval at a time (this machine is short on memory).

- [ ] **Step 1: Calibrate the judge**

Run: `npm run eval:learning-judge-check`
Target: the judge agrees with at least 92% of the gold labels on keep, and with every gold label on invented. If it misses, change the rubric in `learnJudgeMessages`, bump `LEARN_JUDGE_VERSION`, and run again. Never change a gold label to fit the judge unless the label itself was wrong; if it was, say so in the commit message.

- [ ] **Step 2: Baseline on dev with both candidate models**

Run: `npm run eval:learning -- --split dev --models groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-20b`
Record both tables. Read the result JSON for every suggestion judged not worth keeping or invented, and group the failures by cause (a prompt rule the model ignored, a check that let something through, a scenario that is unfair).

- [ ] **Step 3: Tune, one change at a time**

For each cause, make one change: a prompt rule in `buildLearnMessages`, a tighter check in `checkProposals` with a new unit test, or a fixed scenario with the reason in the commit message. Rerun dev after each change and keep it only if it helps. Commit each kept change separately, with the before and after dev numbers in the commit message.

Stop tuning when dev meets all three targets, or after the changes stop helping.

- [ ] **Step 4: Pick the model**

Use the model with the lower invented rate. If they tie, use the higher worth-keeping rate. If it isn't the reply model, make it the route's default: in `src/app/api/learn/route.ts` change `env.LEARN_MODEL ?? env.GROQ_MODEL` to `env.LEARN_MODEL ?? "<chosen model>"`, and add a route test asserting `streamCompletion` receives that model in `configs.groq.model` when `LEARN_MODEL` is unset.

- [ ] **Step 5: Run the test split once**

Run: `npm run eval:learning -- --split test --models groq:<chosen model> --votes 3`
Don't tune after this run. The test split is used up.

- [ ] **Step 6: Write the results**

Create `eval/learning/RESULTS.md` in the style of `eval/RESULTS.md` and `eval/hearing/RESULTS.md`:
- how the eval works;
- the judge check numbers;
- the dev tables before and after tuning, with each change listed;
- the test table;
- whether each target was met;
- known failure patterns, each with an example.

Plain voice, no em dashes.

In `README.md`, add after the Profiles paragraph under "## Status":

```markdown
Suggested notes: after a pause in a conversation, the recent lines (what the other person said and what the user typed) and the few notes they relate to are sent to the language model, which suggests new notes or changes to existing ones. Each suggestion shows the line it came from, and nothing is saved until the user chooses Keep. Replies the user tapped without changing them are never learned from. It can be turned off in Settings. Measurements are in [eval/learning/RESULTS.md](eval/learning/RESULTS.md).
```

and change the line "Notes are stored in the browser. Only the few notes relevant to the current reply are sent to the model." to "Notes are stored in the browser. Only the few notes relevant to the current reply, or to the lines being learned from, are sent to the model."

- [ ] **Step 7: Final checks and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run e2e`
Expected: all pass.

```bash
git add eval/learning/RESULTS.md README.md src eval
git commit -m "Report the learning eval and describe suggested notes in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Open the PR**

Push `feat/learning`. Open a PR against `main` if PR #10 is merged, otherwise against `feat/cloud-captions`. Title: "Suggested notes: learn from conversations, confirmed by the user". The body covers what it does, the privacy line, the test numbers against the targets (stated plainly, including any missed target), and how to test it on the Vercel preview. End it with the attribution line from the session instructions. If a target was missed, the PR says so, and the owner decides whether to accept the numbers, as with replies.
