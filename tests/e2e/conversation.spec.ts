import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MODEL_LINES = [
  '{"reply": "Large, please.", "notes": []}',
  '{"reply": "Hi Sam, my usual please.", "notes": ["m-sam"]}',
  '{"reply": "What sizes do you have?", "notes": []}',
  '{"reactions": ["mm-hmm", "thanks"]}',
].join("\n");

async function prepare(page: Page, theme?: string) {
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

async function startWithMaya(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Maya/ }).click();
  await expect(page.getByLabel("Place")).toHaveValue("m-cafe");
}

test("a partner line produces checked replies that can be spoken", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByLabel("What they said").fill("What size would you like?");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.locator("#replies").getByText("Replies ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hi Sam, my usual please." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();

  await page.locator("body").click();
  await page.keyboard.press("1");
  await expect(page.getByRole("region", { name: "What you said" })).toContainText("Large, please.");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain("Large, please.");
});

test("typing shows matching past phrases immediately", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByLabel("Type a reply").fill("my us");
  await expect(page.getByRole("button", { name: /My usual, please\./ })).toBeVisible();
});

test("the skip link moves focus to the replies", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to replies" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#replies")).toBeFocused();
});

for (const theme of [undefined, "dark", "contrast"]) {
  test(`no accessibility violations (${theme ?? "light"})`, async ({ page }) => {
    await prepare(page, theme);
    await page.goto("/");
    const picker = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(picker.violations).toEqual([]);

    await page.getByRole("button", { name: /^Maya/ }).click();
    await page.getByLabel("What they said").fill("What size would you like?");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("#replies").getByText("Replies ready")).toBeVisible();
    const conversation = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(conversation.violations).toEqual([]);
  });
}

test("no horizontal scrolling at 320 px", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await startWithMaya(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("reduced motion makes transitions instant", async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startWithMaya(page);
  const duration = await page.getByRole("button", { name: "Example profiles" }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
