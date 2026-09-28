import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Judge answers on disk, keyed by scenario, the exact replies shown, the judge model
 * and the prompt version, so a rerun only asks the judge about replies it hasn't seen.
 * Written on every set, so an interrupted run keeps what it paid for.
 */
export class JudgeCache {
  private entries: Record<string, string>;

  constructor(private readonly file: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      this.entries = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      this.entries = {};
    }
  }

  static key(p: { scenarioId: string; candidates: string[]; model: string; version: number }): string {
    return createHash("sha256").update(JSON.stringify([p.scenarioId, p.candidates, p.model, p.version])).digest("hex");
  }

  get(key: string): string | undefined {
    return this.entries[key];
  }

  set(key: string, text: string): void {
    this.entries[key] = text;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(this.entries)}\n`);
  }
}
