import { io } from "socket.io-client";
import { physicalRosterKey } from "../../src/lib/mathex/physical.schemas";
import { checkReflow, expect, test, visit } from "./fixtures";

async function createEvent(baseURL: string, groups: string[], longNames = false) {
  const creator = io(`${baseURL}/physical`);
  const pin = "123456";
  try {
    const result = await creator.timeout(5000).emitWithAck("createCompetition", {
      name: longNames ? "Mathex Grand Final and Inter-School Championship Practice Rehearsal" : "Live rehearsal",
      questionCount: 3,
      markerPin: pin,
      teams: groups.map((group, index) => ({
        name: `${String.fromCharCode(65 + index)} Team${longNames ? " with a long name that still needs to fit the board" : ""}`,
        group
      }))
    });
    expect(result.ok).toBe(true);
    return { hostPath: result.hostPath as string, code: result.code as string, pin };
  } finally {
    creator.disconnect();
  }
}

test("host, marker and projector stay in sync through a physical round", async ({
  page: host,
  context,
  baseURL,
  isMobile
}) => {
  const { hostPath, code, pin } = await createEvent(baseURL!, Array<string>(7).fill(""));
  const marker = await context.newPage();
  const scoreboard = await context.newPage();
  await visit(host, hostPath);
  await visit(marker, `/mathex/app/live/marker/${code}`);
  await visit(scoreboard, `/mathex/app/live/scoreboard/${code}`);
  await expect(scoreboard.getByText("Waiting to start")).toBeVisible();
  await expect(scoreboard.getByRole("columnheader", { name: "Rank" })).toHaveCount(0);

  await marker.getByRole("textbox", { name: "PIN" }).fill(pin);
  await marker.getByRole("button", { name: "Open marker desk" }).click();
  const pick = marker.getByRole("combobox");
  for (const label of ["A Team", "B Team"]) {
    await pick.selectOption({ label });
    await marker.getByRole("button", { name: "Pin team", exact: true }).click();
  }
  await marker.reload();
  await expect(marker.getByRole("heading", { name: "A Team", exact: true })).toBeVisible();
  await expect(marker.getByRole("heading", { name: "B Team", exact: true })).toBeVisible();
  const standings = marker.getByRole("complementary", { name: "Live standings" });
  await expect(standings.getByRole("rowheader", { name: "G Team" })).toBeVisible();
  if (!isMobile) {
    await expect(standings).toBeInViewport();
    await expect(marker.getByRole("button", { name: "Mark B Team correct" })).toBeInViewport();
  }

  await host.getByRole("button", { name: "Start round" }).click();
  await host.getByText("Countdown settings", { exact: true }).click();
  await host.getByRole("spinbutton", { name: "Minutes" }).fill("2");
  await host.getByRole("button", { name: "Start countdown" }).click();
  await expect(scoreboard.getByText("Time remaining")).toBeVisible();
  await expect(scoreboard.locator(".board-clock strong")).toHaveText(/^(02:00|01:5[0-9])$/);
  await host.getByRole("spinbutton", { name: "Minutes" }).fill("4");
  await host.getByRole("button", { name: "Reset countdown" }).click();
  await expect(scoreboard.locator(".board-clock strong")).toHaveText(/^(04:00|03:5[0-9])$/);
  await host.getByRole("button", { name: "Turn off countdown" }).click();
  await expect(scoreboard.getByText("Elapsed time")).toBeVisible();
  await host.getByText("Countdown settings", { exact: true }).click();
  await host.getByText("Setup", { exact: true }).click();
  await host.getByRole("textbox", { name: "Team 1 name" }).fill("A Team draft");

  await marker.getByRole("button", { name: "Mark B Team wrong" }).click();
  await expect(marker.getByText("Q1 marked wrong. Still on Q1.")).toBeVisible();
  await marker.getByRole("button", { name: "Skip question for B Team" }).click();
  await expect(marker.getByText("Q1 skipped, no point. Next is Q2.")).toBeVisible();
  if (!isMobile) {
    await scoreboard.emulateMedia({ reducedMotion: "no-preference" });
    await scoreboard.evaluate(() => {
      const board = document.querySelector(".projector-table");
      if (!board) return;
      const observer = new MutationObserver(() => {
        if (!board.querySelector("tr.leader")?.textContent?.includes("B Team")) return;
        observer.disconnect();
        requestAnimationFrame(() => {
          const moved = [...board.querySelectorAll("tbody tr")].some((row) =>
            row
              .getAnimations()
              .some(
                (animation) =>
                  animation.effect instanceof KeyframeEffect &&
                  animation.effect.getKeyframes().some((frame) => frame.transform)
              )
          );
          board.setAttribute("data-observed-rank-motion", String(moved));
        });
      });
      observer.observe(board, { childList: true, subtree: true, attributes: true });
    });
  }
  await marker.getByRole("button", { name: "Mark B Team correct" }).click();
  await expect(scoreboard.locator("tr.leader").getByRole("rowheader", { name: "B Team" })).toBeVisible();
  if (!isMobile) {
    await expect(scoreboard.locator(".projector-table")).toHaveAttribute("data-observed-rank-motion", "true");
    await scoreboard.emulateMedia({ reducedMotion: "reduce" });
  }
  const projectedB = scoreboard.getByRole("row", { name: /B Team/ });
  await expect(projectedB.locator(".question-track .skipped")).toHaveCount(1);
  await expect(projectedB.locator(".question-track .solved")).toHaveCount(1);
  if (isMobile) {
    await expect(projectedB.getByText("1 wrong attempt · 1 skipped")).toBeVisible();
  } else {
    await expect(scoreboard.getByRole("columnheader", { name: "Wrong attempts" })).toBeVisible();
    await expect(scoreboard.getByRole("columnheader", { name: "Finish time" })).toBeVisible();
    await expect(projectedB.locator(".attempt")).toHaveText(["1", "1"]);
    await expect(projectedB.locator(".finish")).toHaveText("—");
  }
  await expect(standings.getByRole("row", { name: /B Team/ }).getByRole("cell")).toHaveText(["1", "1", "Q3 / 3"]);
  await expect(host.getByRole("textbox", { name: "Team 1 name" })).toHaveValue("A Team draft");
  await expect(marker.getByRole("article").first().getByRole("heading", { name: "A Team" })).toBeVisible();
  if (!isMobile) await expect(scoreboard.getByRole("rowheader", { name: "G Team" })).toBeInViewport();

  await host.getByRole("button", { name: "Pause" }).click();
  await expect(scoreboard.getByText("Round paused")).toBeVisible();
  await expect(marker.getByRole("button", { name: "Mark B Team correct" })).toBeDisabled();
  await marker.getByRole("button", { name: "Undo last mark for B Team" }).click();
  await expect(marker.getByText("Last mark undone.")).toBeVisible();
  await marker.getByRole("button", { name: "Team record for B Team" }).click();
  const record = marker.getByRole("dialog", { name: "B Team team record" });
  await expect(record).toContainText("0 correct · 1 wrong attempt · 1 skipped");
  await record.getByRole("button", { name: "Close" }).click();

  await host.getByRole("button", { name: "Remove B Team", exact: true }).click();
  await host.getByRole("button", { name: "Confirm remove B Team" }).click();
  await host.getByRole("button", { name: "Save teams" }).click();
  const removal = host.getByRole("alertdialog", { name: "Remove teams and their marks?" });
  await expect(removal).toContainText("B Team");
  await removal.getByRole("button", { name: "Keep editing" }).click();
  await host.getByRole("button", { name: "Discard draft" }).click();

  await host.getByRole("textbox", { name: "New marker PIN" }).fill("654321");
  await host.getByRole("button", { name: "Change PIN", exact: true }).click();
  const pinChange = host.getByRole("alertdialog", { name: "Change the marker PIN?" });
  await pinChange.getByRole("button", { name: "Change and disconnect scorers" }).click();
  await expect(pinChange).toBeHidden();
  await expect(marker.getByText("Marker access ended.", { exact: false })).toBeVisible();
  await marker.getByRole("textbox", { name: "PIN" }).fill("654321");
  await marker.getByRole("button", { name: "Open marker desk" }).click();
  await expect(standings).toBeVisible();
  await host.getByRole("button", { name: "Resume" }).click();
  for (const question of [2, 3]) {
    await marker.getByRole("button", { name: "Skip question for B Team" }).click();
    await expect(projectedB.locator(".question-track .skipped")).toHaveCount(question);
  }
  if (isMobile) await expect(projectedB.getByText(/1 wrong attempt · 3 skipped · Finish \d+:\d+/)).toBeVisible();
  else await expect(projectedB.locator(".finish")).toHaveText(/\d+:\d+/);

  await host.getByRole("button", { name: "Finish round" }).click();
  const finish = host.getByRole("alertdialog", { name: "Finish this competition?" });
  await expect(finish).toContainText("6 teams are still working");
  await finish.getByRole("button", { name: "Finish competition" }).click();
  await expect(finish).toBeHidden();
  await expect(scoreboard.getByText("Final results", { exact: true })).toBeVisible();
  await expect(projectedB).toContainText("Done");
  await expect(scoreboard.getByRole("row", { name: /A Team/ })).toContainText("Ended at Q1");
  await Promise.all([checkReflow(host), checkReflow(marker), checkReflow(scoreboard)]);
});

