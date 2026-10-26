import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name: label });
  // Less-used pages sit under "More", collapsed at first.
  if (!(await link.isVisible())) await nav.getByRole("button", { name: /^More/ }).click();
  await link.click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  await expect(page.getByText("Your next step · step 3")).toBeVisible();
});

test("tax rules: a bad file names its line; a draft for next year loads, is reviewed and checked, then removed", async ({ page }) => {
  await go(page, "Tax rules");
  await expect(page.getByRole("heading", { name: "Tax rules", exact: true })).toBeVisible();
  const ireland = page.locator("section", { has: page.getByRole("heading", { name: "Ireland", exact: true }) });
  await expect(ireland.getByRole("row", { name: /IE-2027/ })).toContainText("Maintained with the app");

  // A rate written as a percentage is rejected with its line, and nothing changes.
  const download = page.waitForEvent("download");
  await ireland.getByRole("button", { name: /^Start 2028 from 2027$/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("ie-2028.yaml");
  const draft = await readFile((await file.path())!, "utf8");
  const bad = draft.replace(/^ {4}higher: 0\.4$/m, "    higher: 40");
  await page.getByLabel("Rule file").setInputFiles({ name: "ie-2028.yaml", mimeType: "text/yaml", buffer: Buffer.from(bad) });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("ie-2028.yaml wasn't loaded");
  await expect(alert).toContainText(/Line \d+ · incomeTax\.rates\.higher: Rates are decimals/);
  await expect(ireland.getByRole("row", { name: /IE-2028/ })).toHaveCount(0);

  // The draft as made loads, shows each figure against 2027, and is unchecked until ticked.
  const raised = draft.replace(/^ {4}single: 46500$/m, "    single: 48000");
  await page.getByLabel("Rule file").setInputFiles({ name: "ie-2028.yaml", mimeType: "text/yaml", buffer: Buffer.from(raised) });
  await expect(page.getByRole("status").filter({ hasText: "loaded as ie/2028" })).toBeVisible();
  const row = ireland.getByRole("row", { name: /IE-2028\.0/ });
  await expect(row).toContainText("Your file");
  await expect(row).toContainText("Not checked yet");
  const review = page.locator("section", { has: page.getByRole("heading", { name: /Review IE-2028\.0/ }) });
  await expect(review.getByRole("row", { name: /standardRateBand\.single/ })).toContainText("+1500");
  await review.getByRole("button", { name: "I've checked all of these" }).click();
  await expect(row).toContainText("Checked");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(ireland.getByRole("row", { name: /IE-2028/ })).toHaveCount(0);
});
