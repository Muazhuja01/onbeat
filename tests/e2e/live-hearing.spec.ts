import path from "node:path";
import { expect, test } from "@playwright/test";

const wav = path.resolve("tests/fixtures/partner.wav");

test.skip(!process.env.ONBEAT_LIVE, "Downloads real models and calls the real API. Run with ONBEAT_LIVE=1.");
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`],
  },
  permissions: ["microphone"],
});
test.setTimeout(420_000);

test("hears the partner, captions them and times the replies", async ({ page }) => {
  // Only speech recognition is under test: skip the voice and search model downloads.
  await page.route(/Kokoro|all-MiniLM/, (route) => route.abort());
  await page.goto("/?timer");
  await page.getByRole("button", { name: "Try a demo first" }).click();
  await page.getByRole("button", { name: /^Maya/ }).click();
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByText("Listening. Their words appear in the conversation.")).toBeVisible({ timeout: 300_000 });
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText(/size/i, { timeout: 60_000 });
  // The fixture loops, so the partner keeps asking; collect a few turns.
  await expect
    .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("onbeat:gaps") ?? "[]") as number[]).length), { timeout: 180_000 })
    .toBeGreaterThanOrEqual(10);
  const gaps = await page.evaluate(() => JSON.parse(localStorage.getItem("onbeat:gaps") ?? "[]") as number[]);
  const captions = await page.getByRole("region", { name: "Conversation" }).innerText();
  console.log(`response gaps (ms): ${gaps.join(", ")}`);
  console.log(`captions:\n${captions}`);
});
