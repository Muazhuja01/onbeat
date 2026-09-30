import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { personas } from "@/data/personas";
import { AssistUnreadableError, assistTurn } from "@/lib/assist/server";
import { AssistSession } from "@/lib/assist/session";
import { MemoryStore } from "@/lib/memory/store";
import { providerConfigs } from "@/lib/server/providers";
import { judgeChat, judgeEndpoints } from "../judge";
import { EVAL_TODAY } from "../learning/scenarios";
import { loadLocalEnv } from "../learning/env";
import { withRetry } from "../retry";
import { assistCases, type AssistCase } from "./cases";
import { ASSIST_JUDGE_VERSION, assistJudgeMessages, parseAssistVerdict, shownCard, voteAssist, type AssistVerdict, type ShownCard } from "./judge";
import { assistMarkdown, summarizeAssist, type AssistCaseResult } from "./score";
import { askSimUser, parseSimReply, simUserMessages } from "./sim-user";

loadLocalEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const CACHE_DIR = "eval/assist/.cache";
const CACHE = `${CACHE_DIR}/judge.json`;
const RESULTS_DIR = "eval/assist/results";
/** The first message counts, so the simulated user types at most 7 more. */
const MAX_USER_TURNS = 8;

type Line = { speaker: "user" | "assistant"; text: string };
/** What the runner saves per case: the score's fields plus what --rejudge needs to judge again. */
interface AssistRunResult extends AssistCaseResult {
  /** The brief the chat ran with, so a later rejudge sees the same one. */
  brief?: string;
  lines?: Line[];
  notes?: string[];
  /** The judge failed (usually quota); verdict stays null until --rejudge. */
  judgeError?: string;
}

/** Judge answers by prompt hash, so re-scoring the same chat costs nothing. */
function loadCache(): Record<string, string> {
  return existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string>) : {};
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One case through the app's own session and server turn, with a simulated user answering. */
async function runCase(c: AssistCase, model: string, delay: number): Promise<{ lines: Line[]; cards: (ShownCard & { noteId?: string })[]; notes: string[]; userMessages: number }> {
  const persona = personas.find((p) => p.id === c.persona)!;
  const memory = await MemoryStore.create();
  await memory.replaceAll(persona.notes, []);
  for (const [text, tied] of c.quick ?? []) {
    const note = tied ? persona.notes.find((n) => n.id === tied) : undefined;
    await memory.addQuickPhrase(text, note?.kind === "place" ? { placeId: note.id } : note ? { partnerId: note.id } : {});
  }
  const configs = providerConfigs({ ...process.env, GROQ_MODEL: model });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
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
  await sleep(delay);
  for (let turn = 1; turn < MAX_USER_TURNS; turn++) {
    const messages = simUserMessages(c.brief, session.state.lines);
    const reply = await withRetry(`${c.id}:user`, (cooldown) => askSimUser(messages, { apiKey, cooldown }));
    const { text, done } = parseSimReply(reply);
    if (done || !text) break;
    await session.send(text);
    await sleep(delay);
  }
  return {
    lines: session.state.lines.map(({ speaker, text }) => ({ speaker, text })),
    cards: session.state.cards.filter((card) => card.state === "open").map(shownCard),
    notes: persona.notes.map((n) => n.text),
    userMessages: session.userCount(),
  };
}

/** Judges one case's cards and the user's messages (majority of `votes` calls, cached). Throws when every judge is out of quota or no answer could be read. */
async function judgeCase(run: { brief: string; expected: AssistCase["expected"]; cards: ShownCard[]; lines: Line[]; notes: string[] }, votes: number, ctx: { endpoints: ReturnType<typeof judgeEndpoints>; spent: Set<string>; cache: Record<string, string> }): Promise<AssistVerdict> {
  const messages = assistJudgeMessages({
    today: EVAL_TODAY,
    brief: run.brief,
    notes: run.notes,
    lines: run.lines,
    expected: run.expected,
    cards: run.cards.map(({ action, text, oldText, forName }) => ({ action, text, ...(oldText !== undefined ? { oldText } : {}), ...(forName ? { forName } : {}) })),
  });
  const sets = [];
  for (let v = 0; v < votes; v++) {
    const key = createHash("sha256").update(JSON.stringify({ ASSIST_JUDGE_VERSION, messages, v })).digest("hex");
    ctx.cache[key] ??= (await judgeChat(messages, { endpoints: ctx.endpoints, spent: ctx.spent })).text;
    writeFileSync(CACHE, JSON.stringify(ctx.cache));
    sets.push(parseAssistVerdict(ctx.cache[key], run.cards.length));
  }
  const verdict = voteAssist(sets);
  if (!verdict) throw new Error("judge answer unreadable");
  return verdict;
}

/** Cases left out of the numbers: failed runs, and runs the judge didn't (or couldn't) read. */
function reportLeftOut(results: AssistRunResult[]) {
  for (const r of results) {
    if (r.error) console.log(`  left out ${r.model} ${r.id}: failed (${r.error})`);
    else if (!r.verdict) console.log(`  left out ${r.model} ${r.id}: not judged${r.judgeError ? ` (${r.judgeError})` : ""}`);
    else if (r.verdict.leak) console.log(`  void ${r.model} ${r.id}: the simulated user typed a fact outside its brief`);
  }
}

