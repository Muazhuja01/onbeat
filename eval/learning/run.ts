import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { loadLocalEnv } from "./env";
import { LEARN_JUDGE_VERSION, learnJudgeMessages, parseLearnVerdicts, voteLearn, type LearnVerdict, type ShownSuggestion } from "./judge";
import { EVAL_TODAY, learnScenarios, type LearnScenario } from "./scenarios";
import { learningMarkdown, summarizeLearning, type LearnScenarioResult } from "./score";

loadLocalEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const CACHE_DIR = "eval/learning/.cache";
const CACHE = `${CACHE_DIR}/judge.json`;

/** Judge answers by prompt hash, so re-scoring the same suggestions costs nothing. */
function loadCache(): Record<string, string> {
  return existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string>) : {};
}

const noteName = (sc: LearnScenario, id?: string) => (id ? personas.find((p) => p.id === sc.persona)!.notes.find((n) => n.id === id)?.entities[0] : undefined);

/** One scenario through the app's own path: related notes, /api/learn's logic, then the pending list's merge rules. */
async function runScenario(sc: LearnScenario, provider: ProviderId, model: string): Promise<{ shown: ShownSuggestion[]; notes: string[]; ms: number }> {
  const persona = personas.find((p) => p.id === sc.persona)!;
  const memory = await MemoryStore.create();
  await memory.replaceAll(persona.notes, []);
  const at = new Date(`${EVAL_TODAY}T12:00:00`).getTime();
  const partnerName = noteName(sc, sc.partnerId);
  const placeName = noteName(sc, sc.placeId);
  const lines: QueuedLine[] = sc.lines.map((l, i) => ({
    id: `line-${i + 1}`,
    speaker: l.speaker,
    text: l.text,
    at,
    ...(partnerName ? { partnerName } : {}),
    ...(placeName ? { placeName } : {}),
  }));
  const notes = await relatedNotes(memory, lines);
  const body = {
    today: EVAL_TODAY,
    lines: lines.map(({ id, speaker, text, partnerName: p, placeName: pl }) => ({ id, speaker, text, ...(p ? { partnerName: p } : {}), ...(pl ? { placeName: pl } : {}) })),
    notes: notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text })),
  };
  const configs = providerConfigs({ ...process.env, ...(provider === "groq" ? { GROQ_MODEL: model } : { CLOUDFLARE_MODEL: model }) });
  const started = Date.now();
  const proposals = await withRetry(sc.id, (cooldown) => learnFromBatch(body, { order: [provider], configs, cooldown }));
  const ms = Date.now() - started;
  const pending = await PendingStore.open(memoryKeyValue(), "eval");
  const byId = new Map(lines.map((l) => [l.id, l]));
  await pending.merge(
    proposals.map((p) => toPending(p, byId, memory, at)),
    memory.notes(),
  );
  const shown = pending.list().map((s) => ({
    action: s.action,
    text: composeNoteText(s.draft),
    ...(s.oldText ? { oldText: s.oldText } : {}),
    ...(s.noteId ? { noteId: s.noteId } : {}),
  }));
  return { shown, notes: notes.map((n) => n.text), ms };
}

