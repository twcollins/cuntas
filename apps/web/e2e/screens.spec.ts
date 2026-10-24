import { expect, test } from "@playwright/test";

const OUT = process.env.SHOTS_DIR;
test.skip(!OUT, "set SHOTS_DIR to capture screenshots");

test("capture every page of the demo", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  for (const [path, name] of [["/", "overview"], ["/plan", "plan"], ["/transactions", "transactions"], ["/budgets", "budgets"], ["/bills", "bills"], ["/accounts", "accounts"], ["/import", "import"], ["/debts", "debts"], ["/goals", "goals"], ["/pensions", "pensions"], ["/retirement", "retirement"], ["/investing", "investing"], ["/tax", "tax"], ["/what-if", "what-if"], ["/household", "household"], ["/settings", "settings"], ["/admin", "admin"]] as const) {
    await page.evaluate((p) => { window.history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${test.info().project.name}-${name}.png`, fullPage: true });
  }
  // The same pages in dark mode.
  await page.evaluate(() => { window.history.pushState({}, "", "/settings"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.getByRole("radio", { name: /Dark theme/ }).last().click();
  for (const [path, name] of [["/", "overview"], ["/tax", "tax"], ["/retirement", "retirement"], ["/bills", "bills"]] as const) {
    await page.evaluate((p) => { window.history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${test.info().project.name}-dark-${name}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
