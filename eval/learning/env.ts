import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

/**
 * Loads API keys the way the other evals do (.env.local in the working directory). A git
 * worktree has no copy of that file, so fall back to the main checkout's. Keys only go
 * into this process's environment; nothing prints them.
 */
export function loadLocalEnv(): void {
  const candidates = [".env.local"];
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    candidates.push(join(dirname(resolve(common)), ".env.local"));
  } catch {
    // Not in a git checkout: only the working directory counts.
  }
  for (const file of candidates) {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      // Try the next place; keys can also come from the environment.
    }
  }
}
