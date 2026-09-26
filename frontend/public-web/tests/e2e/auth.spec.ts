import { expect, test } from "@playwright/test";
import { stubAirlineApi } from "./airline-api";

async function enterAirline(page: import("@playwright/test").Page) {
  await page.getByRole("textbox", { name: "Correo corporativo" }).fill("airline.client@dev.elevant.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("Synthetic-Password!2026");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
}

test("public login uses the real API contract, remains tab-scoped and signs out", async ({ page }) => {
  const paths = await stubAirlineApi(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Usar credenciales de demostración/i })).toHaveCount(0);
  await enterAirline(page);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { level: 1, name: "Demo Airlines" })).toBeVisible();
  expect(paths).toEqual(["POST /api/v1/auth/session", "GET /api/v1/auth/session", "GET /api/v1/airline/portal/bootstrap"]);
  const stored = await page.evaluate(() => ({ session: sessionStorage.getItem("elevant-airline-session-v1"), local: localStorage.length }));
  expect(JSON.parse(stored.session ?? "null")).toEqual({ accessToken: "synthetic-e2e-token", expiresAt: "2099-01-01T00:00:00Z" });
  expect(stored.local).toBe(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Demo Airlines" })).toBeVisible();
  const mobileMenu = page.getByRole("button", { name: "Abrir navegación" });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  const signOut = await mobileMenu.isVisible()
    ? page.getByRole("dialog", { name: "Navegación" }).getByRole("button", { name: "Cerrar sesión" })
    : page.getByRole("button", { name: "Cerrar sesión" }).first();
  await signOut.click();
  await expect(page).toHaveURL(/\/login\?mode=login$/);
  expect(await page.evaluate(() => sessionStorage.getItem("elevant-airline-session-v1"))).toBeNull();
});

test("protected portal keeps safe returnTo and rejects non-airline actors", async ({ page }) => {
  await stubAirlineApi(page, { forbidden: true });
  await page.goto("/portal/finanzas");
  await expect(page).toHaveURL(/\/login\?mode=login&returnTo=%2Fportal%2Ffinanzas$/);
  await enterAirline(page);
  await expect(page.getByRole("tabpanel", { name: "Iniciar sesión" }).getByRole("alert")).toContainText("no tiene acceso");
  await expect(page).not.toHaveURL(/\/portal\/finanzas$/);
});

test("temporary password must be changed before a new login", async ({ page }) => {
  const paths = await stubAirlineApi(page, { changeRequired: true });
  await page.goto("/login");
  await enterAirline(page);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill("Synthetic-New-Password!2026");
  await page.getByLabel("Confirmar nueva contraseña", { exact: true }).fill("Synthetic-New-Password!2026");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText(/contraseña actualizada/i)).toBeVisible();
  expect(paths).toEqual(["POST /api/v1/auth/session", "POST /api/v1/auth/password-change"]);
  await expect(page).not.toHaveURL(/\/portal$/);
});

test("retired /dev-airline route is not available", async ({ page }) => {
  const response = await page.goto("/dev-airline");
  expect(response?.status()).toBe(404);
});
