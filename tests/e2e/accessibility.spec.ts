import { test, expect, visit, setTheme, checkAccessibility, checkReflow, checkDialogKeyboard } from "./fixtures";

const routes = [
  "/",
  "/tools",
  "/tools/basic-facts",
  "/tools/factor-finder",
  "/tools/sequencing",
  "/tools/digitle",
  "/tools/make-24",
  "/tools/crossmath",
  "/utilities/number",
  "/utilities/number/24",
  "/mathex",
  "/mathex/app",
  "/mathex/app/create",
  "/mathex/app/play",
  "/mathex/app/live"
];

for (const theme of ["light", "dark"] as const) {
  test(`keyboard navigation has a skip link and visible focus in ${theme}`, async ({ page }) => {
    await visit(page, "/tools/basic-facts");
    await setTheme(page, theme);
    const skip = page.getByRole("link", { name: "Skip to content", exact: true });
    await skip.focus();
    await skip.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    const button = page.getByRole("button", { name: "Accessibility settings" });
    await button.focus();
    await button.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(button).toBeFocused();
    const outline = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor };
    });
    expect(outline.width).toBeGreaterThanOrEqual(2);
    expect(outline.style).not.toBe("none");
    expect(outline.color).not.toBe("rgba(0, 0, 0, 0)");
  });

  for (const route of routes) {
    test(`${route} has accessible content and contrast in ${theme}`, async ({ page }, info) => {
      await visit(page, route);
      await setTheme(page, theme);
      await checkReflow(page);
      await checkAccessibility(page, info, `${route}-${theme}`);
    });
  }

  test(`disclaimer has accessible contrast in ${theme}`, async ({ page }, info) => {
    // Set the real persisted theme before hydration, without bypassing the dialog.
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), theme);
    await page.goto("/");
    const dialog = page.getByRole("alertdialog", { name: "Important disclaimer" });
    await expect(dialog).toBeVisible();
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await checkAccessibility(page, info, `disclaimer-${theme}`);
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.getByRole("button", { name: "I understand" }).press("Enter");
    await expect(dialog).toBeHidden();
  });

  for (const puzzle of ["digitle", "make-24", "crossmath"]) {
    test(`${puzzle} help traps and restores focus with ${theme} contrast`, async ({ page }, info) => {
      await visit(page, `/tools/${puzzle}`);
      await setTheme(page, theme);
      const trigger = page.getByRole("button", { name: "How to play", exact: true });
      await trigger.focus();
      await trigger.press("Enter");
      await checkDialogKeyboard(page, "How to play");
      await checkAccessibility(page, info, `${puzzle}-help-${theme}`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "How to play", exact: true })).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }

  test(`Basic Facts settings, focus mode, and error contrast in ${theme}`, async ({ page }, info) => {
    await visit(page, "/tools/basic-facts");
    await setTheme(page, theme);
    const trigger = page.getByRole("button", { name: "Accessibility settings" });
    await trigger.press("Enter");
    await checkDialogKeyboard(page, "Accessibility settings");
    await expect(page.getByRole("checkbox", { name: /Reduce motion/ })).toBeChecked();
    await page.getByRole("checkbox", { name: /High contrast/ }).check();
    await page.getByRole("checkbox", { name: /Large text/ }).check();
    await checkAccessibility(page, info, `basic-facts-settings-${theme}`);
    await page.getByRole("button", { name: "Done", exact: true }).press("Enter");
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: "Start round" }).press("Enter");
    await page.getByRole("textbox", { name: "Your answer", exact: true }).fill("-999");
    await page.getByRole("button", { name: "Answer", exact: true }).click();
    await expect(page.getByText("Try the next one.")).toBeVisible();
    await page.getByRole("button", { name: "Enter focus mode" }).press("Enter");
    await checkDialogKeyboard(page, "Basic facts focus mode");
    await checkAccessibility(page, info, `basic-facts-focus-${theme}`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Basic facts focus mode" })).toBeHidden();
    await checkReflow(page);
  });

  test(`room form errors and expanded options have ${theme} contrast`, async ({ page }, info) => {
    await visit(page, "/mathex/app/create");
    await setTheme(page, theme);
    await page.getByRole("textbox", { name: "Room name" }).fill("x");
    await expect(page.getByText("Must be 3-60 characters")).toBeVisible();
    await page.getByText("Game options and player tools", { exact: true }).click();
    await checkAccessibility(page, info, `create-room-errors-options-${theme}`);
    await checkReflow(page);
  });
}

test("mobile navigation is keyboard-operable", async ({ page, isMobile }, info) => {
  test.skip(!isMobile, "The collapsed navigation is only present on the mobile layout");
  await visit(page, "/");
  const toggle = page.getByRole("button", { name: "Open navigation menu" });
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await checkAccessibility(page, info, "mobile-navigation-open");
  await page.locator("#mobile-navigation").getByRole("link", { name: "Tools", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-expanded", "false");
});

test("content reflows at 320 CSS pixels and with enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await visit(page, "/tools/basic-facts");
  await checkReflow(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await checkReflow(page);
  await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
});
