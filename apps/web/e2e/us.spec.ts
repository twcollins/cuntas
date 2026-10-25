import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true }).click();
}

test("a US household: dollars, US wording, federal take-home and the US next steps", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Household name").fill("The Smiths");
  await page.getByLabel("Where do you live?").selectOption("US");
  await expect(page.getByLabel("Base currency")).toHaveValue("USD");
  await page.getByRole("button", { name: "Create household" }).click();

  await go(page, "Household");
  await page.getByRole("button", { name: "Add person" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Alex");
  await form.getByLabel("Gross annual pay").fill("60000");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Gross \$60,000 → net \$50,390 a year/)).toBeVisible();
  await expect(page.getByText("Federal only: choose a state")).toBeVisible();

  // Illinois: 4.95% of (60,000 - 2,925) = 2,825.21 off take-home.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByText("US tax details (used while US resident)").click();
  await page.getByRole("dialog").getByLabel("State").selectOption("IL");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Gross \$60,000 → net \$47,565 a year/)).toBeVisible();
  await expect(page.getByText("US-IL-2026.1")).toBeVisible();

  // Indiana, Marion County: 2.95% + 2.02% of (60,000 - 1,000) = 2,932.30 off federal take-home.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByText("US tax details (used while US resident)").click();
  await page.getByRole("dialog").getByLabel("State").selectOption("IN");
  await page.getByRole("dialog").getByLabel("County").selectOption("marion");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Gross \$60,000 → net \$47,458 a year/)).toBeVisible();

  await go(page, "Overview");
  await expect(page.getByText("Start tracking where your money goes")).toBeVisible();
  await expect(page.getByText("Check your 2026 US tax figures")).toBeVisible();
  await expect(page.getByText("Check your 2026 Indiana tax figures")).toBeVisible();

  await go(page, "401(k) and IRAs");
  await go(page, "Accounts");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByRole("dialog").getByLabel("Type")).toContainText("Checking account");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await go(page, "Tax centre");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "US limits and estimated tax" }) });
  await expect(card.getByRole("row", { name: /401\(k\)/ })).toContainText("$24,500.00");
  await expect(page.getByText("US federal return for 2026")).toBeVisible();
});
