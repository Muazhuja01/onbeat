import { secondaryButton } from "./ui";

/** Shown in the top bar while a demo is open, so nobody mistakes the example person's notes for their own. The menu beside it names the demo. */
export function DemoChip({ onSetup }: { onSetup: () => void }) {
  return (
    <p className="flex items-center gap-3 text-label">
      <span className="rounded-full bg-cue px-3 py-1 font-bold text-on-cue">Demo</span>
      <span className="hidden 2xl:inline">Nothing you do here is saved.</span>
      {/* From 1440 px; below that the bar keeps to one row, and the menu offers "Set up your own profile". */}
      <button type="button" onClick={onSetup} className={`${secondaryButton} hidden min-[90rem]:inline-block`}>
        Set up your own
      </button>
    </p>
  );
}
