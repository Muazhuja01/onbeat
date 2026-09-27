import { detectPersist } from "./idb-persist";
import { MemoryStore } from "./store";
import { createBrowserEmbedder } from "./worker-embedder";

let memory: Promise<MemoryStore> | null = null;

export function getBrowserMemory(): Promise<MemoryStore> {
  memory ??= detectPersist().then((persist) => MemoryStore.create({ persist, embedder: createBrowserEmbedder() }));
  return memory;
}
