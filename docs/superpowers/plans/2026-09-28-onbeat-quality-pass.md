# OnBeat Quality Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the default model to a 90% top-3 hit rate and under 5% invented details on a held-out test set, without making replies slower, before OnBeat is deployed.

**Architecture:** First make the eval trustworthy (held-out test set, a judge that lists each fact and its source, a second judge provider, a judgement cache, fixed scoring). Then fix the causes the baseline shows: a stream parser that reads JSON objects instead of lines, a prompt that stops inviting new facts, an always-sent about-me note, and three validator blind spots. A small claim-check model is built behind a flag and only wired into the app if the dev-set numbers need it. Full eval runs are started by the controller between tasks, never by task agents.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Playwright, Groq and Cloudflare Workers AI (OpenAI-compatible chat completions), tsx for the eval.

**Spec:** `docs/superpowers/specs/2026-09-28-onbeat-quality-pass-design.md` (parent: `docs/superpowers/specs/2026-09-27-onbeat-design.md`, section 9).

## Global Constraints

- Node 24, npm 11. `@huggingface/transformers` stays pinned to exactly `3.8.1`.
- Next.js 16 has breaking changes. Before writing Next-specific code, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`).
- Targets (spec section 1): top-3 hit rate at least 90% and invented details under 5% of shown replies, on the held-out test set, for the default model. First-reply p50 in the eval may rise by at most 150 ms over the baseline for the chosen model.
- The test set (`eval/test-scenarios.ts`) is written in Task 1 and not changed afterwards. Prompt, validator and retrieval changes are tuned on the dev set (`eval/scenarios.ts`) only. The test set is run at most twice, only by the controller, only after Task 9.
- Task agents never run the full eval. Smoke runs are allowed: `npm run eval -- --models groq:qwen/qwen3.8-27b --limit 2 --delay 500`, then delete the files it wrote under `eval/results/` that are not tracked by git.
- API keys only in server environment variables `GROQ_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (and read by the eval from `.env.local`). Never print them, never write them into results or cache files, never commit `.env.local`.
- Audio never leaves the browser; only transcribed text goes into suggestion requests. Personal notes never leave the browser except the (at most 8) notes sent with a suggestion request.
- UI copy: plain, active voice, second person, sentence case. No em dash or en dash characters anywhere in UI strings, docs, prompts or eval files. Tool input has turned `\u2013` escapes into literal dashes before: check with `grep -rnP '[\x{2013}\x{2014}]' src eval tests docs README.md` before every commit.
- Plain developer voice in README and docs: no emoji, no em dashes, no marketing tables.
- `npm run lint`, `npm run typecheck` and `npm test` must pass at the end of every task.
- Every commit message ends with a blank line and a `Co-Authored-By:` line naming the model that wrote the commit, for example `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The repo owner edits files on GitHub directly: run `git pull --rebase` before every `git push`.

## Review Focus

- A JSON object split across stream chunks at any character, including inside a string that holds braces or escaped quotes: the reply appears once, whole (Task 4 tests every split position).
- An ordinary reply that starts with an everyday word ("Large, please.", "Toast, please.", "Third floor, Northline Design."): it is still shown; only names are checked (Task 7 guard test runs every scenario's intended reply and every saved phrase through the claim check).
- A profile with no pinned note, or whose pinned note is also the current place or partner: no duplicate notes and never more than k (Task 6 tests).
- The claim-check model slow, down or rate limited: replies still appear, at most 600 ms later, and the list is never emptied by the checker (Task 8 and Task 10 tests).
- Switching profile or stopping Listen in the middle of a turn: no reply-gap sample from the old conversation reaches the new one (Task 9 tests).

## Eval runs (controller only)

Each run writes `eval/results/latest-<set>.json` and `latest-<set>.md`. Keep a copy of each run outside the repo before the next one overwrites it.

| After | Run | Purpose |
|---|---|---|
| Task 3 | `npm run eval -- --set dev --models groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-20b` | Baseline with the new judge and scoring |
| Task 4 | same | Effect of the object parser |
| Task 7 | `npm run eval -- --set dev` (all three default models) | Effect of prompt, pinned note and validator |
| Task 8 | `npm run eval -- --set dev --models <chosen> --claim-check` | Decide whether Task 10 runs (spec 4.5) |
| Task 9 | `npm run eval -- --set test --models <chosen>,cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast` (add `--claim-check` if Task 10 ran) | Results of record |

Model choice (spec section 5) uses the Task 7 run: fewer invented details (by rate over judged replies), then higher hit rate (a gap under 5 points is a tie), then lower first-reply p50. The Task 8 decision: Task 10 runs only if the chosen model is at or above 5% invented on the dev set after Task 7, and the Task 8 run with `--claim-check` brings it under 5% with first-reply p50 at most 250 ms higher. Otherwise Task 10 is skipped and recorded as such.

---

### Task 1: Held-out test set

**Files:**
- Create: `eval/test-scenarios.ts`
- Modify: `eval/scenarios.ts` (export the maker with an id prefix), `eval/scenarios.test.ts`, `eval/run.ts` (`--set dev|test`, output file names)

**Interfaces:**
- Consumes: `Scenario` from `eval/scenarios.ts`.
- Produces: `export const make = (persona, prefix = "") => (n, partnerSaid, intended, noteIds?, extra?) => Scenario` in `eval/scenarios.ts`; `export const testScenarios: Scenario[]` in `eval/test-scenarios.ts` (ids like `maya-t01`); `npm run eval -- --set dev|test` (default `dev`) writing `eval/results/latest-dev.{json,md}` or `latest-test.{json,md}`.

- [ ] **Step 1: Write the failing tests**

Replace `eval/scenarios.test.ts` with:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { scenarios, type Scenario } from "./scenarios";
import { testScenarios } from "./test-scenarios";

const sets: [string, Scenario[]][] = [
  ["dev", scenarios],
  ["test", testScenarios],
];

describe.each(sets)("%s scenarios", (_name, list) => {
  it("has 20 per example profile, with unique ids", () => {
    for (const p of personas) expect(list.filter((s) => s.persona === p.id)).toHaveLength(20);
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
  });

  it("only points at notes the profile has, with the right kinds", () => {
    for (const s of list) {
      const notes = new Map(personas.find((p) => p.id === s.persona)!.notes.map((n) => [n.id, n]));
      for (const id of s.noteIds) expect(notes.has(id), `${s.id}: ${id}`).toBe(true);
      if (s.placeId) expect(notes.get(s.placeId)?.kind, s.id).toBe("place");
      if (s.partnerId) expect(notes.get(s.partnerId)?.kind, s.id).toBe("person");
    }
  });

  it("uses no en or em dashes", () => {
    expect(JSON.stringify(list)).not.toMatch(/[\u2013\u2014]/);
  });

  it("has typed letters in about a fifth of the scenarios", () => {
    const typed = list.filter((s) => s.typed).length;
    expect(typed).toBeGreaterThanOrEqual(9);
    expect(typed).toBeLessThanOrEqual(15);
  });
});

describe("test set", () => {
  it("shares no ids and no partner lines with the dev set", () => {
    const devIds = new Set(scenarios.map((s) => s.id));
    const devLines = new Set(scenarios.map((s) => s.partnerSaid));
    for (const s of testScenarios) {
      expect(devIds.has(s.id), s.id).toBe(false);
      expect(devLines.has(s.partnerSaid), s.id).toBe(false);
    }
  });

  it("marks its ids with t", () => {
    for (const s of testScenarios) expect(s.id).toMatch(/^(maya|tom|aisha)-t\d{2}$/);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run eval/scenarios.test.ts`
Expected: FAIL, `Failed to resolve import "./test-scenarios"`.

- [ ] **Step 3: Export the maker with a prefix**

In `eval/scenarios.ts`, replace the `make` definition with:

```ts
export const make =
  (persona: Scenario["persona"], prefix = "") =>
  (n: number, partnerSaid: string, intended: string, noteIds: string[] = [], extra: Extra = {}): Scenario => ({
    id: `${persona}-${prefix}${String(n).padStart(2, "0")}`,
    persona,
    partnerSaid,
    intended,
    noteIds,
    ...extra,
  });
```

- [ ] **Step 4: Write the test set**

Create `eval/test-scenarios.ts` exactly as follows. These scenarios are the held-out test set: after this commit nobody edits them, and nobody reads model output for them before the controller's final run.