test("the server rejects stale rosters and unconfirmed removal of new marks", async ({ baseURL }) => {
  const { hostPath, code, pin } = await createEvent(baseURL!, ["", ""]);
  const token = new URL(hostPath, baseURL).searchParams.get("hostToken");
  const host = io(`${baseURL}/physical-host-${code}`, { auth: { token }, autoConnect: false });
  const marker = io(`${baseURL}/physical-marker-${code}`, { auth: { code, pin }, autoConnect: false });
  try {
    const snapshot = (await new Promise((resolve) => {
      host.once("snapshot", resolve);
      host.connect();
    })) as import("../../src/lib/mathex/physical.schemas").PhysicalHostSnapshot;
    const [first, second] = snapshot.teams;
    const expectedRoster = physicalRosterKey(snapshot.teams);
    const update = (teams: typeof snapshot.teams, confirmedRemovals: string[]) =>
      host.timeout(5000).emitWithAck("updateTeams", { teams, expectedRoster, confirmedRemovals });
    await new Promise((resolve) => {
      marker.once("snapshot", resolve);
      marker.connect();
    });
    expect(await host.timeout(5000).emitWithAck("start")).toEqual({ ok: true });
    expect(
      await marker
        .timeout(5000)
        .emitWithAck("mark", { teamId: second.id, expectedQuestion: 1, expectedLastActionId: null, action: "skip" })
    ).toEqual({ ok: true });
    expect(await update([first], [])).toMatchObject({ ok: false, error: expect.stringContaining("has marks") });
    expect(await update([first], [second.id])).toEqual({ ok: true });
    expect(await update([first, second], [])).toMatchObject({
      ok: false,
      error: expect.stringContaining("roster changed")
    });
  } finally {
    marker.disconnect();
    host.disconnect();
  }
});

