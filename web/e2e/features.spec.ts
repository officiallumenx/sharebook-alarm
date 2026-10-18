import { test, expect } from "@playwright/test";
import {
  dismissPermissionsIfOpen,
  goHome,
  openApp,
  openDashCard,
  openMenu,
  openNav,
  skipLogin,
  tomorrowISO,
} from "./helpers";

test.describe("Smart Voice Alarm — feature suite", () => {
  test("auth: skip login enters guest home", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("button", { name: /skip for now/i })).toBeVisible();
    await skipLogin(page);
    await expect(page.getByRole("heading", { name: /welcome home/i })).toBeVisible();
    await expect(page.getByText("Guest").first()).toBeVisible();
    await expect(page.getByText("Spaces")).toBeVisible();
  });

  test("permissions: onboarding sheet asks for mobile access", async ({ page }) => {
    await openApp(page, { askPermissions: true });
    await page.getByRole("button", { name: /skip for now/i }).click();
    await expect(page.getByRole("heading", { name: /allow access for alarms/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/notifications/i).first()).toBeVisible();
    await expect(page.getByText(/microphone/i).first()).toBeVisible();
    await expect(page.getByText(/sound & music/i)).toBeVisible();
    await page.getByRole("button", { name: /allow all/i }).click();
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page.getByRole("heading", { name: /welcome home/i })).toBeVisible();
  });

  test("auth: register and log back in", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^register$/i }).first().click();
    await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();

    const phone = `9${Date.now().toString().slice(-9)}`;
    await page.getByLabel(/phone number/i).fill(phone);
    await page.getByLabel(/^name$/i).fill("Playwright User");
    await page.getByLabel(/^age$/i).fill("28");
    await page.getByRole("button", { name: /^female$/i }).click();
    await page.locator("#auth-password").fill("secret12");
    await page.locator("#auth-confirm").fill("secret12");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByRole("heading", { name: /welcome home/i })).toBeVisible();
    await dismissPermissionsIfOpen(page);
    await expect(page.getByText("Playwright").first()).toBeVisible();

    await openMenu(page);
    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();

    await page.getByLabel(/phone number/i).fill(phone);
    await page.locator("#auth-password").fill("secret12");
    await page.getByRole("button", { name: /^log in$/i }).last().click();
    await expect(page.getByRole("heading", { name: /welcome home/i })).toBeVisible();
    await dismissPermissionsIfOpen(page);
  });

  test("dashboard cards open Alarms, Notes, To-Do", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);

    await openDashCard(page, "Alarms");
    await expect(page.getByRole("heading", { name: "Alarms", exact: true })).toBeVisible();
    await goHome(page);

    await openDashCard(page, "Notes");
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
    await goHome(page);

    await openDashCard(page, "To-Do");
    await expect(page.getByRole("heading", { name: "To-Do", exact: true })).toBeVisible();
  });

  test("clock tab shows local time", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openNav(page, [/clock/i]);
    await expect(page.getByText(/local time/i)).toBeVisible();
  });

  test("alarms: create once alarm with date", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openDashCard(page, "Alarms");
    await expect(page.getByRole("heading", { name: "Alarms", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByRole("heading", { name: /set alarm/i })).toBeVisible();

    await page.locator('input[type="date"]').fill(tomorrowISO());
    await page.getByRole("button", { name: "System", exact: true }).click();
    await page.getByPlaceholder(/empty = ringtone only|spoken label/i).fill("Playwright wake");
    await page.getByRole("button", { name: /^continue$/i }).click();

    await expect(page.getByRole("heading", { name: /repeat or once/i })).toBeVisible();
    await page
      .locator("button")
      .filter({ has: page.getByText("Once", { exact: true }) })
      .first()
      .click();
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByRole("heading", { name: /set alarm/i })).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(/playwright wake/i)).toBeVisible();
  });

  test("notes: create and see saved note", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openDashCard(page, "Notes");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByRole("heading", { name: /create new note/i })).toBeVisible();

    await page.getByPlaceholder(/title \(optional\)/i).fill("E2E Note");
    await page.getByRole("textbox", { name: /note body/i }).fill("Hello from Playwright");
    await page.getByRole("button", { name: /save note/i }).click();

    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("E2E Note")).toBeVisible();
  });

  test("notes: editor paste inserts clipboard text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openApp(page);
    await skipLogin(page);
    await openDashCard(page, "Notes");
    await page.getByRole("button", { name: /^add$/i }).click();
    const body = page.getByRole("textbox", { name: /note body/i });
    await body.click();
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("Clipboard paste works");
    });
    await body.focus();
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+KeyV`);
    await expect(body).toContainText("Clipboard paste works");
  });

  test("todo: create and see task", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openDashCard(page, "To-Do");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByRole("heading", { name: /schedule new task/i })).toBeVisible();

    await page
      .locator("form")
      .locator('input[type="text"]')
      .first()
      .fill("Buy milk E2E");
    await page.getByRole("button", { name: /save task/i }).click();

    await expect(page.getByRole("heading", { name: /schedule new task/i })).toBeHidden({
      timeout: 10_000,
    });
    await expect(page.getByText("Buy milk E2E")).toBeVisible();
  });

  test("timer: preset, start, pause, reset", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openNav(page, [/timer/i]);
    await expect(page.getByRole("heading", { name: "Timer" })).toBeVisible();

    await page.getByRole("button", { name: /\+1 min/i }).click();
    await page.getByRole("button", { name: /start timer/i }).click();
    await expect(page.getByText(/running/i)).toBeVisible();

    await page.getByRole("button", { name: /pause timer/i }).click();
    await expect(page.getByText(/^paused$/i)).toBeVisible();

    // Dismiss ring overlay if a prior alarm/timer stole focus
    const dismiss = page.getByRole("button", { name: /^dismiss$/i });
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
    }

    await page.getByRole("button", { name: /reset timer/i }).click({ force: true });
    await expect(page.getByText(/^ready$/i)).toBeVisible();
  });

  test("stopwatch: start, lap, reset", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openNav(page, [/stopwatch|watch/i]);
    await expect(page.getByRole("heading", { name: "Stopwatch" })).toBeVisible();

    await page.getByRole("button", { name: /start stopwatch/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^lap$/i }).click();
    await expect(page.getByText(/lap 1/i)).toBeVisible();
    await page.getByRole("button", { name: /reset stopwatch/i }).click();
    await expect(page.getByText(/ready/i)).toBeVisible();
  });

  test("settings: theme, clock, ringtone, background section", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openNav(page, [/settings/i]);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await expect(page.getByText(/phone permissions/i)).toBeVisible();
    await expect(page.getByText(/background alarms/i)).toBeVisible();
    await expect(page.getByText(/^keepalive$/i)).toBeVisible();
    await expect(page.getByText(/^ringtone$/i)).toBeVisible();

    await page.getByRole("button", { name: /^review$/i }).click();
    await expect(page.getByRole("heading", { name: /app permissions|allow access/i })).toBeVisible();
    await page.getByRole("button", { name: /not now|continue/i }).first().click();

    await page.getByRole("switch", { name: /24-hour clock/i }).click();
    await page
      .locator("button")
      .filter({ has: page.getByText("Olive", { exact: true }) })
      .first()
      .click();
    await expect(page.locator("html")).toHaveClass(/theme-olive/);

    await page.getByRole("button", { name: /faqs/i }).click();
    await expect(page.getByText(/why didn.?t my alarm ring/i)).toBeVisible();
  });

  test("my voices: panel loads record UI", async ({ page, context }) => {
    await context.grantPermissions(["microphone"]).catch(() => undefined);
    await openApp(page);
    await skipLogin(page);
    await openMenu(page);
    await page.getByRole("button", { name: /my voices/i }).click();
    await expect(page.getByRole("heading", { name: /my voices/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^record$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^upload$/i })).toBeVisible();
  });

  test("menu: guest can open sign-in again", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await openMenu(page);
    await page.getByRole("button", { name: /log in \/ register/i }).click();
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /skip for now/i })).toBeVisible();
  });

  test("service worker registers for background alarms", async ({ page }) => {
    await openApp(page);
    await skipLogin(page);
    await page.waitForTimeout(800);
    const hasSw = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration("/");
      return Boolean(reg);
    });
    expect(hasSw).toBeTruthy();
  });
});
