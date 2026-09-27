import type { Note, Phrase } from "@/lib/types";

export interface Snapshot {
  version: 1;
  notes: Note[];
  phrases: Phrase[];
}

export interface Persist {
  /** False when data only lives for this session. */
  readonly durable: boolean;
  load(): Promise<Snapshot | null>;
  save(snapshot: Snapshot): Promise<void>;
}

export function memoryPersist(): Persist {
  let snap: Snapshot | null = null;
  return {
    durable: false,
    async load() {
      return snap ? structuredClone(snap) : null;
    },
    async save(s) {
      snap = structuredClone(s);
    },
  };
}
