import { expect, type Page } from "@playwright/test";

/** Fresh visit with empty local storage (guest can skip login). */
export async function openApp(page: Page, options?: { askPermissions?: boolean }) {
  const askPermissions = Boolean(options?.askPermissions);
  await page.addInitScript((ask) => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      // Default: skip permissions sheet so feature tests stay stable
      if (!ask) localStorage.setItem("chrono_perms_onboarded", "1");
    } catch {
      /* ignore */
    }
  }, askPermissions);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /welcome back|create account/i })).toBeVisible({
    timeout: 15_000,
  });
}

export async function dismissPermissionsIfOpen(page: Page) {
  // Permissions sheet opens ~450ms after auth — wait briefly then dismiss
  const sheet = page.getByRole("heading", {
    name: /allow access for alarms|allow access for home screen|app permissions/i,
  });
  try {
    await sheet.waitFor({ state: "visible", timeout: 3500 });
  } catch {
    return;
  }
  const notNow = page.getByRole("button", { name: /not now/i });
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click();
  } else {
    await page.getByRole("button", { name: /^continue$/i }).click();
  }
  await sheet.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
}

export async function skipLogin(page: Page) {
  await page.getByRole("button", { name: /skip for now/i }).click();
  await expect(page.getByRole("heading", { name: /welcome home/i })).toBeVisible({
    timeout: 15_000,
  });
  await dismissPermissionsIfOpen(page);
}

export async function openMenu(page: Page) {
  await page.getByRole("button", { name: /open menu/i }).click();
  await expect(page.getByText("Menu", { exact: true })).toBeVisible();
}

export async function goHome(page: Page) {
  const home = page.getByRole("button", { name: /go home/i });
  if (await home.isVisible().catch(() => false)) {
    await home.click();
    await expect(page.getByRole("heading", { name: /welcome home/i })).toBeVisible({
      timeout: 10_000,
    });
  }
}

/** Leave dashboard so the bottom nav appears. */
export async function enterSuite(page: Page) {
  const nav = page.locator("nav.bottom-nav");
  if (await nav.isVisible().catch(() => false)) return;
  const alarmsCard = page.getByRole("button", { name: /alarms/i }).first();
  if (await alarmsCard.isVisible().catch(() => false)) {
    await alarmsCard.click();
    await expect(page.getByRole("heading", { name: "Alarms" })).toBeVisible();
  }
}

/** Bottom nav — prefers full label, falls back to short mobile label. */
export async function openNav(page: Page, names: RegExp[]) {
  await enterSuite(page);
  const nav = page.locator("nav.bottom-nav");
  await expect(nav).toBeVisible({ timeout: 10_000 });
  for (const name of names) {
    const btn = nav.getByRole("button", { name }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      return;
    }
  }
  await nav.getByRole("button", { name: names[0] }).first().click();
}

/** Tomorrow as YYYY-MM-DD for date inputs */
export function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Dashboard feature cards include captions in the accessible name. */
export async function openDashCard(page: Page, title: string) {
  const card = page
    .locator("button.dash-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();
}
