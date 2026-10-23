import { test, expect, visit, checkAccessibility } from "./fixtures";

test("Basic Facts can be started and answered using the keyboard", async ({ page }) => {
  await visit(page, "/tools/basic-facts");
  await page.getByRole("button", { name: "Start round" }).press("Enter");
  const input = page.getByRole("textbox", { name: "Your answer" });
  await expect(input).toBeFocused();
  const text = await page.locator('[aria-live="polite"]').filter({ has: input }).locator("p").nth(1).innerText();
  const [, left, operator, right] = text.match(/(\d+)\s*([+\-])\s*(\d+)/)!;
  const answer = operator === "+" ? Number(left) + Number(right) : Number(left) - Number(right);
  await input.fill(String(answer));
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByText("Streak", { exact: true }).locator("..")).toHaveText(/Streak\s*1/);
  await expect(input).toBeFocused();
});

test("Factor Finder validates a complete answer and announces it", async ({ page }, info) => {
  await visit(page, "/tools/factor-finder");
  const target = Number(
    await page.getByText("Find factors of", { exact: true }).locator("..").locator("p").last().innerText()
  );
  for (let number = 1; number <= 12; number++) {
    if (target % number === 0) await page.getByRole("button", { name: String(number), exact: true }).press("Space");
  }
  await page.getByRole("button", { name: "Check factors" }).press("Enter");
  await expect(page.getByRole("status")).toHaveText("All factors found!");
  await checkAccessibility(page, info, "factor-finder-success");
  await page.getByRole("button", { name: "Next target" }).press("Enter");
  await expect(page.getByRole("button", { name: "Check factors" })).toBeDisabled();
});

test("Digitle saves a submitted guess across reloads", async ({ page }, info) => {
  await visit(page, "/tools/digitle");
  for (const digit of "12345") await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  const firstRow = page.getByRole("grid", { name: "Guesses" }).getByRole("row").first();
  await expect(firstRow.getByRole("gridcell").first()).toHaveAttribute("aria-label", /1/);
  const labels = await firstRow
    .getByRole("gridcell")
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("aria-label")));
  await page.reload();
  const results = page.getByRole("dialog", { name: "Results", exact: true });
  if (await results.isVisible()) await results.getByRole("button", { name: "Close results" }).click();
  await expect(firstRow.getByRole("gridcell").first()).toHaveAttribute("aria-label", labels[0]!);
  await expect
    .poll(() =>
      firstRow.getByRole("gridcell").evaluateAll((cells) => cells.map((cell) => cell.getAttribute("aria-label")))
    )
    .toEqual(labels);
  await checkAccessibility(page, info, "digitle-submitted-guess");
});

test("Make 24 validates expressions and restores a completed daily puzzle", async ({ page }, info) => {
  await visit(page, "/tools/make-24");
  await page.getByRole("textbox", { name: "Your expression" }).fill("1/0");
  await page.getByRole("button", { name: "Check expression" }).click();
  await expect(page.getByRole("textbox", { name: "Your expression" })).toBeEnabled();
  await checkAccessibility(page, info, "make24-invalid-expression");
  await page.getByRole("button", { name: "Give up", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Results", exact: true })).toBeVisible();
  await checkAccessibility(page, info, "make24-results");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Your expression" })).toBeDisabled();
  await page.getByRole("button", { name: "See results", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Results", exact: true })).toBeVisible();
});

test("Crossmath supports keyboard tile placement and persists it", async ({ page }, info) => {
  await visit(page, "/tools/crossmath");
  const cell = page.getByRole("button", { name: /Row \d+ column \d+, empty/ }).first();
  const id = await cell.getAttribute("id");
  await cell.focus();
  const tile = page.getByRole("button", { name: /^Tile \d+$/ }).first();
  const label = await tile.getAttribute("aria-label");
  await tile.press("Enter");
  const filled = page.locator(`[id="${id}"]`);
  await expect(filled).toHaveAttribute("aria-label", /, tile \d+/);
  await page.reload();
  await expect(filled).toHaveAttribute("aria-label", /, tile \d+/);
  await checkAccessibility(page, info, "crossmath-placed-tile");
  await filled.press("Enter");
  await expect(filled).toHaveAttribute("aria-label", /, empty/);
  await expect(page.getByRole("button", { name: label!, exact: true }).first()).toBeVisible();
});