```ts
import { make, type Scenario } from "./scenarios";

const maya = make("maya", "t");
const tom = make("tom", "t");
const aisha = make("aisha", "t");

/**
 * Held-out test set, written before any tuning (quality pass spec, section 3).
 * Do not edit, and do not tune prompts, the validator or retrieval against it.
 */
export const testScenarios: Scenario[] = [
  // Maya: ALS, hears fine. Blue Door Café with Sam unless noted.
  maya(1, "Morning! Same as always?", "Yes, the usual please.", ["m-usual"]),
  maya(2, "Hot or iced today?", "Hot, please."),
  maya(3, "Do you want a lid on that?", "Yes please."),
  maya(4, "Would you like a pastry with your latte?", "No thanks, just the latte.", [], { typed: "no" }),
  maya(5, "How's your daughter doing?", "Leila's doing well, thanks.", ["m-leila"]),
  maya(6, "Is Biscuit still chewing everything?", "Ha, not as much now."),
  maya(7, "Any plans for the weekend?", "Not sure yet."),
  maya(8, "Can you tap your card on the reader?", "Sure, one moment."),
  maya(9, "Do you want me to carry it to your table?", "Yes please, that would help.", [], { typed: "yes" }),
  maya(10, "What time is your physio today?", "It's at 10:30.", ["m-physio"]),
  maya(11, "Do you still like Agatha Christie?", "Yes, I love her mysteries.", ["m-books"]),
  maya(12, "Sorry, the card machine is down. Cash only today.", "Okay, give me a moment.", [], { typed: "ok" }),
  maya(13, "Are you walking home after this?", "Yes, it's only two blocks.", ["m-cafe"]),
  maya(14, "Do you need help with the door?", "Yes please, thank you.", [], { partnerId: null }),
  maya(15, "Hi, is anyone sitting here?", "No, it's free.", [], { partnerId: null }),
  maya(16, "Which street do you live on again?", "Cedar Street.", ["m-home"], { typed: "cedar" }),
  maya(17, "Mum, are you coming to visit me in Toronto?", "I'd love to. Let's talk about it.", ["m-leila"], {
    placeId: "m-home",
    partnerId: "m-leila",
  }),
  maya(18, "Mum, how's Biscuit?", "He's doing great.", ["m-biscuit"], { placeId: "m-home", partnerId: "m-leila" }),
  maya(19, "Can I write your name on the cup?", "Yes, it's Maya.", ["m-me"], { typed: "yes" }),
  maya(20, "Why do you use the tablet to talk?", "I have ALS, so I type to talk.", ["m-me"], { partnerId: null }),

  // Tom: Deaf, uses ASL. Riverside Pharmacy with Priya unless noted.
  tom(1, "Next, please. How can I help?", "I'm picking up my prescription.", ["t-meds"]),
  tom(2, "Can you spell your last name for me?", "I'll type it for you.", [], { typed: "i'll" }),
  tom(3, "Is this your usual blood pressure refill?", "Yes, same as every month.", ["t-meds"]),
  tom(4, "Any new allergies since last time?", "Just penicillin, same as before.", ["t-allergy"]),
  tom(5, "Your prescription isn't ready yet. Can you come back in an hour?", "Okay, I'll come back later."),
  tom(6, "Which pharmacy should we send your refills to?", "Riverside Pharmacy.", ["t-pharmacy"]),
  tom(7, "Would you like to speak with the pharmacist about the dose?", "Yes, please.", [], { partnerId: null }),
  tom(8, "Is Dr. Chen still your doctor?", "Yes, Dr. Chen at Lakeview Clinic.", ["t-doctor"]),
  tom(9, "Can you hear the announcements, or should I tell you when your name is called?", "Please tell me. I'm Deaf.", ["t-me"]),
  tom(10, "Do you want to pay now or later?", "Now, please.", [], { typed: "now" }),
  tom(11, "Would you like a printed information sheet?", "Yes please, that helps."),
  tom(12, "Please sign here.", "Okay."),
  tom(13, "Do you need a sharps container too?", "No, thank you.", [], { typed: "no" }),
  tom(14, "Are you still working as a designer?", "Yes, I'm still a graphic designer.", ["t-work"]),
  tom(15, "Do you want your tablets in a blister pack?", "No thanks, the bottle is fine."),
  tom(16, "Hi Tom, any questions about your medication?", "No questions, thank you.", [], { placeId: null, partnerId: "t-doctor" }),
  tom(17, "Should we try a different dose?", "What do you recommend?", [], { placeId: null, partnerId: "t-doctor" }),
  tom(18, "Excuse me, do you know when the pharmacy closes?", "Sorry, I'm not sure.", [], { partnerId: null }),
  tom(19, "Your total is $8.20.", "Card, please.", [], { typed: "card" }),
  tom(20, "Have a good day, Tom!", "Thanks Priya, you too."),

  // Aisha: laryngectomy. Northline Design office with Marco unless noted.
  aisha(1, "Hi Aisha, got a minute?", "Sure, what's up?"),
  aisha(2, "Is the Harbor redesign still on track for Friday?", "Yes, on track for Friday.", ["a-harbor"]),
  aisha(3, "Can you join a call at 3 today?", "Yes, 3 works for me.", [], { typed: "yes" }),
  aisha(4, "Can you send me the Harbor files?", "Sure, I'll send them now."),
  aisha(5, "Do you want to join us for lunch?", "Yes! The Thai place?", ["a-lunch"], { partnerId: "a-jen" }),
  aisha(6, "What time do you usually eat lunch?", "Around 12:30.", ["a-lunch"], { partnerId: "a-jen" }),
  aisha(7, "Are you coming to stand-up tomorrow?", "Yes, I'll be there.", ["a-standup"]),
  aisha(8, "Could you review my slides before the client meeting?", "Sure, send them over.", [], { partnerId: "a-jen" }),
  aisha(9, "Where do you sit?", "Third floor, Northline Design.", ["a-office"], { partnerId: null }),
  aisha(10, "Do you need a bigger monitor?", "No, mine is fine, thanks.", [], { typed: "no" }),
  aisha(11, "Can we push the Harbor deadline?", "I'd rather keep Friday.", ["a-harbor"], { typed: "i'd rather" }),
  aisha(12, "Who's leading the Harbor redesign?", "I am.", ["a-harbor"], { partnerId: null }),
  aisha(13, "Can you help Jen with the website?", "Yes, I can help her.", ["a-jen"]),
  aisha(14, "The meeting room is booked. Can we meet at your desk?", "Sure, that works."),
  aisha(15, "Do you want me to type the notes for the meeting?", "Yes please, that would help."),
  aisha(16, "Are you feeling okay today?", "I'm fine, thanks for asking."),
  aisha(17, "Is anything blocking you on Harbor?", "Not right now, thanks.", [], { typed: "not" }),
  aisha(18, "I'll be late to stand-up.", "Okay, I'll tell Marco.", ["a-marco"], { partnerId: "a-jen" }),
  aisha(19, "Can you explain the design to the new intern?", "Sure, I'll type it out.", [], { typed: "sure" }),
  aisha(20, "Thanks for your help today!", "You're welcome, Marco."),
];
```

- [ ] **Step 5: Let the runner pick a set**

In `eval/run.ts`, add the import:

```ts
import { testScenarios } from "./test-scenarios";
```

In `main()`, replace the line that defines `chosen` with:

```ts
  const set = arg("set") ?? "dev";
  if (set !== "dev" && set !== "test") throw new Error(`Unknown set "${set}". Use --set dev or --set test.`);
  const pool = set === "test" ? testScenarios : scenarios;
  const chosen = pool.filter((s) => !persona || s.persona === persona).slice(0, limit);
```

Replace the two `writeFileSync` calls at the end of `main()` with:

```ts
  writeFileSync(`eval/results/latest-${set}.json`, `${JSON.stringify({ ranAt, set, judgeModel, summaries, results }, null, 2)}\n`);
  writeFileSync(
    `eval/results/latest-${set}.md`,
    `# Eval results\n\nRun ${ranAt.slice(0, 10)}, ${set} set, ${chosen.length} scenarios per model, judged by ${judgeModel}. Generated by \`npm run eval -- --set ${set}\`.\n\n${table}\n`,
  );
```

While in this function's file, remove the duplicated comment line `// Generous timeouts: the eval measures latency instead of falling back. started is` in `runScenario` (it appears twice in a row; keep one).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run eval/scenarios.test.ts`
Expected: PASS (both sets: 20 per profile, unique ids, known notes, no dashes, 9 to 15 typed; test set disjoint and prefixed).

- [ ] **Step 7: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass.

