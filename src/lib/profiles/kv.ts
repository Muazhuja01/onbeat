import { createStore, del, get, set } from "idb-keyval";

/** The few storage calls profiles need, so tests can run on a plain map. */
export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export function memoryKeyValue(): KeyValue {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.has(key) ? (structuredClone(map.get(key)) as T) : undefined;
    },
    async set(key, value) {
      map.set(key, structuredClone(value));
    },
    async del(key) {
      map.delete(key);
    },
  };
}

/** The database and store OnBeat has always used; a new store would need a version change. */
export function idbKeyValue(): KeyValue {
  const store = createStore("onbeat", "memory");
  return {
    get: <T,>(key: string) => get<T>(key, store),
    set: (key, value) => set(key, value, store),
    del: (key) => del(key, store),
  };
}
