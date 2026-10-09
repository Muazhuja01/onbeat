import type { ReactNode } from "react";

/** The card at the bottom of the conversation: replies, then the type row. Docked to the bottom edge below 1024 px. */
export function Tray({ children }: { children: ReactNode }) {
  return (
    <div className="tray flex shrink-0 flex-col gap-3 rounded-[1.375rem] border-2 border-edge bg-surface p-3 shadow-tray sm:p-4 max-lg:-mx-4 max-lg:rounded-b-none max-lg:border-x-0 max-lg:border-b-0 max-lg:pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      {children}
    </div>
  );
}
