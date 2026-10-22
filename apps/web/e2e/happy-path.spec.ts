import { expect, test, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/importers/fixtures");

async function go(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
}

test("demo household: next step, import without duplicates, recategorise, export", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();

  // The next-step card is the first unmet flowchart step, with its rule pack and sources.
  await expect(page.getByText("Your next step · step 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pay off .* of high-interest debt/ })).toBeVisible();
  await expect(page.getByText(/leaving .* a year of employer pension match unclaimed/)).toBeVisible();
  await page.getByRole("button", { name: "Why?" }).first().click();
  await expect(page.getByText(/Rule pack IE-2026\.3/)).toBeVisible();

  // Import an AIB file twice: the second import adds nothing.
  await go(page, "Import");
  await page.getByLabel("Statement file").setInputFiles(join(fixtures, "aib.csv"));
  await expect(page.getByText("Detected: AIB")).toBeVisible();
  await page.getByRole("button", { name: "Import transactions" }).click();
  await expect(page.getByRole("status")).toHaveText(/Imported 3 new transactions/);
  await page.getByLabel("Statement file").setInputFiles(join(fixtures, "aib.csv"));
  await page.getByRole("button", { name: "Import transactions" }).click();
  await expect(page.getByRole("status")).toHaveText(/Imported 0 new transactions; skipped 3 already imported/);

  // Correcting a category offers a rule.
  await go(page, "Transactions");
  await page.getByLabel("Search").fill("Insomnia");
  await page.getByLabel("Category for Insomnia Coffee").first().selectOption({ label: "Lifestyle: Entertainment" });
  await expect(page.getByText(/Always categorise payees containing/)).toBeVisible();
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByLabel("Category for Insomnia Coffee").last()).toHaveValue("cat_entertainment");

  // Export downloads a JSON file.
  await go(page, "Data & sync");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/^cuntas-.*\.json$/);
});

test("new household: take-home pay matches the golden EUR 50,000 case", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("heading", { name: "Start tracking where your money goes" })).toBeVisible();
  await go(page, "Tax centre");
  await page.getByLabel("Tax year").first().selectOption("2027");
  await page.getByLabel("Gross annual pay").fill("50000");
  const table = page.locator("table").first();
  await expect(table.getByRole("row", { name: /Income tax/ })).toContainText("€6,450.00");
  await expect(table.getByRole("row", { name: /USC/ })).toContainText("€1,016.82");
  await expect(table.getByRole("row", { name: /PRSI/ })).toContainText("€2,193.75");
});

test("delete everything returns to onboarding", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  await go(page, "Data & sync");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete all data" }).click();
  await expect(page.getByRole("button", { name: "Open demo" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Open demo" })).toBeVisible();
});
