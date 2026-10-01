import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function setUp(page: Page) {
  await page.getByLabel("What's your name?").fill("Priya");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("About you", { exact: true }).fill("I type to talk.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("OnBeat will suggest notes from your conversations.")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
}

async function say(page: Page, text: string) {
  await page.getByLabel("What they said").fill(text);
  await page.getByRole("button", { name: "Add" }).click();
}

async function hidePage(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
}

test("a suggested note is reviewed, kept, and used by the next reply", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/learn", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string }[] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ proposals: [{ action: "add", kind: "person", name: "Ana", text: "Ana is my new carer. She comes on weekday mornings.", lineIds: [body.lines[0].id] }] }),
    });
  });
  const suggestBodies: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/suggest")) suggestBodies.push(r.postData() ?? "");
  });
  await page.goto("/");
  await setUp(page);
  await say(page, "Your new carer Ana comes on weekday mornings.");
  await say(page, "She starts on Monday.");
  await hidePage(page);

  const menu = page.getByRole("button", { name: "Priya, 1 suggested note" });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole("button", { name: "Suggested notes (1)" }).click();
  await expect(page.getByRole("heading", { name: "New note: People" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Keep: Ana is my new carer. She comes on weekday mornings." }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await say(page, "Is Ana coming tomorrow?");
  await expect(page.locator("#replies").getByText("Replies ready")).toBeVisible();
  expect(suggestBodies.at(-1)).toContain("Ana is my new carer.");
});

test("an existing profile is told about suggested notes once", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page);
  // Setup saves the flag as it finishes; wait for that before taking it away.
  await expect(page.getByRole("heading", { name: "Replies" })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("onbeat:learning-told"));
  await page.reload();
  const notice = page.getByText("New: OnBeat can suggest notes from your conversations for you to review. Turn it off in Settings.");
  await expect(notice).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Priya", exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
});
