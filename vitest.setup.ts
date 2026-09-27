import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// @testing-library/react's own auto-cleanup only registers when a global
// `afterEach` exists (e.g. with `test.globals: true`). This project imports
// `afterEach` per-file instead, so register cleanup explicitly here.
afterEach(() => {
  cleanup();
});
