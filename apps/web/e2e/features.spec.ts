import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, label: string) {
  const menu = page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" });
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

test("bills: detected subscriptions, the Spotify price rise, and a bill from a template", async ({ page }) => {
  await go(page, "Bills");
  await expect(page.getByRole("heading", { name: "Bills", exact: true })).toBeVisible();
  const spotify = page.getByRole("row", { name: /Spotify/ });
  await expect(spotify).toContainText(/Up .* from €17\.99/);
  await page.getByRole("button", { name: /\+ Local Property Tax/ }).click();
  await page.getByLabel("Amount").fill("405");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Local Property Tax").first()).toBeVisible();
  await page.getByRole("row", { name: /Netflix/ }).getByRole("button", { name: "Not a bill" }).click();
  await expect(page.getByRole("row", { name: /Netflix/ })).toHaveCount(0);
});

test("tax centre: payslip check flags missing credits; Form 11 and Scottish tax", async ({ page }) => {
  await go(page, "Tax centre");
  await expect(page.getByText(/Income tax is higher than expected/)).toBeVisible();

  const form11 = page.locator("section", { has: page.getByRole("heading", { name: /Form 11/ }) });
  await form11.getByLabel("Trading profit").fill("60000");
  await form11.getByLabel("Tax year").selectOption("2027");
  await expect(form11.getByRole("row", { name: /PRSI \(Class S/ })).toContainText("€2,632.50");

  const takeHome = page.locator("section", { has: page.getByRole("heading", { name: "Take-home pay" }) });
  await takeHome.getByLabel("Rules").selectOption("UK");
  await takeHome.getByLabel("Tax year").selectOption("2026-27");
  await takeHome.getByLabel("Gross annual pay").fill("50000");
  await takeHome.getByLabel("Income tax", { exact: true }).selectOption("scotland");
  await expect(takeHome.getByRole("row", { name: /Scottish income tax/ })).toContainText("£8,982.05");
});

test("tax centre: US take-home under the 2026 federal pack, marked as figures you haven't checked", async ({ page }) => {
  await go(page, "Tax centre");
  const takeHome = page.locator("section", { has: page.getByRole("heading", { name: "Take-home pay" }) });
  await takeHome.getByLabel("Rules").selectOption("US");
  await takeHome.getByLabel("Gross annual pay").fill("60000");
  await takeHome.getByLabel("Filing status").selectOption("single");
  await takeHome.getByLabel("Age").fill("35");
  await takeHome.getByLabel("401(k) (% of pay)").fill("0");
  await expect(takeHome.getByText("$50,390.00").first()).toBeVisible();
  await expect(takeHome.getByRole("row", { name: /Federal income tax/ })).toContainText("$5,020.00");
  await expect(takeHome.getByText("Figures not checked (2026)")).toBeVisible();

  await go(page, "Tax rules");
  const us = page.locator("section", { has: page.getByRole("heading", { name: "United States (federal)" }) });
  await expect(us.getByRole("row", { name: /US-2026\.1/ })).toContainText("Not checked yet");
});

test("retirement, wrapper comparison and the move what-if render from the demo", async ({ page }) => {
  await go(page, "Retirement");
  await expect(page.getByText("Central", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/UK State Pension .* from 67/)).toBeVisible();

  await go(page, "Compare wrappers");
  await expect(page.getByRole("cell", { name: /ETF or fund \(exit tax\)/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Investment Account.*not yet available/ })).toBeVisible();

  await go(page, "What if we moved");
  await page.getByLabel("Aoife").uncheck();
  await expect(page.getByText(/Stocks and shares ISA \(Seán\)/)).toBeVisible();
  await expect(page.getByText("Tax-free").first()).toBeVisible();

  await page.getByLabel("Move to").selectOption("US");
  await expect(page.getByRole("note")).toContainText("federal only");
  await expect(page.getByText(/€[\d,]+ → \$[\d,]+/)).toBeVisible();
  await expect(page.getByText("Taxed in US").first()).toBeVisible();
  await expect(page.getByText(/FinCEN Form 114/)).toBeVisible();
});

test("light and dark mode", async ({ page }) => {
  await go(page, "Settings");
  const html = page.locator("html");
  await page.getByRole("radio", { name: /Dark theme/ }).last().click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole("radio", { name: /Light theme/ }).last().click();
  await expect(html).not.toHaveClass(/dark/);
});

test("guide: links to each feature, theme toggle only in Settings", async ({ page }) => {
  await go(page, "Guide");
  await expect(page.getByRole("heading", { name: "Guide", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Debts →" }).click();
  await expect(page.getByRole("heading", { name: "Debts", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).locator("..").getByRole("radio", { name: /Dark theme/ })).toHaveCount(0);
});
