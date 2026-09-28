import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare, startWithMaya } from "./helpers";

/** Replaces the real hearing engine (see src/lib/hearing/browser.ts); tests drive it with hear(). */
async function installFakeHearing(page: Page, startsAs: "listening" | "denied" = "listening") {
  await page.addInitScript((initial) => {
    type Listener = (value: unknown) => void;
    const listeners = new Map<string, Set<Listener>>();
    const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((cb) => cb(value));
    const fake = {
      status: "off",
      on(event: string, cb: Listener) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
        return () => listeners.get(event)!.delete(cb);
      },
      async start() {
        fake.status = initial;
        emit("status", initial);
      },
      stop() {
        fake.status = "off";
        emit("status", "off");
      },
      pause() {},
      resume() {},
    };
    const w = window as unknown as { __onbeatHearing: unknown; __hear: typeof emit };
    w.__onbeatHearing = fake;
    w.__hear = emit;
  }, startsAs);
}

async function hear(page: Page, event: "partial" | "turnEnd", text: string) {
  await page.evaluate(
    ([e, t]) => {
      const w = window as unknown as { __hear: (event: string, value: unknown) => void };
      w.__hear(e, e === "turnEnd" ? { text: t, endedAt: Date.now() } : t);
    },
    [event, text] as const,
  );
}

test("live captions become a line in the conversation and bring replies", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByText("Listening. Their words appear in the conversation.")).toBeVisible();

  await hear(page, "partial", "What size");
  await expect(page.getByText("(still talking)")).toBeVisible();
  await expect(page.getByText("What size…")).toBeVisible();

  await hear(page, "turnEnd", "What size would you like?");
  await expect(page.getByText("(still talking)")).toBeHidden();
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText("What size would you like?");
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
});

test("asks for replies while the other person is still talking", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page);
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/suggest")) calls++;
  });
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();

  await hear(page, "partial", "What size would you like today");
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  expect(calls).toBe(1);

  // Same words at the end of the turn: the replies on screen already fit, so no new request.
  await hear(page, "turnEnd", "What size would you like today?");
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText("What size would you like today?");
  await page.waitForTimeout(1000);
  expect(calls).toBe(1);
});

test("a blocked microphone explains what still works", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page, "denied");
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(
    page.getByText("Microphone is off. You can still type replies. Turn it on in your browser's site settings."),
  ).toBeVisible();
  await page.getByLabel("Type a reply").fill("my us");
  await expect(page.getByRole("button", { name: /My usual, please\./ })).toBeVisible();
});

test("no accessibility violations while listening", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  await hear(page, "partial", "What size would");
  await expect(page.getByText("(still talking)")).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
});
