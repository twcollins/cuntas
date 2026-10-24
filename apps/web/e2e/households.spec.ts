import { expect, test, type Page } from "@playwright/test";

async function openSidebar(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
}

async function go(page: Page, label: string) {
  await openSidebar(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true }).click();
}

test("onboarding offers sign-in for people who already use Cúntas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "I already use Cúntas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
  await expect(page.getByText("localhost:8787")).toBeVisible();
});

test("two households on one device: add, switch, keep data, remove", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo" }).click();
  await expect(page.getByText("Your next step · step 3")).toBeVisible();

  await go(page, "Households");
  await page.getByLabel("Name", { exact: true }).fill("Granny's flat");
  await page.getByRole("button", { name: "Start a new household" }).click();
  await expect(page.getByRole("status")).toContainText("Created “Granny's flat”");

  // The new household is empty and open; the switcher lists both.
  await openSidebar(page);
  const switcher = page.getByRole("button", { name: /Switch household/ });
  await expect(switcher).toContainText("Granny's flat");
  await switcher.click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
  await page.getByRole("menuitemradio", { name: "Byrne-Murphy household" }).click();
  await expect(page.getByRole("button", { name: /Switch household/ })).not.toContainText("Granny's flat");

  // The demo's data is intact after switching back, and survives a reload.
  await page.reload();
  await go(page, "Accounts");
  await expect(page.getByText("Credit union", { exact: false }).first()).toBeVisible();

  // Remove the second household from this device.
  await go(page, "Households");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("listitem").filter({ hasText: "Granny's flat" }).getByRole("button", { name: "Remove from device" }).click();
  await expect(page.getByRole("status")).toContainText("Removed “Granny's flat”");
  await expect(page.getByRole("listitem").filter({ hasText: "Granny's flat" })).toHaveCount(0);
});
