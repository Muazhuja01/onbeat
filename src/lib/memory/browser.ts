import type { Persona } from "@/data/personas";
import { openBrowserRegistry, type ProfileRegistry } from "@/lib/profiles/registry";
import { MemoryStore } from "./store";
import { createBrowserEmbedder, type WorkerEmbedder } from "./worker-embedder";

let registry: Promise<ProfileRegistry> | null = null;
let embedder: WorkerEmbedder | null | undefined;

/** One embedding worker for every profile opened in this tab. */
function sharedEmbedder(): WorkerEmbedder | null {
  if (embedder === undefined) embedder = createBrowserEmbedder();
  return embedder;
}

export function getBrowserRegistry(): Promise<ProfileRegistry> {
  registry ??= openBrowserRegistry();
  return registry;
}

export function openProfileMemory(reg: ProfileRegistry, id: string): Promise<MemoryStore> {
  return MemoryStore.create({ persist: reg.persistFor(id), embedder: sharedEmbedder() });
}

/** An example person's notes in memory only: a demo is never saved. */
export async function openDemoMemory(persona: Persona): Promise<MemoryStore> {
  const store = await MemoryStore.create({ embedder: sharedEmbedder() });
  await store.replaceAll(persona.notes, persona.phrases);
  return store;
}
