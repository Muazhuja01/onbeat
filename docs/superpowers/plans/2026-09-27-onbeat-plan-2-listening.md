# OnBeat Plan 2: Listening and eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app listens to the other person through the microphone, shows their words as live captions, prepares replies while they are still talking, and an eval measures reply quality and speed for the three example profiles so the default model can be chosen.

**Architecture:** A hearing web worker runs Silero VAD and Moonshine through Transformers.js (the pattern from the Moonshine Web example), fed 16 kHz audio from an AudioWorklet. A main-thread `HearingEngine` owns the microphone, the worker and the listening status, and emits `partial`, `turnEnd` and `level` events. The conversation layer turns partials into speculative suggestion requests (at most every 2.5 s, after 3 new words), sends one final request at turn end only when the words changed, and a client-side token bucket keeps requests under the rate limit by skipping speculative requests first. A Node eval runner reuses the app's request builder, prompt, provider code and validator, and grades replies with a second model.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, @huggingface/transformers 3.8.1 (Silero VAD `onnx-community/silero-vad`, Moonshine `onnx-community/moonshine-tiny-ONNX`), Web Audio AudioWorklet, Vitest 5 + Testing Library, Playwright, tsx (eval runner).

**Spec:** `docs/superpowers/specs/2026-09-27-onbeat-design.md` (read sections 3, 4, 5, 6.4, 7 and 9 first). Plan 1 (already merged): `docs/superpowers/plans/2026-09-27-onbeat-plan-1-core.md`. Research notes: `docs/research-notes.md`.

**Scope of this plan:** spec build-order step 5 (hearing worker, speculative requests, reactions and cue light during partner speech), the eval from step 3, and the plan-1 items deferred to plan 2: quota guard for slow typists, idle timeout after the first token, several JSON objects on one line, validator strictness (context names, number words), persona entity test. Notes and settings screens, first-run flow, deploy and the demo stay in plan 3.

**Decisions made while writing this plan (recorded so reviewers don't flag them):**

- Silero VAD runs inside the hearing worker through Transformers.js `AutoModel`, as in Hugging Face's Moonshine Web example. `@ricky0123/vad-web` (listed in the spec's version line) is not used: it runs VAD on the main thread and pulls in a second copy of onnxruntime-web. The spec's architecture ("hearing worker (Silero VAD + Moonshine)") is unchanged.
- Moonshine tiny (encoder fp32 31 MB, merged decoder q8 20 MB, VAD 2 MB) keeps the voice plus speech download near the spec's 150 MB (Kokoro q8 is about 90 MB). Task 9's live check decides if base is needed.
- A turn ends after 600 ms of silence (the example uses 400 ms, which splits sentences at breaths).
- "Per provider" quota guard: the server remembers a provider's 429 and skips it until its `Retry-After` passes; the client keeps one token bucket for its own calls to `/api/suggest` (the thing the per-IP rate limit counts).
- The response-gap timer measures "partner's last word to replies for this turn on screen". Replies prepared during the turn count as 0 ms, which is exactly the spec's goal ("usually on screen when the partner stops").

## Global Constraints

- Node 24, npm 11. Run `npm i` without `--silent`. npm 11 blocks install scripts; that is fine for this plan.
- `@huggingface/transformers` stays pinned to exactly `3.8.1`. Do not install v4.
- Next.js 16 has breaking changes. Before writing Next-specific code, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`).
- UI copy: plain, active voice, second person, sentence case. No em dash or en dash characters anywhere in UI strings, docs or eval files. Use `…` (single character) for loading states.
- Colour is never the only signal: every state also has text and/or an icon.
- Colours only through tokens (`bg-ground`, `bg-surface`, `text-ink`, `text-muted`, `bg-cue`, `text-on-cue`, `text-partner`, `border-partner`, border variants). No raw hex in components.
- Reply buttons at least 64 px tall and full width; every other control at least 48 x 48 px.
- Never `transition: all`; honour `prefers-reduced-motion` (the global rule in `globals.css` already makes transitions instant).
- Icons from `@phosphor-icons/react` only; every icon `aria-hidden` next to text or inside a control with an accessible name.
- Nothing is spoken without a user action. Speech recognition models download only after the user presses "Listen". Audio never leaves the browser; only transcribed text goes into suggestion requests.
- Personal notes never leave the browser except the (at most 8) notes sent with a suggestion request.
- Timing rules from spec 5: partials about every 0.5 s; speculative requests at most every 2.5 s and only after 3 or more new words; a final request on turn end only if the text changed; typing debounce 300 ms, minimum 2 characters; a new request aborts the previous one.
- API keys only in server environment variables `GROQ_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (and read by the eval from `.env.local`). Never print them, never write them into results files, never commit `.env.local`.
- Every commit message ends with a blank line and a `Co-Authored-By:` line naming the model that wrote the commit, for example `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (plan 1 ruling R6).
- The repo owner edits files on GitHub directly: run `git pull --rebase` before every `git push`.
- `npm run lint`, `npm run typecheck` and `npm test` must pass at the end of every task. If `eslint-config-next` 16's React hooks rules flag a pattern in this plan, fix it the way the rule suggests without changing behaviour.
- Plain developer voice in README and docs: no emoji, no em dashes, no marketing tables.

## Review Focus

1. **The app's own voice gets captioned as the partner.** When OnBeat speaks a reply, the microphone hears it. Expected: listening pauses while the app speaks and for 400 ms after, and any half-heard partner line is dropped. Pinned by "pauses while the app speaks and resumes after a tail" (Task 6) and "pauses listening while a reply is spoken" (Task 9).
2. **Microphone blocked, missing, or the page isn't secure.** Expected: a plain message says typing still works, nothing crashes, and pressing Listen again retries. Pinned by the denied/unavailable engine tests (Task 6) and "a blocked microphone explains what still works" (Task 9 e2e).
3. **A slow typist while the partner keeps talking runs out of request budget.** Expected: speculative requests are dropped first, typed and final requests are retried when the budget allows, and the "Suggestions are paused" notice does not appear just because of the budget. Pinned by the budget tests (Task 3), "retries a typed request after the budget wait" (Task 3) and "drops a skipped speculative request without retrying" (Task 7).
4. **The final request is skipped wrongly or sent twice.** Expected: the turn-end request is skipped only when a speculative request for the same words (ignoring case and punctuation) is on screen or in flight; a line typed twice is asked twice. Pinned by the `Speculation` tests and "skips the final request when the speculative one already answered the same words" (Task 7).
5. **A very long monologue or constant background noise.** Expected: a segment is forced to end at 30 s so memory stays bounded and a caption appears; short noises never become captions. Pinned by "forces an end at the maximum length" and "discards a short noise" (Task 4).

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/lib/server/providers.ts` | 1 | provider cooldown after 429, idle timeout after first token, per-model reasoning settings |
| `src/app/api/suggest/route.ts` | 1 | passes a module-level cooldown |
| `src/lib/suggest/protocol.ts` | 2 | `splitObjects`, `parseLines` |
| `src/lib/suggest/validate.ts` | 2 | number words, context line as a source |
| `src/lib/suggest/request.ts` | 2 | `buildSuggestRequest`, `clampInput` (shared by client and eval) |
| `src/lib/suggest/budget.ts` | 3 | `RequestBudget` token bucket |
| `src/lib/suggest/client.ts` | 2, 3 | uses the request builder, `parseLines`, budget, `SuggestSkippedError` |
| `src/lib/hearing/audio.ts` | 4 | `SAMPLE_RATE`, `FRAME`, `Framer`, `Resampler`, `levelOf` |
| `src/lib/hearing/segmenter.ts` | 4 | VAD probabilities to start/partial/end/discard events |
| `src/lib/hearing/messages.ts` | 4 | worker protocol types |
| `public/hearing/capture-processor.js` | 5 | AudioWorklet that chunks mic samples |
| `src/lib/hearing/mic.ts` | 5 | `openMic`, `MicError`, `MicSource` |
| `src/workers/hearing.worker.ts` | 5 | Silero VAD + Moonshine |
| `src/lib/hearing/engine.ts` | 6 | `HearingEngine`, `Hearing` interface, statuses |
| `src/lib/hearing/browser.ts` | 6 | `getBrowserHearing()` singleton and e2e seam |
| `src/lib/language-packs/*` | 6 | `asrModel` field |
| `src/lib/conversation/reducer.ts` | 7 | `partnerPartial` state and action |
| `src/lib/conversation/speculation.ts` | 7 | when to ask during partner speech, when to skip the final |
| `src/lib/conversation/use-suggestions.ts` | 3, 7 | priorities, budget retries, speculative requests |
| `src/lib/stats.ts` | 8 | `percentile` |
| `src/lib/conversation/response-gap.ts` | 8 | `GapTimer`, `loadGaps`, `saveGap` |
| `src/components/listen-control.tsx` | 9 | Listen toggle, status text, level meter |
| `src/components/response-gap.tsx` | 9 | reply timer readout (shown with `?timer`) |
| `src/components/caption-log.tsx` | 9 | live partial line |
| `src/components/announcer.tsx` | 9 | bounded queue |
| `src/components/conversation-screen.tsx` | 9 | wiring |
| `tests/e2e/helpers.ts`, `tests/e2e/listening.spec.ts`, `tests/e2e/live-hearing.spec.ts`, `tests/fixtures/partner.wav` | 9 | e2e with a fake hearing engine; opt-in live check |
| `eval/*` | 10 | scenarios, scoring, judge, runner |
| `eval/results/latest.md`, `eval/results/latest.json` | 11 | results |

---

### Task 1: Server: provider cooldown, idle timeout, per-model reasoning settings

**Files:**
- Modify: `src/lib/server/providers.ts`
- Modify: `src/app/api/suggest/route.ts`
- Test: `src/lib/server/providers.test.ts`

**Interfaces:**
- Consumes: existing `streamCompletion(messages, opts)`, `providerConfigs(env)`, `ProviderId`.
- Produces:
  - `groqExtraBody(model: string): Record<string, unknown>` (`{ reasoning_effort: "low" }` for `openai/gpt-oss*`, else `{ reasoning_effort: "none" }`)
  - `interface ProviderCooldown { isCooling(id: ProviderId): boolean; block(id: ProviderId, ms: number): void }`
  - `createCooldown(now?: () => number): ProviderCooldown`
  - `retryAfterMs(header: string | null): number`
  - `StreamOptions` gains `cooldown?: ProviderCooldown` and `idleTimeoutMs?: number` (default 4000)

- [ ] **Step 1: Create the branch**

```bash
cd C:/Users/hujai/onbeat
git checkout main
git pull --rebase
git checkout -b feat/listening
```

- [ ] **Step 2: Write the failing tests**

Change the import line at the top of `src/lib/server/providers.test.ts` to:

```ts
import { AllProvidersFailedError, createCooldown, groqExtraBody, providerConfigs, retryAfterMs, streamCompletion } from "./providers";
```

Add this helper under the existing `sse` helper:

```ts
/** Sends one token, then never sends anything again. */
function stalling(first: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: first } }] })}\n\n`));
    },
  });
  return new Response(body, { status: 200 });
}
```

Add these tests inside `describe("streamCompletion", ...)`:

```ts
  it("skips a provider that is cooling down after a 429", async () => {
    const cooldown = createCooldown();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("groq") ? new Response("busy", { status: 429, headers: { "retry-after": "20" } }) : sse(["ok"]),
    );
    const ask = () => streamCompletion(messages, { order: ["groq", "cloudflare"], configs, fetchImpl: fetchImpl as unknown as typeof fetch, cooldown });
    await ask();
    const r = await ask();
    expect(r.provider).toBe("cloudflare");
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes("groq"))).toHaveLength(1);
  });

  it("fails a stream that stalls after the first token", async () => {
    const fetchImpl = vi.fn(async () => stalling("Hi"));
    const r = await streamCompletion(messages, { order: ["groq"], configs, fetchImpl, idleTimeoutMs: 50 });
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const d of r.deltas) got.push(d);
      })(),
    ).rejects.toThrow(/stalled/);
    expect(got).toEqual(["Hi"]);
  });
```

Add these `describe` blocks at the end of the file:

```ts
describe("createCooldown", () => {
  it("blocks a provider until the time passes", () => {
    let t = 0;
    const c = createCooldown(() => t);
    c.block("groq", 1000);
    expect(c.isCooling("groq")).toBe(true);
    expect(c.isCooling("cloudflare")).toBe(false);
    t = 1001;
    expect(c.isCooling("groq")).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds, defaults to 30 s and caps at 5 minutes", () => {
    expect(retryAfterMs("20")).toBe(20_000);
    expect(retryAfterMs(null)).toBe(30_000);
    expect(retryAfterMs("soon")).toBe(30_000);
    expect(retryAfterMs("9999")).toBe(300_000);
  });
});

describe("groqExtraBody", () => {
  it("turns reasoning off, or as low as the model allows", () => {
    expect(groqExtraBody("qwen/qwen3.8-27b")).toEqual({ reasoning_effort: "none" });
    expect(groqExtraBody("openai/gpt-oss-20b")).toEqual({ reasoning_effort: "low" });
    const env = { GROQ_API_KEY: "g", GROQ_MODEL: "openai/gpt-oss-20b" } as unknown as NodeJS.ProcessEnv;
    expect(providerConfigs(env).groq.extraBody).toEqual({ reasoning_effort: "low" });
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/lib/server/providers.test.ts`
Expected: FAIL, `createCooldown` / `groqExtraBody` / `retryAfterMs` are not exported.

- [ ] **Step 4: Implement**

In `src/lib/server/providers.ts`:

Replace the `groq` entry of `providerConfigs` and add `groqExtraBody` above the function:

```ts
/**
 * Request fields that turn reasoning off, or as low as the model allows, so the
 * first token arrives quickly. gpt-oss models reject "none"; Qwen accepts it.
 */
export function groqExtraBody(model: string): Record<string, unknown> {
  return model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : { reasoning_effort: "none" };
}

export function providerConfigs(env: NodeJS.ProcessEnv = process.env): Record<ProviderId, ProviderConfig> {
  const groqModel = env.GROQ_MODEL ?? "qwen/qwen3.8-27b";
  return {
    groq: {
      id: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: groqModel,
      apiKey: env.GROQ_API_KEY,
      extraBody: groqExtraBody(groqModel),
    },
    // cloudflare entry unchanged
```

(Keep the whole `cloudflare` entry and its comment exactly as they are.)

Add below `AllProvidersFailedError`:

```ts
export interface ProviderCooldown {
  /** True while a provider that answered 429 should be skipped. */
  isCooling(id: ProviderId): boolean;
  block(id: ProviderId, ms: number): void;
}

export function createCooldown(now: () => number = Date.now): ProviderCooldown {
  const until = new Map<ProviderId, number>();
  return {
    isCooling: (id) => (until.get(id) ?? 0) > now(),
    block: (id, ms) => {
      until.set(id, Math.max(until.get(id) ?? 0, now() + ms));
    },
  };
}

/** How long to leave a provider alone after a 429: its Retry-After in seconds, 30 s if missing, at most 5 minutes. */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!header || !Number.isFinite(seconds) || seconds <= 0) return 30_000;
  return Math.min(seconds * 1000, 300_000);
}
```

Add two fields to `StreamOptions`:

```ts
  /** Shared across requests, so a provider that said 429 is skipped until it recovers. */
  cooldown?: ProviderCooldown;
  /** Give up on a stream that goes quiet for this long after its first token. */
  idleTimeoutMs?: number;
```

Replace `contentOnly` with:

```ts
async function* contentOnly(
  first: string,
  stream: AsyncGenerator<string>,
  idleMs: number,
  abort: () => void,
): AsyncGenerator<string> {
  yield first;
  while (true) {
    const next = stream.next();
    next.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      next,
      new Promise<"idle">((resolve) => {
        timer = setTimeout(() => resolve("idle"), idleMs);
      }),
    ]);
    clearTimeout(timer);
    if (result === "idle") {
      // Abort first so the pending read fails; never await return() on a stalled stream.
      abort();
      stream.return(undefined).catch(() => {});
      throw new Error(`provider stalled for ${idleMs} ms`);
    }
    if (result.done) return;
    const text = contentDelta(result.value);
    if (text) yield text;
  }
}
```

In `streamCompletion`, right after the `if (!cfg.apiKey) { ... }` block, add:

```ts
    if (opts.cooldown?.isCooling(id)) {
      failures.push(`${id}: cooling down after 429`);
      continue;
    }
```

Inside `if (!res.ok || !res.body) {`, before `failures.push(...)`, add:

```ts
        if (res.status === 429) opts.cooldown?.block(id, retryAfterMs(res.headers.get("retry-after")));
```

Replace the success `return` line with:

```ts
      return { provider: id, deltas: contentOnly(first, stream, opts.idleTimeoutMs ?? 4000, () => controller.abort()) };
```

In `src/app/api/suggest/route.ts`, change the providers import to include `createCooldown`, add below the `limiter` line:

```ts
// Remembers which provider answered 429 so the next requests skip it until it recovers.
const cooldown = createCooldown();
```

and pass it in the `streamCompletion` options object:

```ts
      configs: providerConfigs(),
      cooldown,
      signal: request.signal,
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/server src/app/api`
Expected: PASS (all old and new tests).

- [ ] **Step 6: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/server/providers.ts src/lib/server/providers.test.ts src/app/api/suggest/route.ts
git commit -m "Skip providers after a 429, time out stalled streams, set reasoning per model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Several JSON objects per line, stricter and fairer validator, shared request builder

**Files:**
- Modify: `src/lib/suggest/protocol.ts`, `src/lib/suggest/validate.ts`, `src/lib/suggest/client.ts`
- Create: `src/lib/suggest/request.ts`
- Test: `src/lib/suggest/protocol.test.ts`, `src/lib/suggest/validate.test.ts`, `src/lib/suggest/client.test.ts`, `src/lib/suggest/request.test.ts`

**Interfaces:**
- Consumes: `parseLine`, `ParsedLine`, `validateReply`, `ValidationSources`, `contextLine`, `MemoryStore.searchNotes/styleExamples/getNote`.
- Produces:
  - `splitObjects(line: string): string[]`, `parseLines(raw: string): ParsedLine[]` (protocol.ts)
  - `ValidationSources` gains `context?: string` (the context line; names, weekday and time of day in it count as sources)
  - `interface RequestInput { mode: SuggestRequestBody["mode"]; typed: string; partnerSaid: string; context: ConversationContext }`
  - `clampInput<T extends { typed: string; partnerSaid: string }>(input: T): T` (typed to 500 chars from the start, partner text to the last 1000)
  - `buildSuggestRequest(args: { memory: MemoryStore; pack: LanguagePack; input: RequestInput; simple: boolean }): Promise<{ body: SuggestRequestBody; sources: ValidationSources }>`
  - `SuggestInput` in client.ts becomes `export interface SuggestInput extends RequestInput {}` (Task 3 adds `priority`)

- [ ] **Step 1: Write the failing protocol tests**

Add `parseLines` to the import in `src/lib/suggest/protocol.test.ts` and append:

```ts
describe("parseLines", () => {
  it("splits several JSON objects on one line", () => {
    expect(parseLines('{"reply": "Yes.", "notes": []}{"reply": "No.", "notes": []} {"reactions": ["ha"]}')).toEqual([
      { kind: "reply", text: "Yes.", noteIds: [] },
      { kind: "reply", text: "No.", noteIds: [] },
      { kind: "reactions", ids: ["ha"] },
    ]);
  });

  it("keeps braces inside strings", () => {
    const out = parseLines('{"reply": "Use {this} one.", "notes": []}{"reply": "Ok.", "notes": []}');
    expect(out.map((p) => p.kind)).toEqual(["reply", "reply"]);
    expect(out[0]).toEqual({ kind: "reply", text: "Use {this} one.", noteIds: [] });
  });

  it("drops text around the objects", () => {
    expect(parseLines('Here you go: {"reply": "Sure.", "notes": []}')).toEqual([{ kind: "reply", text: "Sure.", noteIds: [] }]);
  });

  it("reports a cut-off last object as invalid", () => {
    const out = parseLines('{"reply": "Yes.", "notes": []}{"reply": "No');
    expect(out[0]).toEqual({ kind: "reply", text: "Yes.", noteIds: [] });
    expect(out[1].kind).toBe("invalid");
  });

  it("behaves like parseLine for ordinary lines", () => {
    expect(parseLines("   ")).toEqual([]);
    expect(parseLines("```json")).toEqual([{ kind: "invalid", raw: "```json" }]);
    expect(parseLines('{"reply": "Hi.", "notes": []}')).toEqual([{ kind: "reply", text: "Hi.", noteIds: [] }]);
  });
});
```

- [ ] **Step 2: Write the failing validator tests**

Append inside the file `src/lib/suggest/validate.test.ts`:

```ts
describe("number words", () => {
  it("treats number words as claims, but not 'one'", () => {
    expect(extractClaims("Two, please. Just one more.")).toEqual(["two"]);
    expect(extractClaims("See you at noon.")).toEqual(["noon"]);
  });

  it("backs number words with digits and plain digits with number words", () => {
    expect(claimSupported("two", "I have 2 dogs")).toBe(true);
    expect(claimSupported("2", "two blocks from home")).toBe(true);
    expect(claimSupported("noon", "Lunch at 12:00")).toBe(true);
    expect(claimSupported("three", "I have 2 dogs")).toBe(false);
    expect(claimSupported("2:30", "two blocks from home")).toBe(false);
  });

  it("drops an invented quantity", () => {
    expect(validateReply({ text: "I'd like three, please.", noteIds: [] }, sources({ partnerSaid: "How many?" }))).toMatchObject({
      ok: false,
      detail: "three",
    });
  });
});

describe("context line as a source", () => {
  it("accepts the current partner, place and weekday without a cited note", () => {
    const s = sources({ notes: new Map(), context: "It is Tuesday morning. Place: Blue Door Café. Talking with: Sam." });
    expect(validateReply({ text: "Morning Sam, happy Tuesday.", noteIds: [] }, s).ok).toBe(true);
  });
});
```

- [ ] **Step 3: Write the failing request builder test**

Create `src/lib/suggest/request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { en } from "@/lib/language-packs/en";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import { buildSuggestRequest, clampInput } from "./request";

const NOTES: Note[] = [
  { id: "cafe", kind: "place", text: "Blue Door Café is my local coffee shop.", entities: ["Blue Door Café"], updatedAt: 0 },
  { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam", "Blue Door Café"], updatedAt: 0 },
];

describe("clampInput", () => {
  it("keeps the start of the typed text and the end of what the partner said", () => {
    const out = clampInput({ typed: "a".repeat(600), partnerSaid: `${"x".repeat(1000)}END` });
    expect(out.typed).toHaveLength(500);
    expect(out.partnerSaid).toHaveLength(1000);
    expect(out.partnerSaid.endsWith("END")).toBe(true);
  });
});

describe("buildSuggestRequest", () => {
  it("builds the body and the validation sources from memory", async () => {
    const memory = await MemoryStore.create();
    await memory.replaceAll(NOTES, []);
    const { body, sources } = await buildSuggestRequest({
      memory,
      pack: en,
      input: { mode: "replies", typed: "my usual", partnerSaid: "Hi", context: { now: new Date(2026, 8, 29, 8), partnerId: "sam" } },
      simple: true,
    });
    expect(body.maxWords).toBe(en.simpleMaxWords);
    expect(body.contextLine).toContain("Talking with: Sam.");
    expect(body.notes.length).toBeLessThanOrEqual(8);
    expect(sources.context).toBe(body.contextLine);
    expect(sources.typed).toBe("my usual");
    expect([...sources.notes.keys()]).toEqual(body.notes.map((n) => n.id));
  });
});
```

- [ ] **Step 4: Write the failing client tests**

Append inside `describe("SuggestClient", ...)` in `src/lib/suggest/client.test.ts`:

```ts
  it("accepts two replies sent on one line", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Large, please.", "notes": []}{"reply": "What sizes do you have?", "notes": []}']));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const final = await client.request(input, () => {});
    expect(final?.replies.map((r) => r.text)).toEqual(["Large, please.", "What sizes do you have?"]);
  });

  it("keeps a reply that names the current partner without citing a note", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Thanks Sam!", "notes": []}']));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const final = await client.request(input, () => {});
    expect(final?.replies.map((r) => r.text)).toEqual(["Thanks Sam!"]);
  });
```

- [ ] **Step 5: Run the tests to see them fail**

Run: `npx vitest run src/lib/suggest`
Expected: FAIL (`parseLines` missing, `./request` missing, number-word and context tests fail, the two new client tests get fewer replies).

- [ ] **Step 6: Implement protocol.ts**

Append to `src/lib/suggest/protocol.ts`:

```ts
/**
 * Split a line holding several JSON objects ("{...}{...}" or "{...} {...}")
 * into one string per object. Text outside the objects is dropped; a cut-off
 * last object is kept so it is reported as invalid. A line without any
 * complete object is returned unchanged.
 */
export function splitObjects(line: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      if (depth > 0) inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0) objects.push(line.slice(start, i + 1));
    }
  }
  if (objects.length === 0) return [line];
  if (depth > 0) objects.push(line.slice(start));
  return objects;
}

