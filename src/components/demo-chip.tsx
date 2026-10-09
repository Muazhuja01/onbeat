import { secondaryButton } from "./ui";

/** Shown in the top bar while a demo is open, so nobody mistakes the example person's notes for their own. */
export function DemoChip({ name, onSetup }: { name: string; onSetup: () => void }) {
  return (
    <p className="flex items-center gap-3 text-label">
      <span className="rounded-full bg-cue px-3 py-1 font-bold text-on-cue">Demo: {name}</span>
      <span className="hidden 2xl:inline">Nothing you do here is saved.</span>
      <button type="button" onClick={onSetup} className={secondaryButton}>
        Set up your own
      </button>
    </p>
  );
}
