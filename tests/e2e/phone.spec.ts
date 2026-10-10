import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectTappable, expectThreadAboveTray, prepare, startWithMaya, theySaid } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const REPLIES = ["Large, please.", "Hi Sam, my usual please.", "What sizes do you have?"];

test("on a phone the replies and the type box are on screen without scrolling", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  // Adding their line puts you back in the reply box, where the reactions step aside; leave it first.
  await page.getByLabel("Type a reply").blur();
  for (const name of [...REPLIES, "Mm-hmm", "Thank you"]) {
    await expectTappable(page.getByRole("button", { name }));
  }
  await expectTappable(page.getByLabel("Type a reply"));
  await expectThreadAboveTray(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // Docked to the bottom edge with 24 px top corners.
  const corners = await page.locator(".tray").evaluate((el) => [getComputedStyle(el).borderTopLeftRadius, getComputedStyle(el).borderBottomLeftRadius]);
  expect(corners).toEqual(["24px", "0px"]);
});

test("on a phone the reactions are smaller and share the row with the cue light", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  await page.getByLabel("Type a reply").blur();
  // The cue light: its dot and label (a short "Ready" on phones).
  const cue = await page.locator("#replies > div > span").first().boundingBox();
  for (const name of ["Mm-hmm", "Thank you"]) {
    const chip = page.getByRole("button", { name });
    await expectTappable(chip);
    const box = (await chip.boundingBox())!;
    // Smaller than the 48 px used where there is room, and still a comfortable target.
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeLessThan(48);
    // On the cue light's row, not wrapped below it.
    expect(Math.abs(box.y + box.height / 2 - (cue!.y + cue!.height / 2))).toBeLessThan(4);
  }
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
  // The rows you don't need for typing step aside too; the replies stay.
  await expect(page.getByRole("button", { name: "New conversation" })).toBeHidden();
  for (const name of REPLIES) await expect(page.getByRole("button", { name })).toBeVisible();
  await page.locator("body").click();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();
});

test("with the keyboard open, their latest line and all three replies still show", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  // Enough lines that the thread scrolls, so shrinking it must keep the newest one in view.
  for (const line of ["Good morning!", "How are you today?", "Anything to eat?", "Oat milk again?", "For here or to go?", "Would you like that hot or iced, and do you want it in a mug?"]) {
    await theySaid(page, line);
  }
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  const list = page.getByRole("list", { name: "Conversation lines" });
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // An open keyboard leaves about 600 px of an 844 px phone; resizes-content shrinks the page to that.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.getByLabel("Type a reply").focus();
  await expect(list.getByRole("listitem").last()).toBeInViewport();
  await expectThreadAboveTray(page);
  for (const name of REPLIES) {
    await expectTappable(page.getByRole("button", { name }));
  }
  await expectTappable(page.getByLabel("Type a reply"));
  // Nothing else scrolls the tray away either.
  expect(await page.locator("main").evaluate((el) => el.scrollTop)).toBe(0);
});

test("on a phone their latest line shows in full above the tray", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  await page.getByLabel("Type a reply").blur();
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  const list = (await page.getByRole("list", { name: "Conversation lines" }).boundingBox())!;
  const line = (await page.getByRole("listitem").filter({ hasText: "What size would you like?" }).boundingBox())!;
  expect(line.y, "their line starts inside the thread").toBeGreaterThanOrEqual(list.y - 1);
  expect(line.y + line.height, "their line ends inside the thread").toBeLessThanOrEqual(list.y + list.height + 1);
  await expectThreadAboveTray(page);
});

test("on a phone + They said is a button in the type row, and opens the box on the first click while you are typing", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  const button = page.locator(".tray").getByRole("button", { name: "They said", exact: true });
  await expectTappable(button);
  const box = (await button.boundingBox())!;
  const typeBox = (await page.getByLabel("Type a reply").boundingBox())!;
  expect(Math.abs(box.y + box.height / 2 - (typeBox.y + typeBox.height / 2)), "on the type box's row").toBeLessThan(4);
  // Typing hides the reactions; leaving the box brings them back. Neither may make the click miss.
  await page.getByLabel("Type a reply").focus();
  await button.click();
  await expect(page.getByLabel("What they said")).toBeFocused();
});

test("on a phone New conversation is in the menu, and asks first", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  await expect(page.getByRole("button", { name: "New conversation" })).toHaveCount(0);
  await page.getByRole("button", { name: "Demo: Maya" }).click();
  const sheet = page.getByRole("dialog", { name: "Demo: Maya" });
  await sheet.getByRole("button", { name: "New conversation" }).click();
  await expect(sheet.getByText("Clear this conversation? It isn't saved anywhere.")).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet.getByRole("button", { name: "New conversation" })).toBeFocused();
  await sheet.getByRole("button", { name: "New conversation" }).click();
  await sheet.getByRole("button", { name: "Clear" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Ready when you are")).toBeVisible();
  // Like any sheet, focus goes back to the button that opened it.
  await expect(page.getByRole("button", { name: "Demo: Maya" })).toBeFocused();
});

test("on a phone the replies are 20 px", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await theySaid(page, "What size would you like?");
  const size = await page.getByRole("button", { name: "Large, please." }).getByText("Large, please.").evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("20px");
});

for (const width of [390, 320]) {
  test(`opening + They said doesn't move the replies at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await prepare(page);
    await startWithMaya(page);
    await theySaid(page, "What size would you like?");
    const reply = page.getByRole("button", { name: "Large, please." });
    await expect(reply).toBeVisible();
    await page.getByLabel("Type a reply").blur();
    // The voice status line changes height while the voice loads; measure once it has settled.
    await expect(page.getByText("Using the basic voice.")).toBeVisible();
    const before = (await reply.boundingBox())?.y;
    await page.getByRole("button", { name: "They said", exact: true }).click();
    await expect(page.getByLabel("What they said")).toBeFocused();
    expect((await reply.boundingBox())?.y).toBe(before);
  });
}

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
    // Adding their line left you in the reply box, where the place and person row steps aside.
    await page.getByLabel("Type a reply").blur();
    await page.getByRole("button", { name: /^Where and who/ }).click();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Close where and who" }).click();
    await page.getByRole("button", { name: "Demo: Maya" }).click();
    await expect(page.getByRole("dialog", { name: "Demo: Maya" })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  });
}