```bash
git add eval/scenarios.ts eval/test-scenarios.ts eval/scenarios.test.ts eval/run.ts
git commit -m "Add a held-out test set to the eval

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: A judge that lists facts, with a second provider

**Files:**
- Modify: `eval/judge.ts`, `eval/judge.test.ts`, `eval/score.ts` (`Judgement`, `parseJudgement`), `eval/score.test.ts`, `eval/run.ts` (call site)

**Interfaces:**
- Consumes: `groqExtraBody`, `retryAfterMs` from `@/lib/server/providers`; `ChatMessage` from `@/lib/suggest/prompt`.
- Produces:
  - `export const JUDGE_PROMPT_VERSION = 2`
  - `export interface JudgeEndpoint { name: string; url: string; apiKey: string; model: string; extraBody: Record<string, unknown> }`
  - `export function judgeEndpoints(env?: NodeJS.ProcessEnv): JudgeEndpoint[]` (Groq first, then Cloudflare, each only when its keys exist)
  - `export async function judge(input: JudgeInput, opts: { endpoints: JudgeEndpoint[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<{ text: string; endpoint: string }>`
  - `Judgement` gains `unbacked: { n: number; fact: string }[]`; `parseJudgement(text, candidates)` reads the new `replies` format and still accepts an old-style `invented` array.

- [ ] **Step 1: Write the failing tests**

In `eval/score.test.ts`, replace the `describe("parseJudgement", ...)` block with:

```ts
describe("parseJudgement", () => {
  it("reads match and marks replies with an unbacked fact as invented", () => {
    const text = JSON.stringify({
      match: 2,
      replies: [
        { n: 1, facts: [{ fact: "usual is an oat latte", source: "note" }] },
        { n: 2, facts: [] },
        { n: 3, facts: [{ fact: "went to the park", source: "none" }, { fact: "it is Tuesday", source: "situation" }] },
      ],
    });
    expect(parseJudgement(text, 3)).toEqual({ match: 2, invented: [3], unbacked: [{ n: 3, fact: "went to the park" }] });
  });

  it("treats source case and spacing loosely", () => {
    const text = '{"match": 0, "replies": [{"n": 1, "facts": [{"fact": "has a cat", "source": " None "}]}]}';
    expect(parseJudgement(text, 1)).toEqual({ match: 0, invented: [1], unbacked: [{ n: 1, fact: "has a cat" }] });
  });

  it("ignores reply numbers out of range", () => {
    const text = '{"match": 4, "replies": [{"n": 4, "facts": [{"fact": "x", "source": "none"}]}]}';
    expect(parseJudgement(text, 3)).toEqual({ match: 0, invented: [], unbacked: [] });
  });

  it("still reads an old-style invented list", () => {
    expect(parseJudgement('{"match": 1, "invented": [2, 2, 9]}', 3)).toEqual({ match: 1, invented: [2], unbacked: [] });
  });

  it("finds the object inside surrounding text and returns null when there is none", () => {
    expect(parseJudgement('Sure: {"match": 1, "replies": []} done', 2)).toEqual({ match: 1, invented: [], unbacked: [] });
    expect(parseJudgement("no json here", 2)).toBeNull();
    expect(parseJudgement("{broken", 2)).toBeNull();
  });
});
```

In `eval/judge.test.ts`, replace the whole file with:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { judge, judgeEndpoints, judgeMessages, JUDGE_PROMPT_VERSION, type JudgeEndpoint, type JudgeInput } from "./judge";

const input: JudgeInput = {
  intended: "Large, please.",
  partnerSaid: "What size would you like?",
  typed: "",
  contextLine: "It is Tuesday morning. Place: Blue Door Café. Talking with: Sam.",
  notes: ["My usual order is a large oat milk latte."],
  phrases: ["My usual, please."],
  candidates: ["Large, please.", "Small today."],
};

const groq: JudgeEndpoint = { name: "groq", url: "https://groq.test", apiKey: "g", model: "openai/gpt-oss-120b", extraBody: { reasoning_effort: "low" } };
const cf: JudgeEndpoint = { name: "cloudflare", url: "https://cf.test", apiKey: "c", model: "@cf/openai/gpt-oss-120b", extraBody: {} };

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) => new Response("{}", { status: code, headers });
const noSleep = async () => {};

describe("judgeMessages", () => {
  it("numbers the candidates and asks for facts with their sources", () => {
    const [, user] = judgeMessages(input);
    expect(user.content).toContain("1. Large, please.");
    expect(user.content).toContain("2. Small today.");
    for (const s of ['"note"', '"situation"', '"partner"', '"typed"', '"phrase"', '"none"', '"replies"']) expect(user.content).toContain(s);
    expect(user.content).toContain("are not facts");
  });

  it("lists saved phrases only when there are some", () => {
    expect(judgeMessages(input)[1].content).toContain("- My usual, please.");
    expect(judgeMessages({ ...input, phrases: [] })[1].content).not.toContain("said before");
  });

  it("has a prompt version", () => {
    expect(JUDGE_PROMPT_VERSION).toBe(2);
  });
});

describe("judge", () => {
  it("returns the first endpoint's answer", async () => {
    const fetchImpl = vi.fn(async () => ok('{"match": 1, "replies": []}'));
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep });
    expect(out).toEqual({ text: '{"match": 1, "replies": []}', endpoint: "groq" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://groq.test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", temperature: 0, reasoning_effort: "low", response_format: { type: "json_object" } });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer g");
  });

  it("retries a 429 three times on one endpoint, then moves to the next", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(status(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok('{"match": 2, "replies": []}'));
    const sleep = vi.fn(noSleep);
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep });
    expect(out.endpoint).toBe("cloudflare");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
  });

  it("asks again without JSON mode when an endpoint rejects it", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(400)).mockResolvedValueOnce(ok('{"match": 0, "replies": []}'));
    const out = await judge(input, { endpoints: [cf], fetchImpl, sleep: noSleep });
    expect(out.endpoint).toBe("cloudflare");
    const second = JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(second.response_format).toBeUndefined();
  });

  it("moves on after a network error or a server error", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok('{"match": 1, "replies": []}'));
    expect((await judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep })).endpoint).toBe("cloudflare");
    const fetch500 = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok('{"match": 1, "replies": []}'));
    expect((await judge(input, { endpoints: [groq, cf], fetchImpl: fetch500, sleep: noSleep })).endpoint).toBe("cloudflare");
  });

  it("throws with every endpoint's failure when all fail", async () => {
    const fetchImpl = vi.fn(async () => status(503));
    await expect(judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep })).rejects.toThrow("judge failed: groq HTTP 503; cloudflare HTTP 503");
  });

  it("throws when no endpoint is configured", async () => {
    await expect(judge(input, { endpoints: [], sleep: noSleep })).rejects.toThrow("no judge endpoint");
  });
});

describe("judgeEndpoints", () => {
  it("lists Groq then Cloudflare, each only with its keys", () => {
    const all = judgeEndpoints({ GROQ_API_KEY: "g", CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "c" } as NodeJS.ProcessEnv);
    expect(all.map((e) => e.name)).toEqual(["groq", "cloudflare"]);
    expect(all[0]).toMatchObject({ model: "openai/gpt-oss-120b", apiKey: "g" });
    expect(all[1]).toMatchObject({ model: "@cf/openai/gpt-oss-120b", apiKey: "c", url: "https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions" });
    expect(judgeEndpoints({ GROQ_API_KEY: "g" } as NodeJS.ProcessEnv).map((e) => e.name)).toEqual(["groq"]);
    expect(judgeEndpoints({ GROQ_API_KEY: "g", EVAL_JUDGE_MODEL: "x", EVAL_JUDGE_CF_MODEL: "y", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "c" } as NodeJS.ProcessEnv).map((e) => e.model)).toEqual(["x", "y"]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run eval/judge.test.ts eval/score.test.ts`
Expected: FAIL (`judgeEndpoints` and `JUDGE_PROMPT_VERSION` are not exported; `parseJudgement` returns no `unbacked`).

- [ ] **Step 3: Implement the judge**

Replace `eval/judge.ts` with:

```ts
import { groqExtraBody, retryAfterMs } from "@/lib/server/providers";
import type { ChatMessage } from "@/lib/suggest/prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Bump when the judge prompt changes, so cached judgements from the old prompt are not reused. */
export const JUDGE_PROMPT_VERSION = 2;

export interface JudgeInput {
  intended: string;
  partnerSaid: string;
  typed: string;
  contextLine: string;
  /** Texts of the notes that were sent with the request: the only facts replies may use. */
  notes: string[];
  /** Saved phrases sent to the model as style examples: the person's own words. */
  phrases: string[];
  candidates: string[];
}

export interface JudgeEndpoint {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  extraBody: Record<string, unknown>;
}

/** The same judge model on Groq, then on Cloudflare Workers AI, each only when its keys are set. */
export function judgeEndpoints(env: NodeJS.ProcessEnv = process.env): JudgeEndpoint[] {
  const list: JudgeEndpoint[] = [];
  const groqModel = env.EVAL_JUDGE_MODEL ?? "openai/gpt-oss-120b";
  if (env.GROQ_API_KEY) list.push({ name: "groq", url: GROQ_URL, apiKey: env.GROQ_API_KEY, model: groqModel, extraBody: groqExtraBody(groqModel) });
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    list.push({
      name: "cloudflare",
      url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
      apiKey: env.CLOUDFLARE_API_TOKEN,
      model: env.EVAL_JUDGE_CF_MODEL ?? "@cf/openai/gpt-oss-120b",
      extraBody: {},
    });
  }
  return list;
}

export function judgeMessages(j: JudgeInput): ChatMessage[] {
  const lines = [
    "A person who cannot speak picks one of the suggested replies below and the app says it out loud for them.",
    `Situation: ${j.contextLine}`,
    `The other person said: "${j.partnerSaid}"`,
    `The person had typed: "${j.typed}"`,
    "Facts the replies may use:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    ...(j.phrases.length
      ? [
          "Things the person has said before (their own words, so restating one is not an invented detail):",
          j.phrases.map((p) => `- ${p}`).join("\n"),
        ]
      : []),
    "",
    `What the person meant to say: "${j.intended}"`,
    "",
    "Suggested replies:",
    j.candidates.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    "",
    "Give two things:",
    "match: the number of the first reply that says what the person meant closely enough that they would pick it (same meaning, wording may differ), or 0 if none does.",
    "replies: for each reply, the facts it states about the person, their life or the situation (what they did, have, feel, want, plan or prefer, and any name, place, number, day or time). For each fact give its source:",
    '"note" (the facts above), "situation", "partner" (what the other person said), "typed", "phrase" (something the person has said before), or "none" if nothing above backs it.',
    "Politeness, yes or no, agreeing, declining, asking a question, and repeating what the other person said are not facts.",
    'Answer with one JSON object and nothing else, like {"match": 1, "replies": [{"n": 1, "facts": [{"fact": "usual is an oat latte", "source": "note"}]}, {"n": 2, "facts": []}]}',
  ];
  return [
    { role: "system", content: "You grade reply suggestions for a communication aid. You answer with one JSON object." },
    { role: "user", content: lines.join("\n") },
  ];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Asks the judge, trying each endpoint in order. On one endpoint a 429 is retried
 * three times after its Retry-After (at most 60 s each); a 400 is retried once
 * without JSON mode. Any other failure moves on to the next endpoint.
 */
export async function judge(
  input: JudgeInput,
  opts: { endpoints: JudgeEndpoint[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<{ text: string; endpoint: string }> {
  if (opts.endpoints.length === 0) throw new Error("judge failed: no judge endpoint is configured");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const failures: string[] = [];
  for (const ep of opts.endpoints) {
    const call = (jsonMode: boolean) =>
      fetchImpl(ep.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ep.apiKey}` },
        body: JSON.stringify({
          model: ep.model,
          messages: judgeMessages(input),
          temperature: 0,
          max_tokens: 1500,
          ...ep.extraBody,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    try {
      let res = await call(true);
      for (let attempt = 1; attempt < 4 && res.status === 429; attempt++) {
        await sleep(Math.min(60_000, retryAfterMs(res.headers.get("retry-after"))));
        res = await call(true);
      }
      // Some models reject JSON mode; ask again without it.
      if (res.status === 400) res = await call(false);
      if (!res.ok) {
        failures.push(`${ep.name} HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return { text: data.choices?.[0]?.message?.content ?? "", endpoint: ep.name };
    } catch (err) {
      failures.push(`${ep.name} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`judge failed: ${failures.join("; ")}`);
}
```

- [ ] **Step 4: Parse the new answer**

In `eval/score.ts`, replace the `Judgement` interface and `parseJudgement` with:

```ts
export interface Judgement {
  /** 1-based number of the first shown reply that says what the user meant; 0 if none. */
  match: number;
  /** 1-based numbers of shown replies that state a fact the sources don't back up. */
  invented: number[];
  /** The unbacked facts the judge named, for the write-up. */
  unbacked: { n: number; fact: string }[];
}

/** Reads the judge's JSON answer. Null when it can't be read. */
export function parseJudgement(text: string, candidates: number): Judgement | null {
  const found = text.match(/\{[\s\S]*\}/);
  if (!found) return null;
  let j: { match?: unknown; invented?: unknown; replies?: unknown };
  try {
    j = JSON.parse(found[0]);
  } catch {
    return null;
  }
  const inRange = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= candidates;
  const unbacked: { n: number; fact: string }[] = [];
  if (Array.isArray(j.replies)) {
    for (const r of j.replies as { n?: unknown; facts?: unknown }[]) {
      if (!inRange(r?.n) || !Array.isArray(r.facts)) continue;
      for (const f of r.facts as { fact?: unknown; source?: unknown }[]) {
        if (String(f?.source ?? "").trim().toLowerCase() === "none") unbacked.push({ n: r.n, fact: String(f.fact ?? "") });
      }
    }
  }
  const fromFacts = unbacked.map((u) => u.n);
  const fromList = Array.isArray(j.invented) ? j.invented.filter(inRange) : [];
  return {
    match: inRange(j.match) ? j.match : 0,
    invented: [...new Set([...fromFacts, ...fromList])].sort((a, b) => a - b),
    unbacked,
  };
}
```

If other tests in `eval/score.test.ts` build `Judgement` objects by hand (for `summarize`), add `unbacked: []` to each so they type-check.

- [ ] **Step 5: Update the call site**

In `eval/run.ts`, change the import to `import { judge, judgeEndpoints } from "./judge";`. In `main()`, after `judgeModel` is defined, add:

```ts
  const endpoints = judgeEndpoints();
  if (endpoints.length === 0) throw new Error("No judge endpoint: set GROQ_API_KEY (and optionally the Cloudflare keys) in .env.local.");
```

Pass `endpoints` into `runScenario` (add a parameter `endpoints: JudgeEndpoint[]`, importing the type) and replace the judge call there with:

```ts
      const { text } = await judge(
        { intended: sc.intended, partnerSaid: sc.partnerSaid, typed, contextLine: body.contextLine, notes: body.notes.map((n) => n.text), phrases: body.examples, candidates: shown },
        { endpoints },
      );
      judgement = parseJudgement(text, shown.length);
```

Change the default for a scenario with no replies from `{ match: 0, invented: [] }` to `{ match: 0, invented: [], unbacked: [] }`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run eval`
Expected: PASS.

- [ ] **Step 7: Check that the Cloudflare judge model exists**

Run a one-scenario smoke run that forces the Cloudflare judge: `EVAL_JUDGE_MODEL=does-not-exist npm run eval -- --models groq:qwen/qwen3.8-27b --limit 1 --delay 0` (Groq answers 404 for the unknown judge model, so the judge moves on to Cloudflare). Expected: the scenario line shows `match` with a number, not `?`. If Cloudflare answers 404 or 400 for `@cf/openai/gpt-oss-120b`, look up the current Workers AI model list (`https://developers.cloudflare.com/workers-ai/models/`) for the gpt-oss-120b id, set it as the default in `judgeEndpoints` and the test, and say so in your report. Delete the untracked files this wrote under `eval/results/`.

- [ ] **Step 8: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add eval/judge.ts eval/judge.test.ts eval/score.ts eval/score.test.ts eval/run.ts
git commit -m "Have the eval judge list each fact and its source, with Cloudflare as a second judge

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Judgement cache, honest scoring, raw output for empty answers

**Files:**
- Create: `eval/judge-cache.ts`, `eval/judge-cache.test.ts`
- Modify: `eval/score.ts` (`ScenarioResult`, `ModelSummary`, `summarize`, `toMarkdown`), `eval/score.test.ts`, `eval/run.ts`

**Interfaces:**
- Consumes: `judge`, `judgeEndpoints`, `JUDGE_PROMPT_VERSION` (Task 2).
- Produces:
  - `export class JudgeCache { constructor(file: string); static key(p: { scenarioId: string; candidates: string[]; model: string; version: number }): string; get(key: string): string | undefined; set(key: string, text: string): void }` (writes the file on every `set`)
  - `ScenarioResult` gains `raw?: string` (model output, at most 2000 characters, only when no reply was shown)
  - `ModelSummary` gains `empty: number` and `judgedReplies: number`; `keystrokesSaved` is averaged over judged scenarios; the table shows invented as `X of Y (Z%)` over judged replies and adds `Empty` and `Not judged` columns.

- [ ] **Step 1: Write the failing tests**

Create `eval/judge-cache.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JudgeCache } from "./judge-cache";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-cache-"));
  dirs.push(dir);
  return join(dir, "nested", "cache.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("JudgeCache", () => {
  it("keys on scenario, exact reply texts, model and prompt version", () => {
    const base = { scenarioId: "maya-01", candidates: ["Yes.", "No."], model: "m", version: 2 };
    const k = JudgeCache.key(base);
    expect(JudgeCache.key({ ...base })).toBe(k);
    expect(JudgeCache.key({ ...base, candidates: ["No.", "Yes."] })).not.toBe(k);
    expect(JudgeCache.key({ ...base, scenarioId: "maya-02" })).not.toBe(k);
    expect(JudgeCache.key({ ...base, model: "n" })).not.toBe(k);
    expect(JudgeCache.key({ ...base, version: 3 })).not.toBe(k);
  });

  it("stores answers on disk and reads them back in a new instance", () => {
    const file = tempFile();
    const a = new JudgeCache(file);
    expect(a.get("k")).toBeUndefined();
    a.set("k", '{"match": 1}');
    expect(new JudgeCache(file).get("k")).toBe('{"match": 1}');
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ k: '{"match": 1}' });
  });

  it("starts empty when the file is missing or broken", () => {
    const file = tempFile();
    expect(new JudgeCache(file).get("k")).toBeUndefined();
  });
});
```

In `eval/score.test.ts`, add:

```ts
describe("summarize: empty answers and judged replies", () => {
  const r = (over: Partial<ScenarioResult>): ScenarioResult => ({
    id: "x",
    ok: true,
    shown: ["a", "b"],
    rawReplies: 2,
    blocked: 0,
    judgement: { match: 1, invented: [], unbacked: [] },
    keystrokesSaved: 0.5,
    noteRecall: true,
    firstReplyMs: 100,
    totalMs: 200,
    ...over,
  });

  it("counts empty answers and divides invented details by judged replies only", () => {
    const s = summarize("m", [
      r({ judgement: { match: 1, invented: [2], unbacked: [{ n: 2, fact: "x" }] } }),
      r({ shown: [], rawReplies: 0, judgement: { match: 0, invented: [], unbacked: [] }, keystrokesSaved: 0 }),
      r({ shown: ["a", "b", "c"], judgement: null, keystrokesSaved: 0 }),
    ]);
    expect(s.empty).toBe(1);
    expect(s.judgedReplies).toBe(2);
    expect(s.inventedShown).toBe(1);
    expect(s.shownReplies).toBe(5);
    expect(s.judgeErrors).toBe(1);
    expect(s.keystrokesSaved).toBeCloseTo(0.25);
  });

  it("shows the invented rate, empty answers and unjudged scenarios in the table", () => {
    const s = summarize("m", [r({ judgement: { match: 1, invented: [2], unbacked: [] } }), r({ judgement: null })]);
    const md = toMarkdown([s]);
    expect(md).toContain("| Empty |");
    expect(md).toContain("| Not judged |");
    expect(md).toContain("1 of 2 (50%)");
  });
});
```

(Import `type ScenarioResult` at the top of the file if it isn't already.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run eval/judge-cache.test.ts eval/score.test.ts`
Expected: FAIL (`./judge-cache` missing; `empty` and `judgedReplies` undefined).

- [ ] **Step 3: Implement the cache**

Create `eval/judge-cache.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Judge answers on disk, keyed by scenario, the exact replies shown, the judge model
 * and the prompt version, so a rerun only asks the judge about replies it hasn't seen.
 * Written on every set, so an interrupted run keeps what it paid for.
 */
export class JudgeCache {
  private entries: Record<string, string>;

  constructor(private readonly file: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      this.entries = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      this.entries = {};
    }
  }

  static key(p: { scenarioId: string; candidates: string[]; model: string; version: number }): string {
    return createHash("sha256").update(JSON.stringify([p.scenarioId, p.candidates, p.model, p.version])).digest("hex");
  }

  get(key: string): string | undefined {
    return this.entries[key];
  }

  set(key: string, text: string): void {
    this.entries[key] = text;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(this.entries)}\n`);
  }
}
```

The cache file is `eval/results/judge-cache.json`, already git-ignored by `eval/results/*.json`.

- [ ] **Step 4: Scoring**

In `eval/score.ts`:

Add to `ScenarioResult`:

```ts
  /** The model's output, cut to 2000 characters, kept only when no reply was shown. */
  raw?: string;
```

Add to `ModelSummary`:

```ts
  /** Answered scenarios that showed no reply at all. */
  empty: number;
  /** Replies shown in judged scenarios: the base for the invented rate. */
  judgedReplies: number;
```

In `summarize`, add the two fields and change `keystrokesSaved`:

```ts
    empty: ok.filter((r) => r.shown.length === 0).length,
    judgedReplies: sum(judged.map((r) => r.shown.length)),
    keystrokesSaved: ratio(sum(judged.map((r) => r.keystrokesSaved)), judged.length),
```

Replace `toMarkdown` with:

```ts
export function toMarkdown(summaries: ModelSummary[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const ms = (x: number | null) => (x === null ? "n/a" : `${Math.round(x)} ms`);
  return [
    "| Model | Top-3 hit rate | Invented details | Empty | Replies blocked by the check | Keystrokes saved | Right notes sent | First reply p50 / p95 | Full answer p50 / p95 | Failed | Not judged |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s) =>
        `| ${s.model} | ${pct(s.hitRate)} | ${s.inventedShown} of ${s.judgedReplies} (${pct(ratio(s.inventedShown, s.judgedReplies))}) | ${s.empty} | ${pct(s.blockedRate)} | ${pct(s.keystrokesSaved)} | ${pct(s.noteRecall)} | ${ms(s.firstReplyP50)} / ${ms(s.firstReplyP95)} | ${ms(s.totalP50)} / ${ms(s.totalP95)} | ${s.failed} | ${s.judgeErrors} |`,
    ),
  ].join("\n");
}
```

Update the existing `summarize` and `toMarkdown` tests in `eval/score.test.ts` for the new fields and columns: add `empty` and `judgedReplies` to any full expected object (compute them from that test's fixture), recompute `keystrokesSaved` over judged scenarios if the fixture has an unjudged one, and update any expected header or row string.

- [ ] **Step 5: Use the cache and keep raw output in the runner**

In `eval/run.ts`:

- Import `JudgeCache` from `./judge-cache` and `JUDGE_PROMPT_VERSION` from `./judge`.
- In `main()`, create `const cache = new JudgeCache("eval/results/judge-cache.json");` and pass it into `runScenario` with `endpoints`.
- In `runScenario`, keep the raw text: declare `let raw = "";` next to `shown`, and in the loop change `for await (const d of deltas) splitter.push(d);` to `for await (const d of deltas) { raw += d; splitter.push(d); }`.
- Replace the judge block with:

```ts
  let judgement: Judgement | null = { match: 0, invented: [], unbacked: [] };
  if (shown.length) {
    const key = JudgeCache.key({ scenarioId: sc.id, candidates: shown, model: endpoints[0].model, version: JUDGE_PROMPT_VERSION });
    try {
      let text = cache.get(key);
      if (text === undefined) {
        text = (
          await judge(
            { intended: sc.intended, partnerSaid: sc.partnerSaid, typed, contextLine: body.contextLine, notes: body.notes.map((n) => n.text), phrases: body.examples, candidates: shown },
            { endpoints },
          )
        ).text;
        // Only cache answers that parse, so a garbled one is asked again next run.
        if (parseJudgement(text, shown.length)) cache.set(key, text);
      }
      judgement = parseJudgement(text, shown.length);
    } catch (err) {
      console.warn(`  judge failed for ${sc.id}: ${err instanceof Error ? err.message : String(err)}`);
      judgement = null;
    }
  }
```

- In the returned object for a successful scenario, add `...(shown.length === 0 ? { raw: raw.slice(0, 2000) } : {}),`.
- In the per-scenario console line, print `empty` for a scenario with no replies: replace the success branch with `` `${r.shown.length} shown, match ${r.judgement?.match ?? "?"}${r.shown.length === 0 ? " (empty)" : ""}` ``.

- [ ] **Step 6: Run the tests and a smoke run**

Run: `npx vitest run eval`
Expected: PASS.

Run: `npm run eval -- --models groq:qwen/qwen3.8-27b --limit 2 --delay 500` twice. Expected: the second run makes no judge calls for replies it already judged (same shown replies are rare at temperature 0.6, so check instead that `eval/results/judge-cache.json` exists and has entries, and that no key material appears in it: `grep -ciE "gsk_|bearer" eval/results/judge-cache.json` prints 0). Delete `eval/results/latest-dev.*` and `eval/results/judge-cache.json` afterwards.

- [ ] **Step 7: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add eval/judge-cache.ts eval/judge-cache.test.ts eval/score.ts eval/score.test.ts eval/run.ts
git commit -m "Cache judge answers, score invented details over judged replies, and keep raw output of empty answers

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: Read JSON objects from the stream, not lines

**Files:**
- Modify: `src/lib/suggest/protocol.ts`, `src/lib/suggest/protocol.test.ts`, `src/lib/suggest/client.ts`, `src/lib/suggest/client.test.ts`, `eval/run.ts`

**Interfaces:**
- Consumes: `parseLine` (unchanged).
- Produces: `export function createObjectSplitter(onObject: (json: string) => void, onStray?: (text: string) => void): { push(chunk: string): void; flush(): void }`. Removes `createLineSplitter`, `parseLines` and `splitObjects` (no other users after this task).

- [ ] **Step 1: Write the failing tests**

In `src/lib/suggest/protocol.test.ts`, change the import to `import { createObjectSplitter, parseLine, SuggestRequestSchema } from "./protocol";`, delete the `describe("createLineSplitter", ...)` and `describe("parseLines", ...)` blocks, and add:

```ts
describe("createObjectSplitter", () => {
  const run = (chunks: string[]) => {
    const objects: string[] = [];
    const stray: string[] = [];
    const s = createObjectSplitter((o) => objects.push(o), (t) => stray.push(t));
    for (const c of chunks) s.push(c);
    s.flush();
    return { objects, stray, parsed: objects.map(parseLine) };
  };

  it("emits one object per line", () => {
    const { parsed } = run(['{"reply": "A", "notes": []}\n{"reply": "B", "notes": []}\n']);
    expect(parsed).toEqual([
      { kind: "reply", text: "A", noteIds: [] },
      { kind: "reply", text: "B", noteIds: [] },
    ]);
  });

  it("reads objects pretty-printed over several lines", () => {
    const text = '{\n  "reply": "Yes, my usual please.",\n  "notes": [\n    "m-usual"\n  ]\n}\n{\n  "reactions": [\n    "yes"\n  ]\n}';
    expect(run([text]).parsed).toEqual([
      { kind: "reply", text: "Yes, my usual please.", noteIds: ["m-usual"] },
      { kind: "reactions", ids: ["yes"] },
    ]);
  });

  it("ignores a markdown fence without calling it stray text", () => {
    const { parsed, stray } = run(['```json\n{"reply": "No, thank you.", "notes": []}\n```']);
    expect(parsed).toEqual([{ kind: "reply", text: "No, thank you.", noteIds: [] }]);
    expect(stray).toEqual([]);
  });

  it("splits several objects on one line", () => {
    const { parsed } = run(['{"reply": "Yes.", "notes": []}{"reply": "No.", "notes": []} {"reactions": ["ha"]}']);
    expect(parsed.map((p) => p?.kind)).toEqual(["reply", "reply", "reactions"]);
  });

  it("keeps braces and escaped quotes inside strings", () => {
    const { parsed } = run(['{"reply": "Use {this} \\"one\\".", "notes": []}{"reply": "Ok.", "notes": []}']);
    expect(parsed[0]).toEqual({ kind: "reply", text: 'Use {this} "one".', noteIds: [] });
    expect(parsed).toHaveLength(2);
  });

  it("gives the same result however the stream is cut", () => {
    const text = '```json\n{\n  "reply": "Say {hi} \\"now\\".",\n  "notes": ["a"]\n}\n{"reply": "B"}\n```';
    const whole = run([text]).objects;
    for (let i = 1; i < text.length; i++) {
      expect(run([text.slice(0, i), text.slice(i)]).objects, `cut at ${i}`).toEqual(whole);
    }
    expect(whole).toHaveLength(2);
  });

  it("reports text outside objects as stray, line by line", () => {
    const { parsed, stray } = run(['Here you go: {"reply": "Sure.", "notes": []}\nI cannot help with that.']);
    expect(parsed).toEqual([{ kind: "reply", text: "Sure.", noteIds: [] }]);
    expect(stray).toEqual(["Here you go:", "I cannot help with that."]);
  });

  it("emits a cut-off last object on flush so it counts as invalid", () => {
    const { parsed } = run(['{"reply": "Yes.", "notes": []}{"reply": "No']);
    expect(parsed[0]).toEqual({ kind: "reply", text: "Yes.", noteIds: [] });
    expect(parsed[1]?.kind).toBe("invalid");
  });

  it("emits nothing for blank input", () => {
    expect(run(["  \n\n"])).toEqual({ objects: [], stray: [], parsed: [] });
  });
});
```

In `src/lib/suggest/client.test.ts`, add inside `describe("SuggestClient", ...)`:

```ts
  it("shows replies the model pretty-printed over several lines", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(["```json", "{", '  "reply": "Large, please.",', '  "notes": []', "}", "```"]));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    expect((await client.request(input, () => {}))?.replies.map((r) => r.text)).toEqual(["Large, please."]);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/suggest/protocol.test.ts src/lib/suggest/client.test.ts`
Expected: FAIL (`createObjectSplitter` is not exported; the pretty-printed reply is not shown).

- [ ] **Step 3: Implement the splitter**

In `src/lib/suggest/protocol.ts`, delete `splitObjects`, `parseLines` and `createLineSplitter`, and add:

```ts
const FENCE = /^`{3}[\w-]*$/;

/**
 * Reads model output as a stream of JSON objects, whatever the line breaks: models
 * sometimes pretty-print an object over several lines or wrap the output in a
 * markdown fence. Each top-level object is emitted as soon as its closing brace
 * arrives. Text between objects is reported line by line through onStray, except
 * blank lines and fences. flush() emits a cut-off last object, so it can be counted
 * as invalid.
 */
export function createObjectSplitter(onObject: (json: string) => void, onStray: (text: string) => void = () => {}) {
  let current = "";
  let stray = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  const endStray = () => {
    const t = stray.trim();
    stray = "";
    if (t && !FENCE.test(t)) onStray(t);
  };

  return {
    push(chunk: string) {
      for (const c of chunk) {
        if (depth === 0) {
          if (c === "{") {
            endStray();
            current = "{";
            depth = 1;
          } else if (c === "\n") {
            endStray();
          } else {
            stray += c;
          }
          continue;
        }
        current += c;
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inString = false;
        } else if (c === '"') {
          inString = true;
        } else if (c === "{") {
          depth++;
        } else if (c === "}") {
          depth--;
          if (depth === 0) {
            onObject(current);
            current = "";
          }
        }
      }
    },
    flush() {
      if (depth > 0 && current.trim()) onObject(current);
      endStray();
      current = "";
      depth = 0;
      inString = false;
      escaped = false;
    },
  };
}
```

- [ ] **Step 4: Use it in the client and the eval**

In `src/lib/suggest/client.ts`, change the import to `import { createObjectSplitter, parseLine, type ParsedLine, type SuggestRequestBody } from "./protocol";` and replace the `const splitter = ...` line with:

```ts
    const splitter = createObjectSplitter(
      (obj) => {
        const parsed = parseLine(obj);
        if (parsed) handle(parsed);
      },
      // Prose instead of JSON counts as invalid output, so an all-junk answer is retried.
      () => {
        invalid++;
      },
    );
```

In `eval/run.ts`, change the import to `import { createObjectSplitter, parseLine } from "@/lib/suggest/protocol";` and replace the splitter with:

```ts
    const splitter = createObjectSplitter((obj) => {
      const parsed = parseLine(obj);
      if (parsed?.kind !== "reply") return;
      rawReplies++;
      if (!validateReply({ text: parsed.text, noteIds: parsed.noteIds }, sources).ok) {
        blocked++;
        return;
      }
      if (shown.length >= 3 || shown.some((t) => isNearDuplicate(t, parsed.text))) return;
      shown.push(parsed.text);
      firstReplyMs ??= performance.now() - started;
    });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/suggest eval`
Expected: PASS, including the existing client tests "ignores junk lines", "retries once on the other provider when output is all junk" and "accepts two replies sent on one line".

- [ ] **Step 6: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/suggest/protocol.ts src/lib/suggest/protocol.test.ts src/lib/suggest/client.ts src/lib/suggest/client.test.ts eval/run.ts
git commit -m "Read replies as JSON objects, so pretty-printed or fenced output is no longer lost

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: A prompt that doesn't invite new facts

**Files:**
- Modify: `src/lib/suggest/prompt.ts`, `src/lib/suggest/prompt.test.ts`

**Interfaces:**
- Consumes: `SuggestRequestBody`.
- Produces: `buildMessages(b)` (same signature, new rules text).

- [ ] **Step 1: Write the failing test**

In `src/lib/suggest/prompt.test.ts`, add inside `describe("buildMessages", ...)`:

```ts
  it("asks for a direct answer, a detail from the notes, and an opposite or neutral answer", () => {
    const [, user] = buildMessages(body);
    expect(user.content).toContain("Reply 1 answers directly.");
    expect(user.content).toContain("Reply 2 answers with one detail from the notes or the conversation.");
    expect(user.content).toContain("Reply 3 gives the opposite or a neutral answer");
    expect(user.content).not.toMatch(/alternative/i);
  });

  it("forbids anything about the person the sources don't say, with examples", () => {
    const [, user] = buildMessages(body);
    expect(user.content).toContain("what they did, have, feel, want, plan or prefer");
    expect(user.content).toContain('"Not sure yet."');
    expect(user.content).toContain('"Maybe a mocha today?"');
  });

  it("keeps all three replies on the typed meaning when the person has typed", () => {
    const [, user] = buildMessages(body);
    expect(user.content).toContain("If the person has typed something, all 3 replies keep that meaning");
  });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/lib/suggest/prompt.test.ts`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Rewrite the rules**

In `src/lib/suggest/prompt.ts`, replace the lines from `"Rules:",` through `"- For each reply, list the ids of the notes it uses.",` with:

```ts
    "Rules:",
    "- Write exactly 3 replies, in first person, as the person.",
    `- Each reply is at most ${b.maxWords} words, plain and natural.`,
    "- Reply 1 answers directly. Reply 2 answers with one detail from the notes or the conversation. Reply 3 gives the opposite or a neutral answer, such as declining, or saying they will check or need a moment.",
    "- If the person has typed something, all 3 replies keep that meaning and differ only in wording or detail.",
    "- Say only what the notes, the situation or the conversation back up. Never add anything about the person that they don't: what they did, have, feel, want, plan or prefer, and no new names, places, numbers, days or times.",
    '- If the notes don\'t answer the question, keep the reply short and general, or ask back. For example, if nothing says what they are doing this weekend, write "Not sure yet." or "How about you?", not "I\'m going hiking."',
    '- Don\'t offer choices the notes don\'t mention. If the notes say the usual order is a latte, don\'t suggest "Maybe a mocha today?".',
    "- For each reply, list the ids of the notes it uses.",
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/suggest`
Expected: PASS.

- [ ] **Step 5: Smoke run**

Run: `npm run eval -- --models groq:qwen/qwen3.8-27b --limit 2 --delay 500`. Expected: both scenarios show replies. Read them in the console to confirm the format still parses. Delete the untracked `eval/results/` files it wrote.

- [ ] **Step 6: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/suggest/prompt.ts src/lib/suggest/prompt.test.ts
git commit -m "Stop the prompt from inviting new facts about the person

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: Always send the about-me note

**Files:**
- Modify: `src/lib/types.ts` (`Note`), `src/lib/memory/store.ts` (`searchNotes`), `src/lib/memory/store.test.ts`, `src/data/personas.ts`, `src/data/personas.test.ts`

**Interfaces:**
- Consumes: `Note`, `MemoryStore.searchNotes(query, ctx, k)`.
- Produces: `Note.pinned?: boolean`; `searchNotes` returns context notes first, then pinned notes, then ranked notes, without duplicates, at most `k`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/memory/store.test.ts`, add inside `describe("MemoryStore", ...)`:

```ts
  it("always sends pinned notes right after the place and partner", async () => {
    const m = await MemoryStore.create();
    const me = note("me", "about-me", "I'm Tom. I'm Deaf and I read captions.");
    await m.replaceAll([...NOTES, { ...me, pinned: true }], []);
    const ids = (await m.searchNotes("what size would you like", { ...ctx, placeId: "cafe", partnerId: "sam" })).map((n) => n.id);
    expect(ids.slice(0, 3)).toEqual(["cafe", "sam", "me"]);
    const noQuery = (await m.searchNotes("", ctx)).map((n) => n.id);
    expect(noQuery).toEqual(["me"]);
  });

  it("does not repeat a pinned note that is also the place or partner, and keeps to k", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES.map((n) => (n.id === "sam" ? { ...n, pinned: true } : n)), []);
    const ids = (await m.searchNotes("barista", { ...ctx, placeId: "cafe", partnerId: "sam" }, 2)).map((n) => n.id);
    expect(ids).toEqual(["cafe", "sam"]);
  });

  it("works with no pinned note", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    expect((await m.searchNotes("", ctx)).map((n) => n.id)).toEqual([]);
  });
