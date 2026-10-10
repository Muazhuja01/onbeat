import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare, settle } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const rates = (page: Page) => page.evaluate(() => (window as unknown as { __rates: number[] }).__rates);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

async function setUp(page: Page, name: string, pick: (page: Page) => Promise<void>) {
  await page.getByLabel("What's your name?").fill(name);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await pick(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
}

test("choose a voice in setup, hear a sample, change it later", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Tom", async (p) => {
    await expect(p.getByRole("heading", { name: "How should your voice sound?" })).toBeVisible();
    await settle(p);
    expect((await new AxeBuilder({ page: p }).withTags(WCAG).analyze()).violations).toEqual([]);
    await p.getByRole("radio", { name: "Male", exact: true }).check();
    await p.getByRole("radio", { name: "Faster" }).check();
    // Pressed from the keyboard, the button keeps focus while the sample prepares and plays.
    const play = p.getByRole("button", { name: "Play a sample" });
    await expect(play).toBeEnabled();
    await play.focus();
    await p.keyboard.press("Enter");
    await expect.poll(() => spoken(p)).toContain("Hi, I'm Tom. This is how I'll sound.");
    await expect(play).toBeFocused();
  });
  expect((await rates(page)).at(-1)).toBeCloseTo(1.15, 2);

  // Replies are spoken at the chosen speed.
  await page.getByLabel("Type a reply").fill("Hello there");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).length).toBeGreaterThan(1);
  expect((await rates(page)).at(-1)).toBeCloseTo(1.15, 2);

  // Change it from the profile menu.
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Voice: Male, American, deep" }).click();
  await expect(page.getByRole("heading", { name: "Your voice" })).toBeFocused();
  await page.getByRole("radio", { name: "Slower" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Type a reply").fill("Again");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).at(-1)).toBeCloseTo(0.85, 2);

  // And from Settings.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Change voice" }).click();
  await expect(page.getByRole("heading", { name: "Your voice" })).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("switching profile switches voice", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Tom", async (p) => p.getByRole("radio", { name: "Faster" }).check());
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "New profile" }).click();
  await setUp(page, "Maya", async (p) => p.getByRole("radio", { name: "Slower" }).check());
  await page.getByLabel("Type a reply").fill("Hi");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).at(-1)).toBeCloseTo(0.85, 2);
  await page.getByRole("button", { name: /^Maya/ }).click();
  await page.getByRole("button", { name: "Switch to Tom" }).click();
  // The switch is async and clears the composer when it lands.
  await expect(page.getByRole("button", { name: /^Tom/ })).toBeVisible();
  await page.getByLabel("Type a reply").fill("Hi");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).at(-1)).toBeCloseTo(1.15, 2);
});
