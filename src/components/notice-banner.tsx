import { Info, X } from "@phosphor-icons/react";

/** A screen-wide notice under the top bar. Ones that can be dismissed have a close button. */
export function Notice({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-control border-2 border-edge bg-surface py-2 pr-2 pl-4 text-body shadow-lift">
      <Info aria-hidden="true" size={20} className="shrink-0 text-muted" />
      <p className="min-w-0 flex-1 py-1 [overflow-wrap:anywhere]">{text}</p>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-ground">
          <X aria-hidden="true" size={20} weight="bold" />
        </button>
      )}
    </div>
  );
}