```

In `src/data/personas.test.ts`, add inside the per-persona `describe(p.name, ...)`:

```ts
      it("pins exactly one about-me note", () => {
        const pinned = p.notes.filter((n) => n.pinned);
        expect(pinned).toHaveLength(1);
        expect(pinned[0].kind).toBe("about-me");
      });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/memory/store.test.ts src/data/personas.test.ts`
Expected: FAIL (`pinned` is not a `Note` field; nothing is pinned).

- [ ] **Step 3: Add the field**

In `src/lib/types.ts`, add to `Note` after `entities`:

```ts
  /** Always sent with suggestion requests: the note that says who the user is and how they communicate. */
  pinned?: boolean;
```

- [ ] **Step 4: Send pinned notes**

In `src/lib/memory/store.ts`, in `searchNotes`, replace from `const ranked = ...` to the `return` with:

```ts
    const pinnedIds = [...this.notesById.values()].filter((n) => n.pinned && !contextIds.includes(n.id)).map((n) => n.id);
    const ranked = [...scores.entries()]
      .filter(([id]) => !contextIds.includes(id) && !pinnedIds.includes(id) && this.notesById.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => this.notesById.get(id)!);
    return [...[...contextIds, ...pinnedIds].map((id) => this.notesById.get(id)!), ...ranked].slice(0, k);
