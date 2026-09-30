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

test("clearer captions replace each finished line with the cloud's text", async ({ page }) => {
  await page.route(/Kokoro|all-MiniLM/, (route) => route.abort());
  const bodies: Buffer[] = [];
  await page.route("**/api/transcribe", async (route) => {
    bodies.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Cloud caption number one." }) });
  });
  await page.addInitScript(() => localStorage.setItem("onbeat:cloud-captions", "on"));
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo first" }).click();
  await page.getByRole("button", { name: /^Maya/ }).click();
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByText("Listening. Their words appear in the conversation.")).toBeVisible({ timeout: 300_000 });
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText("Cloud caption number one.", { timeout: 60_000 });
  const first = bodies[0];
  expect(first.subarray(0, 4).toString()).toBe("RIFF");
  // 16 kHz, 16-bit mono: at least a quarter second of speech.
  expect(first.byteLength).toBeGreaterThan(44 + 16000 * 2 * 0.25);
});
