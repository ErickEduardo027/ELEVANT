import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { stubAirlineApi } from "./airline-api";

test.beforeEach(async ({ page }) => {
  await stubAirlineApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Correo corporativo" }).fill("airline.client@dev.elevant.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("Synthetic-Password!2026");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/portal$/);
});

test("shows real airline data for overview, flights, detail and profile", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Demo Airlines" })).toBeVisible();
  await expect(page.getByText("DEV-TAT-0002", { exact: true })).toBeVisible();
  await page.goto("/portal/vuelos");
  await expect(page.getByRole("heading", { level: 1, name: "Vuelos" })).toBeVisible();
  await page.getByRole("link", { name: /DEV-TAT-0002/ }).click();
  await expect(page).toHaveURL(/\/portal\/vuelos\/30000000-0000-7000-8000-000000000003$/);
  await expect(page.getByText("ZZ101")).toBeVisible();
  await page.goto("/portal/perfil");
  await expect(page.getByText("airline.client@dev.elevant.test")).toBeVisible();
  await expect(page.getByText("PUJ · Punta Cana")).toBeVisible();
});

test("keeps all portal modules visible as clearly marked, read-only previews", async ({ page }) => {
  for (const [path, title] of [
    ["solicitudes", "Solicitudes"], ["contratos", "Contratos"], ["documentos", "Documentos"],
    ["finanzas", "Finanzas"], ["reportes", "Reportes"],
  ]) {
    await page.goto(`/portal/${path}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(/Datos de demostración · solo vista previa/i)).toBeVisible();
    await expect(page.locator("#portal-content button:not([disabled])")).toHaveCount(0);
  }
  await page.goto("/portal/finanzas");
  await expect(page.getByRole("button", { name: "Aceptar prefactura" })).toBeDisabled();
  await page.goto("/portal/documentos");
  await expect(page.getByRole("button", { name: "Descargar documento" }).first()).toBeDisabled();
});

test("portal has no horizontal overflow or serious accessibility blockers", async ({ page }) => {
  for (const path of ["/portal", "/portal/vuelos", "/portal/documentos", "/portal/finanzas"]) {
    await page.goto(path);
    await expect(page.locator("#portal-content")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  const axePage = page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"];
  const results = await new AxeBuilder({ page: axePage }).include("#portal-content")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")))
    .toEqual([]);
});
