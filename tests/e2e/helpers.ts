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
  // No voice server in tests unless a test asks for one: with Kokoro's download blocked too,
  // the app falls back to the (stubbed) browser speech engine as before.
  await page.route("**/api/speak**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await page.route("**/api/suggest", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", headers: { "x-onbeat-provider": "groq" }, body: MODEL_LINES }),
  );
  // No suggested notes unless a test asks for them.
  await page.route("**/api/learn", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposals: [] }) }));
  await page.route("**/api/notes-from-document", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        notes: [
          { kind: "preference", text: "I love chess." },
          { kind: "about-me", text: "I play online most evenings." },
        ],
        truncated: false,
      }),
    }),
  );
  await page.addInitScript((themeName) => {
    if (themeName) localStorage.setItem("onbeat:theme", themeName);
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    const rates: number[] = [];
    (window as unknown as { __rates: number[] }).__rates = rates;
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
        rates.push(u.rate);
        setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 30);
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  }, theme);
}

export async function startWithMaya(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo first" }).click();
  await page.getByRole("button", { name: /^Maya/ }).click();
  // At every width: below 640 px the place and person sit in the "Where and who" sheet.
  await expect(page.getByRole("heading", { name: "Replies" })).toBeAttached();
}

/** Types a line for the other person with "+ They said". */
export async function theySaid(page: Page, text: string) {
  await page.getByRole("button", { name: "They said", exact: true }).click();
  await page.getByLabel("What they said").fill(text);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}
