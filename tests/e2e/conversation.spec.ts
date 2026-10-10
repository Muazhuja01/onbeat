import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectTappable, expectThreadAboveTray, prepare, startWithMaya, theySaid } from "./helpers";

test("a partner line produces checked replies that can be spoken", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");

  await expect(page.locator("#replies").getByText("Replies ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hi Sam, my usual please." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();

  await page.locator("body").click();
  await page.keyboard.press("1");
  await expect(page.getByRole("list", { name: "Conversation lines" }).getByRole("listitem").last()).toContainText("Large, please.");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain("Large, please.");
});

test("New conversation clears the screen after asking", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await expect(page.getByRole("button", { name: "New conversation" })).toHaveCount(0);
  await theySaid(page, "What size would you like?");
  await page.getByRole("button", { name: "Large, please." }).click();
  await expect(page.getByRole("list", { name: "Conversation lines" }).getByRole("listitem").last()).toContainText("Large, please.");

  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByText("Clear this conversation? It isn't saved anywhere.")).toBeVisible();
  const asking = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(asking.violations).toEqual([]);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Ready when you are")).toBeVisible();
  await expect(page.getByRole("button", { name: "Large, please." })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Conversation lines" })).toHaveCount(0);
  await expect(page.getByLabel("Type a reply")).toBeFocused();
});

test("the page is cross-origin isolated, so the in-browser models can use several threads", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
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
    await page.getByRole("button", { name: "Try a demo first" }).click();
    const picker = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(picker.violations).toEqual([]);

    await page.getByRole("button", { name: /^Maya/ }).click();
    await theySaid(page, "What size would you like?");
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
  const duration = await page.getByRole("button", { name: "Demo: Maya" }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test("the settings panel passes axe in every theme", async ({ page }) => {
  await prepare(page);
  // Theme changes animate colours for 150 ms; axe must not sample mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startWithMaya(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const name of ["Light", "Dark", "High contrast"]) {
    await page.getByRole("radio", { name }).check();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations, name).toEqual([]);
  }
});

test("a chosen theme is kept after a reload", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "High contrast" }).check();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Number keys speak replies/ }).uncheck();
  await page.getByRole("button", { name: "Close settings" }).click();
  await theySaid(page, "What size would you like?");
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
    await theySaid(page, "What size would you like?");
    await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a long unbroken word wraps in both speakers' lines at 320 px", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await startWithMaya(page);
  const word = "https://example.com/" + "a".repeat(120);
  await theySaid(page, word);
  await page.getByLabel("Type a reply").fill(word);
  await page.keyboard.press("Enter");
  const list = page.getByRole("list", { name: "Conversation lines" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // The thread scrolls on its own, so a line spilling sideways inside it wouldn't show in the page's width.
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  for (const item of await list.getByRole("listitem").all()) {
    expect(await item.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  }
});

test("opening + They said doesn't move the replies", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  const reply = page.getByRole("button", { name: "Large, please." });
  await expect(reply).toBeVisible();
  const before = (await reply.boundingBox())?.y;
  await page.getByRole("button", { name: "They said", exact: true }).click();
  await expect(page.getByLabel("What they said")).toBeFocused();
  expect((await reply.boundingBox())?.y).toBe(before);
});

test("the controls are reached with Tab in the order they appear", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  // Start from the first thing on the page, as a keyboard user would.
  await page.getByRole("link", { name: "Skip to replies" }).focus();
  const names: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute("aria-label") ?? (el?.tagName === "SELECT" ? (el.closest("label")?.textContent ?? "") : (el?.textContent ?? "")).trim();
      }),
    );
  }
  const expected = ["Place", "Talking with", "Listen", "Demo: Maya", "Settings", "New conversation", "Conversation lines", "Mm-hmm", "Large, please.", "They said", "Speak"];
  let at = 0;
  for (const name of names) if (at < expected.length && name.includes(expected[at])) at++;
  expect(at, `missing or out of order: ${expected[at]} in ${names.join(" | ")}`).toBe(expected.length);
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 800 },
]) {
  test(`at ${size.width}×${size.height} in a demo the bar is one row and nothing covers the tray`, async ({ page }) => {
    await page.setViewportSize(size);
    await prepare(page);
    await startWithMaya(page);
    const bar = await page.locator("header").first().boundingBox();
    expect(bar?.height).toBeLessThan(90);
    for (const line of ["Good morning!", "So at eight weeks, when you think you're feeling good, the graft is not ready, and it takes a while.", "What size would you like?"]) {
      await theySaid(page, line);
    }
    await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
    await page.getByLabel("Type a reply").blur();
    await expectThreadAboveTray(page);
    for (const name of ["Large, please.", "Hi Sam, my usual please.", "What sizes do you have?", "Mm-hmm", "Thank you"]) {
      await expectTappable(page.getByRole("button", { name }));
    }
    await expectTappable(page.getByLabel("Type a reply"));
  });
}
