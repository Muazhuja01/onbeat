import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function setUp(page: Page, name: string, withSam = true) {
  await page.getByLabel("What's your name?").fill(name);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("About you", { exact: true }).fill("I type to talk. I can hear fine.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  if (withSam) {
    await page.locator("#person-name").fill("Sam");
    await page.getByLabel("Who they are to you").fill("my barista");
    await page.getByRole("button", { name: "Add person" }).click();
  }
  await page.getByRole("button", { name: "Finish" }).click();
}

const menu = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("first visit sets up a profile that is still there after a reload", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await expect(page.getByLabel("Talking with")).toContainText("Sam");
  await page.reload();
  await expect(menu(page, "Priya")).toBeVisible();
  await expect(page.getByLabel("Talking with")).toContainText("Sam");
});

test("replies use the new profile's notes", async ({ page }) => {
  await prepare(page);
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/suggest")) bodies.push(r.postData() ?? "");
  });
  await page.goto("/");
  await setUp(page, "Priya");
  await page.getByLabel("What they said").fill("How do you talk to people?");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator("#replies").getByText("Replies ready")).toBeVisible();
  expect(bodies.at(-1)).toContain("I'm Priya. I type to talk. I can hear fine.");
});

test("a demo leaves no profile behind", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo first" }).click();
  await page.getByRole("button", { name: /^Maya/ }).click();
  await expect(page.getByText("Nothing you do here is saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("What's your name?")).toBeVisible();
});

test("two profiles, switching, and deleting back to setup", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await menu(page, "Priya").click();
  await page.getByRole("button", { name: "New profile" }).click();
  await setUp(page, "Tom", false);
  await expect(menu(page, "Tom")).toBeVisible();
  await expect(page.getByLabel("Talking with")).not.toContainText("Sam");
  await menu(page, "Tom").click();
  await page.getByRole("button", { name: "Switch to Priya" }).click();
  await expect(page.getByLabel("Talking with")).toContainText("Sam");
  for (const name of ["Priya", "Tom"]) {
    await menu(page, name).click();
    await page.getByRole("button", { name: "Delete this profile" }).click();
    await page.getByRole("button", { name: `Delete ${name}` }).click();
  }
  await expect(page.getByLabel("What's your name?")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("What's your name?")).toBeVisible();
});

test("export then import makes a second copy", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await menu(page, "Priya").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export this profile" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^onbeat-priya-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  await menu(page, "Priya").click();
  await page.getByLabel("Import a profile").setInputFiles(path);
  await expect(menu(page, "Priya (2)")).toBeVisible();
  await expect(page.getByLabel("Talking with")).toContainText("Sam");
});

test("a file that isn't an export is refused", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByLabel("Have an OnBeat export? Import it").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.getByText("That file isn't an OnBeat profile export, so nothing was imported.")).toBeVisible();
  await expect(page.getByLabel("What's your name?")).toBeVisible();
});

test("notes from a document are reviewed before saving", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await menu(page, "Priya").click();
  await page.getByRole("button", { name: "Your notes" }).click();
  await page.getByRole("button", { name: "Add notes from a document" }).click();
  await page.getByLabel(/Choose a document/).setInputFiles({ name: "me.txt", mimeType: "text/plain", buffer: Buffer.from("I love chess.") });
  await page.getByLabel("I play online most evenings.").uncheck();
  await page.getByRole("button", { name: "Save 1 note" }).click();
  await expect(page.getByRole("region", { name: "Likes and dislikes" })).toContainText("I love chess.");
  await expect(page.getByRole("region", { name: "About you" })).not.toContainText("I play online");
});

for (const theme of [undefined, "dark", "contrast"]) {
  test(`setup, menu and notes pass axe (${theme ?? "light"})`, async ({ page }) => {
    await prepare(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    await setUp(page, "Priya");
    await menu(page, "Priya").click();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Your notes" }).click();
    await page.getByRole("button", { name: "Add notes from a document" }).click();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  });
}

for (const fontSize of ["100%", "200%"]) {
  test(`setup, menu and notes have no sideways scroll at 320 px (text ${fontSize})`, async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await page.evaluate((size) => (document.documentElement.style.fontSize = size), fontSize);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await setUp(page, "Priya");
    await menu(page, "Priya").click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Your notes" }).click();
    await page.getByRole("button", { name: "Edit: Sam: my barista" }).click();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}