/** Judges one scenario's shown suggestions (majority of `votes` calls, cached). Throws when every judge is out of quota. */
async function judgeScenario(sc: LearnScenario, shown: ShownSuggestion[], notes: string[], votes: number, ctx: { endpoints: ReturnType<typeof judgeEndpoints>; spent: Set<string>; cache: Record<string, string> }): Promise<LearnVerdict[] | null> {
  if (shown.length === 0) return [];
  const persona = personas.find((p) => p.id === sc.persona)!;
  const partnerName = noteName(sc, sc.partnerId);
  const messages = learnJudgeMessages({
    today: EVAL_TODAY,
    lines: sc.lines.map((l) => ({ ...l, ...(l.speaker === "partner" && partnerName ? { partnerName } : {}) })),
    notes,
    expected: sc.expected.map((e) => ({ ...e, ...(e.noteId ? { oldText: persona.notes.find((n) => n.id === e.noteId)?.text } : {}) })),
    shown,
  });
  const sets = [];
  for (let v = 0; v < votes; v++) {
    const key = createHash("sha256").update(JSON.stringify({ LEARN_JUDGE_VERSION, messages, v })).digest("hex");
    ctx.cache[key] ??= (await judgeChat(messages, { endpoints: ctx.endpoints, spent: ctx.spent })).text;
    writeFileSync(CACHE, JSON.stringify(ctx.cache));
    sets.push(parseLearnVerdicts(ctx.cache[key], shown.length));
  }
  return voteLearn(sets);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs the model on each scenario and judges what it showed. Suggestions are saved even
 * when the judge fails (quota), and `--rejudge <results.json>` later judges only those,
 * so a split is never regenerated just because the judge ran out.
 */
async function main() {
  const rejudge = arg("rejudge");
  const split = (arg("split") ?? "dev") as "dev" | "test";
  const models = (arg("models") ?? "groq:qwen/qwen3.8-27b").split(",").map((m) => {
    const [provider, ...rest] = m.split(":");
    return { provider: provider as ProviderId, model: rest.join(":"), label: m };
  });
  const votes = Number(arg("votes") ?? (split === "test" ? 3 : 1));
  const delay = Number(arg("delay") ?? 3000);
  const only = arg("only");
  const ctx = { endpoints: judgeEndpoints(), spent: new Set<string>(), cache: loadCache() };
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync("eval/learning/results", { recursive: true });

  if (rejudge) {
    const results = JSON.parse(readFileSync(rejudge, "utf8")) as LearnScenarioResult[];
    for (const r of results) {
      if (r.error || r.verdicts !== null || !r.notes) continue;
      const sc = learnScenarios.find((s) => s.id === r.id)!;
      try {
        r.verdicts = await judgeScenario(sc, r.shown, r.notes, votes, ctx);
        delete r.judgeError;
      } catch (err) {
        r.judgeError = errorText(err);
      }
      console.log(`${r.model} ${r.id}: ${r.verdicts ? "judged" : `still unjudged (${r.judgeError})`}`);
    }
    writeFileSync(rejudge, JSON.stringify(results, null, 2));
    const table = learningMarkdown([summarizeLearning(results[0]?.model ?? "?", results)]);
    const splitName = rejudge.includes("-test-") ? "test" : "dev";
    writeFileSync(`eval/learning/results/latest-${splitName}.md`, `${splitName} split, ${votes} judge vote(s)

${table}
`);
    console.log(`
${table}`);
    return;
  }

  const scenarios = learnScenarios.filter((s) => s.split === split && (!only || s.id === only));
  const summaries = [];
  for (const m of models) {
    const results: LearnScenarioResult[] = [];
    for (const sc of scenarios) {
      let run: Awaited<ReturnType<typeof runScenario>>;
      try {
        run = await runScenario(sc, m.provider, m.model);
      } catch (err) {
        results.push({ id: sc.id, model: m.label, expected: sc.expected, shown: [], verdicts: null, ms: 0, error: errorText(err) });
        console.log(`${m.label} ${sc.id}: failed (${errorText(err)})`);
        await sleep(delay);
        continue;
      }
      const result: LearnScenarioResult = { id: sc.id, model: m.label, expected: sc.expected, shown: run.shown, notes: run.notes, verdicts: null, ms: run.ms };
      try {
        result.verdicts = await judgeScenario(sc, run.shown, run.notes, votes, ctx);
      } catch (err) {
        result.judgeError = errorText(err);
      }
      results.push(result);
      console.log(`${m.label} ${sc.id}: ${run.shown.length} shown, ${result.verdicts ? `${result.verdicts.filter((v) => v.keep).length} worth keeping` : `unjudged (${result.judgeError})`}`);
      await sleep(delay);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(`eval/learning/results/${stamp}-${split}-${m.label.replace(/[^a-z0-9.-]+/gi, "_")}.json`, JSON.stringify(results, null, 2));
    summaries.push(summarizeLearning(m.label, results));
  }
  const table = learningMarkdown(summaries);
  writeFileSync(`eval/learning/results/latest-${split}.md`, `${split} split, ${votes} judge vote(s)

${table}
`);
  console.log(`
${split} split, ${votes} judge vote(s)
`);
  console.log(table);
}

void main();
