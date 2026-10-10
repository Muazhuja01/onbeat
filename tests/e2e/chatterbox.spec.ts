import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

/** 0.1 s of silence as 24 kHz 16-bit mono WAV. */
function silence(): Buffer {
  const n = 2400;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

async function voiceServer(page: Page, speak: "ok" | "fail") {
  const bodies: { text: string; voice: string; speed: number }[] = [];
  await page.route("**/api/speak**", async (route) => {
    if (route.request().url().includes("warm=1")) return route.fulfill({ status: 204 });
    bodies.push(route.request().postDataJSON());
    return speak === "ok" ? route.fulfill({ status: 200, contentType: "audio/wav", body: silence() }) : route.fulfill({ status: 503, body: "{}" });
  });
  return bodies;
}

async function setUpTom(page: Page) {
  await page.getByLabel("What's your name?").fill("Tom");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("radio", { name: "Male", exact: true }).check();
}

test("the picker offers the Chatterbox voices, and lines are made by the voice server", async ({ page }) => {
  await prepare(page);
  const bodies = await voiceServer(page, "ok");
  await page.goto("/");
  await setUpTom(page);
  await expect(page.getByRole("radio", { name: "Canadian" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Deep" })).toBeChecked();
  await page.getByRole("button", { name: "Play a sample" }).click();
  await expect.poll(() => bodies.map((b) => b.voice)).toContain("m_us_deep");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByLabel("Type a reply").fill("Hello there");
  await page.keyboard.press("Enter");
  await expect.poll(() => bodies.map((b) => b.text)).toContain("Hello there");
  expect(await spoken(page)).not.toContain("Hello there");
  // Your own voice is ready, so there is nothing to say about it.
  for (const text of ["Waking your voice…", "Using the backup voice.", "Using the basic voice."]) {
    await expect(page.getByText(text)).toHaveCount(0);
  }
});

test("when the voice server fails a line, the device voice says it and the screen says so", async ({ page }) => {
  await prepare(page);
  await voiceServer(page, "fail");
  await page.goto("/");
  await setUpTom(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByLabel("Type a reply").fill("Hello there");
  await page.keyboard.press("Enter");
  await expect.poll(() => spoken(page)).toContain("Hello there");
  await expect(page.getByText("Said in your device's voice: yours wasn't ready in time.")).toBeVisible();
});

test("a long line starts playing once its first part is made, while the rest is still being made", async ({ page }) => {
  await prepare(page);
  const texts: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/speak**", async (route) => {
    if (route.request().url().includes("warm=1")) return route.fulfill({ status: 204 });
    texts.push(route.request().postDataJSON().text);
    // The second part isn't made until the test says so.
    if (texts.length === 2) await held;
    return route.fulfill({ status: 200, contentType: "audio/wav", body: silence() });
  });
  await page.goto("/");
  await setUpTom(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  const sentence = `${"Word ".repeat(23)}words.`;
  await page.getByLabel("Type a reply").fill([sentence, sentence, sentence].join(" "));
  await page.keyboard.press("Enter");
  await expect.poll(() => texts.length).toBe(2);
  // Playing already: the bubble says Speaking, not that it is waiting for your voice.
  await expect(page.getByText("Speaking", { exact: true })).toBeVisible();
  await expect(page.getByText("Getting your voice ready…")).toHaveCount(0);
  release();
  await expect(page.getByText("Speaking", { exact: true })).toHaveCount(0);
  expect(texts).toHaveLength(2);
  expect(await spoken(page)).toEqual([]);
});
