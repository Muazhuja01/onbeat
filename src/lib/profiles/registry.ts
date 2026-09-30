import { learningKeys } from "@/lib/learning/keys";
import type { Persist, Snapshot } from "@/lib/memory/persist";
import { idbKeyValue, memoryKeyValue, type KeyValue } from "./kv";

export interface ProfileInfo {
  id: string;
  name: string;
  createdAt: number;
}

interface RegistryState {
  version: 1;
  activeId: string | null;
  profiles: ProfileInfo[];
}

const LIST_KEY = "profiles";
/** Before profiles, one snapshot held everything, and it only ever came from the example people. */
const OLD_KEY = "snapshot";
export const NAME_MAX = 40;

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX).trim();
}

/** The saved profiles, which one is open, and each profile's notes and phrases under its own key. */
export class ProfileRegistry {
  private constructor(
    private readonly kv: KeyValue,
    private state: RegistryState,
    readonly durable: boolean,
    private readonly now: () => number,
  ) {}

  static async open(kv: KeyValue, opts: { durable?: boolean; now?: () => number } = {}): Promise<ProfileRegistry> {
    const state = (await kv.get<RegistryState>(LIST_KEY)) ?? { version: 1, activeId: null, profiles: [] };
    await kv.del(OLD_KEY);
    return new ProfileRegistry(kv, state, opts.durable ?? true, opts.now ?? Date.now);
  }

  list(): ProfileInfo[] {
    return [...this.state.profiles];
  }

  active(): ProfileInfo | null {
    return this.state.profiles.find((p) => p.id === this.state.activeId) ?? null;
  }

  /** The storage profiles use. Learning keeps each profile's queue and suggestions here too. */
  get keyValue(): KeyValue {
    return this.kv;
  }

  async create(name: string): Promise<ProfileInfo> {
    const clean = cleanName(name);
    if (!clean) throw new Error("A profile needs a name");
    const profile = { id: crypto.randomUUID(), name: clean, createdAt: this.now() };
    await this.write({ ...this.state, activeId: profile.id, profiles: [...this.state.profiles, profile] });
    return profile;
  }

  async rename(id: string, name: string): Promise<void> {
    const clean = cleanName(name);
    if (!clean) throw new Error("A profile needs a name");
    await this.write({ ...this.state, profiles: this.state.profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) });
  }

  async remove(id: string): Promise<void> {
    const profiles = this.state.profiles.filter((p) => p.id !== id);
    const activeId = this.state.activeId === id ? (profiles[0]?.id ?? null) : this.state.activeId;
    await this.kv.del(`profile:${id}`);
    for (const key of learningKeys(id)) await this.kv.del(key);
    await this.write({ ...this.state, activeId, profiles });
  }

  async setActive(id: string): Promise<void> {
    if (!this.state.profiles.some((p) => p.id === id)) return;
    await this.write({ ...this.state, activeId: id });
  }

  persistFor(id: string): Persist {
    const key = `profile:${id}`;
    return {
      durable: this.durable,
      load: async () => (await this.kv.get<Snapshot>(key)) ?? null,
      save: (snapshot) => this.kv.set(key, snapshot),
    };
  }

  uniqueName(name: string): string {
    const clean = cleanName(name) || "Profile";
    const taken = new Set(this.state.profiles.map((p) => p.name.toLowerCase()));
    if (!taken.has(clean.toLowerCase())) return clean;
    for (let n = 2; ; n++) {
      const candidate = `${clean} (${n})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private async write(state: RegistryState): Promise<void> {
    await this.kv.set(LIST_KEY, state);
    this.state = state;
  }
}

/** IndexedDB when it works (not in some private windows), otherwise memory for this visit. */
export async function openBrowserRegistry(): Promise<ProfileRegistry> {
  try {
    return await ProfileRegistry.open(idbKeyValue());
  } catch {
    return ProfileRegistry.open(memoryKeyValue(), { durable: false });
  }
}
