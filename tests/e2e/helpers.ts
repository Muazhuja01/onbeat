import { expect, type Page } from "@playwright/test";

const MODEL_LINES = [
  '{"reply": "Large, please.", "notes": []}',
  '{"reply": "Hi Sam, my usual please.", "notes": ["m-sam"]}',
  '{"reply": "What sizes do you have?", "notes": []}',
  '{"reactions": ["mm-hmm", "thanks"]}',
].join("\n");

export async function prepare(page: Page, theme?: string) {
  // No model downloads in tests: the embedder falls back to text search and
  // the voice falls back to the (stubbed) browser speech engine.
  await page.route(/huggingface\.co|hf\.co|cdn-lfs/, (route) => route.abort());
  await page.route("**/api/suggest", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", headers: { "x-onbeat-provider": "groq" }, body: MODEL_LINES }),
  );
  await page.addInitScript((themeName) => {
    if (themeName) localStorage.setItem("onbeat:theme", themeName);
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [],
      cancel() {},
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
      speak(u: SpeechSynthesisUtterance) {
        spoken.push(u.text);
        setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 30);
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  }, theme);
}

export async function startWithMaya(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Maya/ }).click();
  await expect(page.getByLabel("Place")).toHaveValue("m-cafe");
}