```

- [ ] **Step 5: Pin each profile's main about-me note**

In `src/data/personas.ts`, change the note helper to accept extra fields:

```ts
const n = (id: string, kind: Note["kind"], text: string, entities: string[] = [], extra: Partial<Note> = {}): Note => ({
  id,
  kind,
  text,
  entities,
  updatedAt: 0,
  ...extra,
});
```

and add `{ pinned: true }` as the fifth argument to `m-me`, `t-me` and `a-me`, for example:

```ts
      n("t-me", "about-me", "I'm Tom. I'm Deaf and I use ASL. I read captions to follow what people say.", ["Tom"], { pinned: true }),
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/memory src/data eval`
Expected: PASS.

- [ ] **Step 7: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/types.ts src/lib/memory/store.ts src/lib/memory/store.test.ts src/data/personas.ts src/data/personas.test.ts
git commit -m "Always send the note that says who the user is and how they communicate

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 7: Close the validator's blind spots

**Files:**
- Create: `src/lib/suggest/common-words.ts`
- Modify: `src/lib/suggest/validate.ts`, `src/lib/suggest/validate.test.ts`, `eval/scenarios.test.ts`

**Interfaces:**
- Consumes: `extractClaims`, `claimSupported`, `validateReply`.
- Produces: `export const COMMON_WORDS: ReadonlySet<string>` (lowercase); `extractClaims` also returns a sentence-initial capitalised word that is not in `COMMON_WORDS`, the name after a title (`Dr.`, `Mr.`, `Mrs.`, `Ms.`), and relative time phrases (`this week`, `next week`, `last week`, `this weekend`, `next weekend`, `next month`, `later today`); `claimSupported` backs a multi-word claim by a case-insensitive phrase match.

- [ ] **Step 1: Write the failing tests**

In `src/lib/suggest/validate.test.ts`, replace the test "ignores sentence-initial capitals that aren't days or months" with:

```ts
  it("ignores everyday words at the start of a sentence", () => {
    expect(extractClaims("Large, please.")).toEqual([]);
    expect(extractClaims("Coffee sounds good. Thanks!")).toEqual([]);
    expect(extractClaims("Much better, thanks.")).toEqual([]);
    expect(extractClaims("Here it is.")).toEqual([]);
  });
  it("checks an unusual word at the start of a sentence as a possible name", () => {
    expect(extractClaims("Jen helped me set it up.")).toEqual(["Jen"]);
    expect(extractClaims("Sure. Priya said so.")).toEqual(["Priya"]);
  });
