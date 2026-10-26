import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name: label, exact: true });
  // Less-used pages sit under "More", collapsed at first.
  if (!(await link.isVisible())) await nav.getByRole("button", { name: /^More/ }).click();
  await link.click();
}

test("quick add: a cash spend in four taps, a monthly bill, and a move between accounts", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your first name").fill("Alex");
  await page.getByLabel("Where do you live?").selectOption("US");
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByText("Hello, Alex")).toBeVisible();

  // Open, amount, category, Save.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Add" });
  await sheet.getByLabel("Amount (USD)").fill("12.50");
  await sheet.getByRole("button", { name: "Eating out and takeaway" }).click();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  // Nothing sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A payee fills the category; "every month" adds a bill; "add another" keeps the sheet open.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await sheet.getByLabel("Amount (USD)").fill("29.99");
  await sheet.getByLabel("What for (optional)").fill("Netflix");
  await expect(sheet.getByRole("button", { name: "TV and subscriptions" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByLabel("This happens every month (adds it to Bills)").check();
  await sheet.getByRole("button", { name: "Save and add another" }).click();
  await expect(sheet.getByRole("status")).toContainText("Spent $29.99 · TV and subscriptions · added to Bills");
  await expect(sheet.getByLabel("Amount (USD)")).toBeFocused();
  await sheet.getByRole("button", { name: "Close" }).click();

  await go(page, "Transactions");
  await expect(page.getByText("Added by hand")).toBeVisible();
  await expect(page.getByLabel("Category for Netflix")).toHaveValue("cat_tv_subs");
  await expect(page.getByText("by hand", { exact: true })).toHaveCount(2);

  await go(page, "Bills");
  await expect(page.getByText("Netflix").first()).toBeVisible();

  await go(page, "Accounts");
  await expect(page.getByRole("row", { name: /Cash/ })).toContainText("Not tracked");

  // A move needs two accounts that keep a balance.
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Checking");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Savings");
  await page.getByRole("dialog").getByLabel("Type").selectOption("savings");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await sheet.getByRole("radio", { name: "Moved" }).click();
  await sheet.getByLabel("Amount (USD)").fill("200");
  await sheet.getByLabel("From").selectOption({ label: "Checking" });
  await sheet.getByLabel("To").selectOption({ label: "Savings" });
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await go(page, "Transactions");
  await expect(page.getByText("Transfer · Savings")).toBeVisible();

  // Delete a hand-entered row.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Delete Netflix/ }).click();
  await expect(page.getByLabel("Category for Netflix")).toHaveCount(0);
});

test("quick add opens with N on a keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcut");
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "Add" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add" })).toHaveCount(0);
});
