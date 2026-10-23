import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on("page", (page) => {
        page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
      });
      await use(errors);
      expect(errors, "Unexpected browser exceptions").toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };

export async function dismissDisclaimer(page: Page) {
  if (await page.evaluate(() => localStorage.getItem("disclaimer-acknowledged") === "true")) return;
  const dialog = page.getByRole("alertdialog", { name: "Important disclaimer" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "I understand" }).click();
  await expect(dialog).toBeHidden();
}

export async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `GET ${path}`).toBe(200);
  await dismissDisclaimer(page);
  // First-time puzzle instructions are tested separately with the dialog open.
  const help = page.getByRole("dialog", { name: "How to play", exact: true });
  if (await help.isVisible()) {
    await help.getByRole("button", { name: "Close help" }).click();
    await expect(help).toBeHidden();
  }
}

export async function setTheme(page: Page, theme: "light" | "dark") {
  if (!!(await page.locator("html").getAttribute("class"))?.split(/\s+/).includes("dark") !== (theme === "dark")) {
    await page.getByRole("button", { name: "Toggle theme" }).click();
  }
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
}

export async function checkAccessibility(page: Page, info: TestInfo, state: string) {
  // No excludes, disabled rules, or accepted violations. Explicitly keep text
  // contrast enabled even if axe changes its default tag selection.
  const result = await new AxeBuilder({ page })
    .options({ rules: { "color-contrast": { enabled: true } } })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  await info.attach(`accessibility-${state}`, {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json"
  });
  expect(
    [...result.passes, ...result.violations].some((rule) => rule.id === "color-contrast"),
    "Contrast must actually be evaluated"
  ).toBe(true);
  expect(
    result.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
    })),
    `Accessibility violations in ${state}`
  ).toEqual([]);
}

export async function checkReflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  }));
  expect(dimensions.content, "Page should not scroll horizontally").toBeLessThanOrEqual(dimensions.viewport + 1);
}

export async function checkDialogKeyboard(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const count = await dialog.locator('button, input, select, textarea, a[href], [tabindex="0"]').count();
  for (let index = 0; index <= count; index++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement)), "Tab stays in dialog").toBe(
      true
    );
  }
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}