/** Parse one line of model output, which may hold several JSON objects. */
export function parseLines(raw: string): ParsedLine[] {
  const line = raw.trim();
  if (!line) return [];
  return splitObjects(line)
    .map(parseLine)
    .filter((p): p is ParsedLine => p !== null);
}
```

- [ ] **Step 7: Implement validate.ts**

In `src/lib/suggest/validate.ts`, add below `NEVER_NAMES`:

```ts
/**
 * Number words that state a quantity or time. "one" is left out on purpose:
 * "one moment", "the other one" and "one more" are everyday phrases.
 */
const NUMBER_WORDS = new Map<string, number>([
  ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7],
  ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11], ["twelve", 12],
  ["fifteen", 15], ["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50],
  ["hundred", 100], ["noon", 12], ["midnight", 12],
]);
```

In `extractClaims`, inside `words.forEach`, add right after `if (NEVER_NAMES.has(n)) return;`:

```ts
      if (NUMBER_WORDS.has(n)) {
        claims.push(n);
        return;
      }
```

Replace `claimSupported` with:

```ts
export function claimSupported(claim: string, sourceText: string): boolean {
  const sourceNumbers = [...sourceText.matchAll(NUMBER)].map((m) => canonicalNumber(m[0]));
  const words = (normalize(sourceText).match(WORD) ?? []).flatMap((w) => [w, w.replace(/'s$/, "")]);
  if (/^\d/.test(claim)) {
    if (sourceNumbers.includes(canonicalNumber(claim))) return true;
    // A plain "2" is backed by "two" in the source; a time like "2:30" needs its digits.
    if (!/^\d+$/.test(claim)) return false;
    return words.some((w) => NUMBER_WORDS.get(w) === Number(claim));
  }
  const target = normalize(claim).replace(/'s$/, "");
  if (words.includes(target)) return true;
  const value = NUMBER_WORDS.get(target);
  if (value !== undefined) return sourceNumbers.includes(String(value)) || sourceNumbers.includes(`${value}:00`);
  // Days in notes are often plural ("Tuesdays").
  return DAYS_AND_MONTHS.has(target) && words.includes(`${target}s`);
}
```

Add the field to `ValidationSources`:

```ts
export interface ValidationSources {
  notes: Map<string, string>;
  partnerSaid: string;
  typed: string;
  /** The situation line sent to the model (weekday, time of day, place and partner names). */
  context?: string;
}
```

and include it in `validateReply`'s `sourceText`:

```ts
  const sourceText = [
    ...reply.noteIds.map((id) => sources.notes.get(id) ?? ""),
    sources.partnerSaid,
    sources.typed,
    sources.context ?? "",
  ].join("\n");
```

- [ ] **Step 8: Create request.ts**

```ts
import { contextLine } from "@/lib/context";
import type { LanguagePack } from "@/lib/language-packs/types";
import type { MemoryStore } from "@/lib/memory/store";
import type { ConversationContext } from "@/lib/types";
import type { SuggestRequestBody } from "./protocol";
import type { ValidationSources } from "./validate";

export interface RequestInput {
  mode: SuggestRequestBody["mode"];
  typed: string;
  partnerSaid: string;
  context: ConversationContext;
}

/** Clamp to what the server accepts: the start of the typed text, the end of what the partner said. */
export function clampInput<T extends { typed: string; partnerSaid: string }>(input: T): T {
  return { ...input, typed: input.typed.slice(0, 500), partnerSaid: input.partnerSaid.slice(-1000) };
}

/**
 * Everything one suggestion request sends, and the sources its replies are
 * checked against. Shared by the app's client and the eval runner, so both
 * test the same thing.
 */
export async function buildSuggestRequest(args: {
  memory: MemoryStore;
  pack: LanguagePack;
  input: RequestInput;
  simple: boolean;
}): Promise<{ body: SuggestRequestBody; sources: ValidationSources }> {
  const { memory, pack, simple } = args;
  const { mode, typed, partnerSaid, context } = clampInput(args.input);
  const line = contextLine(context, (id) => memory.getNote(id));
  const query = `${typed} ${partnerSaid}`.trim();
  const notes = await memory.searchNotes(query, context, 8);
  const body: SuggestRequestBody = {
    mode,
    typed,
    partnerSaid,
    contextLine: line,
    notes: notes.map((n) => ({ id: n.id, text: n.text.slice(0, 300) })),
    examples: memory.styleExamples(query, 5).map((e) => e.slice(0, 200)),
    reactions: pack.reactions,
    maxWords: simple ? pack.simpleMaxWords : pack.maxWords,
  };
  const sources: ValidationSources = { notes: new Map(notes.map((n) => [n.id, n.text])), partnerSaid, typed, context: line };
  return { body, sources };
}
```

- [ ] **Step 9: Use them in client.ts**

In `src/lib/suggest/client.ts`:

Replace the imports and `SuggestInput` with:

```ts
import { contextLine } from "@/lib/context";
import type { LanguagePack, Reaction } from "@/lib/language-packs/types";
import type { MemoryStore } from "@/lib/memory/store";
import { normalize } from "@/lib/text";
import type { Reply } from "@/lib/types";
import { createLineSplitter, parseLines, type ParsedLine, type SuggestRequestBody } from "./protocol";
import { buildSuggestRequest, clampInput, type RequestInput } from "./request";
import { isNearDuplicate, validateReply, type ValidationSources } from "./validate";

export type SuggestInput = RequestInput;
```

Replace the top of `request()` down to (and including) the `const sources ...` line with:

```ts
  async request(input: SuggestInput, onUpdate: (u: SuggestUpdate) => void): Promise<SuggestUpdate | null> {
    const clamped = clampInput(input);
    const { memory, pack } = this.deps;
    const simple = this.deps.simpleLanguage?.() ?? false;
    const line = contextLine(clamped.context, (id) => memory.getNote(id));
    const key = JSON.stringify([
      clamped.mode,
      normalize(clamped.typed.trim()),
      normalize(clamped.partnerSaid.trim()),
      clamped.context.placeId ?? "",
      clamped.context.partnerId ?? "",
      simple,
      line,
    ]);

    this.cancel();
    const cached = this.cache.get(key);
    if (cached) {
      onUpdate(cached);
      return cached;
    }

    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation && !controller.signal.aborted;

    const { body, sources } = await buildSuggestRequest({ memory, pack, input: clamped, simple });
    if (!isCurrent()) return null;
```

(The rest of `request()` from `let outcome = await this.stream(...)` stays as it is.)

In `stream()`, replace the `createLineSplitter(...)` call with:

```ts
    const handle = (parsed: ParsedLine) => {
      if (parsed.kind === "invalid") {
        invalid++;
        return;
      }
      if (parsed.kind === "reactions") {
        reactions = parsed.ids.map((id) => reactionsById.get(id)).filter((r): r is Reaction => !!r).slice(0, 2);
      } else {
        if (replies.length >= 3) return;
        if (!validateReply({ text: parsed.text, noteIds: parsed.noteIds }, sources).ok) return;
        if (replies.some((r) => isNearDuplicate(r.text, parsed.text))) return;
        replies.push({ text: parsed.text, noteIds: parsed.noteIds, source: "model" });
      }
      if (isCurrent()) onUpdate({ replies: [...replies], reactions, done: false });
    };
    const splitter = createLineSplitter((line) => parseLines(line).forEach(handle));
```

`SuggestRequestBody` is still used by `stream()`'s parameter type; keep that import.

- [ ] **Step 10: Run the tests**

Run: `npx vitest run src/lib/suggest`
Expected: PASS.

- [ ] **Step 11: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/suggest
git commit -m "Split JSON objects on one line, check number words, accept context names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Quota guard (client token bucket) and budget retries

**Files:**
- Create: `src/lib/suggest/budget.ts`
- Modify: `src/lib/suggest/client.ts`, `src/lib/conversation/use-suggestions.ts`
- Test: `src/lib/suggest/budget.test.ts`, `src/lib/suggest/client.test.ts`, `src/lib/conversation/use-suggestions.test.tsx`

**Interfaces:**
- Consumes: `SuggestClient`, `RequestInput` (Task 2), `useSuggestions` args (unchanged).
- Produces:
  - `type RequestPriority = "final" | "typed" | "speculative"`
  - `class RequestBudget { constructor(opts?: { capacity: number; perMinute: number; now?: () => number }); take(priority: RequestPriority): number; drain(): void }` (`take` returns 0 when a token was taken, else the ms to wait)
  - `class SuggestSkippedError extends Error { readonly retryInMs: number }`
  - `SuggestInput` becomes `interface SuggestInput extends RequestInput { priority?: RequestPriority }` (default `"final"`)
  - `SuggestClient` deps gain `budget?: RequestBudget` (default capacity 20, 24 per minute)
  - inside `useSuggestions`: `run(mode, typed, partnerSaid, priority): Promise<boolean>` (true when the request finished and was current)

Why these numbers: the server allows 30 requests per minute per IP (plan 1). 24 per minute leaves room for retries on the other provider. Speculative requests need 8 tokens in the bucket, typed ones 3, final ones 1, so speculation stops first when the budget runs low.

- [ ] **Step 1: Write the failing budget tests**

Create `src/lib/suggest/budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RequestBudget } from "./budget";

function setup(capacity: number, perMinute = 60) {
  let t = 0;
  const budget = new RequestBudget({ capacity, perMinute, now: () => t });
  return { budget, advance: (ms: number) => void (t += ms) };
}

describe("RequestBudget", () => {
  it("lets requests through while tokens last", () => {
    const { budget } = setup(3);
    expect([budget.take("final"), budget.take("final"), budget.take("final")]).toEqual([0, 0, 0]);
    expect(budget.take("final")).toBeGreaterThan(0);
  });

  it("gives up speculative requests first, then typed ones", () => {
    const { budget } = setup(10);
    budget.take("final");
    budget.take("final"); // 8 left
    expect(budget.take("speculative")).toBe(0); // 7 left
    expect(budget.take("speculative")).toBeGreaterThan(0);
    expect(budget.take("typed")).toBe(0); // 6 left
    budget.take("final");
    budget.take("final");
    budget.take("final");
    budget.take("final"); // 2 left
    expect(budget.take("typed")).toBeGreaterThan(0);
    expect(budget.take("final")).toBe(0);
  });

  it("refills over time and says how long to wait", () => {
    const { budget, advance } = setup(1, 60);
    budget.take("final");
    expect(budget.take("final")).toBe(1000);
    advance(1000);
    expect(budget.take("final")).toBe(0);
  });

  it("empties when the server says it is rate limited", () => {
    const { budget } = setup(20);
    budget.drain();
    expect(budget.take("final")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write the failing client tests**

In `src/lib/suggest/client.test.ts`, change the import to:

```ts
import { SuggestClient, SuggestSkippedError, SuggestUnavailableError, type SuggestUpdate } from "./client";
import { RequestBudget } from "./budget";
```

and add inside `describe("SuggestClient", ...)`:

```ts
  it("skips a request when the budget is spent, without cancelling the one in flight", async () => {
    const budget = new RequestBudget({ capacity: 8, perMinute: 60, now: () => 0 });
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Large, please.", "notes": []}']));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl, budget });
    const first = client.request({ ...input, priority: "final" }, () => {}); // 7 tokens left
    await expect(client.request({ ...input, partnerSaid: "Anything else?", priority: "speculative" }, () => {})).rejects.toBeInstanceOf(
      SuggestSkippedError,
    );
    expect((await first)?.replies).toHaveLength(1);
  });

  it("serves a cached answer even when the budget is spent", async () => {
    const budget = new RequestBudget({ capacity: 1, perMinute: 60, now: () => 0 });
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Large, please.", "notes": []}']));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl, budget });
    await client.request(input, () => {});
    const again = await client.request(input, () => {});
    expect(again?.replies).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("empties the budget when the server answers 429", async () => {
    const budget = new RequestBudget({ capacity: 20, perMinute: 24, now: () => 0 });
    const fetchImpl = vi.fn(async () => new Response("slow down", { status: 429 }));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl, budget });
    await expect(client.request(input, () => {})).rejects.toBeInstanceOf(SuggestUnavailableError);
    expect(budget.take("final")).toBeGreaterThan(0);
  });
```

- [ ] **Step 3: Write the failing hook test**

In `src/lib/conversation/use-suggestions.test.tsx`, change the client import to:

```ts
import { SuggestSkippedError, SuggestUnavailableError, type SuggestClient, type SuggestInput, type SuggestUpdate } from "@/lib/suggest/client";
```

and add inside `describe("useSuggestions", ...)`:

```ts
  it("retries a typed request after the budget wait, without pausing suggestions", async () => {
    const calls: SuggestInput[] = [];
    let first = true;
    const client = {
      cancel: vi.fn(),
      clearCache: vi.fn(),
      request: vi.fn(async (input: SuggestInput, onUpdate: (u: SuggestUpdate) => void) => {
        calls.push(input);
        if (first) {
          first = false;
          throw new SuggestSkippedError(1000);
        }
        onUpdate(done);
        return done;
      }),
    } as unknown as SuggestClient;
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "typed", text: "zz" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ priority: "typed" });
    expect(result.current.state.status).not.toBe("paused");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ mode: "replies", typed: "zz", priority: "typed" });
    expect(result.current.state.replies[0].text).toBe("Large, please.");
  });
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx vitest run src/lib/suggest src/lib/conversation`
Expected: FAIL (`./budget` missing, `SuggestSkippedError` missing).

- [ ] **Step 5: Create budget.ts**

```ts
export type RequestPriority = "final" | "typed" | "speculative";

/** Tokens that must stay in the bucket after a request of this priority, so speculation gives way first. */
const RESERVE: Record<RequestPriority, number> = { final: 0, typed: 2, speculative: 7 };

/**
 * Client-side token bucket for calls to /api/suggest (spec 5, quota guard).
 * The server allows 30 requests per minute per IP; the default 24 per minute
 * leaves room for a retry on the other provider.
 */
export class RequestBudget {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly perMinute: number;
  private readonly now: () => number;

  constructor(opts: { capacity: number; perMinute: number; now?: () => number } = { capacity: 20, perMinute: 24 }) {
    this.capacity = opts.capacity;
    this.perMinute = opts.perMinute;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.capacity;
    this.last = this.now();
  }

  /** Takes a token and returns 0, or returns how many ms to wait before this priority may send. */
  take(priority: RequestPriority): number {
    this.refill();
    const needed = RESERVE[priority] + 1;
    if (this.tokens >= needed) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil(((needed - this.tokens) * 60_000) / this.perMinute);
  }

  /** The server said it is rate limited: stop sending until the bucket refills. */
  drain(): void {
    this.refill();
    this.tokens = 0;
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) * this.perMinute) / 60_000);
    this.last = t;
  }
}
```

- [ ] **Step 6: Use it in client.ts**

In `src/lib/suggest/client.ts`:

Add the import:

```ts
import { RequestBudget, type RequestPriority } from "./budget";
```

Replace `export type SuggestInput = RequestInput;` with:

```ts
export interface SuggestInput extends RequestInput {
  /** How much the request matters when the budget is low. Defaults to "final". */
  priority?: RequestPriority;
}
```

Add after `SuggestUnavailableError`:

```ts
/** The request was not sent, to stay under the rate limit. Nothing was cancelled. */
export class SuggestSkippedError extends Error {
  constructor(readonly retryInMs: number) {
    super(`Suggestion request skipped to stay under the rate limit; retry in ${retryInMs} ms`);
    this.name = "SuggestSkippedError";
  }
}
```

Add `budget?: RequestBudget;` to `interface Deps`, and replace the constructor with:

```ts
  private readonly budget: RequestBudget;

  constructor(private readonly deps: Deps) {
    this.budget = deps.budget ?? new RequestBudget();
  }
```

In `request()`, replace:

```ts
    this.cancel();
    const cached = this.cache.get(key);
    if (cached) {
      onUpdate(cached);
      return cached;
    }
```

with:

```ts
    const priority = input.priority ?? "final";
    const cached = this.cache.get(key);
    if (cached) {
      this.cancel();
      onUpdate(cached);
      return cached;
    }
    // Checked before cancelling, so a skipped request never stops the one in flight.
    const wait = this.budget.take(priority);
    if (wait > 0) throw new SuggestSkippedError(wait);
    this.cancel();
```

Change the retry condition to also spend a token:

```ts
    if (outcome && outcome.replies.length === 0 && outcome.invalid > 0 && isCurrent() && this.budget.take(priority) === 0) {
```

In `stream()`, replace the `if (!res.ok || !res.body) {` block with:

```ts
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 429) this.budget.drain();
      throw new SuggestUnavailableError(`HTTP ${res.status}`);
    }
```

- [ ] **Step 7: Priorities and retries in use-suggestions.ts**

In `src/lib/conversation/use-suggestions.ts`:

Replace the imports with:

```ts
import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { MemoryStore } from "@/lib/memory/store";
import type { RequestPriority } from "@/lib/suggest/budget";
import { SuggestSkippedError, SuggestUnavailableError, type SuggestClient, type SuggestInput } from "@/lib/suggest/client";
import type { ConversationAction, ConversationState } from "./reducer";

type Run = (mode: SuggestInput["mode"], typed: string, partnerSaid: string, priority: RequestPriority) => Promise<boolean>;
```

Add after the `prevTypedRef` declaration:

```ts
  // A request skipped for budget reasons is asked again later (see run).
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  const runRef = useRef<Run>(async () => false);
```

Replace the whole `const run = useCallback(...)` block with:

```ts
  const run = useCallback<Run>(
    async (mode, typed, partnerSaid, priority) => {
      if (!client) return false;
      clearTimeout(retryTimer.current);
      const s = stateRef.current;
      dispatch({ type: "thinking" });
      try {
        const final = await client.request(
          { mode, typed, partnerSaid, priority, context: { now: new Date(), placeId: s.placeId, partnerId: s.partnerId } },
          (u) => dispatch({ type: "suggestions", replies: u.replies, reactions: u.reactions, done: u.done, hold: holdingRef.current() }),
        );
        return final !== null;
      } catch (err) {
        if (err instanceof SuggestSkippedError) {
          // Over budget (spec 5, quota guard). Speculative requests are dropped;
          // typed and final ones are asked again once the budget allows.
          dispatch({ type: "cancelled" });
          if (priority !== "speculative") {
            retryTimer.current = setTimeout(() => {
              const latest = stateRef.current;
              if (priority === "typed" && !latest.typed.trim()) return;
              void runRef.current(mode, priority === "typed" ? latest.typed : typed, partnerSaid, priority);
            }, err.retryInMs);
          }
          return false;
        }
        if (err instanceof SuggestUnavailableError) {
          dispatch({ type: "unavailable" });
        } else {
          // Any other error (e.g. memory.searchNotes rejecting, a parser
          // throw) must not become an unhandled rejection here, since every
          // call site uses `void run(...)`. Treat it the same as the
          // service being unavailable so `status` doesn't stay "thinking".
          console.error("useSuggestions: unexpected error", err);
          dispatch({ type: "unavailable" });
        }
        return false;
      }
    },
    [client, dispatch],
  );
  useEffect(() => {
    runRef.current = run;
  });
```

Give each existing call site its priority:

- partner-turn effect: `void run("replies+reactions", s.typed, said, "final");`
- typing effect: `void run("replies", typed, said, "typed");`
- context effect: `if (said || s.typed.trim().length >= 2) void run(said ? "replies+reactions" : "replies", s.typed, said, "final");`

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lib/suggest src/lib/conversation src/components`
Expected: PASS.

- [ ] **Step 9: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/suggest src/lib/conversation
git commit -m "Keep suggestion requests under the rate limit and retry skipped ones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Audio framing and the speech segmenter

**Files:**
- Create: `src/lib/hearing/audio.ts`, `src/lib/hearing/segmenter.ts`, `src/lib/hearing/messages.ts`
- Test: `src/lib/hearing/audio.test.ts`, `src/lib/hearing/segmenter.test.ts`

**Interfaces:**
- Produces:
  - `SAMPLE_RATE = 16000`, `FRAME = 512`
  - `class Framer { push(samples: Float32Array, onFrame: (frame: Float32Array) => void): void; reset(): void }` (each emitted frame is a new array of exactly 512 samples)
  - `class Resampler { constructor(from: number, to?: number); push(input: Float32Array): Float32Array }` (stateful across chunks; returns the input unchanged when the rates match)
  - `levelOf(samples: Float32Array): number` (0 to 1)
  - `interface SegmenterOptions { speechThreshold; exitThreshold; endSilenceMs; minSpeechMs; padMs; partialEveryMs; maxSegmentMs }`, `DEFAULT_SEGMENTER`
  - `type SegmentEvent = { type: "start" } | { type: "partial"; audio: Float32Array } | { type: "end"; audio: Float32Array; silenceMs: number } | { type: "discard" }`
  - `class Segmenter { constructor(o?: SegmenterOptions); push(frame: Float32Array, probability: number): SegmentEvent[]; reset(): void }`
  - `HearingWorkerRequest`, `HearingWorkerMessage` (see Step 5)

This is the logic of the hearing worker with the models taken out, so it can be tested with made-up speech probabilities. The thresholds come from the Moonshine Web example (speech above 0.3, stays speech down to 0.1, 80 ms padding rounded up to whole frames, 250 ms minimum speech, 30 s maximum for Moonshine); the turn-end pause is 600 ms instead of the example's 400 ms.

- [ ] **Step 1: Write the failing audio tests**

Create `src/lib/hearing/audio.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FRAME, Framer, levelOf, Resampler } from "./audio";

describe("Framer", () => {
  it("cuts chunks of any size into 512-sample frames, in order", () => {
    const framer = new Framer();
    const frames: Float32Array[] = [];
    const ramp = Float32Array.from({ length: 1100 }, (_, i) => i);
    framer.push(ramp.subarray(0, 700), (f) => frames.push(f));
    framer.push(ramp.subarray(700), (f) => frames.push(f));
    expect(frames).toHaveLength(2);
    expect(frames.every((f) => f.length === FRAME)).toBe(true);
    expect([frames[0][0], frames[1][0], frames[1][511]]).toEqual([0, 512, 1023]);
    expect(frames[0]).not.toBe(frames[1]);
  });

  it("drops a half-filled frame on reset", () => {
    const framer = new Framer();
    const frames: Float32Array[] = [];
    framer.push(new Float32Array(300).fill(1), (f) => frames.push(f));
    framer.reset();
    framer.push(new Float32Array(FRAME).fill(2), (f) => frames.push(f));
    expect(frames).toHaveLength(1);
    expect(frames[0][0]).toBe(2);
  });
});

describe("Resampler", () => {
  it("returns 16 kHz input unchanged", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(new Resampler(16_000).push(input)).toBe(input);
  });

  it("keeps every third sample of 48 kHz audio across chunk boundaries", () => {
    const resampler = new Resampler(48_000);
    const ramp = Float32Array.from({ length: 3000 }, (_, i) => i);
    const out = [0, 1000, 2000].flatMap((start) => Array.from(resampler.push(ramp.subarray(start, start + 1000))));
    expect(out).toEqual(Array.from({ length: 1000 }, (_, i) => i * 3));
  });

  it("turns one second of 44.1 kHz audio into about 16000 samples", () => {
    const resampler = new Resampler(44_100);
    let n = 0;
    for (let i = 0; i < 44_100; i += 441) n += resampler.push(new Float32Array(441)).length;
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(1);
  });
});

describe("levelOf", () => {
  it("is 0 for silence and 1 for loud audio", () => {
    expect(levelOf(new Float32Array(512))).toBe(0);
    expect(levelOf(new Float32Array(512).fill(1))).toBe(1);
    expect(levelOf(new Float32Array(512).fill(0.1))).toBeCloseTo(0.5);
    expect(levelOf(new Float32Array(0))).toBe(0);
  });
});
```

- [ ] **Step 2: Write the failing segmenter tests**

Create `src/lib/hearing/segmenter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FRAME } from "./audio";
import { DEFAULT_SEGMENTER, Segmenter, type SegmentEvent } from "./segmenter";

function feed(segmenter: Segmenter, probabilities: number[]): SegmentEvent[] {
  return probabilities.flatMap((p) => segmenter.push(new Float32Array(FRAME).fill(p), p));
}
const repeat = (p: number, n: number) => Array<number>(n).fill(p);
const types = (events: SegmentEvent[]) => events.map((e) => e.type);

describe("Segmenter", () => {
  it("stays quiet without speech", () => {
    expect(feed(new Segmenter(), repeat(0.05, 50))).toEqual([]);
  });

  it("starts, sends a partial every half second and ends after a 600 ms pause", () => {
    const events = feed(new Segmenter(), [0.9, ...repeat(0.9, 30), ...repeat(0.02, 19)]);
    expect(types(events)).toEqual(["start", "partial", "partial", "partial", "end"]);
    const end = events.at(-1) as Extract<SegmentEvent, { type: "end" }>;
    // 50 frames, minus the trailing silence beyond 96 ms of padding.
    expect(end.audio.length).toBe(50 * FRAME - (19 * FRAME - 3 * FRAME));
    expect(end.silenceMs).toBeCloseTo(608);
  });

  it("keeps a little audio from just before speech started", () => {
    const events = feed(new Segmenter(), [...repeat(0.05, 5), 0.9, ...repeat(0.9, 16)]);
    const partial = events.find((e) => e.type === "partial") as Extract<SegmentEvent, { type: "partial" }>;
    expect(partial.audio.length).toBe((3 + 1 + 16) * FRAME);
  });

  it("discards a short noise without sending partials", () => {
    expect(types(feed(new Segmenter(), [0.9, ...repeat(0.05, 19)]))).toEqual(["start", "discard"]);
  });

  it("forces an end at the maximum length", () => {
    const segmenter = new Segmenter({ ...DEFAULT_SEGMENTER, maxSegmentMs: 1000, partialEveryMs: 100_000 });
    const events = feed(segmenter, repeat(0.9, 40));
    expect(types(events)).toEqual(["start", "end", "start"]);
    expect((events[1] as Extract<SegmentEvent, { type: "end" }>).audio.length).toBe(32 * FRAME);
  });

  it("drops speech in progress on reset", () => {
    const segmenter = new Segmenter();
    feed(segmenter, repeat(0.9, 6));
    segmenter.reset();
    expect(feed(segmenter, repeat(0.02, 25))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/lib/hearing`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement audio.ts**

```ts
/** Silero VAD and Moonshine both take 16 kHz mono audio. */
export const SAMPLE_RATE = 16_000;
/** Silero VAD v5 reads 512 samples (32 ms) at a time. */
export const FRAME = 512;

/** Collects samples into frames of exactly FRAME samples. */
export class Framer {
  private buffer = new Float32Array(FRAME);
  private filled = 0;

  push(samples: Float32Array, onFrame: (frame: Float32Array) => void): void {
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(FRAME - this.filled, samples.length - i);
      this.buffer.set(samples.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === FRAME) {
        onFrame(this.buffer);
        this.buffer = new Float32Array(FRAME);
        this.filled = 0;
      }
    }
  }

  reset(): void {
    this.filled = 0;
  }
}

/**
 * Converts audio to 16 kHz with linear interpolation, carrying its position
 * across chunks. Used when the browser won't open the microphone at 16 kHz.
 */
export class Resampler {
  /** Read position in the next chunk; -1 means "the last sample of the previous chunk". */
  private position = 0;
  private previous = 0;

  constructor(
    private readonly from: number,
    private readonly to = SAMPLE_RATE,
  ) {}

  push(input: Float32Array): Float32Array {
    if (this.from === this.to) return input;
    const step = this.from / this.to;
    const out: number[] = [];
    let p = this.position;
    while (p <= input.length - 1) {
      const i = Math.floor(p);
      const frac = p - i;
      const a = i < 0 ? this.previous : input[i];
      const b = frac === 0 ? a : input[i + 1];
      out.push(a + (b - a) * frac);
      p += step;
    }
    this.position = p - input.length;
    if (input.length) this.previous = input[input.length - 1];
    return Float32Array.from(out);
  }
}

/** Loudness from 0 to 1 for the level meter (root mean square, scaled so speech fills most of it). */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / samples.length) * 5);
}
```

- [ ] **Step 5: Implement segmenter.ts and messages.ts**

`src/lib/hearing/segmenter.ts`:

```ts
import { FRAME, SAMPLE_RATE } from "./audio";

export interface SegmenterOptions {
  /** A frame above this speech probability starts a segment. */
  speechThreshold: number;
  /** While recording, frames at or above this still count as speech. */
  exitThreshold: number;
  /** This much silence ends the partner's turn. */
  endSilenceMs: number;
  /** Segments with less speech than this are noise and are dropped. */
  minSpeechMs: number;
  /** Audio kept from before speech started, and after it ended. */
  padMs: number;
  /** How often to send the audio so far for a live caption. */
  partialEveryMs: number;
  /** Moonshine handles at most 30 s; longer speech is cut here. */
  maxSegmentMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  speechThreshold: 0.3,
  exitThreshold: 0.1,
  endSilenceMs: 600,
  minSpeechMs: 250,
  padMs: 96,
  partialEveryMs: 500,
  maxSegmentMs: 30_000,
};

export type SegmentEvent =
  | { type: "start" }
  | { type: "partial"; audio: Float32Array }
  | { type: "end"; audio: Float32Array; silenceMs: number }
  | { type: "discard" };

const toSamples = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
const toMs = (samples: number) => (samples / SAMPLE_RATE) * 1000;

function concat(frames: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let offset = 0;
  for (const f of frames) {
    if (offset >= length) break;
    const part = f.subarray(0, length - offset);
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Turns per-frame speech probabilities into speech segments: start, partial snapshots, end or discard. */
export class Segmenter {
  private recording = false;
  private frames: Float32Array[] = [];
  private before: Float32Array[] = [];
  private length = 0;
  private silence = 0;
  private voiced = 0;
  private sincePartial = 0;

  constructor(private readonly o: SegmenterOptions = DEFAULT_SEGMENTER) {}

  push(frame: Float32Array, probability: number): SegmentEvent[] {
    if (!this.recording) {
      if (probability <= this.o.speechThreshold) {
        this.before.push(frame);
        if (this.before.length > Math.ceil(toSamples(this.o.padMs) / FRAME)) this.before.shift();
        return [];
      }
      this.recording = true;
      this.frames = [...this.before, frame];
      this.before = [];
      this.length = this.frames.reduce((n, f) => n + f.length, 0);
      this.voiced = frame.length;
      this.silence = 0;
      this.sincePartial = 0;
      return [{ type: "start" }];
    }

    this.frames.push(frame);
    this.length += frame.length;
    this.sincePartial += frame.length;
    if (probability >= this.o.exitThreshold) {
      this.voiced += frame.length;
      this.silence = 0;
    } else {
      this.silence += frame.length;
    }

    if (this.length >= toSamples(this.o.maxSegmentMs)) return [this.finish()];
    if (this.silence >= toSamples(this.o.endSilenceMs)) {
      if (this.voiced < toSamples(this.o.minSpeechMs)) {
        this.clear();
        return [{ type: "discard" }];
      }
      return [this.finish()];
    }
    if (this.sincePartial >= toSamples(this.o.partialEveryMs) && this.voiced >= toSamples(this.o.minSpeechMs)) {
      this.sincePartial = 0;
      return [{ type: "partial", audio: concat(this.frames, this.length) }];
    }
    return [];
  }

  /** Drop speech in progress (used while the app itself is speaking). */
  reset(): void {
    this.clear();
    this.before = [];
  }

  private finish(): SegmentEvent {
    const keep = this.length - Math.max(0, this.silence - toSamples(this.o.padMs));
    const event: SegmentEvent = { type: "end", audio: concat(this.frames, keep), silenceMs: toMs(this.silence) };
    this.clear();
    return event;
  }

  private clear(): void {
    this.recording = false;
    this.frames = [];
    this.length = 0;
    this.silence = 0;
    this.voiced = 0;
    this.sincePartial = 0;
  }
}
```

`src/lib/hearing/messages.ts`:

```ts
export type HearingWorkerRequest =
  | { type: "load"; model: string }
  | { type: "audio"; samples: Float32Array }
  | { type: "reset" };

export type HearingWorkerMessage =
  | { type: "progress"; value: number }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "speechStart" }
  /** Transcript of the partner's words so far; `ms` is how long transcription took. */
  | { type: "partial"; text: string; ms: number }
  /** The partner paused long enough to end the turn. `endedAt` is when their last word ended (ms since epoch). Text may be empty. */
  | { type: "turnEnd"; text: string; endedAt: number; ms: number };
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/hearing`
Expected: PASS.

- [ ] **Step 7: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/hearing
git commit -m "Add audio framing and the speech segmenter for listening

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hearing worker, capture worklet and microphone

**Files:**
- Create: `src/workers/hearing.worker.ts`, `public/hearing/capture-processor.js`, `src/lib/hearing/mic.ts`
- Test: `src/lib/hearing/mic.test.ts`

**Interfaces:**
- Consumes: `Framer`, `Resampler`, `levelOf`, `SAMPLE_RATE` (Task 4), `Segmenter`, `SegmentEvent`, `HearingWorkerRequest`, `HearingWorkerMessage`.
- Produces:
  - worker: answers `load` with `progress`* then `ready` (or `error`); answers `audio` with `speechStart`, `partial`, `turnEnd`; `reset` drops everything in progress
  - `interface MicSource { stop(): void }`, `type MicErrorKind = "denied" | "unavailable"`, `class MicError extends Error { readonly kind: MicErrorKind }`
  - `openMic(onChunk: (samples: Float32Array, level: number) => void): Promise<MicSource>` (16 kHz mono chunks)

The worker follows Hugging Face's Moonshine Web example (`transformers.js-examples/moonshine-web/src/worker.js`): Silero VAD through `AutoModel` with `model_type: "custom"`, Moonshine through the `automatic-speech-recognition` pipeline, all inference chained one call at a time. Differences: models load on request (not at import), WebAssembly only (like the other two workers), partial transcripts every 0.5 s while someone talks, and a `reset` message. The worklet lives in `public/` as plain JavaScript because `audioWorklet.addModule` needs a URL to a standalone script. The models can't run in Vitest; Task 9 Step 12 checks this code live in Chromium.

- [ ] **Step 1: Write the failing microphone tests**

Create `src/lib/hearing/mic.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { MicError, openMic } from "./mic";

function stubMic(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal("AudioWorkletNode", class {});
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("openMic", () => {
  it("reports a blocked permission as denied", async () => {
    stubMic(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
    await expect(openMic(() => {})).rejects.toMatchObject({ kind: "denied" });
  });

  it("reports a missing microphone as unavailable", async () => {
    stubMic(() => Promise.reject(new DOMException("Requested device not found", "NotFoundError")));
    await expect(openMic(() => {})).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("reports a browser without recording support as unavailable", async () => {
    const err = await openMic(() => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MicError);
    expect((err as MicError).kind).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/hearing/mic.test.ts`
Expected: FAIL, `./mic` not found.

- [ ] **Step 3: Implement mic.ts**

```ts
import { levelOf, Resampler, SAMPLE_RATE } from "./audio";

export interface MicSource {
  stop(): void;
}

export type MicErrorKind = "denied" | "unavailable";

export class MicError extends Error {
  constructor(
    readonly kind: MicErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "MicError";
  }
}

/** Opens the microphone and calls onChunk with 16 kHz mono samples and their level (0 to 1). */
export async function openMic(onChunk: (samples: Float32Array, level: number) => void): Promise<MicSource> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
    throw new MicError("unavailable", "Recording needs a secure page and Web Audio support.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const kind = name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
    throw new MicError(kind, err instanceof Error ? err.message : String(err));
  }

  try {
    let ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch {
      // Firefox can't connect a microphone to a context running at another sample rate.
      await ctx.close();
      ctx = new AudioContext({ latencyHint: "interactive" });
      source = ctx.createMediaStreamSource(stream);
    }
    await ctx.audioWorklet.addModule("/hearing/capture-processor.js");
    const node = new AudioWorkletNode(ctx, "onbeat-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    const resampler = new Resampler(ctx.sampleRate);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const samples = resampler.push(e.data);
      onChunk(samples, levelOf(samples));
    };
    source.connect(node);
    await ctx.resume();
    const context = ctx;
    return {
      stop() {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw new MicError("unavailable", err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 4: Create the capture worklet**

`public/hearing/capture-processor.js`:

```js
/* global AudioWorkletProcessor, registerProcessor */
// Runs on the audio thread: collects microphone samples into chunks and posts
// them to the page, which resamples them to 16 kHz for the hearing worker.
const CHUNK = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const n = Math.min(CHUNK - this.filled, channel.length - i);
      this.buffer.set(channel.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === CHUNK) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(CHUNK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("onbeat-capture", CaptureProcessor);
```

- [ ] **Step 5: Create the hearing worker**

`src/workers/hearing.worker.ts`:

```ts
import { AutoModel, env, pipeline, Tensor } from "@huggingface/transformers";
import { Framer, SAMPLE_RATE } from "@/lib/hearing/audio";
import type { HearingWorkerMessage, HearingWorkerRequest } from "@/lib/hearing/messages";
import { Segmenter, type SegmentEvent } from "@/lib/hearing/segmenter";

env.allowLocalModels = false;

type Progress = { status: string; name?: string; file?: string; loaded?: number; total?: number };
type AsrOutput = { text: string } | { text: string }[];
type Transcriber = (audio: Float32Array) => Promise<AsrOutput>;
// pipeline()'s overloads are too complex for TypeScript here; narrow them (as embedder.worker.ts does).
type AsrFactory = (
  task: "automatic-speech-recognition",
  model: string,
  options: {
    device: "wasm";
    dtype: { encoder_model: "fp32"; decoder_model_merged: "q8" };
    progress_callback: (p: Progress) => void;
  },
) => Promise<Transcriber>;
const createTranscriber = pipeline as unknown as AsrFactory;

type Vad = (inputs: { input: Tensor; sr: Tensor; state: Tensor }) => Promise<{ output: Tensor; stateN: Tensor }>;
type ModelOptions = Parameters<typeof AutoModel.from_pretrained>[1];

const VAD_MODEL = "onnx-community/silero-vad";

let models: Promise<{ vad: Vad; asr: Transcriber }> | null = null;
const downloads = new Map<string, { loaded: number; total: number }>();
let shownPercent = -1;

function post(message: HearingWorkerMessage): void {
  (self as unknown as Worker).postMessage(message);
}

/** One overall percentage across all model files, never going backwards. */
function onProgress(p: Progress): void {
  if (p.status !== "progress" || !p.file || !p.total) return;
  downloads.set(`${p.name ?? ""}/${p.file}`, { loaded: p.loaded ?? 0, total: p.total });
  let loaded = 0;
  let total = 0;
  for (const d of downloads.values()) {
    loaded += d.loaded;
    total += d.total;
  }
  const percent = Math.floor((loaded / total) * 100);
  if (percent > shownPercent) {
    shownPercent = percent;
    post({ type: "progress", value: percent });
  }
}

async function loadModels(model: string): Promise<{ vad: Vad; asr: Transcriber }> {
  // Silero VAD is a custom ONNX model. The options are cast because `config`
  // is typed as a full PretrainedConfig; this is the Moonshine Web example's call.
  const vad = (await AutoModel.from_pretrained(VAD_MODEL, {
    config: { model_type: "custom" },
    dtype: "fp32",
    progress_callback: onProgress,
  } as unknown as ModelOptions)) as unknown as Vad;
  const asr = await createTranscriber("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    progress_callback: onProgress,
  });
  await asr(new Float32Array(SAMPLE_RATE)); // warm up, so the first real transcript isn't slow
  return { vad, asr };
}

const sr = new Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
const freshState = () => new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let vadState = freshState();
const framer = new Framer();
const segmenter = new Segmenter();
/** Inference runs one call at a time, in arrival order. */
let chain: Promise<void> = Promise.resolve();
/** Bumped by "reset", so work queued before it is dropped. */
let generation = 0;
/** A partial transcript is queued or running; newer ones are skipped until it is done. */
let partialBusy = false;

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => console.error("hearing worker:", err));
}

async function transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
  const { asr } = await models!;
  const started = performance.now();
  const out = await asr(audio);
  const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
  return { text, ms: Math.round(performance.now() - started) };
}

function handle(events: SegmentEvent[], at: number, gen: number): void {
  for (const e of events) {
    if (e.type === "start") {
      post({ type: "speechStart" });
    } else if (e.type === "partial") {
      if (partialBusy) continue;
      partialBusy = true;
      enqueue(async () => {
        try {
          if (gen !== generation) return;
          const { text, ms } = await transcribe(e.audio);
          if (gen === generation && text) post({ type: "partial", text, ms });
        } finally {
          partialBusy = false;
        }
      });
    } else if (e.type === "end") {
      const endedAt = at - e.silenceMs;
      enqueue(async () => {
        if (gen !== generation) return;
        const { text, ms } = await transcribe(e.audio);
        // Sent even when empty, so the page can clear a live caption.
        if (gen === generation) post({ type: "turnEnd", text, endedAt, ms });
      });
    }
  }
}

function onAudio(samples: Float32Array): void {
  const at = Date.now();
  const gen = generation;
  framer.push(samples, (frame) =>
    enqueue(async () => {
      if (gen !== generation || !models) return;
      const { vad } = await models;
      const { output, stateN } = await vad({ input: new Tensor("float32", frame, [1, frame.length]), sr, state: vadState });
      if (gen !== generation) return;
      vadState = stateN;
      handle(segmenter.push(frame, (output.data as Float32Array)[0]), at, gen);
    }),
  );
}

self.onmessage = (event: MessageEvent<HearingWorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case "load":
      models ??= loadModels(msg.model);
      models.then(
        () => post({ type: "ready" }),
        (err) => {
          models = null;
          post({ type: "error", message: err instanceof Error ? err.message : String(err) });
        },
      );
      return;
    case "reset":
      generation++;
      framer.reset();
      segmenter.reset();
      vadState = freshState();
      partialBusy = false;
      return;
    case "audio":
      onAudio(msg.samples);
  }
};
```

If `tsc` rejects a cast above (Transformers.js 3.8.1 types differ from what this plan assumed), keep the runtime calls exactly as written and adjust only the type assertions, the way `embedder.worker.ts` narrows `pipeline`. Note it in the task report.

- [ ] **Step 6: Run the tests and a production build**

Run: `npx vitest run src/lib/hearing && npm run build`
Expected: tests PASS; the build compiles the new worker without errors (the worker is bundled but not loaded yet).

- [ ] **Step 7: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/workers/hearing.worker.ts public/hearing/capture-processor.js src/lib/hearing/mic.ts src/lib/hearing/mic.test.ts
git commit -m "Add the hearing worker, audio capture worklet and microphone access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hearing engine

**Files:**
- Create: `src/lib/hearing/engine.ts`, `src/lib/hearing/browser.ts`
- Modify: `src/lib/language-packs/types.ts`, `src/lib/language-packs/en.ts`
- Test: `src/lib/hearing/engine.test.ts`

**Interfaces:**
- Consumes: `WorkerLike` (`src/lib/worker-like.ts`), `HearingWorkerMessage`, `MicError`, `MicSource`, `openMic`.
- Produces:
  - `type HearingStatus = "off" | "loading" | "listening" | "denied" | "unavailable" | "error"`
  - `interface TurnEnd { text: string; endedAt: number }`
  - `type HearingEvents = { status: HearingStatus; progress: number; level: number; speechStart: number; partial: string; turnEnd: TurnEnd }` (`speechStart` carries a timestamp; `partial` with `""` means "clear the live caption")
  - `interface Hearing { readonly status: HearingStatus; on<K>(event: K, cb): () => void; start(): Promise<void>; stop(): void; pause(): void; resume(afterMs?: number): void }`
  - `class HearingEngine implements Hearing` with deps `{ createWorker: () => WorkerLike | null; openMic; model: string; levelEveryMs?: number; now?: () => number }`
  - `getBrowserHearing(): Hearing` (returns `window.__onbeatHearing` when an e2e test installed one)
  - `LanguagePack.asrModel: string`; `en.asrModel = "onnx-community/moonshine-tiny-ONNX"`

Behaviour: `start()` asks for the microphone and loads the model at the same time; status is `loading` until both are ready, then `listening`. `pause()` (called when the app starts speaking) resets the worker, clears the live caption and drops audio until `resume(afterMs)` has waited `afterMs`. Level events are throttled to one per 100 ms. Partials and turn ends are ignored unless listening and not paused.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/hearing/engine.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerLike } from "@/lib/worker-like";
import { HearingEngine, type HearingDeps, type HearingStatus } from "./engine";
import type { HearingWorkerMessage } from "./messages";
import { MicError, type MicSource } from "./mic";

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  sent: { type: string }[] = [];
  postMessage(m: unknown) {
    this.sent.push(m as { type: string });
  }
  terminate() {}
  reply(m: HearingWorkerMessage) {
    this.onmessage?.({ data: m } as MessageEvent);
  }
  count(type: string) {
    return this.sent.filter((m) => m.type === type).length;
  }
}

function setup(opts: { openMic?: HearingDeps["openMic"]; noWorker?: boolean } = {}) {
  const worker = new FakeWorker();
  let feedMic: (samples: Float32Array, level: number) => void = () => {};
  const micStop = vi.fn();
  const openMic =
    opts.openMic ??
    (async (onChunk: (samples: Float32Array, level: number) => void): Promise<MicSource> => {
      feedMic = onChunk;
      return { stop: micStop };
    });
  let t = 0;
  const engine = new HearingEngine({ createWorker: () => (opts.noWorker ? null : worker), openMic, model: "moonshine", now: () => t });
  const statuses: HearingStatus[] = [];
  engine.on("status", (s) => statuses.push(s));
  return {
    engine,
    worker,
    micStop,
    statuses,
    feed: (level = 0.5) => feedMic(new Float32Array(4), level),
    advance: (ms: number) => void (t += ms),
  };
}

afterEach(() => vi.useRealTimers());

describe("HearingEngine", () => {
  it("loads the model and listens once the mic and the model are ready", async () => {
    const { engine, worker, statuses } = setup();
    await engine.start();
    expect(worker.sent[0]).toEqual({ type: "load", model: "moonshine" });
    expect(engine.status).toBe("loading");
    worker.reply({ type: "ready" });
    expect(statuses).toEqual(["loading", "listening"]);
  });

  it("sends audio to the worker only while listening", async () => {
    const { engine, worker, feed } = setup();
    await engine.start();
    feed();
    expect(worker.count("audio")).toBe(0);
    worker.reply({ type: "ready" });
    feed();
    expect(worker.count("audio")).toBe(1);
  });

  it("reports a blocked microphone", async () => {
    const { engine } = setup({ openMic: async () => Promise.reject(new MicError("denied", "no")) });
    await engine.start();
    expect(engine.status).toBe("denied");
  });

  it("reports unavailable without workers or a microphone", async () => {
    const noWorker = setup({ noWorker: true });
    await noWorker.engine.start();
    expect(noWorker.engine.status).toBe("unavailable");
    const noMic = setup({ openMic: async () => Promise.reject(new MicError("unavailable", "none")) });
    await noMic.engine.start();
    expect(noMic.engine.status).toBe("unavailable");
  });

  it("shows an error when the model fails to load, releases the mic, and can retry", async () => {
    const { engine, worker, micStop } = setup();
    await engine.start();
    worker.reply({ type: "error", message: "offline" });
    expect(engine.status).toBe("error");
    expect(micStop).toHaveBeenCalled();
    await engine.start();
    expect(worker.count("load")).toBe(2);
  });

  it("pauses while the app speaks and resumes after a tail", async () => {
    vi.useFakeTimers();
    const { engine, worker, feed } = setup();
    await engine.start();
    worker.reply({ type: "ready" });
    engine.pause();
    expect(worker.count("reset")).toBe(1);
    feed();
    expect(worker.count("audio")).toBe(0);
    engine.resume(400);
    vi.advanceTimersByTime(399);
    feed();
    expect(worker.count("audio")).toBe(0);
    vi.advanceTimersByTime(1);
    feed();
    expect(worker.count("audio")).toBe(1);
  });

  it("clears the live caption when paused, and ignores transcripts while paused", async () => {
    const { engine, worker } = setup();
    const partials: string[] = [];
    const turns: string[] = [];
    engine.on("partial", (p) => partials.push(p));
    engine.on("turnEnd", (t) => turns.push(t.text));
    await engine.start();
    worker.reply({ type: "ready" });
    worker.reply({ type: "partial", text: "What size", ms: 50 });
    engine.pause();
    worker.reply({ type: "partial", text: "What size would", ms: 50 });
    worker.reply({ type: "turnEnd", text: "What size would you like?", endedAt: 1, ms: 80 });
    expect(partials).toEqual(["What size", ""]);
    expect(turns).toEqual([]);
  });

  it("passes on turn ends, and an empty one only clears the live caption", async () => {
    const { engine, worker } = setup();
    const partials: string[] = [];
    const turns: { text: string; endedAt: number }[] = [];
    engine.on("partial", (p) => partials.push(p));
    engine.on("turnEnd", (t) => turns.push(t));
    await engine.start();
    worker.reply({ type: "ready" });
    worker.reply({ type: "partial", text: "Um", ms: 50 });
    worker.reply({ type: "turnEnd", text: "", endedAt: 5, ms: 50 });
    worker.reply({ type: "turnEnd", text: "Hello there.", endedAt: 9, ms: 50 });
    expect(partials).toEqual(["Um", ""]);
    expect(turns).toEqual([{ text: "Hello there.", endedAt: 9 }]);
  });

  it("ignores transcripts after stop and releases the mic", async () => {
    const { engine, worker, micStop } = setup();
    const partials: string[] = [];
    engine.on("partial", (p) => partials.push(p));
    await engine.start();
    worker.reply({ type: "ready" });
    engine.stop();
    worker.reply({ type: "partial", text: "late", ms: 10 });
    expect(partials).toEqual([]);
    expect(micStop).toHaveBeenCalled();
    expect(engine.status).toBe("off");
  });

  it("closes the mic when stopped while the browser was asking for permission", async () => {
    let grant!: (m: MicSource) => void;
    const { engine } = setup({ openMic: () => new Promise<MicSource>((r) => (grant = r)) });
    const started = engine.start();
    engine.stop();
    const stop = vi.fn();
    grant({ stop });
    await started;
    expect(stop).toHaveBeenCalled();
    expect(engine.status).toBe("off");
  });

  it("sends the level at most every 100 ms", async () => {
    const { engine, feed, advance } = setup();
    const levels: number[] = [];
    engine.on("level", (l) => levels.push(l));
    await engine.start();
    feed(0.2);
    advance(50);
    feed(0.3);
    advance(50);
    feed(0.4);
    expect(levels).toEqual([0.2, 0.4]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/hearing/engine.test.ts`
Expected: FAIL, `./engine` not found.

- [ ] **Step 3: Implement engine.ts**

```ts
import type { WorkerLike } from "@/lib/worker-like";
import type { HearingWorkerMessage } from "./messages";
import { MicError, type MicSource } from "./mic";

export type HearingStatus = "off" | "loading" | "listening" | "denied" | "unavailable" | "error";

export interface TurnEnd {
  text: string;
  /** When the partner's last word ended (ms since epoch). */
  endedAt: number;
}

export type HearingEvents = {
  status: HearingStatus;
  progress: number;
  level: number;
  /** Timestamp of the moment speech started. */
  speechStart: number;
  /** Live caption so far; "" clears it. */
  partial: string;
  turnEnd: TurnEnd;
};

/** What the conversation screen needs from hearing, so tests can pass a fake. */
export interface Hearing {
  readonly status: HearingStatus;
  on<K extends keyof HearingEvents>(event: K, cb: (value: HearingEvents[K]) => void): () => void;
  start(): Promise<void>;
  stop(): void;
  pause(): void;
  resume(afterMs?: number): void;
}

export interface HearingDeps {
  createWorker: () => WorkerLike | null;
  openMic: (onChunk: (samples: Float32Array, level: number) => void) => Promise<MicSource>;
  model: string;
  levelEveryMs?: number;
  now?: () => number;
}

export class HearingEngine implements Hearing {
  status: HearingStatus = "off";
  private listeners: { [K in keyof HearingEvents]: Set<(v: HearingEvents[K]) => void> } = {
    status: new Set(),
    progress: new Set(),
    level: new Set(),
    speechStart: new Set(),
    partial: new Set(),
    turnEnd: new Set(),
  };
  private worker: WorkerLike | null = null;
  private mic: MicSource | null = null;
  private ready = false;
  private loading = false;
  private paused = false;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private startToken = 0;
  private lastLevelAt = -Infinity;
  private hasPartial = false;

  constructor(private readonly deps: HearingDeps) {}

  on<K extends keyof HearingEvents>(event: K, cb: (v: HearingEvents[K]) => void): () => void {
    this.listeners[event].add(cb);
    return () => {
      this.listeners[event].delete(cb);
    };
  }

  async start(): Promise<void> {
    if (this.status === "loading" || this.status === "listening") return;
    const token = ++this.startToken;
    this.setStatus("loading");
    if (!this.worker) {
      this.worker = this.deps.createWorker();
      if (!this.worker) {
        this.setStatus("unavailable");
        return;
      }
      this.worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data as HearingWorkerMessage);
    }
    if (!this.ready && !this.loading) {
      this.loading = true;
      this.worker.postMessage({ type: "load", model: this.deps.model });
    }
    let mic: MicSource;
    try {
      mic = await this.deps.openMic((samples, level) => this.onChunk(samples, level));
    } catch (err) {
      if (token === this.startToken) this.setStatus(err instanceof MicError && err.kind === "denied" ? "denied" : "unavailable");
      return;
    }
    // Stopped, or the model failed, while the browser was asking for permission.
    if (token !== this.startToken || this.status !== "loading") {
      mic.stop();
      return;
    }
    this.mic = mic;
    if (this.ready) this.setStatus("listening");
  }

  stop(): void {
    this.startToken++;
    clearTimeout(this.resumeTimer);
    this.paused = false;
    this.mic?.stop();
    this.mic = null;
    this.worker?.postMessage({ type: "reset" });
    this.clearPartial();
    this.emit("level", 0);
    this.setStatus("off");
  }

  /** Stop hearing for now (the app is speaking), dropping anything half-heard. */
  pause(): void {
    clearTimeout(this.resumeTimer);
    if (this.paused) return;
    this.paused = true;
    this.worker?.postMessage({ type: "reset" });
    this.clearPartial();
  }

  /** Hear again after `afterMs`, so the tail of the app's own voice isn't captioned. */
  resume(afterMs = 0): void {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.paused = false;
    }, afterMs);
  }

  private get active(): boolean {
    return this.status === "listening" && !this.paused;
  }

  private onChunk(samples: Float32Array, level: number): void {
    const now = this.deps.now?.() ?? Date.now();
    if (now - this.lastLevelAt >= (this.deps.levelEveryMs ?? 100)) {
      this.lastLevelAt = now;
      this.emit("level", this.paused ? 0 : level);
    }
    if (!this.active || !this.worker) return;
    this.worker.postMessage({ type: "audio", samples }, [samples.buffer as ArrayBuffer]);
  }

  private onWorkerMessage(msg: HearingWorkerMessage): void {
    switch (msg.type) {
      case "progress":
        this.emit("progress", msg.value);
        return;
      case "ready":
        this.ready = true;
        this.loading = false;
        if (this.mic && this.status === "loading") this.setStatus("listening");
        return;
      case "error":
        this.ready = false;
        this.loading = false;
        if (this.status === "loading") {
          this.mic?.stop();
          this.mic = null;
          this.setStatus("error");
        }
        return;
      case "speechStart":
        if (this.active) this.emit("speechStart", this.deps.now?.() ?? Date.now());
        return;
      case "partial":
        if (!this.active) return;
        this.hasPartial = true;
        this.emit("partial", msg.text);
        return;
      case "turnEnd": {
        if (!this.active) return;
        const had = this.hasPartial;
        this.hasPartial = false;
        if (msg.text) this.emit("turnEnd", { text: msg.text, endedAt: msg.endedAt });
        else if (had) this.emit("partial", "");
        return;
      }
    }
  }

  private clearPartial(): void {
    if (!this.hasPartial) return;
    this.hasPartial = false;
    this.emit("partial", "");
  }

  private setStatus(status: HearingStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  private emit<K extends keyof HearingEvents>(event: K, value: HearingEvents[K]): void {
    for (const cb of this.listeners[event]) cb(value);
  }
}
```

- [ ] **Step 4: Language pack field and browser singleton**

In `src/lib/language-packs/types.ts`, add to `LanguagePack` after `bcp47`:

```ts
  /** Speech recognition model (Transformers.js id) for the partner's speech. */
  asrModel: string;
```

In `src/lib/language-packs/en.ts`, add after `bcp47: "en-US",`:

```ts
  asrModel: "onnx-community/moonshine-tiny-ONNX",
```

Create `src/lib/hearing/browser.ts`:

```ts
import { en } from "@/lib/language-packs/en";
import { HearingEngine, type Hearing } from "./engine";
import { openMic } from "./mic";

declare global {
  interface Window {
    /** End-to-end tests install a fake here before the app loads (tests/e2e/listening.spec.ts). */
    __onbeatHearing?: Hearing;
  }
}

let engine: Hearing | null = null;

export function getBrowserHearing(): Hearing {
  if (typeof window !== "undefined" && window.__onbeatHearing) return window.__onbeatHearing;
  engine ??= new HearingEngine({
    createWorker: () =>
      typeof Worker === "undefined"
        ? null
        : new Worker(new URL("../../workers/hearing.worker.ts", import.meta.url), { type: "module" }),
    openMic,
    model: en.asrModel,
  });
  return engine;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/hearing`
Expected: PASS.

- [ ] **Step 6: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/hearing src/lib/language-packs
git commit -m "Add the hearing engine that owns the mic, the worker and listening status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Live partner text and speculative requests

**Files:**
- Create: `src/lib/conversation/speculation.ts`
- Modify: `src/lib/conversation/reducer.ts`, `src/lib/conversation/use-suggestions.ts`
- Test: `src/lib/conversation/speculation.test.ts`, `src/lib/conversation/reducer.test.ts`, `src/lib/conversation/use-suggestions.test.tsx`

**Interfaces:**
- Consumes: `tokenize` (`src/lib/text.ts`), `run(mode, typed, partnerSaid, priority): Promise<boolean>` (Task 3), `SuggestSkippedError`.
- Produces:
  - `ConversationState.partnerPartial: string` (`""` when nobody is talking); action `{ type: "partnerPartial"; text: string }`; `partnerSaid` and `reset` clear it
  - `SPECULATE_EVERY_MS = 2500`, `SPECULATE_AFTER_WORDS = 3`
  - `class Speculation { newTurn(): void; shouldSend(partial: string, now: number): boolean; sent(partial: string, now: number): void; finished(partial: string, ok: boolean): void; needsFinal(text: string): boolean; turnDone(): void }`

Behaviour (spec 4 "A conversation turn" and 5 "Timing rules"): while the partner talks, each new partial transcript may send a `"replies+reactions"` request with priority `"speculative"`, at most every 2.5 s and only after 3 or more new words since the last one. When the turn ends, the final request is skipped if a speculative request for the same words (compared as tokens, so case and punctuation don't matter) is on screen or still in flight.

- [ ] **Step 1: Write the failing speculation tests**

Create `src/lib/conversation/speculation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Speculation } from "./speculation";

describe("Speculation", () => {
  it("waits for 3 words before the first request", () => {
    const s = new Speculation();
    expect(s.shouldSend("What size", 10_000)).toBe(false);
    expect(s.shouldSend("What size would", 10_000)).toBe(true);
  });

  it("sends at most every 2.5 s and only after 3 new words", () => {
    const s = new Speculation();
    s.sent("What size would", 10_000);
    expect(s.shouldSend("What size would you like today", 11_000)).toBe(false);
    expect(s.shouldSend("What size would you", 13_000)).toBe(false);
    expect(s.shouldSend("What size would you like today", 12_500)).toBe(true);
  });

  it("counts words again on a new turn but keeps the spacing", () => {
    const s = new Speculation();
    s.sent("one two three four five six", 10_000);
    s.newTurn();
    expect(s.shouldSend("Hi there Maya", 11_000)).toBe(false);
    expect(s.shouldSend("Hi there Maya", 12_500)).toBe(true);
  });

  it("skips the final request when the same words are on their way or answered", () => {
    const s = new Speculation();
    s.sent("what size would you like", 10_000);
    expect(s.needsFinal("What size would you like?")).toBe(false);
    s.finished("what size would you like", true);
    expect(s.needsFinal("What size would you like?")).toBe(false);
    expect(s.needsFinal("What size would you like today?")).toBe(true);
  });

  it("asks again when the speculative request failed or the turn is over", () => {
    const s = new Speculation();
    s.sent("what size would you like", 10_000);
    s.finished("what size would you like", false);
    expect(s.needsFinal("What size would you like?")).toBe(true);
    s.sent("what size would", 20_000);
    s.finished("what size would", true);
    s.turnDone();
    expect(s.needsFinal("what size would")).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing reducer and hook tests**

Append to `src/lib/conversation/reducer.test.ts` (inside its top-level `describe`):

```ts
  it("shows the partner's words while they talk and clears them when the turn ends", () => {
    let s = conversationReducer(initialConversation, { type: "partnerPartial", text: " What size " });
    expect(s.partnerPartial).toBe("What size");
    s = conversationReducer(s, { type: "partnerSaid", id: "1", text: "What size would you like?", at: 1 });
    expect(s.partnerPartial).toBe("");
    expect(s.turns.at(-1)?.text).toBe("What size would you like?");
    s = conversationReducer({ ...s, partnerPartial: "Hello" }, { type: "reset" });
    expect(s.partnerPartial).toBe("");
  });
```

Append inside `describe("useSuggestions", ...)` in `src/lib/conversation/use-suggestions.test.tsx`:

```ts
  it("asks while the partner is still talking, at most every 2.5 s after 3 new words", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    vi.setSystemTime(10_000);
    await act(async () => result.current.dispatch({ type: "partnerPartial", text: "What" }));
    expect(client.calls).toHaveLength(0);
    await act(async () => result.current.dispatch({ type: "partnerPartial", text: "What size would" }));
    expect(client.calls[0]).toMatchObject({ mode: "replies+reactions", partnerSaid: "What size would", priority: "speculative" });
    vi.setSystemTime(11_000);
    await act(async () => result.current.dispatch({ type: "partnerPartial", text: "What size would you like today" }));
    expect(client.calls).toHaveLength(1);
    vi.setSystemTime(12_600);
    await act(async () => result.current.dispatch({ type: "partnerPartial", text: "What size would you like today then" }));
    expect(client.calls).toHaveLength(2);
  });

  it("skips the final request when the speculative one already answered the same words", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    vi.setSystemTime(10_000);
    await act(async () => result.current.dispatch({ type: "partnerPartial", text: "What size would you like" }));
    expect(client.calls).toHaveLength(1);
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "What size would you like?", at: 1 }));
    expect(client.calls).toHaveLength(1);
    expect(result.current.state.partnerPartial).toBe("");
  });

  it("sends a final request when the turn ended with new words", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    vi.setSystemTime(10_000);
    await act(async () => result.current.dispatch({ type: "partnerPartial", text: "What size would" }));
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "What size would you like?", at: 1 }));
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]).toMatchObject({ partnerSaid: "What size would you like?", priority: "final" });
  });

  it("drops a skipped speculative request without retrying", async () => {
    const client = fakeClient(new SuggestSkippedError(1000));
    const { result } = await setup(client);
    vi.setSystemTime(10_000);
    await act(async () => result.current.dispatch({ type: "partnerPartial", text: "What size would" }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(client.calls).toHaveLength(1);
    expect(result.current.state.status).not.toBe("paused");
  });
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/lib/conversation`
Expected: FAIL (`./speculation` missing, `partnerPartial` unknown).

- [ ] **Step 4: Implement speculation.ts**

```ts
import { tokenize } from "@/lib/text";

export const SPECULATE_EVERY_MS = 2500;
export const SPECULATE_AFTER_WORDS = 3;

/** Same words, ignoring case, accents and punctuation. */
const same = (a: string, b: string) => tokenize(a).join(" ") === tokenize(b).join(" ");

/** Decides when to ask for replies while the partner is still talking (spec 4 and 5). */
export class Speculation {
  private lastAt = -Infinity;
  private wordsAtLast = 0;
  private pending: string | null = null;
  private answered: string | null = null;

  /** The partner started a new turn. Word counts restart; the 2.5 s spacing carries over. */
  newTurn(): void {
    this.wordsAtLast = 0;
    this.pending = null;
    this.answered = null;
  }

  /** True when this partial transcript should be sent now. */
  shouldSend(partial: string, now: number): boolean {
    const words = tokenize(partial).length;
    return words - this.wordsAtLast >= SPECULATE_AFTER_WORDS && now - this.lastAt >= SPECULATE_EVERY_MS;
  }

  sent(partial: string, now: number): void {
    this.lastAt = now;
    this.wordsAtLast = tokenize(partial).length;
    this.pending = partial;
  }

  /** A speculative request ended; `ok` means its replies reached the screen. */
  finished(partial: string, ok: boolean): void {
    if (this.pending !== null && same(partial, this.pending)) this.pending = null;
    if (ok) this.answered = partial;
  }

  /** True when the finished turn needs its own request: no request for these words is on screen or on its way. */
  needsFinal(text: string): boolean {
    if (this.pending !== null && same(text, this.pending)) return false;
    if (this.answered !== null && same(text, this.answered)) return false;
    return true;
  }

  /** The turn is over; forget its words so the same line said again later is asked again. */
  turnDone(): void {
    this.wordsAtLast = 0;
    this.pending = null;
    this.answered = null;
  }
}
```

- [ ] **Step 5: Reducer**

In `src/lib/conversation/reducer.ts`:

- Add `partnerPartial: string;` to `ConversationState` (after `turns`), with a doc comment `/** What the partner has said so far in the turn they are still speaking; "" when nobody is talking. */`.
- Add `| { type: "partnerPartial"; text: string }` to `ConversationAction`.
- Add `partnerPartial: "",` to `initialConversation`.
- Add a case:

```ts
    case "partnerPartial":
      return { ...state, partnerPartial: action.text.trim() };
```

- In the `partnerSaid` case, return `{ ...state, partnerPartial: "", turns: addTurn(...) }` (keep the empty-text early return as it is).

`reset` already returns `initialConversation` values, so it clears the partial.

- [ ] **Step 6: Hook**

In `src/lib/conversation/use-suggestions.ts`:

Change the React import to `import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";` and add `import { Speculation } from "./speculation";`.

Add after the `runRef` effect from Task 3:

```ts
  const [speculation] = useState(() => new Speculation());
```

Replace the partner-turn effect with:

```ts
  // The partner finished a turn: ask with the full sentence, unless a request
  // made while they were talking already covers the same words.
  useEffect(() => {
    if (!partnerTurnId) return;
    const s = stateRef.current;
    const said = s.turns.findLast((t) => t.speaker === "partner")?.text ?? "";
    const needed = speculation.needsFinal(said);
    speculation.turnDone();
    if (needed) void run("replies+reactions", s.typed, said, "final");
  }, [partnerTurnId, run, speculation]);

  // The partner is still talking: prepare replies from what they've said so far.
  const partial = state.partnerPartial;
  const hadPartial = useRef(false);
  useEffect(() => {
    if (!partial) {
      hadPartial.current = false;
      return;
    }
    if (!hadPartial.current) {
      hadPartial.current = true;
      speculation.newTurn();
    }
    const now = Date.now();
    if (!speculation.shouldSend(partial, now)) return;
    speculation.sent(partial, now);
    void run("replies+reactions", stateRef.current.typed, partial, "speculative").then((ok) => speculation.finished(partial, ok));
  }, [partial, run, speculation]);
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lib/conversation src/components`
Expected: PASS.

- [ ] **Step 8: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/conversation
git commit -m "Prepare replies while the partner is still talking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Response-gap timer

**Files:**
- Create: `src/lib/stats.ts`, `src/lib/conversation/response-gap.ts`
- Test: `src/lib/stats.test.ts`, `src/lib/conversation/response-gap.test.ts`

**Interfaces:**
- Produces:
  - `percentile(values: number[], p: number): number | null` (nearest rank; `null` for an empty list). Used by the screen and by the eval.
  - `class GapTimer { constructor(record: (ms: number) => void); speechStarted(at: number): void; repliesShown(at: number): void; turnEnded(endedAt: number): void }`
  - `loadGaps(storage?: Pick<Storage, "getItem"> | null): number[]`, `saveGap(ms: number, storage?: Pick<Storage, "getItem" | "setItem"> | null): number[]` (key `onbeat:gaps`, last 100 values)

What is measured (spec 1 success criterion, spec 9 "in-app timing"): the time from the partner's last word until replies for that turn are on screen. Replies that appeared during the turn (from a speculative request) count as 0 ms. Replies that were already on screen before the turn started don't count.

- [ ] **Step 1: Write the failing tests**

`src/lib/stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { percentile } from "./stats";

describe("percentile", () => {
  it("uses the nearest rank", () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([4, 1, 3, 2], 95)).toBe(4);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});
```

`src/lib/conversation/response-gap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GapTimer, loadGaps, saveGap } from "./response-gap";

function timer() {
  const recorded: number[] = [];
  return { gaps: new GapTimer((ms) => recorded.push(ms)), recorded };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("GapTimer", () => {
  it("counts replies already on screen when the partner stops as no wait", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(2000);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([0]);
  });

  it("waits for replies that arrive after the partner stops", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([]);
    gaps.repliesShown(3800);
    gaps.repliesShown(4200);
    expect(recorded).toEqual([800]);
  });

  it("ignores replies from before the turn", () => {
    const { gaps, recorded } = timer();
    gaps.repliesShown(500);
    gaps.speechStarted(1000);
    gaps.turnEnded(3000);
    gaps.repliesShown(3500);
    expect(recorded).toEqual([500]);
  });

  it("counts replies shown after the last word but before the transcript arrived", () => {
    const { gaps, recorded } = timer();
    gaps.speechStarted(1000);
    gaps.repliesShown(3200);
    gaps.turnEnded(3000);
    expect(recorded).toEqual([200]);
  });
});

describe("saved gaps", () => {
  it("keeps the last 100 and survives bad data", () => {
    const storage = memoryStorage();
    storage.setItem("onbeat:gaps", "not json");
    expect(loadGaps(storage)).toEqual([]);
    for (let i = 0; i < 105; i++) saveGap(i + 0.4, storage);
    const all = loadGaps(storage);
    expect(all).toHaveLength(100);
    expect(all[0]).toBe(5);
    expect(all.at(-1)).toBe(104);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/stats.test.ts src/lib/conversation/response-gap.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/lib/stats.ts`:

```ts
/** Nearest-rank percentile (p from 0 to 100). Null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
```

`src/lib/conversation/response-gap.ts`:

```ts
/**
 * Measures the time from the partner's last word until replies for that turn
 * are on screen (spec 1: about 1 second). Replies prepared during the turn
 * count as 0 ms; replies from before the turn don't count.
 */
export class GapTimer {
  private turnStartedAt: number | null = null;
  private shownAt: number | null = null;
  private waitingSince: number | null = null;

  constructor(private readonly record: (ms: number) => void) {}

  speechStarted(at: number): void {
    this.turnStartedAt ??= at;
  }

  repliesShown(at: number): void {
    this.shownAt = at;
    if (this.waitingSince !== null) {
      this.record(Math.max(0, at - this.waitingSince));
      this.waitingSince = null;
    }
  }

  turnEnded(endedAt: number): void {
    const started = this.turnStartedAt ?? endedAt;
    this.turnStartedAt = null;
    if (this.shownAt !== null && this.shownAt >= started) {
      this.record(Math.max(0, this.shownAt - endedAt));
      return;
    }
    this.waitingSince = endedAt;
  }
}

const KEY = "onbeat:gaps";
const KEEP = 100;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadGaps(storage: Pick<Storage, "getItem"> | null = browserStorage()): number[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

export function saveGap(ms: number, storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage()): number[] {
  const all = [...loadGaps(storage), Math.round(ms)].slice(-KEEP);
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage can be full or blocked; the numbers still show for this session.
  }
  return all;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stats.test.ts src/lib/conversation/response-gap.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/lib/stats.ts src/lib/stats.test.ts src/lib/conversation/response-gap.ts src/lib/conversation/response-gap.test.ts
git commit -m "Time the gap between the partner's last word and replies on screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Listening on the conversation screen

**Files:**
- Create: `src/components/listen-control.tsx`, `src/components/response-gap.tsx`, `tests/e2e/helpers.ts`, `tests/e2e/listening.spec.ts`, `tests/e2e/live-hearing.spec.ts`, `tests/fixtures/partner.wav`
- Modify: `src/components/caption-log.tsx`, `src/components/announcer.tsx`, `src/components/conversation-screen.tsx`, `tests/e2e/conversation.spec.ts`
- Test: `src/components/components.test.tsx`, `src/components/conversation-screen.test.tsx`

**Interfaces:**
- Consumes: `getBrowserHearing()`, `Hearing`, `HearingStatus`, `HearingEvents` (Task 6); reducer `partnerPartial` (Task 7); `GapTimer`, `loadGaps`, `saveGap`, `percentile` (Task 8).
- Produces:
  - `<ListenControl hearing={Hearing | null} status={HearingStatus} progress={number} onToggle={() => void} />` (a toggle button named "Listen" with `aria-pressed`, status text, level meter while listening)
  - `<ResponseGap gaps={number[]} />`
  - `<CaptionLog turns partnerName partial?: string />` (a live line with "(still talking)" while `partial` is non-empty)
  - announcer keeps at most 5 waiting messages (newest win)
  - screen: listening pauses while a reply is spoken and resumes 400 ms after; `?timer` in the URL shows the reply timer
  - e2e helpers `prepare(page, theme?)`, `startWithMaya(page)`

- [ ] **Step 1: Write the failing component tests**

In `src/components/components.test.tsx`, add imports:

```ts
import { ListenControl } from "./listen-control";
import { ResponseGap } from "./response-gap";
```

Add inside `describe("CaptionLog", ...)`:

```ts
  it("shows a live line while the partner is talking", () => {
    render(<CaptionLog turns={[]} partnerName="Sam" partial="What size" />);
    expect(screen.getByText("What size…")).toBeInTheDocument();
    expect(screen.getByText("(still talking)")).toBeInTheDocument();
    expect(screen.queryByText(/will appear here/)).not.toBeInTheDocument();
  });
```

Add inside `describe("AnnouncerProvider", ...)`:

```ts
  it("keeps only the newest five messages when captions pile up", () => {
    vi.useFakeTimers();
    try {
      const calls: [string, string?][] = Array.from({ length: 8 }, (_, i) => [`Line ${i + 1}`]);
      render(
        <AnnouncerProvider>
          <Announce calls={calls} />
        </AnnouncerProvider>,
      );
      const region = screen.getByRole("status");
      act(() => screen.getByRole("button", { name: "Go" }).click());
      const seen: string[] = [];
      for (let i = 0; i < 300; i++) {
        act(() => vi.advanceTimersByTime(25));
        const text = region.textContent ?? "";
        if (text && text !== seen.at(-1)) seen.push(text);
      }
      expect(seen).toEqual(["Line 4", "Line 5", "Line 6", "Line 7", "Line 8"]);
    } finally {
      vi.useRealTimers();
    }
  });
```

Add at the end of the file:

```ts
describe("ListenControl", () => {
  it("offers to listen and says what happens the first time", () => {
    render(<ListenControl hearing={null} status="off" progress={0} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/downloads speech recognition to this device/)).toBeInTheDocument();
  });

  it("shows progress while getting ready, then says it is listening", () => {
    const { rerender } = render(<ListenControl hearing={null} status="loading" progress={42} onToggle={() => {}} />);
    expect(screen.getByText("Getting speech recognition ready…")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    rerender(<ListenControl hearing={null} status="listening" progress={100} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Listening. Their words appear in the conversation.")).toBeInTheDocument();
  });

  it("explains a blocked microphone", () => {
    render(<ListenControl hearing={null} status="denied" progress={0} onToggle={() => {}} />);
    expect(
      screen.getByText("Microphone is off. You can still type replies. Turn it on in your browser's site settings."),
    ).toBeInTheDocument();
  });
});

describe("ResponseGap", () => {
  it("shows the last and the median gap", () => {
    render(<ResponseGap gaps={[400, 1200, 800]} />);
    expect(screen.getByText("Replies were ready 0.8 s after they stopped. Median 0.8 s over 3 turns.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing screen tests**

In `src/components/conversation-screen.test.tsx`, extend the `vi.hoisted` block: before its `return`, add

```ts
  const hearingListeners: Record<string, Set<Listener>> = {
    status: new Set(),
    progress: new Set(),
    level: new Set(),
    speechStart: new Set(),
    partial: new Set(),
    turnEnd: new Set(),
  };
  const hearing = {
    status: "off",
    on(event: string, cb: Listener) {
      hearingListeners[event].add(cb);
      return () => hearingListeners[event].delete(cb);
    },
    start: async () => {},
    stop: () => {},
    pause: () => {},
    resume: () => {},
  };
  const hear = (event: string, v: unknown) => {
    for (const cb of hearingListeners[event]) cb(v);
  };
```

and change the return to `return { voice, emit, requests, hearing, hear };`.

Add below the voice mock:

```ts
vi.mock("@/lib/hearing/browser", () => ({ getBrowserHearing: () => h.hearing }));
```

Add to `beforeEach`:

```ts
  h.hearing.start = vi.fn(async () => {});
  h.hearing.stop = vi.fn();
  h.hearing.pause = vi.fn();
  h.hearing.resume = vi.fn();
```

Add at the end of the file:

```ts
describe("ConversationScreen listening", () => {
  it("starts listening from the Listen button", async () => {
    await startWithMaya();
    await userEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(h.hearing.start).toHaveBeenCalled();
  });

  it("shows the partner's words live, then as a line that brings replies", async () => {
    await startWithMaya();
    act(() => h.hear("partial", "What size would"));
    expect(screen.getByText("What size would…")).toBeInTheDocument();
    expect(screen.getByText("(still talking)")).toBeInTheDocument();
    act(() => h.hear("turnEnd", { text: "What size would you like?", endedAt: Date.now() }));
    expect(screen.queryByText("(still talking)")).not.toBeInTheDocument();
    expect(screen.getByText("What size would you like?")).toBeInTheDocument();
    expect(h.requests.at(-1)?.input).toMatchObject({ partnerSaid: "What size would you like?", priority: "final" });
  });

  it("pauses listening while a reply is spoken", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    expect(h.hearing.pause).toHaveBeenCalled();
    act(() => h.emit("end", "Large, please."));
    expect(h.hearing.resume).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/components`
Expected: FAIL (new modules missing, no Listen button, no live line).

- [ ] **Step 4: ListenControl and ResponseGap**

`src/components/listen-control.tsx`:

```tsx
"use client";

import { Microphone, MicrophoneSlash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Hearing, HearingStatus } from "@/lib/hearing/engine";

const TEXT: Record<HearingStatus, string> = {
  off: "Turn this on to see their words as captions. The first time, it downloads speech recognition to this device.",
  loading: "Getting speech recognition ready…",
  listening: "Listening. Their words appear in the conversation.",
  denied: "Microphone is off. You can still type replies. Turn it on in your browser's site settings.",
  unavailable: "This browser can't use the microphone here. You can still type what they said.",
  error: "Couldn't download speech recognition. Check your connection and try again.",
};

interface Props {
  hearing: Hearing | null;
  status: HearingStatus;
  progress: number;
  onToggle: () => void;
}

export function ListenControl({ hearing, status, progress, onToggle }: Props) {
  const on = status === "listening" || status === "loading";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={on}
          onClick={onToggle}
          className={`inline-flex min-h-12 items-center gap-2 rounded-control border-2 px-5 text-body font-bold transition-[border-color,background-color] duration-150 ${
            on ? "border-ink bg-cue text-on-cue" : "border-ink/30 bg-surface text-ink hover:border-ink"
          }`}
        >
          {on ? <Microphone aria-hidden="true" size={24} weight="bold" /> : <MicrophoneSlash aria-hidden="true" size={24} />}
          Listen
        </button>
        {status === "listening" && <LevelMeter hearing={hearing} />}
      </div>
      <p className="text-label text-muted">
        {/* Only the status sentence is live; the percentage would be read out on every change. */}
        <span role="status">{TEXT[status]}</span>
        {status === "loading" && <span className="tabular-nums"> {Math.max(0, Math.min(100, progress))}%</span>}
      </p>
    </div>
  );
}

/** How loud the microphone is right now. Subscribes itself so level updates don't re-render the screen. */
function LevelMeter({ hearing }: { hearing: Hearing | null }) {
  const [level, setLevel] = useState(0);
  useEffect(() => (hearing ? hearing.on("level", setLevel) : undefined), [hearing]);
  return (
    <span aria-hidden="true" className="block h-3 w-24 overflow-hidden rounded-full border-2 border-ink/30">
      <span className="block h-full bg-partner transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
    </span>
  );
}
```

`src/components/response-gap.tsx`:

```tsx
import { percentile } from "@/lib/stats";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Reply timer for demos and measurements; shown when the page URL has ?timer. */
export function ResponseGap({ gaps }: { gaps: number[] }) {
  if (gaps.length === 0) return <p className="text-label text-muted">Reply timer: waiting for the first turn.</p>;
  const last = gaps[gaps.length - 1];
  const median = percentile(gaps, 50) ?? last;
  return (
    <p className="text-label text-muted tabular-nums">
      Replies were ready {seconds(last)} after they stopped. Median {seconds(median)} over {gaps.length} {gaps.length === 1 ? "turn" : "turns"}.
    </p>
  );
}
```

- [ ] **Step 5: CaptionLog live line**

In `src/components/caption-log.tsx`:

Change the signature and scroll effect:

```tsx
export function CaptionLog({ turns, partnerName, partial = "" }: { turns: Turn[]; partnerName: string; partial?: string }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Instant scroll (never smooth) so reduced motion is respected.
    // Optional call: jsdom has no scrollIntoView.
    end.current?.scrollIntoView?.({ block: "end" });
  }, [turns.length, partial]);
```

Change `{turns.length === 0 ? (` to `{turns.length === 0 && !partial ? (`, and add the live line right before `<li ref={end} aria-hidden="true" />`:

```tsx
          {partial && (
            <li className="border-l-4 border-dashed border-partner pl-4">
              <span className="block text-label font-bold text-partner">
                {partnerName} <span className="font-medium text-muted">(still talking)</span>
              </span>
              <span className="block text-caption font-medium break-words">{partial}…</span>
            </li>
          )}
```

The live line is not announced (only finished lines are, through the announcer), so screen readers aren't flooded twice a second.

- [ ] **Step 6: Bound the announcer queue**

In `src/components/announcer.tsx`, add below `CLEAR_MS`:

```ts
/** Live captions can arrive faster than one a second; keep the newest few rather than falling behind. */
const MAX_WAITING = 5;
```

and in `announce`, between the push/replace and `pump();`:

```ts
    while (queue.length > MAX_WAITING) queue.shift();
```

- [ ] **Step 7: Wire the screen**

In `src/components/conversation-screen.tsx`:

Add imports:

```ts
import { GapTimer, loadGaps, saveGap } from "@/lib/conversation/response-gap";
import { getBrowserHearing } from "@/lib/hearing/browser";
import type { Hearing, HearingStatus } from "@/lib/hearing/engine";
import { ListenControl } from "./listen-control";
import { ResponseGap } from "./response-gap";
```

Below `const noVoice = ...` add:

```ts
const noHearing = (): Hearing | null => null;
const hasTimerFlag = () => new URLSearchParams(window.location.search).has("timer");
```

Below the `voiceMode` line add:

```ts
  // Hearing is an external store like the voice (spec 4, hearing unit).
  const hearing = useSyncExternalStore(subscribeNever, getBrowserHearing, noHearing);
  const subscribeHearing = useCallback((cb: () => void) => (hearing ? hearing.on("status", cb) : () => {}), [hearing]);
  const hearingStatus = useSyncExternalStore<HearingStatus>(subscribeHearing, () => hearing?.status ?? "off", () => "off");
  const [hearingProgress, setHearingProgress] = useState(0);
  const showTimer = useSyncExternalStore(subscribeNever, hasTimerFlag, () => false);
  const [gaps, setGaps] = useState<number[]>(() => (typeof window === "undefined" ? [] : loadGaps()));
  const [gapTimer] = useState(() => new GapTimer((ms) => setGaps(saveGap(ms))));
```

Below the existing voice effect add:

```ts
  // The microphone would hear the app's own voice: pause while it speaks and a moment after.
  useEffect(() => {
    if (!voice || !hearing) return;
    const offs = [voice.on("start", () => hearing.pause()), voice.on("end", () => hearing.resume(400))];
    return () => offs.forEach((off) => off());
  }, [voice, hearing]);

  useEffect(() => {
    if (!hearing) return;
    const offs = [
      hearing.on("progress", setHearingProgress),
      hearing.on("speechStart", (at) => gapTimer.speechStarted(at)),
      hearing.on("partial", (text) => dispatch({ type: "partnerPartial", text })),
      hearing.on("turnEnd", ({ text, endedAt }) => {
        dispatch({ type: "partnerSaid", id: crypto.randomUUID(), text, at: Date.now() });
        gapTimer.turnEnded(endedAt);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      hearing.stop();
    };
  }, [hearing, gapTimer]);
```

Below the effect that prepares voice clips for `state.replies`, add:

```ts
  useEffect(() => {
    if (state.replies.length) gapTimer.repliesShown(Date.now());
  }, [state.replies, gapTimer]);

  const toggleListening = () => {
    if (!hearing) return;
    if (hearingStatus === "listening" || hearingStatus === "loading") hearing.stop();
    else void hearing.start();
  };
```

In the JSX, replace the context area:

```tsx
          <div className="flex flex-col gap-4 [grid-area:context]">
            <ContextBar
              places={places}
              people={people}
              placeId={state.placeId}
              partnerId={state.partnerId}
              onChange={(placeId, partnerId) => dispatch({ type: "setContext", placeId, partnerId })}
            />
            <ListenControl hearing={hearing} status={hearingStatus} progress={hearingProgress} onToggle={toggleListening} />
          </div>
```

pass the partial to the caption log:

```tsx
            <CaptionLog turns={state.turns} partnerName={partnerName} partial={state.partnerPartial} />
```

and after `<VoiceStatus ... />` add:

```tsx
            {showTimer && <ResponseGap gaps={gaps} />}
```

- [ ] **Step 8: Run the unit tests**

Run: `npx vitest run src/components`
Expected: PASS.

- [ ] **Step 9: Share the e2e helpers**

Create `tests/e2e/helpers.ts` by moving `MODEL_LINES`, `prepare` and `startWithMaya` out of `tests/e2e/conversation.spec.ts` unchanged, with `export` added to `prepare` and `startWithMaya`, and the imports they need:

```ts
import { expect, type Page } from "@playwright/test";
```

In `tests/e2e/conversation.spec.ts`, delete those three definitions, change the Playwright import to `import { expect, test } from "@playwright/test";` and add `import { prepare, startWithMaya } from "./helpers";`.

- [ ] **Step 10: Write the listening e2e tests**

`tests/e2e/listening.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare, startWithMaya } from "./helpers";

/** Replaces the real hearing engine (see src/lib/hearing/browser.ts); tests drive it with hear(). */
async function installFakeHearing(page: Page, startsAs: "listening" | "denied" = "listening") {
  await page.addInitScript((initial) => {
    type Listener = (value: unknown) => void;
    const listeners = new Map<string, Set<Listener>>();
    const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((cb) => cb(value));
    const fake = {
      status: "off",
      on(event: string, cb: Listener) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
        return () => listeners.get(event)!.delete(cb);
      },
      async start() {
        fake.status = initial;
        emit("status", initial);
      },
      stop() {
        fake.status = "off";
        emit("status", "off");
      },
      pause() {},
      resume() {},
    };
    const w = window as unknown as { __onbeatHearing: unknown; __hear: typeof emit };
    w.__onbeatHearing = fake;
    w.__hear = emit;
  }, startsAs);
}

async function hear(page: Page, event: "partial" | "turnEnd", text: string) {
  await page.evaluate(
    ([e, t]) => {
      const w = window as unknown as { __hear: (event: string, value: unknown) => void };
      w.__hear(e, e === "turnEnd" ? { text: t, endedAt: Date.now() } : t);
    },
    [event, text] as const,
  );
}

test("live captions become a line in the conversation and bring replies", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByText("Listening. Their words appear in the conversation.")).toBeVisible();

  await hear(page, "partial", "What size");
  await expect(page.getByText("(still talking)")).toBeVisible();
  await expect(page.getByText("What size…")).toBeVisible();

  await hear(page, "turnEnd", "What size would you like?");
  await expect(page.getByText("(still talking)")).toBeHidden();
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText("What size would you like?");
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
});

test("asks for replies while the other person is still talking", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page);
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/suggest")) calls++;
  });
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();

  await hear(page, "partial", "What size would you like today");
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  expect(calls).toBe(1);

  // Same words at the end of the turn: the replies on screen already fit, so no new request.
  await hear(page, "turnEnd", "What size would you like today?");
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText("What size would you like today?");
  await page.waitForTimeout(1000);
  expect(calls).toBe(1);
});

test("a blocked microphone explains what still works", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page, "denied");
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(
    page.getByText("Microphone is off. You can still type replies. Turn it on in your browser's site settings."),
  ).toBeVisible();
  await page.getByLabel("Type a reply").fill("my us");
  await expect(page.getByRole("button", { name: /My usual, please\./ })).toBeVisible();
});

test("no accessibility violations while listening", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  await hear(page, "partial", "What size would");
  await expect(page.getByText("(still talking)")).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
});
```

- [ ] **Step 11: Run all checks including e2e**

Run: `npm run lint && npm run typecheck && npm test && npm run e2e`
Expected: all pass (the 8 existing e2e tests plus 4 new ones).

- [ ] **Step 12: Live check with real models (local only)**

This checks Task 5's worker in a real browser. It downloads the speech models (about 53 MB) and calls the real `/api/suggest`, so it needs `.env.local` with a Groq key. Do not print or copy `.env.local`.

First create the speech fixture with Windows' built-in voice (PowerShell):

```powershell
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force tests/fixtures | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile("$PWD\tests\fixtures\partner.wav", $format)
$synth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">Hi Maya. What size would you like today?<break time="2500ms"/></speak>')
$synth.Dispose()
```

Then create `tests/e2e/live-hearing.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

const wav = path.resolve("tests/fixtures/partner.wav");

test.skip(!process.env.ONBEAT_LIVE, "Downloads real models and calls the real API. Run with ONBEAT_LIVE=1.");
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`],
  },
  permissions: ["microphone"],
});
test.setTimeout(420_000);

test("hears the partner, captions them and times the replies", async ({ page }) => {
  // Only speech recognition is under test: skip the voice and search model downloads.
  await page.route(/Kokoro|all-MiniLM/, (route) => route.abort());
  await page.goto("/?timer");
  await page.getByRole("button", { name: /^Maya/ }).click();
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByText("Listening. Their words appear in the conversation.")).toBeVisible({ timeout: 300_000 });
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText(/size/i, { timeout: 60_000 });
  // The fixture loops, so the partner keeps asking; collect a few turns.
  await expect
    .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("onbeat:gaps") ?? "[]") as number[]).length), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(5);
  const gaps = await page.evaluate(() => JSON.parse(localStorage.getItem("onbeat:gaps") ?? "[]") as number[]);
  const captions = await page.getByRole("region", { name: "Conversation" }).innerText();
  console.log(`response gaps (ms): ${gaps.join(", ")}`);
  console.log(`captions:\n${captions}`);
});
```

Run (bash): `ONBEAT_LIVE=1 npx playwright test tests/e2e/live-hearing.spec.ts --reporter=list`

Expected: PASS, the captions read close to "Hi Maya. What size would you like today?", and the printed gaps are mostly under 1500 ms. Put the captions and gaps in the task report.

If the model loads but the captions are wrong or empty after 60 s, switch `en.asrModel` to `onnx-community/moonshine-base-ONNX` (merged decoder q8 is 42 MB, encoder fp32 81 MB) and run again. Keep base only if it passes; say so in the task report, because it raises the one-time download. If neither passes, stop and report BLOCKED with the browser console output (add `page.on("console", (m) => console.log(m.text()))` temporarily to see worker errors).

- [ ] **Step 13: Commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add src/components tests/e2e tests/fixtures/partner.wav src/lib/language-packs
git commit -m "Listen to the partner on the conversation screen with live captions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Eval runner

**Files:**
- Create: `eval/scenarios.ts`, `eval/score.ts`, `eval/judge.ts`, `eval/run.ts`
- Modify: `package.json` (script `eval`, dev dependency `tsx`), `vitest.config.ts` (include `eval/**/*.test.ts`), `src/data/personas.test.ts`
- Test: `eval/scenarios.test.ts`, `eval/score.test.ts`, `eval/judge.test.ts`

**Interfaces:**
- Consumes: `personas` (`src/data/personas.ts`), `MemoryStore`, `en`, `buildSuggestRequest` (Task 2), `buildMessages`, `createLineSplitter`, `parseLines`, `validateReply`, `isNearDuplicate`, `streamCompletion`, `providerConfigs`, `groqExtraBody`, `retryAfterMs` (Task 1), `percentile` (Task 8), `ChatMessage`.
- Produces:
  - `interface Scenario { id; persona: "maya" | "tom" | "aisha"; placeId?: string | null; partnerId?: string | null; partnerSaid; typed?; intended; noteIds: string[] }` (`undefined` place/partner means the profile's default, `null` means not set); `scenarios: Scenario[]` (20 per profile)
  - `interface Judgement { match: number; invented: number[] }`; `parseJudgement(text, candidates): Judgement | null`
  - `keystrokesSaved(intended, typed, hit): number`
  - `interface ScenarioResult`, `interface ModelSummary`, `summarize(model, results): ModelSummary`, `toMarkdown(summaries): string`
  - `judgeMessages(input: JudgeInput): ChatMessage[]`, `judge(input, opts): Promise<string>`
  - `npm run eval [-- --models groq:<model>,cloudflare:<model>] [--persona maya] [--limit n] [--delay ms]` writes `eval/results/latest.json` and `eval/results/latest.md`

What is measured (spec 9): top-3 hit rate (a second model judges whether any shown reply says what the user meant), invented details that got past the validator (judged), replies the validator blocked, keystrokes saved against typing the whole sentence (a tap counts as one keystroke), whether the notes the intended reply needs were among the 8 sent (spec 5 says to add a reranker only if this is often false), and latency to the first valid reply and to the full answer. The judge is `openai/gpt-oss-120b` on Groq (override with `EVAL_JUDGE_MODEL`), a different and larger model than the candidates.

- [ ] **Step 1: Install tsx and wire the script and tests**

```bash
npm i -D tsx@4
```

In `package.json` scripts, add after `"e2e"`:

```json
    "eval": "tsx eval/run.ts"
```

In `vitest.config.ts`, change `include` to:

```ts
    include: ["src/**/*.test.{ts,tsx}", "eval/**/*.test.ts"],
```

- [ ] **Step 2: Persona consistency tests**

In `src/data/personas.test.ts` add imports:

```ts
import { claimSupported, extractClaims } from "@/lib/suggest/validate";
import { normalize } from "@/lib/text";
```

and inside the per-persona `describe(p.name, ...)`:

```ts
      it("names each note's entities in its text", () => {
        for (const note of p.notes) {
          for (const e of note.entities) expect(normalize(note.text), `${note.id}: ${e}`).toContain(normalize(e));
        }
      });

      it("only puts names, days and numbers in phrases that its notes back up", () => {
        const allNotes = p.notes.map((n) => n.text).join("\n");
        for (const ph of p.phrases) {
          for (const claim of extractClaims(ph.text)) expect(claimSupported(claim, allNotes), `${ph.id}: ${claim}`).toBe(true);
        }
      });
```

These pass with today's data; they guard later edits to the profiles, which the eval depends on (plan 1 deferred item).

- [ ] **Step 3: Write the failing eval tests**

`eval/scenarios.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { scenarios } from "./scenarios";

describe("eval scenarios", () => {
  it("has 20 per example profile, with unique ids", () => {
    for (const p of personas) expect(scenarios.filter((s) => s.persona === p.id)).toHaveLength(20);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });

  it("only points at notes the profile has, with the right kinds", () => {
    for (const s of scenarios) {
      const notes = new Map(personas.find((p) => p.id === s.persona)!.notes.map((n) => [n.id, n]));
      for (const id of s.noteIds) expect(notes.has(id), `${s.id}: ${id}`).toBe(true);
      if (s.placeId) expect(notes.get(s.placeId)?.kind, s.id).toBe("place");
      if (s.partnerId) expect(notes.get(s.partnerId)?.kind, s.id).toBe("person");
    }
  });

  it("uses no en or em dashes", () => {
    expect(JSON.stringify(scenarios)).not.toMatch(/[\u2013\u2014]/);
  });
});
```

`eval/score.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keystrokesSaved, parseJudgement, summarize, toMarkdown, type ScenarioResult } from "./score";

describe("parseJudgement", () => {
  it("reads the judge's JSON, even with text around it", () => {
    expect(parseJudgement('Sure. {"match": 2, "invented": [3, 3]}', 3)).toEqual({ match: 2, invented: [3] });
  });

  it("ignores numbers outside the candidate list", () => {
    expect(parseJudgement('{"match": 5, "invented": [0, 2, 9]}', 3)).toEqual({ match: 0, invented: [2] });
  });

  it("returns null for an unreadable answer", () => {
    expect(parseJudgement("no idea", 3)).toBeNull();
    expect(parseJudgement("{broken", 3)).toBeNull();
  });
});

describe("keystrokesSaved", () => {
  it("counts one tap plus what was typed, against typing it all", () => {
    expect(keystrokesSaved("Large, please.", "", true)).toBeCloseTo(1 - 1 / 14);
    expect(keystrokesSaved("Large, please.", "lar", true)).toBeCloseTo(1 - 4 / 14);
    expect(keystrokesSaved("Large, please.", "lar", false)).toBe(0);
  });
});

describe("summarize", () => {
  it("rolls results up per model", () => {
    const base = { shown: ["a", "b"], rawReplies: 3, blocked: 1, keystrokesSaved: 0.5, noteRecall: true, firstReplyMs: 400, totalMs: 900 };
    const results: ScenarioResult[] = [
      { id: "1", ok: true, ...base, judgement: { match: 1, invented: [] } },
      { id: "2", ok: true, ...base, noteRecall: false, judgement: { match: 0, invented: [2] }, keystrokesSaved: 0, firstReplyMs: 600, totalMs: 1100 },
      { id: "3", ok: false, error: "HTTP 503", shown: [], rawReplies: 0, blocked: 0, judgement: null, keystrokesSaved: 0, noteRecall: false, firstReplyMs: null, totalMs: null },
    ];
    expect(summarize("groq:m", results)).toMatchObject({
      scenarios: 3,
      failed: 1,
      judgeErrors: 0,
      hitRate: 0.5,
      inventedShown: 1,
      shownReplies: 4,
      blockedRate: 2 / 6,
      keystrokesSaved: 0.25,
      noteRecall: 0.5,
      firstReplyP50: 400,
      totalP95: 1100,
    });
  });
});

describe("toMarkdown", () => {
  it("makes one table row per model", () => {
    const md = toMarkdown([summarize("groq:m", [])]);
    expect(md.split("\n")).toHaveLength(3);
    expect(md).toContain("| groq:m | 0% |");
  });
});
```

`eval/judge.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { judge, judgeMessages, type JudgeInput } from "./judge";

const input: JudgeInput = {
  intended: "Large, please.",
  partnerSaid: "What size?",
  typed: "",
  contextLine: "It is Tuesday morning.",
  notes: ["Sam is the barista."],
  candidates: ["Large, please.", "Small."],
};

describe("judge", () => {
  it("numbers the candidates and lists the allowed facts", () => {
    const [, user] = judgeMessages(input);
    expect(user.content).toContain("1. Large, please.\n2. Small.");
    expect(user.content).toContain("- Sam is the barista.");
  });

  it("asks again without JSON mode when the model rejects it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 400 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"match": 1, "invented": []}' } }] }));
    const text = await judge(input, { apiKey: "k", model: "openai/gpt-oss-120b", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(text).toContain('"match": 1');
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[1].response_format).toBeUndefined();
    expect(bodies[0].reasoning_effort).toBe("low");
  });

  it("waits and tries once more after a 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "{}" } }] }));
    const sleep = vi.fn(async () => {});
    await judge(input, { apiKey: "k", model: "openai/gpt-oss-120b", fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx vitest run eval src/data`
Expected: the eval tests FAIL (modules missing); the persona tests PASS.

- [ ] **Step 5: Write the scenarios**

`eval/scenarios.ts`:

```ts
export interface Scenario {
  id: string;
  persona: "maya" | "tom" | "aisha";
  /** Place note id. Left out: the profile's default. null: not set. */
  placeId?: string | null;
  /** Partner note id. Left out: the profile's default. null: someone new. */
  partnerId?: string | null;
  partnerSaid: string;
  /** What the user had typed before choosing, if anything. */
  typed?: string;
  /** What the user meant to say. */
  intended: string;
  /** Notes the intended reply relies on, to check that search sent them. */
  noteIds: string[];
}

type Extra = Pick<Scenario, "placeId" | "partnerId" | "typed">;

const make =
  (persona: Scenario["persona"]) =>
  (n: number, partnerSaid: string, intended: string, noteIds: string[] = [], extra: Extra = {}): Scenario => ({
    id: `${persona}-${String(n).padStart(2, "0")}`,
    persona,
    partnerSaid,
    intended,
    noteIds,
    ...extra,
  });

const maya = make("maya");
const tom = make("tom");
const aisha = make("aisha");

export const scenarios: Scenario[] = [
  // Maya: ALS, hears fine. Blue Door Café with Sam unless noted.
  maya(1, "Hi Maya, the usual today?", "Yes please, my usual.", ["m-usual"]),
  maya(2, "What size would you like?", "Large, please.", ["m-usual"], { typed: "lar" }),
  maya(3, "Oat milk again?", "Yes, oat milk and no sugar.", ["m-usual"]),
  maya(4, "Anything to eat with that?", "No thanks, just the coffee."),
  maya(5, "Is that for here or to go?", "To go, please."),
  maya(6, "How are you doing today?", "I'm doing well, thanks for asking."),
  maya(7, "How's Leila getting on at university?", "She's doing great in Toronto.", ["m-leila"], { typed: "she's" }),
  maya(8, "Did you bring Biscuit with you today?", "Not today, Biscuit is at home.", ["m-biscuit"]),
  maya(9, "Reading anything good lately?", "An Agatha Christie mystery. I love them.", ["m-books"]),
  maya(10, "Will that be card or cash?", "Card, please.", [], { typed: "card" }),
  maya(11, "Sorry, we're out of oat milk today.", "Okay, I'll have it black then.", [], { typed: "ok" }),
  maya(12, "Do you want your receipt?", "No thanks."),
  maya(13, "Are you off to physio later?", "Yes, physio is at 10:30.", ["m-physio"]),
  maya(14, "Can I get your name for the cup?", "It's Maya.", ["m-me"]),
  maya(15, "Would you like to try our new pumpkin latte?", "No thanks, I'll stick with my usual.", ["m-usual"], { typed: "no" }),
  maya(16, "That'll be ready in a few minutes.", "Thanks, I'll wait over here."),
  maya(17, "Do you live nearby?", "Yes, just two blocks away.", ["m-cafe"]),
  maya(18, "Excuse me, is this seat taken?", "No, go ahead.", [], { partnerId: null }),
  maya(19, "Sorry, I didn't catch that. Could you say it again?", "I have ALS, so I type to talk. One moment.", ["m-me"], {
    partnerId: null,
    typed: "i type",
  }),
  maya(20, "Hi Mum, how was your week?", "Pretty good. Biscuit and I went to the café.", ["m-biscuit", "m-cafe"], {
    placeId: "m-home",
    partnerId: "m-leila",
  }),

  // Tom: Deaf, uses ASL. Riverside Pharmacy with Priya unless noted.
  tom(1, "Hi, what can I do for you today?", "I'm here to pick up my prescription.", ["t-meds"]),
  tom(2, "Can I have your name, please?", "It's Tom.", ["t-me"]),
  tom(3, "What's your date of birth?", "I'll type it for you.", [], { typed: "i'll type" }),
  tom(4, "Is this for your blood pressure medication?", "Yes, my blood pressure medication.", ["t-meds"]),
  tom(5, "Do you have any allergies?", "Yes, I'm allergic to penicillin.", ["t-allergy"]),
  tom(6, "It'll be about ten minutes.", "Okay, I'll wait."),
  tom(7, "Who's your doctor?", "Dr. Chen at Lakeview Clinic.", ["t-doctor"]),
  tom(8, "Have you had any side effects?", "No, I feel fine."),
  tom(9, "Do you want to talk to the pharmacist about it?", "Yes please. Can you write it down?", [], { partnerId: null }),
  tom(10, "Sorry, can you hear me okay?", "I'm Deaf. I read captions, so please look at me when you speak.", ["t-me"]),
  tom(11, "Would you like a bag?", "No thanks."),
  tom(12, "Can I see your insurance card, please?", "Here it is.", [], { typed: "here" }),
  tom(13, "Take one tablet every morning with food.", "One every morning with food, got it."),
  tom(14, "Do you want a text when your refill is due?", "Yes, a reminder would help."),
  tom(15, "We need to call your doctor first.", "Okay. Can you text me when it's ready?"),
  tom(16, "Is there anything else you need?", "No, that's all. Thank you."),
  tom(17, "How's work going these days?", "Busy, lots of design projects.", ["t-work"]),
  tom(18, "Are you in line?", "Yes, I'm next.", [], { partnerId: null }),
  tom(19, "How have you been feeling on the new dose?", "Much better, thank you.", [], { placeId: null, partnerId: "t-doctor" }),
  tom(20, "That's $12.50, please.", "Card, please.", [], { typed: "card" }),

  // Aisha: laryngectomy. Northline Design office with Marco unless noted.
  aisha(1, "Morning Aisha, how are you?", "Morning, Marco. I'm good, thanks."),
  aisha(2, "How's the Harbor redesign coming along?", "Almost done. It's due on Friday.", ["a-harbor"]),
  aisha(3, "Can you have it ready by Friday?", "Yes, I'll send it by Friday.", ["a-harbor"]),
  aisha(4, "Are you coming to stand-up?", "Yes, see you at 9:15.", ["a-standup"]),
  aisha(5, "Do you want to grab lunch later?", "Sure, the Thai place at 12:30?", ["a-lunch"]),
  aisha(6, "Can we move our meeting to tomorrow?", "Sounds good to me."),
  aisha(7, "Do you need anything from me for Harbor?", "Just your feedback on the designs.", ["a-harbor"]),
  aisha(8, "Hey, can you look at the website header?", "Sure, send me the link.", [], { partnerId: "a-jen" }),
  aisha(9, "Are you going to the Thai place today?", "Yes, at 12:30 as usual.", ["a-lunch"], { partnerId: "a-jen" }),
  aisha(10, "Can you present the designs to the client?", "I'd rather share the slides and answer questions in the chat.", [], {
    typed: "i'd rather",
  }),
  aisha(11, "Did you get my email?", "Not yet, I'll check now."),
  aisha(12, "The client wants a few changes.", "Okay, let me check and get back to you."),
  aisha(13, "How's the new desk setup?", "Much better, thanks."),
  aisha(14, "Is the third floor too noisy for you?", "It's fine for me.", ["a-office"]),
  aisha(15, "Can you cover Jen's review this afternoon?", "Yes, I can do that."),
  aisha(16, "Want a coffee from downstairs?", "No thanks, I'm fine."),
  aisha(17, "What time is stand-up again?", "Every weekday at 9:15.", ["a-standup"]),
  aisha(18, "Hi, I'm new here. Which floor is Northline Design on?", "It's on the third floor.", ["a-office"], { partnerId: null }),
  aisha(19, "Are you free for a quick call?", "After stand-up works for me.", ["a-standup"], { typed: "after" }),
  aisha(20, "Great work on the mockups!", "Thanks, Marco."),
];
```

- [ ] **Step 6: Scoring**

`eval/score.ts`:

```ts
import { percentile } from "@/lib/stats";

export interface Judgement {
  /** 1-based number of the first shown reply that says what the user meant; 0 if none. */
  match: number;
  /** 1-based numbers of shown replies that state a fact the sources don't back up. */
  invented: number[];
}

export interface ScenarioResult {
  id: string;
  /** False when the model request failed. */
  ok: boolean;
  error?: string;
  /** Replies that passed the validator, as the app would show them (at most 3). */
  shown: string[];
  /** Reply lines the model produced. */
  rawReplies: number;
  /** Reply lines the validator dropped (unknown note or unsupported detail). */
  blocked: number;
  judgement: Judgement | null;
  keystrokesSaved: number;
  /** Every note the intended reply needs was among the notes sent. */
  noteRecall: boolean;
  firstReplyMs: number | null;
  totalMs: number | null;
}

export interface ModelSummary {
  model: string;
  scenarios: number;
  failed: number;
  judgeErrors: number;
  hitRate: number;
  inventedShown: number;
  shownReplies: number;
  blockedRate: number;
  keystrokesSaved: number;
  noteRecall: number;
  avgShown: number;
  firstReplyP50: number | null;
  firstReplyP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
}

/** Reads the judge's JSON answer. Null when it can't be read. */
export function parseJudgement(text: string, candidates: number): Judgement | null {
  const found = text.match(/\{[\s\S]*\}/);
  if (!found) return null;
  try {
    const j = JSON.parse(found[0]) as { match?: unknown; invented?: unknown };
    const inRange = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= candidates;
    return {
      match: inRange(j.match) ? j.match : 0,
      invented: Array.isArray(j.invented) ? [...new Set(j.invented.filter(inRange))] : [],
    };
  } catch {
    return null;
  }
}

/** Share of keystrokes saved against typing the intended sentence in full. A tap on a reply costs one. */
export function keystrokesSaved(intended: string, typed: string, hit: boolean): number {
  if (!hit || intended.length === 0) return 0;
  return Math.max(0, 1 - (typed.length + 1) / intended.length);
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

export function summarize(model: string, results: ScenarioResult[]): ModelSummary {
  const ok = results.filter((r) => r.ok);
  const judged = ok.filter((r) => r.judgement !== null);
  const shownReplies = sum(ok.map((r) => r.shown.length));
  const firsts = ok.map((r) => r.firstReplyMs).filter((v): v is number => v !== null);
  const totals = ok.map((r) => r.totalMs).filter((v): v is number => v !== null);
  return {
    model,
    scenarios: results.length,
    failed: results.length - ok.length,
    judgeErrors: ok.length - judged.length,
    hitRate: ratio(judged.filter((r) => r.judgement!.match > 0).length, judged.length),
    inventedShown: sum(judged.map((r) => r.judgement!.invented.length)),
    shownReplies,
    blockedRate: ratio(sum(ok.map((r) => r.blocked)), sum(ok.map((r) => r.rawReplies))),
    keystrokesSaved: ratio(sum(ok.map((r) => r.keystrokesSaved)), ok.length),
    noteRecall: ratio(ok.filter((r) => r.noteRecall).length, ok.length),
    avgShown: ratio(shownReplies, ok.length),
    firstReplyP50: percentile(firsts, 50),
    firstReplyP95: percentile(firsts, 95),
    totalP50: percentile(totals, 50),
    totalP95: percentile(totals, 95),
  };
}

export function toMarkdown(summaries: ModelSummary[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const ms = (x: number | null) => (x === null ? "n/a" : `${Math.round(x)} ms`);
  return [
    "| Model | Top-3 hit rate | Invented details shown | Replies blocked by the check | Keystrokes saved | Right notes sent | First reply p50 / p95 | Full answer p50 / p95 | Failed |",
    "|---|---|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s) =>
        `| ${s.model} | ${pct(s.hitRate)} | ${s.inventedShown} of ${s.shownReplies} | ${pct(s.blockedRate)} | ${pct(s.keystrokesSaved)} | ${pct(s.noteRecall)} | ${ms(s.firstReplyP50)} / ${ms(s.firstReplyP95)} | ${ms(s.totalP50)} / ${ms(s.totalP95)} | ${s.failed} |`,
    ),
  ].join("\n");
}
```

- [ ] **Step 7: Judge**

`eval/judge.ts`:

```ts
import { groqExtraBody, retryAfterMs } from "@/lib/server/providers";
import type { ChatMessage } from "@/lib/suggest/prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface JudgeInput {
  intended: string;
  partnerSaid: string;
  typed: string;
  contextLine: string;
  /** Texts of the notes that were sent with the request: the only facts replies may use. */
  notes: string[];
  candidates: string[];
}

export function judgeMessages(j: JudgeInput): ChatMessage[] {
  const lines = [
    "A person who cannot speak picks one of the suggested replies below and the app says it out loud for them.",
    `Situation: ${j.contextLine}`,
    `The other person said: "${j.partnerSaid}"`,
    `The person had typed: "${j.typed}"`,
    "Facts the replies may use:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    "",
    `What the person meant to say: "${j.intended}"`,
    "",
    "Suggested replies:",
    j.candidates.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    "",
    "Give two things:",
    "match: the number of the first reply that says what the person meant closely enough that they would pick it (same meaning, wording may differ), or 0 if none does.",
    "invented: the numbers of replies that state a specific fact (a name, place, number, day, time, or a claim about the person's life) that is not in the facts, the situation, what the other person said, or what the person typed.",
    'Answer with one JSON object and nothing else, like {"match": 2, "invented": []}',
  ];
  return [
    { role: "system", content: "You grade reply suggestions for a communication aid. You answer with one JSON object." },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Asks the judge model on Groq. Returns its raw text; parse it with parseJudgement. */
export async function judge(
  input: JudgeInput,
  opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = (jsonMode: boolean) =>
    fetchImpl(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        messages: judgeMessages(input),
        temperature: 0,
        max_tokens: 1000,
        ...groqExtraBody(opts.model),
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  let res = await call(true);
  if (res.status === 429) {
    await sleep(Math.min(60_000, retryAfterMs(res.headers.get("retry-after"))));
    res = await call(true);
  }
  // Some models reject JSON mode; ask again without it.
  if (res.status === 400) res = await call(false);
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
```

- [ ] **Step 8: Runner**

`eval/run.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { personas } from "@/data/personas";
import { en } from "@/lib/language-packs/en";
import { MemoryStore } from "@/lib/memory/store";
import { groqExtraBody, providerConfigs, streamCompletion, type ProviderId } from "@/lib/server/providers";
import { buildMessages } from "@/lib/suggest/prompt";
import { createLineSplitter, parseLines } from "@/lib/suggest/protocol";
import { buildSuggestRequest } from "@/lib/suggest/request";
import { isNearDuplicate, validateReply } from "@/lib/suggest/validate";
import { judge } from "./judge";
import { scenarios, type Scenario } from "./scenarios";
import { keystrokesSaved, parseJudgement, summarize, toMarkdown, type Judgement, type ScenarioResult } from "./score";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Keys can also come from the environment.
}

const DEFAULT_MODELS = ["groq:qwen/qwen3.8-27b", "groq:openai/gpt-oss-20b", "cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
/** A Tuesday morning, so the weekday and time of day in every prompt stay the same. */
const NOW = new Date(2026, 8, 29, 9, 0);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runScenario(sc: Scenario, provider: ProviderId, model: string, judgeModel: string): Promise<ScenarioResult> {
  const persona = personas.find((p) => p.id === sc.persona)!;
  const memory = await MemoryStore.create();
  await memory.replaceAll(persona.notes, persona.phrases);
  const typed = sc.typed ?? "";
  const context = {
    now: NOW,
    placeId: sc.placeId === null ? undefined : (sc.placeId ?? persona.defaultPlaceId),
    partnerId: sc.partnerId === null ? undefined : (sc.partnerId ?? persona.defaultPartnerId),
  };
  const { body, sources } = await buildSuggestRequest({
    memory,
    pack: en,
    input: { mode: "replies+reactions", typed, partnerSaid: sc.partnerSaid, context },
    simple: false,
  });

  const base = providerConfigs();
  const configs = {
    ...base,
    [provider]: { ...base[provider], model, extraBody: provider === "groq" ? groqExtraBody(model) : base[provider].extraBody },
  };
  const shown: string[] = [];
  let rawReplies = 0;
  let blocked = 0;
  let firstReplyMs: number | null = null;
  const started = performance.now();
  try {
    // Generous timeouts: the eval measures latency instead of falling back.
    const { deltas } = await streamCompletion(buildMessages(body), { order: [provider], configs, firstTokenTimeoutMs: 10_000, idleTimeoutMs: 10_000 });
    const splitter = createLineSplitter((line) => {
      for (const parsed of parseLines(line)) {
        if (parsed.kind !== "reply") continue;
        rawReplies++;
        if (!validateReply({ text: parsed.text, noteIds: parsed.noteIds }, sources).ok) {
          blocked++;
          continue;
        }
        if (shown.length >= 3 || shown.some((t) => isNearDuplicate(t, parsed.text))) continue;
        shown.push(parsed.text);
        firstReplyMs ??= performance.now() - started;
      }
    });
    for await (const d of deltas) splitter.push(d);
    splitter.flush();
  } catch (err) {
    return {
      id: sc.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      shown,
      rawReplies,
      blocked,
      judgement: null,
      keystrokesSaved: 0,
      noteRecall: false,
      firstReplyMs: null,
      totalMs: null,
    };
  }
  const totalMs = performance.now() - started;

  let judgement: Judgement | null = { match: 0, invented: [] };
  if (shown.length) {
    try {
      const text = await judge(
        { intended: sc.intended, partnerSaid: sc.partnerSaid, typed, contextLine: body.contextLine, notes: body.notes.map((n) => n.text), candidates: shown },
        { apiKey: process.env.GROQ_API_KEY ?? "", model: judgeModel },
      );
      judgement = parseJudgement(text, shown.length);
    } catch (err) {
      console.warn(`  judge failed for ${sc.id}: ${err instanceof Error ? err.message : String(err)}`);
      judgement = null;
    }
  }
  const sentIds = new Set(body.notes.map((n) => n.id));
  return {
    id: sc.id,
    ok: true,
    shown,
    rawReplies,
    blocked,
    judgement,
    keystrokesSaved: keystrokesSaved(sc.intended, typed, (judgement?.match ?? 0) > 0),
    noteRecall: sc.noteIds.every((id) => sentIds.has(id)),
    firstReplyMs,
    totalMs,
  };
}

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing. Add it to .env.local.");
  const models = (arg("models")?.split(",") ?? DEFAULT_MODELS).map((m) => {
    const [provider, ...rest] = m.split(":");
    if (provider !== "groq" && provider !== "cloudflare") throw new Error(`Unknown provider in "${m}". Use groq:<model> or cloudflare:<model>.`);
    return { provider: provider as ProviderId, model: rest.join(":") };
  });
  const persona = arg("persona");
  const limit = Number(arg("limit") ?? Infinity);
  const delay = Number(arg("delay") ?? 2500);
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? "openai/gpt-oss-120b";
  const chosen = scenarios.filter((s) => !persona || s.persona === persona).slice(0, limit);

  const summaries = [];
  const results: Record<string, ScenarioResult[]> = {};
  for (const { provider, model } of models) {
    const name = `${provider}:${model}`;
    console.log(`\n${name} (${chosen.length} scenarios)`);
    const list: ScenarioResult[] = [];
    for (const sc of chosen) {
      const r = await runScenario(sc, provider, model, judgeModel);
      list.push(r);
      console.log(`  ${sc.id}: ${r.ok ? `${r.shown.length} shown, match ${r.judgement?.match ?? "?"}` : `failed (${r.error})`}`);
      await sleep(delay);
    }
    results[name] = list;
    summaries.push(summarize(name, list));
  }

  const table = toMarkdown(summaries);
  console.log(`\n${table}`);
  mkdirSync("eval/results", { recursive: true });
  const ranAt = new Date().toISOString();
  writeFileSync("eval/results/latest.json", `${JSON.stringify({ ranAt, judgeModel, summaries, results }, null, 2)}\n`);
  writeFileSync(
    "eval/results/latest.md",
    `# Eval results\n\nRun ${ranAt.slice(0, 10)}, ${chosen.length} scenarios per model, judged by ${judgeModel}. Generated by \`npm run eval\`.\n\n${table}\n`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

If `tsc` narrows `firstReplyMs` to `null` at the `return` (it is only assigned inside the splitter callback), keep the declared type by writing `let firstReplyMs = null as number | null;`.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run eval src/data`
Expected: PASS.

- [ ] **Step 10: Smoke-run against the real API (needs `.env.local`)**

Run: `npm run eval -- --models groq:qwen/qwen3.8-27b --limit 2 --delay 500`
Expected: two scenario lines such as `maya-01: 3 shown, match 1`, a table, and `eval/results/latest.md` written. If it fails with a missing key, say so in the report; do not print `.env.local`. Delete the smoke output afterwards (`rm eval/results/latest.*`); Task 11 makes the real run.

- [ ] **Step 11: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add eval package.json package-lock.json vitest.config.ts src/data/personas.test.ts
git commit -m "Add the eval runner with scenarios for Maya, Tom and Aisha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Run the eval, choose the model, measure timing, write it up

**Files:**
- Create: `eval/results/latest.md`, `eval/results/latest.json` (generated), `eval/RESULTS.md`
- Modify (depending on results): `src/lib/server/providers.ts`, `src/lib/server/providers.test.ts`, `src/lib/suggest/validate.ts`, `src/lib/suggest/validate.test.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-27-onbeat-design.md` (one sentence in section 5)

This task needs `.env.local` with the Groq and Cloudflare keys. Never print, copy or commit it.

- [ ] **Step 1: Run the full eval**

Run: `npm run eval`
It makes about 180 model calls and 180 judge calls with a 2.5 s pause between scenarios, so it takes roughly 15 to 25 minutes. Run it in the background and wait for it to finish.
Expected: a table with three rows in `eval/results/latest.md`. If a model fails most scenarios (for example it was removed from the free tier), rerun without it using `--models` and note that in `eval/RESULTS.md`.

- [ ] **Step 2: Look at every invented detail**

For each result in `eval/results/latest.json` whose `judgement.invented` is not empty, read the reply. If the invented detail is a name, number, day or time the validator should have caught, add a failing test for that exact reply to `src/lib/suggest/validate.test.ts`, fix `validate.ts` until it passes, and rerun that model (`npm run eval -- --models <provider:model>`; the file then holds only that model, so rerun all three at the end if you changed the validator). A vague claim the validator can't catch by design (for example "I already paid") goes under "Known gaps" in Step 4 with the reply quoted.

- [ ] **Step 3: Choose the Groq model**

Compare `groq:qwen/qwen3.8-27b` and `groq:openai/gpt-oss-20b` in this order:
1. fewer invented details shown;
2. higher top-3 hit rate (a gap under 5 points is a tie);
3. lower first-reply p50.

If gpt-oss-20b wins, change the default in `providerConfigs` to `env.GROQ_MODEL ?? "openai/gpt-oss-20b"` and update the first test in `src/lib/server/providers.test.ts` to expect `{ model: "openai/gpt-oss-20b", stream: true, reasoning_effort: "low" }`. If Qwen wins, change nothing.

The Cloudflare backup stays `@cf/meta/llama-3.3-70b-instruct-fp8-fast` in this plan. If it shows invented details after Step 2, or its hit rate is more than 20 points below the chosen Groq model, write that under "Known gaps" for plan 3.

If "Right notes sent" is below 80% for the chosen model, add "consider a reranker (spec 5)" under "Known gaps", listing the scenarios where the note was missing.

- [ ] **Step 4: Measure in-app timing and write `eval/RESULTS.md`**

Run the live check from Task 9 again: `ONBEAT_LIVE=1 npx playwright test tests/e2e/live-hearing.spec.ts --reporter=list` and take the printed gaps. Compute the median and p95 by hand from the list (nearest rank, like `percentile`).

Create `eval/RESULTS.md` in the repo's plain style (no emoji, no em dashes):

```markdown
# Eval results

Scenarios: 20 per example profile (Maya at the café, Tom at the pharmacy, Aisha at work), in `eval/scenarios.ts`. Each scenario has what the other person said, sometimes a few typed letters, and the sentence the user meant. Replies go through the same request builder, prompt and validator as the app. A second model (the judge) decides whether any shown reply says what the user meant and whether a shown reply states a fact that isn't in the notes or the conversation.

Run it with `npm run eval` (needs the keys in `.env.local`, about 20 minutes). The raw output is in `results/latest.md` and `results/latest.json`.

## Results (<date of the run>)

<paste the table from results/latest.md>

## Model choice

<one or two sentences: which Groq model is the default now and why, using the numbers above>

## In-app timing

Time from the other person's last word until replies are on screen, measured by the live browser check (`tests/e2e/live-hearing.spec.ts`, Chromium on <this machine: CPU and OS>, <n> turns): median <x> ms, p95 <y> ms. Replies prepared while they were still talking count as 0 ms.

## Known gaps

- <each gap from Steps 2 and 3, or "None found in this run.">
```

Fill every `<...>` with the real values from this run; leave nothing in angle brackets.

- [ ] **Step 5: Update the spec and README**

In `docs/superpowers/specs/2026-09-27-onbeat-design.md`, at the end of the "Default model" paragraph in section 5, add one sentence: `The plan 2 eval chose <model>; see eval/RESULTS.md.`

In `README.md`:
- Change the "Status" section to: `Listening works: the other person's speech is captioned in the browser and replies are prepared while they talk. Eval results are in [eval/RESULTS.md](eval/RESULTS.md). Settings, notes editing and the first-run flow are next.`
- In "Run it locally", change the download sentence to: `The first visit downloads the voice (about 90 MB) and the search model (about 23 MB). Pressing Listen downloads speech recognition (about 53 MB) the first time. All are cached by the browser afterwards.` (use the base model's size if Task 9 switched to it).
- After the "Checks:" line add: `Eval: \`npm run eval\` (needs the API keys; about 20 minutes).`

- [ ] **Step 6: Final checks**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run e2e`
Expected: all pass.

- [ ] **Step 7: Commit and push**

```bash
git add eval README.md docs/superpowers/specs/2026-09-27-onbeat-design.md src/lib/server src/lib/suggest
git commit -m "Record eval results and choose the default model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git pull --rebase origin main
git push -u origin feat/listening
```

---

## After this plan

- **Plan 3 (finish):** notes and settings screens (voice with written descriptions, speed, caption size, simple language, reaction list, theme, vibration, hold to speak, shortcut list, a setting for the reply timer), first-run flow with download consent for the voice and speech models, confirm/undo before a profile replaces data (plan 1 R17), iOS AudioContext unlock, voice worker serialization, composer Stop button, full accessibility pass with colour-vision screenshots, deploy to Vercel (team `hujaifa-muaz`), README results table from `eval/RESULTS.md`, 120-second demo video.
- Carried from this plan, if they show up in testing: CPU contention when the voice, search and hearing workers run together on phones; resampling quality on Firefox (no low-pass filter); prompt tuning for the Cloudflare backup if the eval flagged it.