test("the public scoreboard pages through large groups without losing rows", async ({ page, baseURL }) => {
  const { code } = await createEvent(baseURL!, [...Array<string>(9).fill("Juniors"), "Seniors"]);
  await visit(page, `/mathex/app/live/scoreboard/${code}`);
  await expect(page.getByRole("heading", { name: /Teams \/ Juniors \(1\/2\)/ })).toBeVisible();
  await expect(page.getByRole("rowheader")).toHaveCount(8);
  const next = page.getByRole("button", { name: "Next standings page" });
  await next.click();
  await expect(page.getByRole("heading", { name: /Teams \/ Juniors \(2\/2\)/ })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "I Team" })).toBeVisible();
  await next.click();
  await expect(page.getByRole("heading", { name: "Teams / Seniors" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "J Team" })).toBeVisible();
  await expect(next).toBeDisabled();
});

test("seven long team names fit a short projector viewport", async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, "Projector viewport");
  const { code, hostPath } = await createEvent(baseURL!, Array<string>(7).fill(""), true);
  await visit(page, hostPath);
  await page.getByRole("button", { name: "Start round" }).click();
  await expect(page.getByText("Round live", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 576 });
  await visit(page, `/mathex/app/live/scoreboard/${code}`);
  await expect(page.getByRole("rowheader")).toHaveCount(7);
  await expect(page.getByRole("rowheader", { name: /^G Team/ })).toBeInViewport({ ratio: 1 });

  await page.setViewportSize({ width: 320, height: 640 });
  const rank = page.getByRole("columnheader", { name: "Rank" });
  await expect(rank).toBeVisible();
  const rankFits = await rank.evaluate((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const lines = range.getClientRects();
    const bounds = cell.getBoundingClientRect();
    return lines.length === 1 && lines[0].left >= bounds.left && lines[0].right <= bounds.right;
  });
  expect(rankFits).toBe(true);
  await checkReflow(page);
});
