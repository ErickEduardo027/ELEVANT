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
  expect(paths.slice(0, 3)).toEqual(["POST /api/v1/auth/session", "GET /api/v1/auth/session", "GET /api/v1/airline/portal/bootstrap"]);
  await expect.poll(() => paths.includes("GET /api/v1/changes")).toBe(true);
  const stored = await page.evaluate(() => ({ session: sessionStorage.getItem("elevant-airline-session-v1"), local: localStorage.length }));
  expect(JSON.parse(stored.session ?? "null")).toEqual({ accessToken: "synthetic-e2e-token", expiresAt: "2099-01-01T00:00:00Z", refreshToken: null });
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
  await expect(page.locator("#login-panel").getByRole("alert")).toContainText("no tiene acceso");
  await expect(page).not.toHaveURL(/\/portal\/finanzas$/);
});

test("temporary password must be changed before a new login", async ({ page }) => {
  const paths = await stubAirlineApi(page, { changeRequired: true });
  await page.goto("/login");
  await enterAirline(page);
  // N17: a step, not an error. The requirements are on screen before anything is typed.
  await expect(page.getByLabel("Nueva contraseña", { exact: true })).toBeFocused();
  await expect(page.locator("#login-panel").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Requisitos de la contraseña" })).toBeVisible();
  await page.getByLabel("Nueva contraseña", { exact: true }).fill("Synthetic-New-Password!2026");
  await page.getByLabel("Confirmar nueva contraseña", { exact: true }).fill("Synthetic-New-Password!2026");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText(/contraseña actualizada/i)).toBeVisible();
  expect(paths).toEqual(["POST /api/v1/auth/session", "POST /api/v1/auth/password-change"]);
  await expect(page).not.toHaveURL(/\/portal$/);
});

// N17: a desktop window under 50rem high puts the login form in two columns; only the buttons may share a row.
for (const step of ["code", "password"] as const) {
  test(`the ${step} step keeps its title${step === "password" ? ", its one instruction and the requirements" : " and its one instruction"} at full width in a short window`,
    async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Layout of a short desktop window");
      await page.setViewportSize({ width: 1366, height: 657 });
      await stubAirlineApi(page, step === "code" ? { codeRequired: true } : { changeRequired: true });
      await page.goto("/login");
      await enterAirline(page);
      const field = step === "code"
        ? page.getByRole("textbox", { name: /Código de verificación/ })
        : page.getByLabel("Nueva contraseña", { exact: true });
      await expect(field).toBeFocused();
      const form = page.locator("form").filter({ has: field });
      const instruction = form.getByText(step === "code" ? /Pedimos un código/ : /es temporal/);
      await expect(instruction).toHaveCount(1);
      const parts = [form.getByRole("heading", { level: 3 }), instruction];
      if (step === "password") parts.push(form.getByRole("list", { name: "Requisitos de la contraseña" }));
      const formWidth = (await form.boundingBox())!.width;
      for (const part of parts) expect((await part.boundingBox())!.width).toBeGreaterThan(formWidth * 0.9);
    });
}

test("retired /dev-airline route is not available", async ({ page }) => {
  const response = await page.goto("/dev-airline");
  expect(response?.status()).toBe(404);
});

test("legacy registration URL joins the real commercial intake", async ({ page }) => {
  await page.goto("/login?mode=register");
  await expect(page).toHaveURL(/\/solicitar-acceso$/);
  await expect(page.getByRole("heading", { name: /Su próxima escala empieza aquí/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Razón social" })).toHaveCount(0);
});
