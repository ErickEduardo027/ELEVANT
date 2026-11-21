import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import { financeInvoices, signableContract, stubAirlineApi, stubAirlineFinance } from "./airline-api";
import { expectNoHorizontalOverflow } from "./layout";

/** The computed value of each CSS property, by its name. */
function computed(locator: Locator, properties: string[]) {
  return locator.evaluate((element, names) => Object.fromEntries(names.map((name) =>
    [name, getComputedStyle(element).getPropertyValue(name)])), properties);
}

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
    ["finanzas", "Facturas"], ["reportes", "Reportes operativos y financieros"],
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

// N14: an airline without a contract in force is told so by the badge and the top bar, never «autorizado»,
// and the station value keeps the page title visible on phones, where its label is hidden.
test("names an airline without a contract in force without horizontal overflow", async ({ page }) => {
  await page.route("**/api/v1/airline/portal/standing", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fallback(); return; }
    await route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({ organizationId: "10000000-0000-7000-8000-000000000002", status: "None", readOnly: true,
        stations: [], contracts: [] }) });
  });
  await page.reload();
  await expect(page.getByText("Todavía no tiene un contrato aprobado con AVIAM.")).toBeVisible();
  const topbar = page.getByRole("banner");
  await expect(topbar.getByText("Sin estación en vigor")).toBeVisible();
  const title = topbar.getByText("Inicio", { exact: true });
  await expect(title).toBeVisible();
  expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth), "título del portal sin recortar")
    .toBe(true);
  const sidebar = page.getByRole("complementary", { name: "Navegación principal" });
  if (await sidebar.isVisible()) await expect(sidebar.getByText("Sin contrato con AVIAM")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/autorizad/i);
  await expectNoHorizontalOverflow(page, "/portal sin contrato en vigor");
});

// N18: the portal forms reuse the field of the flight search and only their own button is primary, so «Borrar firma»
// stays secondary; «Reintentar» and the timeline's toggle are styled, the airline accepts the contract before drawing
// its signature, as AVIAM countersigns, and the dark navigation draws a dark, thin scrollbar.
test("styles the portal forms in AVIAM's signing order without horizontal overflow", async ({ page }) => {
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
  await page.route(`**/api/v1/contract-versions/${signableContract.versionId}/document`, async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fallback(); return; }
    await route.fulfill({ status: 200, headers, body: JSON.stringify(signableContract.document) });
  });
  // A failed read of the permits offers «Reintentar» above their form.
  await page.route("**/api/v1/airline/permits", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fallback(); return; }
    await route.fulfill({ status: 503, headers, body: JSON.stringify({ status: 503, title: "Unavailable" }) });
  });
  await page.goto("/portal/contratos");
  const submit = page.getByRole("button", { name: "Acepto y firmo" });
  await expect(submit).toBeVisible();

  const title = page.getByLabel("Cargo", { exact: true });
  const acceptance = page.getByRole("checkbox", { name: /Acepto este contrato en nombre de mi aerolínea/ });
  const signature = page.getByRole("img", { name: "Firma" });
  const tops = await Promise.all([title, acceptance, signature, submit].map(async (item) => (await item.boundingBox())!.y));
  expect.soft(tops, "cargo, casilla, firma y botón, en ese orden").toEqual([...tops].sort((a, b) => a - b));

  const field = { "min-height": "44px", "border-top": "1px solid rgb(184, 201, 219)", "border-top-left-radius": "8.8px",
    "background-color": "rgb(255, 255, 255)", color: "rgb(16, 33, 56)" };
  const permits = page.getByRole("region", { name: "Permisos de la aerolínea" });
  const kind = permits.getByLabel("Tipo de documento");
  for (const control of [page.getByLabel("Nombre completo de quien firma"), title, kind,
    permits.getByLabel("Número", { exact: true }), permits.getByLabel("Fecha de emisión")])
    expect.soft(await computed(control, Object.keys(field))).toEqual(field);
  // The list takes the font of its form, like the fields.
  expect.soft(await kind.evaluate((element) =>
    getComputedStyle(element).fontFamily === getComputedStyle(element.parentElement!).fontFamily)).toBe(true);

  const primary = { "background-color": "rgb(23, 87, 216)", color: "rgb(255, 255, 255)" };
  for (const button of [submit, permits.getByRole("button", { name: "Enviar permiso" })])
    expect.soft(await computed(button, Object.keys(primary))).toEqual(primary);
  expect.soft(await computed(page.getByRole("button", { name: "Borrar firma" }), ["background-color", "color", "border-top"]))
    .toEqual({ "background-color": "rgb(255, 255, 255)", color: "rgb(17, 44, 70)", "border-top": "1px solid rgb(200, 211, 223)" });
  const secondary = { "background-color": "rgb(255, 255, 255)", color: "rgb(17, 85, 180)",
    "border-top": "1px solid rgb(184, 201, 223)" };
  for (const button of [permits.getByRole("button", { name: "Reintentar" }),
    page.getByRole("button", { name: "Ver línea de tiempo del contrato" })])
    expect.soft(await computed(button, Object.keys(secondary))).toEqual(secondary);

  const dark = { "color-scheme": "dark", "scrollbar-width": "thin" };
  const sidebar = page.getByRole("complementary", { name: "Navegación principal" });
  if (await sidebar.isVisible()) expect.soft(await computed(sidebar, Object.keys(dark))).toEqual(dark);
  else {
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    const panel = page.getByRole("dialog", { name: "Navegación" }).locator(":scope > div");
    await expect(panel).toBeVisible();
    expect.soft(await computed(panel, Object.keys(dark))).toEqual(dark);
    await page.getByRole("button", { name: "Cerrar navegación" }).click();
  }
  await expectNoHorizontalOverflow(page, "/portal/contratos con el formulario de firma");
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

