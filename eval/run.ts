import { mkdirSync, writeFileSync } from "node:fs";
import { personas } from "@/data/personas";
import { en } from "@/lib/language-packs/en";
import { MemoryStore } from "@/lib/memory/store";
import { checkReply } from "@/lib/server/claim-check";
import { groqExtraBody, providerConfigs, streamCompletion, type ProviderId } from "@/lib/server/providers";
import { buildMessages } from "@/lib/suggest/prompt";
import { createObjectSplitter, parseLine } from "@/lib/suggest/protocol";
import { buildSuggestRequest } from "@/lib/suggest/request";
import { isNearDuplicate, validateReply } from "@/lib/suggest/validate";
import { judge, judgeEndpoints, JUDGE_PROMPT_VERSION, type JudgeEndpoint } from "./judge";
import { JudgeCache, judgeWithCache } from "./judge-cache";
import { withRetry } from "./retry";
import { scenarios, type Scenario } from "./scenarios";
import { testScenarios } from "./test-scenarios";
import { judgedByPhrase, keystrokesSaved, parseJudgement, summarize, toMarkdown, type Judgement, type ScenarioResult } from "./score";

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

async function runScenario(sc: Scenario, provider: ProviderId, model: string, endpoints: JudgeEndpoint[], cache: JudgeCache, spent: Set<string>, claimCheck: boolean): Promise<ScenarioResult> {
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
  let raw = "";
  let rawReplies = 0;
  let blocked = 0;
  let checkBlocked = 0;
  let firstReplyMs = null as number | null;
  let started = performance.now();
  try {
    // Generous timeouts: the eval measures latency instead of falling back. started is
    // reset on every attempt so a rate-limit wait between retries never counts as latency.
    const { deltas } = await withRetry(sc.id, async (cooldown) => {
      started = performance.now();
      return streamCompletion(buildMessages(body), { order: [provider], configs, firstTokenTimeoutMs: 10_000, idleTimeoutMs: 10_000, cooldown });
    });
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
  } catch (err) {
    return {
      id: sc.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      shown,
      rawReplies,
      blocked,
      checkBlocked,
      judgement: null,
      keystrokesSaved: 0,
      noteRecall: false,
      firstReplyMs: null,
      totalMs: null,
    };
  }
  const totalMs = performance.now() - started;

  let judgement: Judgement | null = { match: 0, invented: [], unbacked: [] };
  let judgedBy: string | undefined;
  if (shown.length) {
    const input = { intended: sc.intended, partnerSaid: sc.partnerSaid, typed, contextLine: body.contextLine, notes: body.notes.map((n) => n.text), phrases: body.examples, candidates: shown };
    try {
      ({ judgement, judgedBy } = await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, () => judge(input, { endpoints, spent }), (text) => parseJudgement(text, shown.length)));
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
    checkBlocked,
    judgement,
    keystrokesSaved: keystrokesSaved(sc.intended, typed, (judgement?.match ?? 0) > 0),
    noteRecall: sc.noteIds.every((id) => sentIds.has(id)),
    firstReplyMs,
    totalMs,
    ...(shown.length === 0 ? { raw: raw.slice(0, 2000) } : {}),
    ...(judgedBy ? { judgedBy } : {}),
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
  const endpoints = judgeEndpoints();
  if (endpoints.length === 0) throw new Error("No judge endpoint: set GROQ_API_KEY (and optionally the Cloudflare keys) in .env.local.");
  const claimCheck = process.argv.includes("--claim-check");
  const set = arg("set") ?? "dev";
  if (set !== "dev" && set !== "test") throw new Error(`Unknown set "${set}". Use --set dev or --set test.`);
  const pool = set === "test" ? testScenarios : scenarios;
  const chosen = pool.filter((s) => !persona || s.persona === persona).slice(0, limit);

  const cache = new JudgeCache("eval/results/judge-cache.json");
  const spent = new Set<string>();
  const summaries = [];
  const results: Record<string, ScenarioResult[]> = {};
  for (const { provider, model } of models) {
    const name = `${provider}:${model}`;
    console.log(`\n${name} (${chosen.length} scenarios)`);
    const list: ScenarioResult[] = [];
    for (const sc of chosen) {
      const spentBefore = new Set(spent);
      const r = await runScenario(sc, provider, model, endpoints, cache, spent, claimCheck);
      list.push(r);
      for (const ep of spent) {
        if (!spentBefore.has(ep)) console.log(`  judge: ${ep} is out of quota, using the next judge for the rest of the run`);
      }
      console.log(`  ${sc.id}: ${r.ok ? `${r.shown.length} shown, match ${r.judgement?.match ?? "?"}${r.shown.length === 0 ? " (empty)" : ""}` : `failed (${r.error})`}`);
      await sleep(delay);
    }
    results[name] = list;
    summaries.push(summarize(name, list));
  }

  const table = toMarkdown(summaries);
  console.log(`\n${table}`);
  mkdirSync("eval/results", { recursive: true });
  const ranAt = new Date().toISOString();
  writeFileSync(`eval/results/latest-${set}.json`, `${JSON.stringify({ ranAt, set, judgeModel, summaries, results }, null, 2)}\n`);
  writeFileSync(
    `eval/results/latest-${set}.md`,
    `# Eval results\n\nRun ${ranAt.slice(0, 10)}, ${set} set, ${chosen.length} scenarios per model, judged by ${judgedByPhrase(Object.values(results).flat())}${claimCheck ? " with the claim check" : ""}. Generated by \`npm run eval -- --set ${set}\`.\n\n${table}\n`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
