import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// @testing-library/react's own auto-cleanup only registers when a global
// `afterEach` exists (e.g. with `test.globals: true`). This project imports
// `afterEach` per-file instead, so register cleanup explicitly here.
afterEach(() => {
  cleanup();
});

// jsdom has no showModal/close. Enough of them for components built on <dialog>:
// open the dialog, move focus into it like a browser does, and fire "close" when it closes.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  const focusFirst = (dialog: HTMLDialogElement) =>
    dialog.querySelector<HTMLElement>("[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
    focusFirst(this);
  };
  HTMLDialogElement.prototype.show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, value?: string) {
    if (!this.open) return;
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    this.dispatchEvent(new Event("close"));
  };
}
