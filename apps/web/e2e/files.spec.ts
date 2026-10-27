import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function go(page: Page, label: string) {
  const menu = page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name: label, exact: true });
  if (!(await link.isVisible())) await nav.getByRole("button", { name: /^More/ }).click();
  await link.click();
}

/** Drops a file on the page the way a browser does when it's dragged in from the desktop (or opened in the app). */
async function dropFile(page: Page, name: string, text: string) {
  const transfer = await page.evaluateHandle(([n, t]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([t], n));
    return dt;
  }, [name, text] as const);
  for (const type of ["dragenter", "dragover", "drop"]) await page.dispatchEvent("main", type, { dataTransfer: transfer });
}

async function saved(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const download = page.waitForEvent("download");
  await click();
  const file = await download;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, "utf8") };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  await expect(page.getByText("Your next step · step 3")).toBeVisible();
});

test("a rule file opened from anywhere goes to Tax rules and is checked there", async ({ page }) => {
  await go(page, "Tax rules");
  const ireland = page.locator("section", { has: page.getByRole("heading", { name: "Ireland", exact: true }) });
  const draft = await saved(page, () => ireland.getByRole("button", { name: /^Start 2028 from 2027$/ }).click());
  await go(page, "Overview");
  await dropFile(page, draft.name, draft.text);
  await expect(page.getByRole("heading", { name: "Tax rules", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "ie-2028.yaml loaded as ie/2028" })).toBeVisible();
  await expect(ireland.getByRole("row", { name: /IE-2028\.0/ })).toContainText("Your file");
});

test("an export opened from anywhere asks before it replaces the household; exporting is recorded as a backup", async ({ page }) => {
  await go(page, "Settings");
  await expect(page.getByText("Not backed up from this device yet.")).toBeVisible();
  const exported = await saved(page, () => page.getByRole("button", { name: "Export JSON" }).click());
  await expect(page.getByText(/^Last backed up or exported /)).toBeVisible();

  await go(page, "Accounts");
  await dropFile(page, exported.name, exported.text);
  const ask = page.locator("section", { has: page.getByRole("heading", { name: `Restore ${exported.name}?` }) });
  await expect(ask).toContainText("This replaces");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);

  await dropFile(page, exported.name, exported.text);
  await ask.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toHaveText("Data restored.");
});

test("a month without a backup, after changes, Overview asks for one", async ({ page }) => {
  // The demo was added just now; move the clock on a month and change something.
  await page.clock.setFixedTime(new Date(Date.now() + 31 * 86_400_000));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Add" });
  await sheet.getByLabel(/^Amount/).fill("4.50");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await go(page, "Transactions");
  await go(page, "Overview");
  const ask = page.getByRole("region", { name: "Back up this household" });
  await expect(ask).toContainText("Not backed up yet");
  await ask.getByRole("button", { name: "Not now" }).click();
  await expect(ask).toHaveCount(0);
});
