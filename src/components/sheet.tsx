"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "bottom" slides up from the bottom edge (phones); "right" is a side panel. */
  side?: "bottom" | "right";
  /** The close button's accessible name, e.g. "Close settings". */
  closeLabel: string;
  children: ReactNode;
}

/**
 * A modal panel on a native <dialog>: focus stays inside, the page behind is inert, and
 * Escape, the close button or the backdrop close it. Focus goes back to what opened it.
 */
export function Sheet({ open, onClose, title, side = "bottom", closeLabel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`sheet ${side === "right" ? "sheet-right" : "sheet-bottom"}`}
      onClose={() => {
        // Only when focus would otherwise be lost: something opened from inside may have taken it.
        const active = document.activeElement;
        if (!active || active === document.body || ref.current?.contains(active)) opener.current?.focus();
        opener.current = null;
        onCloseRef.current();
      }}
      onKeyDown={(e) => {
        // Handled here, not by the browser, so the screen's own Escape (stop speaking, clear the box) doesn't run too.
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        ref.current?.close();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself, but so does one on its own
        // padding or empty space. Only a click outside the dialog's box is a backdrop click.
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) ref.current?.close();
      }}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          {side === "bottom" && <div aria-hidden="true" data-handle className="mx-auto -mt-2 h-1.5 w-10 rounded-full bg-muted/40" />}
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-reply font-bold">
              {title}
            </h2>
            <button
              type="button"
              aria-label={closeLabel}
              onClick={() => ref.current?.close()}
              className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-edge bg-raised transition-[border-color] duration-150 hover:border-ink"
            >
              <X aria-hidden="true" size={22} weight="bold" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
