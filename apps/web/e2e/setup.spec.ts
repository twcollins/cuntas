import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

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
}

test("a new user reaches a first budget from the checklist: you, import, budget", async ({ page }) => {
  const started = Date.now();
  let actions = 3; // onboarding: name, country, create
  await newUsHousehold(page);
  const checklist = page.getByRole("region", { name: "Get set up" });
  await expect(checklist).toContainText("0 of 4 done");
  // The checklist stands in for step 0.
  await expect(page.getByText("Start tracking where your money goes")).toHaveCount(0);

  await checklist.getByRole("button", { name: "Add your birth date, pay and state" }).click();
  const you = page.getByRole("dialog", { name: "About you, Alex" });
  await you.getByLabel("Date of birth").fill("1988-04-02");
  await you.getByLabel("Pay a year, before tax").fill("85000");
  await you.getByLabel("State").selectOption("TX");
  await you.getByRole("button", { name: "Save" }).click();
  actions += 5;
  await expect(checklist.getByRole("listitem", { name: "You: done" })).toContainText("Alex, US (Texas), $85,000 a year");

  await checklist.getByRole("link", { name: "Import statements" }).first().click();
  await page.getByLabel("Statement files").setInputFiles([join(fixtures, "chase-checking.csv"), join(fixtures, "amex.csv")]);
  await page.getByRole("button", { name: "Import 4 transactions" }).click();
  actions += 3;

  await go(page, "Overview");
  actions += 1;
  await expect(checklist).toContainText("3 of 4 done");
  await expect(checklist.getByRole("listitem", { name: "Accounts: done" })).toContainText("Chase (checking), American Express ··1003");
  await expect(checklist.getByRole("listitem", { name: "Spending: done" })).toContainText("4 transactions");
  await checklist.getByRole("button", { name: "Make my budget" }).click();
  actions += 1;

  // Done: the checklist gives way to the next step, and the budget is there to adjust.
  await expect(checklist).toHaveCount(0);
  await go(page, "Budgets");
  await expect(page.getByText("Groceries").first()).toBeVisible();
  await expect(page.getByText("Holidays and travel").first()).toBeVisible();
  test.info().annotations.push({ type: "first budget", description: `${actions} actions, ${Math.round((Date.now() - started) / 1000)} s automated` });
  expect(actions).toBeLessThanOrEqual(15);
});

test("no statements: a rough monthly figure, then a budget from it", async ({ page }) => {
  await newUsHousehold(page);
  const checklist = page.getByRole("region", { name: "Get set up" });
  await checklist.getByRole("button", { name: "give a rough monthly figure" }).click();
  const sheet = page.getByRole("dialog", { name: "Monthly spending" });
  await sheet.getByLabel("Groceries").fill("600");
  await sheet.getByLabel("Rent or mortgage").fill("1800");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(checklist.getByRole("listitem", { name: "Spending: done" })).toContainText("About $2,400 a month, from your estimate");
  await expect(checklist.getByRole("listitem", { name: "Budget: to do" })).toContainText("from your estimate");
  await checklist.getByRole("button", { name: "Make my budget" }).click();
  await expect(checklist.getByRole("listitem", { name: "Budget: done" })).toBeVisible();

  // An account by hand, in place.
  await checklist.getByRole("button", { name: "Add an account" }).click();
  const add = page.getByRole("dialog", { name: "Add an account" });
  await add.getByLabel("Name").fill("Credit union checking");
  await add.getByLabel("Balance today").fill("1250");
  await add.getByRole("button", { name: "Add account" }).click();
  await expect(checklist.getByRole("listitem", { name: "Accounts: done" })).toContainText("Credit union checking");

  // Hide puts the next-step card back.
  await checklist.getByRole("button", { name: "Hide" }).click();
  await expect(checklist).toHaveCount(0);
});

test("phone: tab bar, More opens the full menu, and no page scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  await tabs.getByRole("button", { name: "More" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Budgets" }).click();
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
  await expect(tabs.getByRole("button", { name: "Add" })).toBeVisible();

  for (const path of ["/", "/transactions", "/review", "/import", "/accounts", "/budgets", "/plan", "/bills", "/debts", "/goals", "/tax", "/pensions", "/retirement", "/investing", "/what-if", "/tax-rules", "/household", "/households", "/account", "/settings", "/guide"]) {
    await page.goto(path);
    // Charts draw once at their default size before fitting the screen, so wait for the page to settle.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: path }).toBeLessThanOrEqual(375);
  }
});
