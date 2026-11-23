import { readFile } from "node:fs/promises";
import { io } from "socket.io-client";
import { test, expect, visit, setTheme, checkAccessibility, checkReflow } from "./fixtures";

const questions = [
  {
    contents: "<p>What is 2 + 2?</p>",
    solutions: [{ type: "number", value: 4, group: 0 }],
    allowEquivalent: true,
    answerComment: "",
    requireAllSolutionGroups: false,
    solutionOrderMatters: false,
    skippable: true
  },
  {
    contents: "<p>What is 3 + 3?</p>",
    solutions: [{ type: "number", value: 6, group: 0 }],
    allowEquivalent: true,
    answerComment: "",
    requireAllSolutionGroups: false,
    solutionOrderMatters: false,
    skippable: true
  }
];

test("set editor imports a JSON backup without replacing the draft until confirmed", async ({ page, isMobile }) => {
  await page.addInitScript((questions) => {
    if (!localStorage.getItem("mathex-draft")) {
      localStorage.setItem(
        "mathex-draft",
        JSON.stringify({ name: "Existing draft", questions: questions.slice(0, 1) })
      );
    }
  }, questions);
  await visit(page, "/mathex/app/create/editor");
  const title = page.getByRole("textbox", { name: "Set title", exact: true });
  const dialog = page.getByRole("dialog", { name: "Import a Mathex set?" });
  const importFile = async (value: unknown) => {
    await page.getByRole("button", { name: "Files", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import set…", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "mathex-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value))
    });
  };

  await expect(title).toHaveValue("Existing draft");
  await importFile({ questions: [null] });
  await expect(page.getByText("This file is not a Mathex set")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(title).toHaveValue("Existing draft");

  const backup = { name: "Imported set", instructions: "<p>No calculators.</p>", questions };
  await importFile(backup);
  await expect(dialog.getByText("mathex-backup.json")).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Back up draft" }).click();
  expect((await download).suggestedFilename()).toBe("Existing-draft.json");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(title).toHaveValue("Existing draft");

  await importFile(backup);
  await dialog.getByRole("button", { name: "Import set", exact: true }).click();
  await expect(title).toHaveValue("Imported set");
  await expect(page.getByText("Imported 2 questions")).toBeVisible();
  await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo", exact: true }).click();
  await expect(title).toHaveValue("Existing draft");

  await importFile(backup);
  await dialog.getByRole("button", { name: "Import set", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue("Imported set");
  if (isMobile) await page.getByRole("button", { name: "Contents", exact: true }).click();
  await expect(page.getByRole("button", { name: /What is 3 \+ 3\?/ })).toBeVisible();
});

test("set editor renders math and exports both print PDFs", async ({ page }) => {
  await page.addInitScript((question) => {
    localStorage.setItem(
      "mathex-draft",
      JSON.stringify({
        name: "Print regression",
        questions: [{ ...question, contents: "<p>Find $$\\frac{8}{2}$$.</p>" }]
      })
    );
  }, questions[0]);
  await visit(page, "/mathex/app/create/editor");
  await expect(page.locator("math mfrac").first()).toBeVisible();

  for (const name of ["Question slips PDF", "Answer key PDF"]) {
    await page.getByRole("button", { name: "Files", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("menuitem", { name, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const data = await readFile(await download.path());
    expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`host and player complete a real Mathex round in ${theme}`, async ({
    page: host,
    browser,
    isMobile,
    browserErrors
  }, info) => {
    test.setTimeout(120_000);
    await visit(host, "/mathex/app/create");
    await setTheme(host, theme);
    const chooser = host.waitForEvent("filechooser");
    await host.getByRole("button", { name: "Click or drag a JSON file" }).click();
    await (
      await chooser
    ).setFiles({
      name: "ci-questions.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(questions))
    });
    await host.getByRole("textbox", { name: "Room name" }).fill("CI competition");
    await host.getByRole("spinbutton", { name: "Thinking time" }).fill("1");
    await host.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(host).toHaveURL(/\/mathex\/app\/manage\?[^#]*id=/);
    const id = new URL(host.url()).searchParams.get("id")!;
    expect(id).toMatch(/^\d{6}$/);
    await expect(host.getByRole("heading", { name: "Competition dashboard" })).toBeVisible();
    await checkAccessibility(host, info, `host-lobby-${theme}`);
    await checkReflow(host);

    const playerContext = await browser.newContext({
      baseURL: "http://127.0.0.1:5199",
      viewport: host.viewportSize(),
      isMobile,
      hasTouch: isMobile,
      reducedMotion: "reduce",
      locale: "en-NZ",
      timezoneId: "Pacific/Auckland"
    });
    const player = await playerContext.newPage();
    player.on("pageerror", (error) => browserErrors.push(`player: ${error.message}`));
    try {
      await visit(player, `/mathex/app/play/${id}`);
      await setTheme(player, theme);
      await player.getByRole("textbox", { name: "Your name" }).fill("CI player");
      await player.getByRole("button", { name: "Join competition" }).press("Enter");
      await expect(player.getByText("Waiting for the host to start the competition", { exact: true })).toBeVisible();
      await expect(host.getByText("CI player", { exact: true })).toBeVisible();
      await host.getByRole("button", { name: "Start round", exact: true }).click();
      await expect(player.getByText("What is 2 + 2?", { exact: true })).toBeVisible();
      await checkAccessibility(player, info, `player-question-${theme}`);
      await checkReflow(player);
      await player.getByRole("textbox", { name: "Your answer" }).fill("4");
      await player.getByRole("button", { name: "Lock in answer" }).press("Enter");
      await expect(player.getByText("What is 3 + 3?", { exact: true })).toBeVisible();

      // A full browser reload must preserve the player identity and question.
      await player.reload();
      await expect(player.getByText("What is 3 + 3?", { exact: true })).toBeVisible();
      await player.getByRole("button", { name: "Skip question", exact: true }).click();
      const skip = player.getByRole("alertdialog", { name: "Skip this question?" });
      await expect(skip).toBeVisible();
      await checkAccessibility(player, info, `player-skip-dialog-${theme}`);
      await skip.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
      await player.getByRole("textbox", { name: "Your answer" }).fill("6");
      await player.getByRole("button", { name: "Lock in answer" }).press("Enter");
      await expect(player.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();

      // Finishing all questions does not necessarily end the host's round.
      await expect(host.getByRole("button", { name: "Finish round", exact: true })).toBeVisible();
      await host.getByRole("button", { name: "Finish round", exact: true }).click();
      const finish = host.getByRole("alertdialog", { name: "Finish the game?" });
      await expect(finish).toBeVisible();
      await checkAccessibility(host, info, `host-finish-dialog-${theme}`);
      await finish.getByRole("button", { name: "Finish round", exact: true }).click();
      await expect(player.getByRole("heading", { name: "Finished", exact: true })).toBeVisible();
      await expect(player.getByText(/2\/2 correct/).first()).toBeVisible();
      await checkAccessibility(player, info, `player-results-${theme}`);

      if (isMobile) await host.getByRole("button", { name: "Controls and results", exact: true }).click();
      await expect(host.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible();
      await checkAccessibility(host, info, `host-results-${theme}`);
      const download = host.waitForEvent("download");
      await host.getByRole("button", { name: "Export", exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(`mathex-results-${id}.json`);
      const stream = await file.createReadStream();
      expect(stream).not.toBeNull();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const results = JSON.parse(Buffer.concat(chunks).toString());
      expect(results).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "CI player", correctCount: 2 })])
      );
    } finally {
      await playerContext.close();
    }
  });
}

test("live editor waits for connection before joining with a saved name", async ({ page }) => {
  const socket = io("http://127.0.0.1:5199/set-collaboration", { forceNew: true });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    const result = await socket.timeout(5000).emitWithAck("createSession", {
      set: {
        name: "Saved-name regression",
        instructions: "",
        questions,
        pdfOptions: { questionTextSize: 11, answerTextSize: 11, imageHeight: 30, slipHeight: 49.5, cutMargin: 50 }
      },
      ownerPin: "246810"
    });
    expect(result.ok, result.error).toBe(true);
    await page.addInitScript(
      ({ token }) => {
        localStorage.setItem("disclaimer-acknowledged", "true");
        localStorage.setItem(`mathex-collab-name:${token}`, "Returning editor");
      },
      { token: result.sessionToken }
    );

    let releaseConnection!: () => void;
    let connectionReady = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    await page.route("**/socket.io/**", async (route) => {
      await connectionReady;
      await route.continue();
    });
    await page.goto(`/mathex/app/create/editor/${result.sessionToken}`);
    await expect(page.getByRole("button", { name: "Join", exact: true })).toBeDisabled();
    await expect(page.getByRole("alertdialog", { name: "Mathex connection interrupted" })).toBeHidden();
    releaseConnection();
    await expect(page.getByRole("textbox", { name: "Set title", exact: true })).toHaveValue("Saved-name regression");
    await expect(page.getByRole("alertdialog", { name: "Mathex connection interrupted" })).toBeHidden();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Set title", exact: true })).toHaveValue("Saved-name regression");
    await expect(page.getByRole("alertdialog", { name: "Mathex connection interrupted" })).toBeHidden();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Download as JSON" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Import set…" })).toHaveCount(0);

    // A first-time visitor must still choose when to submit their name.
    await page.addInitScript(
      ({ token }) => {
        localStorage.removeItem(`mathex-collab-name:${token}`);
      },
      { token: result.sessionToken }
    );
    connectionReady = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    await page.reload();
    await page.getByRole("textbox", { name: "Your name" }).fill("New visitor");
    await expect(page.getByRole("button", { name: "Join", exact: true })).toBeDisabled();
    releaseConnection();
    await expect(page.getByRole("button", { name: "Join", exact: true })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Join live set" })).toBeVisible();
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Set title", exact: true })).toHaveValue("Saved-name regression");
  } finally {
    socket.disconnect();
  }
});
