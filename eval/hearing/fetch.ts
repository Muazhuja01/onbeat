/**
 * Downloads the hearing test set into eval/hearing/.cache (git-ignored):
 * real speech with transcripts from AMI (meetings, room microphone) and
 * Common Voice (many speakers and accents, their own microphones), and real
 * background noise from DEMAND. Clips are picked with a fixed seed, so every
 * run gets the same set. Dev comes from each corpus's validation split and
 * test from its test split.
 *
 *   npx tsx eval/hearing/fetch.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, type Clip, type Split } from "./clips";
import { normalizeWords } from "./score";

const PER_SOURCE = 100;
const ROWS = "https://datasets-server.huggingface.co/rows";

interface Source {
  name: Clip["source"];
  dataset: string;
  config: string;
  splits: Record<Split, string>;
  maxPerSpeaker: number;
  pick: (row: Record<string, unknown>) => { text: string; speaker: string } | null;
}

const SOURCES: Source[] = [
  {
    name: "ami",
    dataset: "edinburghcstr/ami",
    config: "sdm",
    splits: { dev: "validation", test: "test" },
    maxPerSpeaker: 8,
    pick: (r) => {
      const seconds = (r.end_time as number) - (r.begin_time as number);
      const text = r.text as string;
      // Short turns a partner might say, with at least a few real words.
      if (seconds < 1 || seconds > 8 || normalizeWords(text).length < 3) return null;
      return { text, speaker: r.speaker_id as string };
    },
  },
  {
    name: "cv",
    dataset: "fixie-ai/common_voice_17_0",
    config: "en",
    splits: { dev: "validation", test: "test" },
    maxPerSpeaker: 2,
    pick: (r) => {
      if ((r.down_votes as number) > 0 || (r.up_votes as number) < 2) return null;
      return { text: r.sentence as string, speaker: r.client_id as string };
    },
  },
];

const NOISES = ["PCAFETER", "SPSQUARE", "STRAFFIC"];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The dataset viewer rate-limits; pace requests and wait as long as it asks. */
async function getJson(url: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    await sleep(500);
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as Record<string, unknown>;
    if (attempt >= 6) throw new Error(`${res.status} for ${url}`);
    const asked = Number(res.headers.get("retry-after"));
    await sleep(asked > 0 ? asked * 1000 : 10_000 * 2 ** attempt);
  }
}

async function fetchSource(src: Source, split: Split, seed: number): Promise<Clip[]> {
  const base = `${ROWS}?dataset=${encodeURIComponent(src.dataset)}&config=${src.config}&split=${src.splits[split]}`;
  const total = (await getJson(`${base}&offset=0&length=1`)).num_rows_total as number;
  const random = rng(seed);
  const dir = join(CACHE, src.name, split);
  mkdirSync(dir, { recursive: true });
  const clips: Clip[] = [];
  const perSpeaker = new Map<string, number>();
  const seen = new Set<number>();
  // Short random pages spread the picks across the whole split.
  for (let page = 0; clips.length < PER_SOURCE && page < 200; page++) {
    const offset = Math.floor(random() * Math.max(1, total - 20));
    if (seen.has(offset)) continue;
    seen.add(offset);
    const rows = (await getJson(`${base}&offset=${offset}&length=20`)).rows as { row_idx: number; row: Record<string, unknown> }[];
    for (const { row_idx, row } of rows) {
      if (clips.length >= PER_SOURCE) break;
      const picked = src.pick(row);
      if (!picked) continue;
      const count = perSpeaker.get(picked.speaker) ?? 0;
      if (count >= src.maxPerSpeaker) continue;
      const id = `${src.name}-${split}-${row_idx}`;
      if (clips.some((c) => c.id === id)) continue;
      const audio = row.audio as { src: string }[] | { src: string };
      const url = Array.isArray(audio) ? audio[0].src : audio.src;
      const file = join(dir, `${row_idx}.wav`);
      if (!existsSync(file)) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} downloading ${id}`);
        writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
      }
      perSpeaker.set(picked.speaker, count + 1);
      clips.push({ id, source: src.name, split, text: picked.text, speaker: picked.speaker, file });
    }
  }
  console.log(`${src.name} ${split}: ${clips.length} clips from ${perSpeaker.size} speakers`);
  return clips;
}

async function fetchNoise(name: string): Promise<void> {
  const dir = join(CACHE, "noise");
  const out = join(dir, `${name}.wav`);
  if (existsSync(out)) return;
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, `${name}_16k.zip`);
  const url = `https://zenodo.org/api/records/1227121/files/${name}_16k.zip/content`;
  console.log(`downloading ${name} noise…`);
  // Zenodo turns away requests without a named client.
  const res = await fetch(url, { headers: { "User-Agent": "onbeat-hearing-eval/1.0" } });
  if (!res.ok) throw new Error(`${res.status} downloading ${name} noise`);
  writeFileSync(zip, new Uint8Array(await res.arrayBuffer()));
  // Channel 1 of the 16-channel array is one ordinary microphone.
  execFileSync("unzip", ["-o", "-j", zip, `${name}/ch01.wav`, "-d", dir]);
  execFileSync("mv", [join(dir, "ch01.wav"), out]);
  execFileSync("rm", [zip]);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  for (const n of NOISES) await fetchNoise(n);
  const clips: Clip[] = [];
  for (const [i, src] of SOURCES.entries()) {
    clips.push(...(await fetchSource(src, "dev", 1000 + i)), ...(await fetchSource(src, "test", 2000 + i)));
  }
  writeFileSync(join(CACHE, "clips.json"), JSON.stringify(clips, null, 1));
  console.log(`${clips.length} clips saved to ${CACHE}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
