import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { prepare, startWithMaya, theySaid } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const REPLIES = ["Large, please.", "Hi Sam, my usual please.", "What sizes do you have?"];

test("on a phone the replies and the type box are on screen without scrolling", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  for (const name of REPLIES) {
    await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByLabel("Type a reply")).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // Docked to the bottom edge with 24 px top corners.
  const corners = await page.locator(".tray").evaluate((el) => [getComputedStyle(el).borderTopLeftRadius, getComputedStyle(el).borderBottomLeftRadius]);
  expect(corners).toEqual(["24px", "0px"]);
});

test("the reactions step aside while you type, and come back after", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  // Adding their line puts focus back in "Type a reply", so the reactions start out of the way.
  await expect(page.getByLabel("Type a reply")).toBeFocused();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeHidden();
  await page.getByLabel("Type a reply").blur();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();
  await page.getByLabel("Type a reply").focus();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeHidden();
  // Only the reactions and phrases step aside: the rest stays.
  await expect(page.getByRole("button", { name: "New conversation" })).toBeVisible();
  await page.locator("body").click();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();
});

test("with the keyboard open, their latest line and all three replies still show", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  // Enough lines that the thread scrolls, so shrinking it must keep the newest one in view.
  for (const line of ["Good morning!", "How are you today?", "Anything to eat?", "Would you like that hot or iced, and do you want it in a mug?"]) {
    await theySaid(page, line);
  }
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  const list = page.getByRole("list", { name: "Conversation lines" });
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // An open keyboard leaves about 600 px of an 844 px phone; resizes-content shrinks the page to that.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.getByLabel("Type a reply").focus();
  await expect(list.getByRole("listitem").last()).toBeInViewport();
  for (const name of REPLIES) {
    await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
});

test("place and person change in a sheet, and Settings is in the menu", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: /^Where and who/ }).click();
  const sheet = page.getByRole("dialog", { name: "Where and who" });
  await sheet.getByLabel("Talking with").selectOption({ label: "Someone new" });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Where and who: Blue Door Café, Someone new" })).toBeVisible();

  await page.getByRole("button", { name: "Demo: Maya" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

for (const theme of [undefined, "dark", "contrast"]) {
  test(`the phone screen and its sheets pass axe (${theme ?? "light"})`, async ({ page }) => {
    await prepare(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startWithMaya(page);
    await theySaid(page, "What size would you like?");
    await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: /^Where and who/ }).click();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Close where and who" }).click();
    await page.getByRole("button", { name: "Demo: Maya" }).click();
    await expect(page.getByRole("dialog", { name: "Demo: Maya" })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  });
}