```

and add:

```ts
describe("titles and relative times", () => {
  it("checks the name after a title", () => {
    expect(extractClaims("Ask Dr. Patel about it.")).toContain("Patel");
    expect(validateReply({ text: "Ask Dr. Patel about it.", noteIds: [] }, sources()).ok).toBe(false);
  });

  it("checks relative time phrases and backs them from the conversation", () => {
    expect(extractClaims("Maybe I'll skip it this week.")).toContain("this week");
    expect(validateReply({ text: "Maybe I'll skip it this week.", noteIds: [] }, sources()).ok).toBe(false);
    expect(validateReply({ text: "Yes, this week works.", noteIds: [] }, sources({ partnerSaid: "Are you free this week?" })).ok).toBe(true);
    expect(validateReply({ text: "Later today works.", noteIds: [] }, sources({ partnerSaid: "Can we talk later today?" })).ok).toBe(true);
  });

  it("drops an invented name at the start of a sentence and keeps a backed one", () => {
    expect(validateReply({ text: "Jen helped me set it up.", noteIds: [] }, sources()).ok).toBe(false);
    expect(validateReply({ text: "Sam knows my order.", noteIds: ["sam"] }, sources()).ok).toBe(true);
  });
});
```

In `eval/scenarios.test.ts`, add at the end (imports: `extractClaims`, `claimSupported` from `@/lib/suggest/validate`, `personas` is already imported):

```ts
describe("validator guard", () => {
  // Every reply a user really meant, and every saved phrase, must survive the claim
  // check when the profile's notes and the conversation are the sources. A failure
  // here means the check would hide a good reply: add the everyday word to
  // COMMON_WORDS (never a name).
  it("accepts every intended reply and saved phrase", () => {
    for (const s of [...scenarios, ...testScenarios]) {
      const p = personas.find((x) => x.id === s.persona)!;
      const source = [...p.notes.map((n) => n.text), s.partnerSaid, s.typed ?? "", "It is Tuesday morning."].join("\n");
      for (const claim of extractClaims(s.intended)) expect(claimSupported(claim, source), `${s.id}: ${claim}`).toBe(true);
    }
    for (const p of personas) {
      const source = p.notes.map((n) => n.text).join("\n");
      for (const ph of p.phrases) for (const claim of extractClaims(ph.text)) expect(claimSupported(claim, source), `${ph.id}: ${claim}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/suggest/validate.test.ts eval/scenarios.test.ts`
Expected: FAIL on the new name, title and relative-time tests.

- [ ] **Step 3: The everyday word list**

Create `src/lib/suggest/common-words.ts`:

```ts
/**
 * Everyday English words that can start a reply. A capitalised first word that is not
 * in this list is checked as a possible name, so "Jen helped me" needs a source but
 * "Large, please." doesn't. Add ordinary words here when a good reply is blocked;
 * never add names.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  "a", "about", "absolutely", "actually", "after", "again", "ah", "all", "almost", "alright", "also", "always", "an", "and",
  "another", "any", "anything", "anyway", "are", "around", "as", "ask", "at", "awesome", "back", "be", "because", "been",
  "before", "better", "black", "both", "busy", "but", "by", "can", "can't", "card", "cash", "certainly", "check", "coffee",
  "come", "cool", "could", "cup", "decaf", "definitely", "did", "didn't", "do", "does", "doing", "don't", "done", "each",
  "either", "enjoy", "even", "every", "everything", "excuse", "exactly", "fine", "first", "for", "from", "give", "glad",
  "go", "going", "good", "got", "great", "ha", "had", "happy", "has", "have", "he", "he's", "hello", "her", "here", "hey",
  "hi", "his", "hmm", "hold", "home", "hot", "how", "iced", "if", "in", "is", "isn't", "it", "it's", "just", "large",
  "last", "later", "latte", "let", "let's", "like", "little", "look", "lots", "lovely", "maybe", "me", "medium", "milk",
  "mine", "more", "morning", "most", "much", "my", "never", "next", "nice", "no", "none", "nope", "not", "nothing", "now",
  "of", "off", "oh", "on", "once", "one", "only", "or", "other", "our", "out", "over", "pardon", "perfect", "perhaps",
  "please", "pretty", "probably", "quite", "ready", "really", "regular", "right", "same", "see", "send", "she", "she's",
  "should", "small", "so", "some", "someone", "something", "sometimes", "soon", "sorry", "sounds", "still", "sugar",
  "sure", "take", "tea", "tell", "thank", "thanks", "that", "that's", "the", "their", "them", "then", "there", "there's",
  "these", "they", "they're", "third", "this", "those", "though", "to", "toast", "today", "together", "too", "totally",
  "try", "two", "um", "until", "up", "us", "usual", "very", "wait", "was", "water", "we", "we're", "welcome", "well",
  "were", "what", "what's", "when", "where", "which", "while", "who", "why", "will", "with", "without", "won't", "would",
  "wow", "yeah", "yes", "yep", "yet", "you", "you're", "your", "yours",
]);
```

- [ ] **Step 4: Extend the claim extraction**

In `src/lib/suggest/validate.ts`:

Add the import `import { COMMON_WORDS } from "./common-words";`.

Add after `RELATIVE_DAYS`:

```ts
/** Relative time phrases that state when something happens, so they need a source. */
const RELATIVE_TIMES = /\b(?:(?:this|next|last) (?:week|weekend|month)|later today)\b/gi;

/** A full stop after these doesn't end a sentence, so the name after them is still checked. */
const SENTENCE_END = /(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms)\.)\s+/;
```

Replace the body of `extractClaims` (and update its doc comment) with:

```ts
/**
 * Details that must be backed by a source: numbers and times, day and month names,
 * relative days and time phrases (tomorrow, this week, later today) anywhere, and
 * capitalised words that could be names: any capitalised word after the first word
 * of a sentence, and a capitalised first word that is not an everyday word.
 */
export function extractClaims(text: string): string[] {
  const claims: string[] = [];
  for (const m of text.matchAll(NUMBER)) claims.push(canonicalNumber(m[0]));
  for (const m of text.matchAll(RELATIVE_TIMES)) claims.push(m[0].toLowerCase());
  for (const sentence of text.split(SENTENCE_END)) {
    const words = sentence.match(WORD) ?? [];
    words.forEach((word, i) => {
      const n = normalize(word).replace(/'s$/, "");
      if (NEVER_NAMES.has(n)) return;
      if (NUMBER_WORDS.has(n)) {
        claims.push(n);
        return;
      }
      if (DAYS_AND_MONTHS.has(n) || RELATIVE_DAYS.has(n)) {
        claims.push(word.replace(/['\u2019]s$/, ""));
        return;
      }
      if (!/^\p{Lu}/u.test(word)) return;
      if (i > 0 || !COMMON_WORDS.has(normalize(word))) claims.push(word.replace(/['\u2019]s$/, ""));
    });
  }
  return claims;
}
```

In `claimSupported`, add as the first line of the function:

```ts
  if (/\s/.test(claim)) return normalize(sourceText).includes(normalize(claim));
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/suggest src/data eval`
Expected: PASS. If the validator guard in `eval/scenarios.test.ts` fails for an everyday word (for example `Oat`), add that word to `COMMON_WORDS` and rerun. If it fails for a name, the scenario or phrase is wrong; stop and report it instead of changing it (the test set must not change after Task 1).

- [ ] **Step 6: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/suggest/common-words.ts src/lib/suggest/validate.ts src/lib/suggest/validate.test.ts eval/scenarios.test.ts
git commit -m "Check names at the start of a sentence, names after a title, and relative time phrases

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 8: Claim check model behind a flag

**Files:**
- Create: `src/lib/server/claim-check.ts`, `src/lib/server/claim-check.test.ts`
- Modify: `eval/run.ts` (`--claim-check`), `eval/score.ts` (`ScenarioResult.checkBlocked`, `ModelSummary.checkBlocked`, table column), `eval/score.test.ts`

**Interfaces:**
- Consumes: `retryAfterMs` is not needed; `ChatMessage` from `@/lib/suggest/prompt`.
- Produces:
  - `export interface ClaimCheckInput { reply: string; notes: string[]; partnerSaid: string; typed: string; contextLine: string; phrases: string[] }`
  - `export type ClaimVerdict = "ok" | "invented" | "unknown"`
  - `export function claimCheckMessages(input: ClaimCheckInput): ChatMessage[]`
  - `export async function checkReply(input: ClaimCheckInput, opts: { apiKey: string | undefined; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<ClaimVerdict>` (default model `process.env.CLAIM_CHECK_MODEL ?? "llama-3.1-8b-instant"`, default timeout 600 ms; any error, timeout or unclear answer returns `"unknown"`)
  - eval flag `--claim-check`: model replies that pass the validator are also checked; `"invented"` drops the reply and counts `checkBlocked`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/claim-check.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkReply, claimCheckMessages, type ClaimCheckInput } from "./claim-check";

const input: ClaimCheckInput = {
  reply: "I went to the park.",
  notes: ["Biscuit is my dog."],
  partnerSaid: "What did you do today?",
  typed: "",
  contextLine: "It is Tuesday morning.",
  phrases: ["My usual, please."],
};

const answer = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("claimCheckMessages", () => {
  it("gives the reply, the sources and a one-word answer format", () => {
    const [, user] = claimCheckMessages(input);
    for (const s of ['"I went to the park."', "- Biscuit is my dog.", "What did you do today?", "- My usual, please.", "ok or invented"]) {
      expect(user.content).toContain(s);
    }
  });
});

describe("checkReply", () => {
  it("reads ok and invented", async () => {
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => answer("invented")) })).toBe("invented");
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => answer(" OK.")) })).toBe("ok");
  });

  it("sends a short deterministic request to the check model", async () => {
    const fetchImpl = vi.fn(async () => answer("ok"));
    await checkReply(input, { apiKey: "k", model: "m", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", temperature: 0, max_tokens: 3 });
  });

  it("returns unknown on an unclear answer, an HTTP error, a network error or no key", async () => {
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => answer("maybe")) })).toBe("unknown");
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => new Response("{}", { status: 429 })) })).toBe("unknown");
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) })).toBe("unknown");
    expect(await checkReply(input, { apiKey: undefined, fetchImpl: vi.fn() })).toBe("unknown");
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      const verdict = checkReply(input, { apiKey: "k", timeoutMs: 600, fetchImpl: fetchImpl as unknown as typeof fetch });
      await vi.advanceTimersByTimeAsync(600);
      expect(await verdict).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

