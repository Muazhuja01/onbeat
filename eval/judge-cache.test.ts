// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JudgeCache } from "./judge-cache";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-cache-"));
  dirs.push(dir);
  return join(dir, "nested", "cache.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("JudgeCache", () => {
  it("keys on scenario, exact reply texts, model and prompt version", () => {
    const base = { scenarioId: "maya-01", candidates: ["Yes.", "No."], model: "m", version: 2 };
    const k = JudgeCache.key(base);
    expect(JudgeCache.key({ ...base })).toBe(k);
    expect(JudgeCache.key({ ...base, candidates: ["No.", "Yes."] })).not.toBe(k);
    expect(JudgeCache.key({ ...base, scenarioId: "maya-02" })).not.toBe(k);
    expect(JudgeCache.key({ ...base, model: "n" })).not.toBe(k);
    expect(JudgeCache.key({ ...base, version: 3 })).not.toBe(k);
  });

  it("stores answers on disk and reads them back in a new instance", () => {
    const file = tempFile();
    const a = new JudgeCache(file);
    expect(a.get("k")).toBeUndefined();
    a.set("k", '{"match": 1}');
    expect(new JudgeCache(file).get("k")).toBe('{"match": 1}');
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ k: '{"match": 1}' });
  });

  it("starts empty when the file is missing or broken", () => {
    const file = tempFile();
    expect(new JudgeCache(file).get("k")).toBeUndefined();
  });
});
