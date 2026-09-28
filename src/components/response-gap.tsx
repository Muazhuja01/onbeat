import { percentile } from "@/lib/stats";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Reply timer for demos and measurements; shown when the page URL has ?timer. */
export function ResponseGap({ gaps }: { gaps: number[] }) {
  if (gaps.length === 0) return <p className="text-label text-muted">Reply timer: waiting for the first turn.</p>;
  const last = gaps[gaps.length - 1];
  const median = percentile(gaps, 50) ?? last;
  return (
    <p className="text-label text-muted tabular-nums">
      Replies were ready {seconds(last)} after they stopped. Median {seconds(median)} over {gaps.length} {gaps.length === 1 ? "turn" : "turns"}.
    </p>
  );
}
