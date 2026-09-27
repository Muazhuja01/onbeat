import { createStore, get, set } from "idb-keyval";
import { memoryPersist, type Persist, type Snapshot } from "./persist";

const KEY = "snapshot";

export function idbPersist(): Persist {
  const store = createStore("onbeat", "memory");
  return {
    durable: true,
    async load() {
      return (await get<Snapshot>(KEY, store)) ?? null;
    },
    async save(snapshot) {
      await set(KEY, snapshot, store);
    },
  };
}

/** IndexedDB when available (not in some private windows), otherwise session memory. */
export async function detectPersist(): Promise<Persist> {
  try {
    const p = idbPersist();
    await p.load();
    return p;
  } catch {
    return memoryPersist();
  }
}
