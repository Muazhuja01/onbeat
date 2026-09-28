import { en } from "@/lib/language-packs/en";
import { HearingEngine, type Hearing } from "./engine";
import { openMic } from "./mic";

declare global {
  interface Window {
    /** End-to-end tests install a fake here before the app loads (tests/e2e/listening.spec.ts). */
    __onbeatHearing?: Hearing;
  }
}

let engine: Hearing | null = null;

export function getBrowserHearing(): Hearing {
  if (typeof window !== "undefined" && window.__onbeatHearing) return window.__onbeatHearing;
  engine ??= new HearingEngine({
    createWorker: () =>
      typeof Worker === "undefined"
        ? null
        : new Worker(new URL("../../workers/hearing.worker.ts", import.meta.url), { type: "module" }),
    openMic,
    model: en.asrModel,
  });
  return engine;
}
