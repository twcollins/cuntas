import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, label: string) {
  const menu = page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name: label, exact: true });
  if (!(await link.isVisible())) await nav.getByRole("button", { name: /^More/ }).click();
  await link.click();
}

test("a US citizen living in Ireland: FBAR and filing in the Tax centre, Social Security on Retirement", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  await go(page, "Tax centre");
  await expect(page.getByRole("heading", { name: "US reporting: accounts outside the US" })).toHaveCount(0);

  // Aoife is also American.
  await go(page, "Household");
  await page.getByRole("listitem").filter({ hasText: "Aoife" }).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: "American" }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  await go(page, "Tax centre");
  const aoife = page.getByRole("region", { name: "US reporting for Aoife" });
  await expect(aoife).toContainText("US citizen living in Ireland");
  await expect(aoife).toContainText("FBAR needed");
  await expect(aoife).toContainText(/Due .* while living abroad/);
  await expect(aoife).toContainText("file a US return every year");
  await expect(page.getByRole("region", { name: "US reporting for Seán" })).toHaveCount(0);

  // Five years in the US before moving home, with a figure from the SSA statement.
  await go(page, "Retirement");
  await page.getByLabel("US work years").fill("5");
  await page.getByLabel("SSA benefit at full age ($/mo)").fill("600");
  await page.getByLabel("SSA benefit at full age ($/mo)").blur();
  await expect(page.getByText(/US Social Security €[\d,]+ from 67/)).toBeVisible();
  const claiming = page.locator("section", { has: page.getByRole("heading", { name: "Social Security: when to claim" }) });
  await expect(claiming).toContainText("from your SSA statement");
  await expect(claiming.getByRole("row", { name: /^70 / })).toContainText("$744.00");
  await expect(claiming.getByRole("row", { name: /^62 / })).toContainText("$420.00");
});

test("a US household: Social Security from pay, no Irish or UK years", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your first name").fill("Alex");
  await page.getByLabel("Where do you live?").selectOption("US");
  await page.getByRole("button", { name: "Create household" }).click();
  const checklist = page.getByRole("region", { name: "Get set up" });
  await checklist.getByRole("button", { name: /^Add your/ }).click();
  const you = page.getByRole("dialog", { name: "About you, Alex" });
  await you.getByLabel("Date of birth").fill("1985-05-20");
  await you.getByLabel("Pay a year, before tax").fill("60000");
  await you.getByLabel("State").selectOption("TX");
  await you.getByRole("button", { name: "Save" }).click();

  await go(page, "Retirement");
  await expect(page.getByLabel("IE PRSI years")).toHaveCount(0);
  const claiming = page.locator("section", { has: page.getByRole("heading", { name: "Social Security: when to claim" }) });
  await expect(claiming).toContainText("work since 22 assumed");
  // Working from 22 to 67 at 60,000: the best 35 years give 2,345 a month at 67.
  await expect(claiming.getByRole("row", { name: /^67 / })).toContainText("$2,345.00");
  await page.getByLabel("US work years").fill("13");
  await expect(claiming).not.toContainText("work since 22 assumed");
});
