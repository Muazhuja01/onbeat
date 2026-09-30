import { secondaryButton } from "./ui";

/** Shown while a demo is open, so nobody mistakes the example person's notes for their own. */
export function DemoBar({ name, onSetup }: { name: string; onSetup: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-control border-2 border-ink/30 px-4 py-3">
      <p className="text-body">
        <strong>Demo: {name}.</strong> Nothing you do here is saved.
      </p>
      <button type="button" onClick={onSetup} className={secondaryButton}>
        Set up your own
      </button>
    </div>
  );
}
