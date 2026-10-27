import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, label: string) {
  const menu = page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name: label, exact: true });
  if (!(await link.isVisible())) await nav.getByRole("button", { name: /^More/ }).click();
  await link.click();
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("new household: a rough monthly figure sets the emergency fund target and a first budget", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your first name").fill("Alex");
  await page.getByLabel("Where do you live?").selectOption("US");
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByText("Hello, Alex")).toBeVisible();

  // No pay and no transactions: the target is the floor, and Overview asks for a figure.
  await expect(page.getByText("Starter target $1,000")).toBeVisible();
  await page.getByRole("button", { name: "Add your monthly spending" }).click();
  const sheet = page.getByRole("dialog", { name: "Monthly spending" });
  await sheet.getByLabel("Rent or mortgage").fill("1800");
  await sheet.getByLabel("Groceries").fill("600");
  await sheet.getByLabel("Utilities and phone").fill("250");
  await sheet.getByLabel("Transport").fill("200");
  await sheet.getByLabel("Debt repayments").fill("150");
  await sheet.getByLabel("Everything else").fill("700");
  await expect(sheet.getByTestId("estimate-total")).toHaveText("$3,700");
  expect(await noSideways(page)).toBe(true);
  await sheet.getByRole("button", { name: "Save" }).click();

  // Essential lines (all but "everything else") make one month: $3,000.
  await expect(page.getByText("Starter target $3,000, based on your estimate")).toBeVisible();

  // Three spends by hand don't replace the estimate yet.
  for (const [amount, chip] of [["4.50", "Eating out and takeaway"], ["62.10", "Groceries"], ["30", "Commute and fuel"]] as const) {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add" });
    await add.getByLabel("Amount (USD)").fill(amount);
    await add.getByRole("button", { name: chip }).click();
    await add.getByRole("button", { name: "Save", exact: true }).click();
    await expect(add).toHaveCount(0);
  }
  await expect(page.getByText("Starter target $3,000, based on your estimate")).toBeVisible();

  // One tap makes the first budget.
  await go(page, "Budgets");
  await page.getByRole("button", { name: "Start from your monthly estimate" }).click();
  await expect(page.getByLabel("Budget for Groceries")).toHaveValue("600");
  await expect(page.getByLabel("Budget for Rent or mortgage")).toHaveValue("1800");
  await expect(page.getByLabel("Budget for Other")).toHaveValue("700");
  expect(await noSideways(page)).toBe(true);
});

test("Budgets: a rough monthly figure made there becomes the budget", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your first name").fill("Sam");
  await page.getByRole("button", { name: "Create household" }).click();
  await go(page, "Budgets");
  await page.getByRole("button", { name: "Start from a rough monthly figure" }).click();
  const sheet = page.getByRole("dialog", { name: "Monthly spending" });
  await sheet.getByLabel("Groceries").fill("450");
  await sheet.getByRole("button", { name: "Save and make a budget" }).click();
  await expect(page.getByLabel("Budget for Groceries")).toHaveValue("450");
});