In `eval/score.test.ts`, add:

```ts
describe("summarize: claim check", () => {
  it("adds up replies the claim check dropped and shows them in the table", () => {
    const base: ScenarioResult = {
      id: "x", ok: true, shown: ["a"], rawReplies: 3, blocked: 0, judgement: { match: 1, invented: [], unbacked: [] },
      keystrokesSaved: 0, noteRecall: true, firstReplyMs: 1, totalMs: 1, checkBlocked: 2,
    };
    const s = summarize("m", [base, { ...base, checkBlocked: 1 }]);
    expect(s.checkBlocked).toBe(3);
    expect(toMarkdown([s])).toContain("| Dropped by the claim check |");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/server/claim-check.test.ts eval/score.test.ts`
Expected: FAIL (`./claim-check` missing; `checkBlocked` undefined).

- [ ] **Step 3: Implement the check**

Create `src/lib/server/claim-check.ts`:

```ts
import type { ChatMessage } from "@/lib/suggest/prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface ClaimCheckInput {
  reply: string;
  notes: string[];
  partnerSaid: string;
  typed: string;
  contextLine: string;
  phrases: string[];
}

export type ClaimVerdict = "ok" | "invented" | "unknown";

export function claimCheckMessages(c: ClaimCheckInput): ChatMessage[] {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "(none)");
  const lines = [
    `Reply: "${c.reply}"`,
    `Situation: ${c.contextLine}`,
    `The other person said: "${c.partnerSaid}"`,
    `The person typed: "${c.typed}"`,
    "Facts about the person:",
    list(c.notes),
    "Things the person has said before:",
    list(c.phrases),
    "",
    "Does the reply state anything about the person that none of the above backs: what they did, have, feel, want, plan or prefer, or a name, place, number, day or time?",
    "Politeness, yes or no, agreeing, declining and questions are fine.",
    "Answer with one word: ok or invented.",
  ];
  return [
    { role: "system", content: "You check replies for a communication aid. You answer with one word." },
    { role: "user", content: lines.join("\n") },
  ];
}

/**
 * Asks a small, fast model whether a reply states something about the person that
 * the sources don't back. Any error, timeout or unclear answer is "unknown", so a
 * slow or failing checker never hides replies (quality pass spec 4.5).
 */
export async function checkReply(
  input: ClaimCheckInput,
  opts: { apiKey: string | undefined; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<ClaimVerdict> {
  if (!opts.apiKey) return "unknown";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 600);
  try {
    const res = await fetchImpl(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model ?? process.env.CLAIM_CHECK_MODEL ?? "llama-3.1-8b-instant",
        messages: claimCheckMessages(input),
        temperature: 0,
        max_tokens: 3,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? "").toLowerCase();
    if (text.includes("invented")) return "invented";
    if (/\bok\b/.test(text)) return "ok";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Scoring**

In `eval/score.ts`: add `checkBlocked?: number;` to `ScenarioResult` (doc: replies the claim check dropped, only with `--claim-check`), add `checkBlocked: number;` to `ModelSummary`, set it in `summarize` with `checkBlocked: sum(ok.map((r) => r.checkBlocked ?? 0)),`, and add a `Dropped by the claim check` column at the end of the table header (`|---|` added to the separator) with `${s.checkBlocked}` at the end of each row.

- [ ] **Step 5: The eval flag**

In `eval/run.ts`:

- Import `checkReply` from `@/lib/server/claim-check`.
- In `main()`, read `const claimCheck = process.argv.includes("--claim-check");` and pass it to `runScenario`. Add ` with the claim check` to the markdown header sentence when it is on.
- In `runScenario`, when `claimCheck` is on, replies must be checked in order before they count as shown, so the splitter only queues them and the stream loop awaits the checks. Replace the splitter and the `for await` loop with:

```ts
    const queue: { text: string; noteIds: string[] }[] = [];
    const splitter = createObjectSplitter((obj) => {
      const parsed = parseLine(obj);
      if (parsed?.kind !== "reply") return;
      rawReplies++;
      if (!validateReply({ text: parsed.text, noteIds: parsed.noteIds }, sources).ok) {
        blocked++;
        return;
      }
      queue.push({ text: parsed.text, noteIds: parsed.noteIds });
    });
    const drain = async () => {
      while (queue.length) {
        const reply = queue.shift()!;
        if (shown.length >= 3 || shown.some((t) => isNearDuplicate(t, reply.text))) continue;
        if (claimCheck) {
          const verdict = await checkReply(
            { reply: reply.text, notes: body.notes.map((n) => n.text), partnerSaid: body.partnerSaid, typed: body.typed, contextLine: body.contextLine, phrases: body.examples },
            { apiKey: process.env.GROQ_API_KEY },
          );
          if (verdict === "invented") {
            checkBlocked++;
            continue;
          }
        }
        shown.push(reply.text);
        firstReplyMs ??= performance.now() - started;
      }
    };
    for await (const d of deltas) {
      raw += d;
      splitter.push(d);
      await drain();
    }
    splitter.flush();
    await drain();
```

Declare `let checkBlocked = 0;` next to `blocked`, and add `checkBlocked` to both returned result objects.

- [ ] **Step 6: Run the tests and a smoke run**

Run: `npx vitest run src/lib/server eval`
Expected: PASS.

Run: `npm run eval -- --models groq:qwen/qwen3.8-27b --limit 3 --delay 500 --claim-check`. Expected: the run finishes and the table has the new column. If the check model answers 404 (model id retired), pick the current smallest Llama model from Groq's model list (`https://console.groq.com/docs/models`), change the default in `claim-check.ts`, and say so in your report. Delete the untracked `eval/results/` files it wrote, except `judge-cache.json` if it existed before.

- [ ] **Step 7: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/server/claim-check.ts src/lib/server/claim-check.test.ts eval/run.ts eval/score.ts eval/score.test.ts
git commit -m "Add a claim check model the eval can turn on with --claim-check

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 9: Clear the reply timer between conversations

**Files:**
- Modify: `src/lib/conversation/response-gap.ts`, `src/lib/conversation/response-gap.test.ts`, `src/components/conversation-screen.tsx`

**Interfaces:**
- Consumes: `GapTimer` (plan 2).
- Produces: `GapTimer.reset(): void`; waiting turns older than `MAX_WAIT_MS = 30_000` when replies arrive are dropped without a sample.

- [ ] **Step 1: Write the failing tests**

In `src/lib/conversation/response-gap.test.ts`, add:

```ts
describe("GapTimer clean-up", () => {
  const model = [{ source: "model" as const }];

  it("drops a waiting turn that ended more than 30 s before replies arrive", () => {
    const record = vi.fn();
    const t = new GapTimer(record);
    t.speechStarted(1_000);
    t.turnEnded(2_000);
    t.repliesShown(32_001, model, 2_500);
    expect(record).not.toHaveBeenCalled();
  });

  it("still records a turn that waited just under 30 s", () => {
    const record = vi.fn();
    const t = new GapTimer(record);
    t.speechStarted(1_000);
    t.turnEnded(2_000);
    t.repliesShown(31_999, model, 2_500);
    expect(record).toHaveBeenCalledWith(29_999);
  });

  it("forgets waiting and unfinished turns on reset", () => {
    const record = vi.fn();
    const t = new GapTimer(record);
    t.speechStarted(1_000);
    t.turnEnded(2_000);
    t.speechStarted(3_000);
    t.reset();
    t.repliesShown(4_000, model, 3_500);
    t.turnEnded(5_000);
    expect(record).not.toHaveBeenCalled();
  });
});
```