function describe(r: AssistRunResult): string {
  if (!r.verdict) return `${r.cards.length} cards, ${r.judgeError ? `unjudged (${r.judgeError})` : "not judged"}`;
  const kept = r.verdict.cards.filter((v) => v.keep).length;
  return `${r.cards.length} cards, ${kept} worth keeping, ${r.userMessages} user messages${r.verdict.leak ? ", VOID (leak)" : ""}`;
}

/**
 * Chats through each case with the simulated user, then judges the cards left open.
 * Chats and cards are saved even when the judge fails (quota) or `--no-judge` is given,
 * and `--rejudge <results.json>` later judges only those, so no chat is rerun just
 * because the judge wasn't there.
 *
 *   --split dev|test   which cases (default dev; with --rejudge, the file's split)
 *   --models a,b       Groq models for the assistant (default: the app's GROQ_MODEL)
 *   --votes n          judge calls per case, majority wins (default 1 on dev, 3 on test)
 *   --only id,id       just these cases of the split
 *   --delay ms         pause after each assistant turn (default 2000)
 *   --no-judge         save chats and cards with verdict null, skip judging
 *   --rejudge file     judge the unjudged cases in a saved results file
 */
async function main() {
  const rejudge = arg("rejudge");
  const noJudge = flag("no-judge");
  const split = (rejudge ? (rejudge.includes("-test-") ? "test" : "dev") : (arg("split") ?? "dev")) as "dev" | "test";
  if (split !== "dev" && split !== "test") throw new Error(`--split must be dev or test, not ${String(split)}`);
  const models = (arg("models") ?? providerConfigs(process.env).groq.model).split(",");
  const votes = Number(arg("votes") ?? (split === "test" ? 3 : 1));
  const delay = Number(arg("delay") ?? 2000);
  const only = arg("only")?.split(",");
  const ctx = { endpoints: judgeEndpoints(), spent: new Set<string>(), cache: loadCache() };
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  if (rejudge) {
    const results = JSON.parse(readFileSync(rejudge, "utf8")) as AssistRunResult[];
    for (const r of results) {
      if (r.error || r.verdict !== null || !r.lines || !r.notes) continue;
      const brief = r.brief ?? assistCases.find((x) => x.id === r.id)?.brief;
      if (!brief) {
        console.log(`${r.model} ${r.id}: no brief saved and no case with this id, skipped`);
        continue;
      }
      try {
        r.verdict = await judgeCase({ brief, expected: r.expected, cards: r.cards, lines: r.lines, notes: r.notes }, votes, ctx);
        delete r.judgeError;
      } catch (err) {
        r.judgeError = errorText(err);
      }
      console.log(`${r.model} ${r.id}: ${describe(r)}`);
    }
    writeFileSync(rejudge, JSON.stringify(results, null, 2));
    const byModel = [...new Set(results.map((r) => r.model))].map((model) => ({ model, summary: summarizeAssist(results.filter((r) => r.model === model)) }));
    const table = assistMarkdown(split, votes, byModel);
    writeFileSync(`${RESULTS_DIR}/latest-${split}.md`, table);
    reportLeftOut(results);
    console.log(`\n${table}`);
    return;
  }

  const cases = assistCases.filter((c) => c.split === split && (!only || only.includes(c.id)));
  const missing = only?.filter((id) => !cases.some((c) => c.id === id)) ?? [];
  if (missing.length) throw new Error(`not in the ${split} split: ${missing.join(", ")}`);
  const rows = [];
  for (const model of models) {
    const results: AssistRunResult[] = [];
    for (const c of cases) {
      let run: Awaited<ReturnType<typeof runCase>>;
      try {
        run = await runCase(c, model, delay);
      } catch (err) {
        results.push({ id: c.id, model, expected: c.expected, cards: [], userMessages: 0, verdict: null, error: errorText(err) });
        console.log(`${model} ${c.id}: failed (${errorText(err)})`);
        await sleep(delay);
        continue;
      }
      const result: AssistRunResult = { id: c.id, model, expected: c.expected, cards: run.cards, userMessages: run.userMessages, verdict: null, brief: c.brief, lines: run.lines, notes: run.notes };
      if (!noJudge) {
        try {
          result.verdict = await judgeCase({ brief: c.brief, expected: c.expected, ...run }, votes, ctx);
        } catch (err) {
          result.judgeError = errorText(err);
        }
      }
      results.push(result);
      console.log(`${model} ${c.id}: ${describe(result)}`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = `${RESULTS_DIR}/${stamp}-${split}-${model.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
    writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`saved ${file}`);
    reportLeftOut(results);
    rows.push({ model, summary: summarizeAssist(results) });
  }
  if (noJudge) {
    console.log("\nNot judged (--no-judge). Judge later with --rejudge <file>.");
    return;
  }
  const table = assistMarkdown(split, votes, rows);
  writeFileSync(`${RESULTS_DIR}/latest-${split}.md`, table);
  console.log(`\n${table}`);
}

main().catch((err: unknown) => {
  console.error(errorText(err));
  process.exitCode = 1;
});
