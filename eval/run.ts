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
import { withRetry } from "./retry";
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
  let firstReplyMs = null as number | null;
  let started = performance.now();
  try {
    // Generous timeouts: the eval measures latency instead of falling back. started is
    // reset on every attempt so a rate-limit wait between retries never counts as latency.
    const { deltas } = await withRetry(sc.id, async (cooldown) => {
      started = performance.now();
      return streamCompletion(buildMessages(body), { order: [provider], configs, firstTokenTimeoutMs: 10_000, idleTimeoutMs: 10_000, cooldown });
    });
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
