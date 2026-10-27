import { expect, test, type Page } from "@playwright/test";

const CHASE = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n";
const chase = (name: string, rows: [string, string, string][]) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(CHASE + rows.map(([date, text, amount]) => `DEBIT,${date},"${text}",${amount},DEBIT_CARD,1000.00,,`).join("\n") + "\n"),
});

async function go(page: Page, label: string) {
  const menu = page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name: label });
  if (!(await link.first().isVisible())) await nav.getByRole("button", { name: /^More/ }).click();
  await link.first().click();
}

async function importUnknownMerchants(page: Page) {
  await page.goto("/");
  await page.getByLabel("Your first name").fill("Alex");
  await page.getByLabel("Where do you live?").selectOption("US");
  await page.getByRole("button", { name: "Create household" }).click();
  await go(page, "Import");
  await page.getByLabel("Statement files").setInputFiles(
    chase("chase.csv", [
      ["09/02/2026", "LUCIA'S NAIL SALON #1 OAKLAND CA", "-45.00"],
      ["09/16/2026", "LUCIA'S NAIL SALON #2 BERKELEY CA", "-55.00"],
      ["09/05/2026", "BOB'S HARDWARE 2231", "-27.60"],
      ["09/19/2026", "BOB'S HARDWARE 2231", "-10.00"],
      ["09/20/2026", "ZELLE TO JORDAN", "-60.00"],
      ["09/03/2026", "TRADER JOE'S #123 SAN FRANCISCO CA", "-64.18"],
    ]),
  );
  await page.getByRole("button", { name: "Import 6 transactions" }).click();
  await expect(page.getByText("1 categorised automatically")).toBeVisible();
  await expect(page.getByText(/5 need a category/)).toBeVisible();
}

test("the review queue files a merchant's rows in one tap, and its rule files the next import", async ({ page }) => {
  await importUnknownMerchants(page);
  // The nav shows how many wait; the queue opens on the biggest merchant.
  await go(page, "Review");
  await expect(page.getByLabel("5 to review")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Merchant: Lucia's Nail Salon" })).toBeVisible();
  await expect(page.getByText("LUCIA'S NAIL SALON #1 OAKLAND CA")).toBeVisible();
  await expect(page.getByText(/2 transactions · \$100\.00/)).toBeVisible();

  await page.getByLabel("More categories").selectOption({ label: "Essential bills: Toiletries and pharmacy" });
  await expect(page.getByRole("status")).toHaveText(/Filed 2 transactions from Lucia's Nail Salon as Toiletries and pharmacy, with a rule for next time\./);

  // S skips; the next one, filed without a rule, can be undone.
  await expect(page.getByRole("heading", { name: "Merchant: Zelle to Jordan" })).toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByRole("heading", { name: "Merchant: Bob's Hardware" })).toBeVisible();
  await page.getByLabel("Always use this for Bob's Hardware").uncheck();
  await page.getByRole("group", { name: "Category for Bob's Hardware" }).getByRole("button", { name: /Groceries/ }).click();
  await expect(page.getByRole("status")).toHaveText(/Filed 2 transactions from Bob's Hardware as Groceries\./);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { name: "Merchant: Bob's Hardware" })).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByRole("status")).toHaveText(/from Bob's Hardware as/);

  // Only the skipped one is left.
  await expect(page.getByText("You skipped the last merchant.")).toBeVisible();
  await page.getByRole("button", { name: "Go through them again" }).click();
  await expect(page.getByRole("heading", { name: "Merchant: Zelle to Jordan" })).toBeVisible();
  await page.getByRole("link", { name: "Done for now" }).click();
  await expect(page.getByText("1 transaction needs a category.")).toBeVisible();

  // The rule made for Lucia's files the next statement's visit.
  await go(page, "Import");
  await page.getByLabel("Statement files").setInputFiles(chase("chase-oct.csv", [["10/04/2026", "LUCIA'S NAIL SALON #1 OAKLAND CA", "-40.00"]]));
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByText("1 categorised automatically")).toBeVisible();
  await expect(page.getByText(/need a category/)).toHaveCount(0);
});

test("on a phone, a swipe left skips and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await importUnknownMerchants(page);
  await page.getByRole("link", { name: "Review now" }).click();
  const card = page.getByRole("heading", { name: "Merchant: Lucia's Nail Salon" });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await card.dispatchEvent("touchstart", { touches: [{ identifier: 0, clientX: 300, clientY: 200 }], changedTouches: [{ identifier: 0, clientX: 300, clientY: 200 }] });
  await card.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 0, clientX: 120, clientY: 200 }] });
  await expect(page.getByRole("heading", { name: "Merchant: Zelle to Jordan" })).toBeVisible();
});
