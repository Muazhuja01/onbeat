import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function setUp(page: Page) {
  await page.goto("/");
  await page.getByLabel("What's your name?").fill("Tom");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("About you", { exact: true }).fill("I'm Deaf and I use ASL.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Assistant" }).click();
  await expect(page.getByRole("heading", { name: "Assistant" })).toBeFocused();
}

test("prepare an appointment, keep the cards, see the phrases with that person", async ({ page }) => {
  await prepare(page);
  let turn = 0;
  await page.route("**/api/assist", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string; speaker: string }[] };
    const last = body.lines.filter((l) => l.speaker === "user").at(-1)!.id;
    turn++;
    const answer =
      turn === 1
        ? { say: "Who is the appointment with, and when?", proposals: [] }
        : {
            say: "Here is a note, the doctor, and two phrases. Anything else?",
            proposals: [
              { action: "add", kind: "routine", text: "Thursday 8 October, 10:00: seeing Dr. Chen about my blood pressure.", lineIds: [last] },
              { action: "add", kind: "person", name: "Dr. Chen", text: "Dr. Chen is my family doctor.", lineIds: [last] },
              { action: "phrase", text: "I get dizzy in the mornings.", for: "Dr. Chen", lineIds: [last] },
              { action: "phrase", text: "Please write it down for me.", for: "Dr. Chen", lineIds: [last] },
            ],
          };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
  });
  await setUp(page);
  await openAssistant(page);
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Prepare for an appointment" }).click();
  await expect(page.getByText("Who is the appointment with, and when?")).toBeVisible();
  await page.getByLabel("Or type what you need").fill("Dr. Chen, my family doctor, Thursday at 10:00 about my blood pressure. I get dizzy in the mornings.");
  await page.keyboard.press("Enter");
  for (const name of ["Keep: Thursday 8 October", "Keep: Dr. Chen", "Keep: I get dizzy", "Keep: Please write it down"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  }
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Talking with").selectOption({ label: "Dr. Chen" });
  const row = page.getByRole("group", { name: "Your phrases" });
  await expect(row.getByRole("button", { name: "I get dizzy in the mornings." })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
});

test("closing with changes not kept asks first", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/assist", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string; speaker: string }[] };
    const last = body.lines.filter((l) => l.speaker === "user").at(-1)!.id;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [last] }] }) });
  });
  await setUp(page);
  await openAssistant(page);
  await page.getByRole("button", { name: "Make quick phrases" }).click();
  await expect(page.getByRole("button", { name: "Keep: Thank you." })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Leave without keeping 1 change?")).toBeVisible();
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page.getByRole("heading", { name: "Assistant" })).toHaveCount(0);
});

test("a removal asks before deleting", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/assist", async (route) => {
    const body = route.request().postDataJSON() as { lines: { id: string; speaker: string }[]; notes: { id: string; text: string }[] };
    const last = body.lines.filter((l) => l.speaker === "user").at(-1)!.id;
    const target = body.notes.find((n) => n.text.includes("Lakeview"))!;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ say: "Remove it?", proposals: [{ action: "remove", noteId: target.id, lineIds: [last] }] }) });
  });
  await setUp(page);
  // A note to remove, added through Your notes.
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Your notes" }).click();
  await page.getByRole("button", { name: "Add a place" }).click();
  await page.getByLabel("Name").fill("Lakeview Clinic");
  await page.getByLabel("A few words about it").fill("My old clinic.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await openAssistant(page);
  await page.getByLabel("Or type what you need").fill("I don't go to Lakeview Clinic any more.");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Delete: Lakeview/ }).click();
  await expect(page.getByText("Delete this note?")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Your notes" }).click();
  await expect(page.getByText("Lakeview Clinic")).toHaveCount(0);
});

test("demos have no assistant", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo first" }).click();
  await page.getByRole("button", { name: /^Maya/ }).click();
  await page.getByRole("button", { name: /Demo: Maya/ }).click();
  await expect(page.getByRole("button", { name: "Assistant" })).toHaveCount(0);
});
