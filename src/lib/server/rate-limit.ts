export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    check(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const k of hits.keys()) {
          hits.delete(k);
          if (hits.size <= 4000) break;
        }
      }
      return true;
    },
  };
}
