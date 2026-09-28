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

test("live captions don't scroll the page away from the replies on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await installFakeHearing(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  // Enough lines that the log is at its full height and scrolls inside itself,
  // so a new caption line can't change the page's layout.
  const lines = ["Good morning!", "How are you today?", "What size would you like?", "Anything to eat?", "Oat milk again?"];
  for (const line of [...lines, "For here or to go?", "Is that everything?"]) {
    await hear(page, "turnEnd", line);
  }
  const log = page.getByRole("region", { name: "Conversation" }).getByRole("list");
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const reply = page.getByRole("button", { name: "Large, please." });
  await expect(reply).toBeVisible();
  await reply.scrollIntoViewIfNeeded();
  await expect(reply).toBeInViewport();
  const before = await page.evaluate(() => window.scrollY);
  const replyTop = (await reply.boundingBox())?.y;
  expect(before).toBeGreaterThan(0);

  // Only captions change from here: requests made while they talk never answer,
  // so a reply list re-streaming can't move the page either.
  await page.route("**/api/suggest", () => {});

  for (const words of ["Would", "Would you like", "Would you like a pastry", "Would you like a pastry with that"]) {
    await hear(page, "partial", words);
    await expect(page.getByText(`${words}…`)).toBeAttached();
  }
  // Give any scroll effect time to run after the last caption.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  expect((await reply.boundingBox())?.y).toBe(replyTop);
  await expect(reply).toBeInViewport();
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
