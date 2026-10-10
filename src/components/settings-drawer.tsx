"use client";

import { GearSix } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { SettingsPanel } from "./settings-panel";
import { Sheet } from "./sheet";

/** The gear in the top bar. */
export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Settings"
      onClick={onOpen}
      className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-edge bg-raised shadow-lift transition-[border-color] duration-150 hover:border-ink"
    >
      <GearSix aria-hidden="true" size={22} />
    </button>
  );
}

/** Settings in a panel from the right edge. */
export function SettingsDrawer({ open, onClose, ...panel }: { open: boolean; onClose: () => void } & ComponentProps<typeof SettingsPanel>) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings" side="right" closeLabel="Close settings">
      <SettingsPanel {...panel} />
    </Sheet>
  );
}
