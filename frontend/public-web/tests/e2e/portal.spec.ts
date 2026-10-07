import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { stubAirlineApi } from "./airline-api";
import { expectNoHorizontalOverflow } from "./layout";

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

test("renders every portal module with its heading, even when a read is unavailable", async ({ page }) => {
  for (const [path, title] of [
    ["solicitudes", "Solicitudes con estado visible."], ["documentos", "Documentos"],
    ["finanzas", "Finanzas"], ["reportes", "Reportes operativos y financieros"],
  ]) {
    await page.goto(`/portal/${path}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("#portal-content")).toBeVisible();
  }
});

test("shows real tenant-scoped contract history without a demo card", async ({ page }) => {
  await page.goto("/portal/contratos");
  await expect(page.getByRole("heading", { level: 1, name: "Contratos y tarifarios" })).toBeVisible();
  await expect(page.getByText("DEV-CONTRACT-0001").first()).toBeVisible();
  await expect(page.getByText("Manejo de equipaje")).toBeVisible();
  await expect(page.getByText("DEMO-CON-001")).toHaveCount(0);
});

test("portal has no horizontal overflow or serious accessibility blockers", async ({ page }) => {
  for (const path of ["/portal", "/portal/vuelos", "/portal/solicitudes", "/portal/contratos",
    "/portal/documentos", "/portal/finanzas", "/portal/reportes", "/portal/perfil"]) {
    await page.goto(path);
    await expect(page.locator("#portal-content")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page, path);
  }
  const axePage = page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"];
  const results = await new AxeBuilder({ page: axePage }).include("#portal-content")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")))
    .toEqual([]);
});