/** Serious or critical axe violations inside the portal's content. */
async function seriousViolations(page: import("@playwright/test").Page) {
  const axePage = page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"];
  const results = await new AxeBuilder({ page: axePage }).include("#portal-content")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")).map((item) => item.id);
}

// PR F: the billing reads as a conventional one: invoices in a table, each with its own page that survives Back and
// a reload, one primary action, and the statement on its own page with the breakdown in a drawer.
test("billing: invoice table, invoice page with its URL and statement without overflow", async ({ page }) => {
  await stubAirlineFinance(page);
  const [pending] = financeInvoices;
  await page.goto("/portal/finanzas");
  const table = page.getByRole("table", { name: "Facturas" });
  await expect(table.getByRole("row", { name: /E310000000104/ })).toContainText("47 días de atraso");
  await expect(page.getByLabel("Resumen de facturas")).toContainText("3 de 4");
  await expect(table.getByRole("row", { name: /^Total \(4 facturas\)/ })).toContainText("USD 17,186.40");
  await expectNoHorizontalOverflow(page, "/portal/finanzas con facturas");
  expect(await seriousViolations(page), "/portal/finanzas").toEqual([]);

  await table.getByRole("link", { name: "Ver detalle de Factura E310000000101" }).click();
  await expect(page).toHaveURL(new RegExp(`/portal/finanzas/facturas/${pending.id}$`));
  const detail = page.getByRole("region", { name: "Detalle de factura" });
  await expect(detail.getByRole("heading", { level: 1, name: "Factura E310000000101" })).toBeVisible();
  await expect(detail.getByText("Emitida el 05/11/2026")).toBeVisible();
  await expect(detail.getByRole("row", { name: /Manejo de equipaje/ })).toContainText("649.00");
  // One primary action: the card payment.
  await expect(page.locator("#portal-content [data-variant=primary]")).toHaveCount(1);
  await expect(detail.getByRole("button", { name: "Pagar con tarjeta USD 1,480.90" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "detalle de factura");
  expect(await seriousViolations(page), "detalle de factura").toEqual([]);

  await page.reload();
  await expect(detail.getByRole("heading", { level: 1, name: "Factura E310000000101" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/portal\/finanzas$/);
  await expect(table).toBeVisible();

  await page.getByRole("link", { name: "Estado de cuenta" }).click();
  await expect(page).toHaveURL(/\/portal\/finanzas\/estado-de-cuenta$/);
  const statement = page.getByRole("region", { name: "Estado de cuenta de aerolínea" });
  await expect(statement.getByRole("table", { name: "Movimientos en USD" }).getByRole("row", { name: /^Saldo al corte/ }))
    .toContainText("USD 14,186.40");
  await expectNoHorizontalOverflow(page, "estado de cuenta");
  expect(await seriousViolations(page), "estado de cuenta").toEqual([]);
  const opener = statement.getByRole("button", { name: "Ver cobro BANK-2026-1109" });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "BANK-2026-1109 · PUJ" });
  await expect(drawer.getByText("Pago de factura")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});