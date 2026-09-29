import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { prepare, startWithMaya } from "./helpers";

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

test("the settings panel passes axe in every theme", async ({ page }) => {
  await prepare(page);
  // Theme changes animate colours for 150 ms; axe must not sample mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startWithMaya(page);
  await page.getByText("Settings", { exact: true }).click();
  for (const name of ["Light", "Dark", "High contrast"]) {
    await page.getByRole("radio", { name }).check();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations, name).toEqual([]);
  }
});

test("a chosen theme is kept after a reload", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByText("Settings", { exact: true }).click();
  await page.getByRole("radio", { name: "High contrast" }).check();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  await page.getByText("Settings", { exact: true }).click();
  await page.getByRole("radio", { name: "Match this device" }).check();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
});

test("the device's more-contrast setting turns on high contrast", async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ contrast: "more" });
  await startWithMaya(page);
  const ground = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(ground).toBe("rgb(0, 0, 0)");
});

test("number keys can be turned off for voice control users", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByText("Settings", { exact: true }).click();
  await page.getByRole("checkbox", { name: /Number keys speak replies/ }).uncheck();
  await page.getByLabel("What they said").fill("What size would you like?");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  await page.locator("#replies").focus();
  await page.keyboard.press("1");
  await page.keyboard.press("Alt+1");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual(["Mm-hmm"]);
});

// A user style sheet or extension can double the root font. The 64rem breakpoint
// doesn't follow it, so both layouts must survive large rem values.
for (const width of [320, 1280]) {
  test(`double-size text still fits at ${width} px`, async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width, height: 900 });
    await startWithMaya(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.getByLabel("What they said").fill("What size would you like?");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
