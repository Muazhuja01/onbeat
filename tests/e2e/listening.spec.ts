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

/** A piece of the other person's speech that ended after a pause, with when it started and ended. */
async function hearPiece(page: Page, text: string, startedAt: number, endedAt: number) {
  await page.evaluate(
    ([t, s, e]) => {
      const w = window as unknown as { __hear: (event: string, value: unknown) => void };
      w.__hear("turnEnd", { text: t, startedAt: s, endedAt: e });
    },
    [text, startedAt, endedAt] as const,
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

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test(`long lines on a ${size.width}×${size.height} screen keep both text boxes and the replies on screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await prepare(page);
    await installFakeHearing(page);
    await startWithMaya(page);
    await page.getByRole("button", { name: "Listen" }).click();
    const long =
      "So at eight weeks, when you think you're feeling good, the graft is not ready, and it takes a while for that graft to become a ligament, so you gotta respect the tissue healing.";
    for (let i = 0; i < 4; i++) await hear(page, "turnEnd", long);
    await hear(page, "partial", long);
    // Replies first: speaking what you typed cancels a reply request still on its way.
    await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
    const said =
      "My name is Alex. I'm a comp sci major, currently working on different projects, and I also like competing in hackathons with my friends on the weekends when I have the time.";
    await page.getByLabel("Type a reply").fill(said);
    await page.getByRole("button", { name: "Speak" }).click();
    await expect(page.getByRole("region", { name: "What you said" })).toContainText(said);

    // Nothing moved the page, and everything you need is inside the window without scrolling.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const target of [
      page.getByLabel("Type a reply"),
      page.getByRole("button", { name: "Speak" }),
      page.getByLabel("What they said"),
      page.getByRole("button", { name: "Large, please." }),
      page.getByRole("button", { name: "What sizes do you have?" }),
    ])
      await expect(target).toBeInViewport({ ratio: 1 });
    // The long line got smaller to fit, but not below the body text size.
    const fontPx = await page.getByRole("region", { name: "What you said" }).getByText(said).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontPx).toBeGreaterThanOrEqual(20);
    expect(fontPx).toBeLessThanOrEqual(32);
  });
}

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

test("a 2 s pause keeps the other person's words in one line, unless that is turned off in Settings", async ({ page }) => {
  await prepare(page);
  await installFakeHearing(page);
  await startWithMaya(page);
  await page.getByRole("button", { name: "Listen" }).click();
  const lines = page.getByRole("region", { name: "Conversation" }).getByRole("listitem");

  // Times are given with each piece, so the test needn't wait the 2 s.
  await hearPiece(page, "So the physio", 10_000, 11_000);
  await hearPiece(page, "moved to Thursdays.", 13_000, 14_500);
  await expect(lines).toHaveCount(1);
  await expect(lines).toContainText("So the physio moved to Thursdays.");

  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByText("Settings").click();
  await page.getByRole("checkbox", { name: "Keep the other person's pauses in one line" }).uncheck();

  await hearPiece(page, "So the physio", 20_000, 21_000);
  await hearPiece(page, "moved to Thursdays.", 23_000, 24_500);
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText("So the physio");
  await expect(lines.nth(1)).toContainText("moved to Thursdays.");
});
