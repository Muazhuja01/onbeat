/**
 * The assistant is hidden until its eval meets the release targets (eval/assist/RESULTS.md).
 * Set NEXT_PUBLIC_ASSISTANT=1 at build time to show it; the end-to-end tests do.
 */
export const ASSISTANT_ENABLED = process.env.NEXT_PUBLIC_ASSISTANT === "1";
