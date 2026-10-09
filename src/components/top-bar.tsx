import type { ReactNode } from "react";

/** The bar along the top of every screen: the mark, then `start`, with `end` pushed to the right. `below` is a second row. */
export function TopBar({ start, end, below }: { start?: ReactNode; end?: ReactNode; below?: ReactNode }) {
  return (
    <header className="border-b border-edge bg-surface">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
        <p className="mr-2 flex items-center gap-2 text-2xl font-extrabold tracking-tight" translate="no">
          <span aria-hidden="true" className="size-3 rounded-full bg-cue shadow-[0_0_0_3px_color-mix(in_srgb,var(--cue)_25%,transparent)]" />
          OnBeat
        </p>
        {start}
        <div className="ml-auto flex items-center gap-2">{end}</div>
      </div>
      {below}
    </header>
  );
}