(Import `vi` from `vitest` if the file doesn't already.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/conversation/response-gap.test.ts`
Expected: FAIL (`reset` is not a function; the 30 s turn is recorded).

- [ ] **Step 3: Implement**

In `src/lib/conversation/response-gap.ts`, add above the class:

```ts
/** A turn still waiting this long when replies arrive is from a stall or an outage, not a response gap. */
const MAX_WAIT_MS = 30_000;
```

Add to the class:

```ts
  /** Forget the current conversation: a profile switch or stopping Listen. */
  reset(): void {
    this.turnStartedAt = null;
    this.shownAt = null;
    this.waiting = [];
  }
```

In `repliesShown`, change the loop body so stale turns are dropped:

```ts
    for (const turn of this.waiting) {
      if (at - turn.endedAt > MAX_WAIT_MS) continue;
      if (turn.startedAt <= asked) this.record(Math.max(0, at - turn.endedAt));
      else still.push(turn);
    }
```

- [ ] **Step 4: Reset on profile switch and on stopping Listen**

In `src/components/conversation-screen.tsx`:

- In the profile switch callback, right after `dispatch({ type: "reset" });`, add `gapTimer.reset();` and add `gapTimer` to that callback's dependency list.
- In `toggleListening`, change the stop branch to:

```ts
    if (hearingStatus === "listening" || hearingStatus === "loading") {
      hearing.stop();
      gapTimer.reset();
    } else void hearing.start();
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/conversation src/components`
Expected: PASS.

- [ ] **Step 6: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/conversation/response-gap.ts src/lib/conversation/response-gap.test.ts src/components/conversation-screen.tsx
git commit -m "Clear the reply timer on profile switch and when listening stops, and drop stale turns

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 10 (conditional): Claim check in the app

Run this task only if the controller's decision after the Task 8 eval run says so (see "Eval runs"). Otherwise the controller records that it was skipped and why.

**Files:**
- Create: `src/lib/server/claim-filter.ts`, `src/lib/server/claim-filter.test.ts`
- Modify: `src/app/api/suggest/route.ts`, `src/app/api/suggest/route.test.ts`, `.env.example`

**Interfaces:**
- Consumes: `createObjectSplitter`, `parseLine` (Task 4); `checkReply`, `ClaimVerdict` (Task 8).
- Produces: `export async function* filterReplies(deltas: AsyncIterable<string>, check: (reply: string) => Promise<ClaimVerdict>): AsyncGenerator<string, void, undefined>` which yields one line per object (`JSON` + `"\n"`) and stray text lines, dropping reply objects the check calls `"invented"`. The route uses it when `CLAIM_CHECK=on`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/claim-filter.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { filterReplies } from "./claim-filter";

async function* chunks(...xs: string[]) {
  for (const x of xs) yield x;
}
const collect = async (it: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const x of it) out.push(x);
  return out;
};

describe("filterReplies", () => {
  it("drops replies the check calls invented and keeps the rest in order", async () => {
    const check = vi.fn(async (reply: string) => (reply.includes("park") ? "invented" : "ok") as const);
    const out = await collect(
      filterReplies(chunks('{"reply": "Yes.", "notes": []}\n{"reply": "I went to the ', 'park.", "notes": []}\n{"reactions": ["yes"]}'), check),
    );
    expect(out).toEqual(['{"reply": "Yes.", "notes": []}\n', '{"reactions": ["yes"]}\n']);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("keeps a reply when the check can't tell", async () => {
    const out = await collect(filterReplies(chunks('{"reply": "Maybe.", "notes": []}'), async () => "unknown"));
    expect(out).toEqual(['{"reply": "Maybe.", "notes": []}\n']);
  });

  it("passes invalid objects and stray text through, so the client can still retry junk", async () => {
    const out = await collect(filterReplies(chunks('I cannot help with that.\n{"other": 1}'), async () => "ok"));
    expect(out).toEqual(["I cannot help with that.\n", '{"other": 1}\n']);
  });
});
```

In `src/app/api/suggest/route.test.ts`, add a test in the style of "streams model text with the provider header" that sets `process.env.CLAIM_CHECK = "on"`, mocks the provider stream to return two reply lines, mocks the check model call (the fetch to `https://api.groq.com/openai/v1/chat/completions` with `max_tokens: 3`) to answer `invented` for one of them, and expects the response text to contain only the other reply; restore `CLAIM_CHECK` afterwards. Follow that file's existing fetch mocking (read it first); the check call can be told apart from the completion call by `max_tokens: 3` in its body.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/server/claim-filter.test.ts src/app/api/suggest/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the filter**

Create `src/lib/server/claim-filter.ts`:

```ts
import { createObjectSplitter, parseLine } from "@/lib/suggest/protocol";
import type { ClaimVerdict } from "./claim-check";

/**
 * Passes model output through, one line per JSON object, and drops reply objects the
 * claim check calls invented. Stray text and invalid objects pass through unchanged so
 * the client still sees junk and can retry. Replies are checked one at a time, in order.
 */
export async function* filterReplies(deltas: AsyncIterable<string>, check: (reply: string) => Promise<ClaimVerdict>): AsyncGenerator<string, void, undefined> {
  const pending: string[] = [];
  const splitter = createObjectSplitter(
    (obj) => pending.push(obj),
    (text) => pending.push(`\u0000${text}`),
  );
  async function* drain() {
    while (pending.length) {
      const item = pending.shift()!;
      if (item.startsWith("\u0000")) {
        yield `${item.slice(1)}\n`;
        continue;
      }
      const parsed = parseLine(item);
      if (parsed?.kind === "reply" && (await check(parsed.text)) === "invented") continue;
      yield `${item.trim()}\n`;
    }
  }
  for await (const d of deltas) {
    splitter.push(d);
    yield* drain();
  }
  splitter.flush();
  yield* drain();
}
```

(The `\u0000` prefix marks stray text inside the queue only; it never reaches the client. Write it as the escape sequence `\u0000`, not a literal character.)

- [ ] **Step 4: Use it in the route**

In `src/app/api/suggest/route.ts`, import `checkReply` from `@/lib/server/claim-check` and `filterReplies` from `@/lib/server/claim-filter`. After `streamCompletion` returns, add:

```ts
    const body = parsed.data;
    const output =
      process.env.CLAIM_CHECK === "on"
        ? filterReplies(deltas, (reply) =>
            checkReply(
              { reply, notes: body.notes.map((n) => n.text), partnerSaid: body.partnerSaid, typed: body.typed, contextLine: body.contextLine, phrases: body.examples },
              { apiKey: process.env.GROQ_API_KEY },
            ),
          )
        : deltas;
```

and use `output` instead of `deltas` in the `ReadableStream`'s `pull` (`await output.next()`) and `cancel` (`await output.return(undefined)`). `deltas` from `streamCompletion` is an `AsyncGenerator<string>`; `filterReplies` returns one too, so both calls type-check.

In `.env.example`, add:

```
# Optional: check each reply with a small model before it is shown (quality pass, spec 4.5).
CLAIM_CHECK=on
```

(Only add this line if the controller's decision turned the check on; the value documents the setting.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/server src/app/api`
Expected: PASS.

- [ ] **Step 6: Check and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`

```bash
git add src/lib/server/claim-filter.ts src/lib/server/claim-filter.test.ts src/app/api/suggest/route.ts src/app/api/suggest/route.test.ts .env.example
git commit -m "Check replies with a small model before they are shown

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 11: Live timing and the write-up

Runs after the controller's test-set run. The controller hands over the paths of the saved dev and test results.

**Files:**
- Modify: `tests/e2e/live-hearing.spec.ts`, `eval/RESULTS.md`, `README.md`, `docs/superpowers/specs/2026-09-27-onbeat-design.md` (section 5 default model sentence if the model changed; section 9 one sentence), `src/lib/server/providers.ts` and `src/lib/server/providers.test.ts` only if the model choice changed the default
- Add: `eval/results/latest-dev.md`, `eval/results/latest-test.md` (generated by the controller's runs)

**Interfaces:**
- Consumes: the controller's result files and the model decision.
- Produces: the results of record.

- [ ] **Step 1: Collect ten live turns**

In `tests/e2e/live-hearing.spec.ts`, change `.toBeGreaterThanOrEqual(5)` to `.toBeGreaterThanOrEqual(10)` and the poll timeout from `90_000` to `180_000`. Run: `ONBEAT_LIVE=1 npx playwright test tests/e2e/live-hearing.spec.ts --reporter=list`. Expected: PASS and a list of at least 10 gaps. Compute the median and p95 with nearest rank, like `src/lib/stats.ts` `percentile`.

- [ ] **Step 2: Apply the model choice**

If the controller's decision changed the default Groq model, change the default in `providerConfigs` (`env.GROQ_MODEL ?? "<model>"`) and the first test in `src/lib/server/providers.test.ts` to expect it, and update the section 5 sentence in the parent spec. If not, change nothing here.

- [ ] **Step 3: Write `eval/RESULTS.md`**

Keep the plan 2 sections as history under a heading `## Plan 2 baseline (2026-09-28)` (move the existing results, model choice, timing and known gaps under it, headings one level down). Above it add:

```markdown
## Quality pass (<date>)

What changed: <one line each: object parser, prompt, pinned about-me note, validator, claim check (on or off, and why), judge and scoring changes>.

### Test set (held out, 60 scenarios, written before tuning)

<paste the table from results/latest-test.md>

### Dev set (60 scenarios, used for tuning)

<paste the table from results/latest-dev.md for the final dev run>

### Against the targets

<one short paragraph per target: 90% hit rate and under 5% invented, for the default model on the test set, met or not, with the numbers; first-reply p50 against the plan 2 baseline>

### In-app timing

<the live check sentence as in plan 2, with at least 10 turns>

### Known gaps

<what is still flagged on the test set, quoted, grouped the plan 2 way>
```

Fill every `<...>` with real values; leave nothing in angle brackets. If a target is missed, say so plainly and say that the owner decides before deployment (parent spec section 9).

- [ ] **Step 4: README and spec**

In `README.md`, under the Status section, add the test-set table for the default model and the backup (from `latest-test.md`), with one sentence saying it is the held-out set and linking `eval/RESULTS.md`. In the parent spec section 9, after the gate sentence, add one sentence: `The quality pass measured <hit rate> and <invented rate> on the held-out test set; see eval/RESULTS.md.`

- [ ] **Step 5: Final checks**

Run each on its own: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`.
Expected: all pass (the live check is skipped without `ONBEAT_LIVE`).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/live-hearing.spec.ts eval/RESULTS.md eval/results/latest-dev.md eval/results/latest-test.md README.md docs/superpowers/specs/2026-09-27-onbeat-design.md
# plus src/lib/server/providers.ts src/lib/server/providers.test.ts if Step 2 changed them
git commit -m "Record the quality pass results

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

Do not push; the controller pushes after the final review.
