import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const CHASE = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n";
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/importers/fixtures");

async function go(page: Page, label: string) {
  const menu = page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name: label, exact: true });
  if (!(await link.isVisible())) await nav.getByRole("button", { name: /^More/ }).click();
  await link.click();
}

async function newUsHousehold(page: Page) {
  await page.goto("/");
  await page.getByLabel("Your first name").fill("Alex");
  await page.getByLabel("Where do you live?").selectOption("US");
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("heading", { name: "Get set up" })).toBeVisible();
}

/** Drops files on the page the way a browser does when they're dragged in from the desktop. */
async function dropFiles(page: Page, files: { name: string; text: string }[]) {
  const transfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: "text/csv" }));
    return dt;
  }, files);
  await page.dispatchEvent("main", "dragenter", { dataTransfer: transfer });
  await page.dispatchEvent("main", "dragover", { dataTransfer: transfer });
  await page.dispatchEvent("main", "drop", { dataTransfer: transfer });
}

test("two statements at once need no choices beyond Import, and say what to do next", async ({ page }) => {
  await newUsHousehold(page);
  await go(page, "Import");
  await page.getByLabel("Statement files").setInputFiles([join(fixtures, "chase-checking.csv"), join(fixtures, "amex.csv")]);

  // Each file is recognised and headed for a new account named after the bank, the card typed as a card.
  await expect(page.getByText("Detected: Chase (checking)")).toBeVisible();
  await expect(page.getByText("Detected: American Express")).toBeVisible();
  await expect(page.getByLabel("Account for chase-checking.csv")).toHaveValue("__new");
  await expect(page.getByLabel("New account name for amex.csv")).toHaveValue("American Express ··1003");
  await expect(page.getByLabel("Account type for amex.csv")).toHaveValue("creditCard");

  await page.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 4 transactions from 2 files");
  // Trader Joe's, the payroll and Delta are known merchants; the card payment is a transfer.
  await expect(page.getByText("3 categorised automatically")).toBeVisible();
  await expect(page.getByText(/need a category/)).toHaveCount(0);
  await expect(page.getByText(/Spending Sep 1, 2026 – Sep 20, 2026: \$477/)).toBeVisible();

  // Importing the same files again goes to the same accounts and adds nothing.
  await page.getByLabel("Statement files").setInputFiles([join(fixtures, "chase-checking.csv"), join(fixtures, "amex.csv")]);
  await expect(page.getByLabel("Account for amex.csv")).not.toHaveValue("__new");
  await expect(page.getByLabel("Account for chase-checking.csv")).not.toHaveValue("__new");
  await page.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 0 transactions from 2 files");
  await expect(page.getByText("4 already imported (skipped)")).toBeVisible();

  // Review now opens the review queue on the merchants nobody knows.
  await page.getByLabel("Statement files").setInputFiles({ name: "chase-oct.csv", mimeType: "text/csv", buffer: Buffer.from(`${CHASE}DEBIT,09/21/2026,"LUCIA'S NAIL SALON #1 OAKLAND CA",-45.00,DEBIT_CARD,1000.00,,\n`) });
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByText(/1 need a category/)).toBeVisible();
  await page.getByRole("link", { name: "Review now" }).click();
  await expect(page.getByRole("heading", { name: "Merchant: Lucia's Nail Salon" })).toBeVisible();

  // Last month's statement counts as tracking, and Overview shows its spending with its dates.
  await go(page, "Overview");
  await expect(page.getByRole("listitem", { name: "Spending: done" })).toBeVisible();
  await expect(page.getByText(/^Spending Sep 1, 2026 – Sep 30, 2026$/)).toBeVisible();
  await go(page, "Accounts");
  await expect(page.getByText("Chase (checking)")).toBeVisible();
  await expect(page.getByText("American Express ··1003")).toBeVisible();
});

test("files dropped on any page open Import with them", async ({ page }) => {
  await newUsHousehold(page);
  await dropFiles(page, [{ name: "chase.csv", text: await readFile(join(fixtures, "chase-checking.csv"), "utf8") }]);
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByText("Detected: Chase (checking)")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 2 transactions from 1 file");
});

test("a column mapping is kept for the next file with the same header row", async ({ page }) => {
  await newUsHousehold(page);
  await go(page, "Import");
  const csv = (rows: string) => ({ name: "mybank.csv", mimeType: "text/csv", buffer: Buffer.from(`When,What,Out,In\n${rows}`) });
  await page.getByLabel("Statement files").setInputFiles(csv("09/13/2026,CORNER SHOP,12.50,\n09/14/2026,REFUND,,3.00\n"));
  await expect(page.getByText("Check the columns")).toBeVisible();
  // The guess reads the dates month first for a dollar household and finds the money in and out columns.
  await expect(page.getByLabel("Date format")).toHaveValue("MM/DD/YYYY");
  await expect(page.getByLabel("Or: money out column")).toHaveValue("Out");
  await expect(page.getByRole("cell", { name: "−$12.50" })).toBeVisible();
  await page.getByLabel("Description column").selectOption("What");
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 2 transactions from 1 file");

  await page.getByLabel("Statement files").setInputFiles(csv("10/01/2026,CORNER SHOP,4.00,\n"));
  await expect(page.getByText("Columns as last time")).toBeVisible();
  await expect(page.getByLabel("Account for mybank.csv")).not.toHaveValue("__new");
});

test("Import fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newUsHousehold(page);
  await go(page, "Import");
  await page.getByLabel("Statement files").setInputFiles([join(fixtures, "chase-checking.csv"), join(fixtures, "amex.csv")]);
  await expect(page.getByText("Detected: American Express")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
