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
