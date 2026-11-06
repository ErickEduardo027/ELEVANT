import { expect, test } from "@playwright/test";
import { call, login } from "./support/api";
import { forwardApi, loginPortal, loginPrivate, openModule, snap } from "./support/browser";
import { API, loadRun, PUBLIC_WEB, savePassword, saveRun, startRun } from "./support/env";
import { linkTo, waitForEmail } from "./support/mailpit";

// Fase 1 · Comercial: an airline asks for services on the public site, Contratos verifies and
// approves it, Superadmin opens its portal account, the representative activates it, Contratos
// prices the draft and Finanzas approves it. Every run uses its own synthetic airline.

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const pick = (alphabet: string) => alphabet[Math.floor(Math.random() * alphabet.length)];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  test.skip(!health?.ok, "The local stack is not running.");
});

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

test("Finanzas publica la tarifa base de los servicios del catálogo público", async ({ page }) => {
  startRun();
  const catalog = await call<{ services: Array<{ id: string; name: string }> }>(null, "GET", "/public/commercial-catalog");
  const finance = await login("finance");
  const versions = await call<Array<{ id: string; status: string }>>(finance, "GET", "/finance/service-tariffs?currency=USD");
  const published = versions.data.find(item => item.status === "Published");
  const detail = published ? await call<{ rates: Array<{ serviceId: string }> }>(finance, "GET", `/finance/service-tariffs/${published.id}`) : null;
  const missing = catalog.data.services.filter(service => !detail?.data.rates.some(rate => rate.serviceId === service.id));
  await loginPrivate(page, "finance");
  await openModule(page, "Tarifarios");
  await openModule(page, "Tarifario de servicios");
  if (missing.length) {
    await expect(page.getByText("Cargando tarifas…")).toBeHidden();
    await expect(page.getByRole("button", { name: /USD · desde/ }).first()).toBeVisible();
    const draft = page.getByRole("button", { name: /USD · desde .* Borrador/ });
    if (await draft.count()) await draft.first().click();
    else await page.getByRole("button", { name: "Nueva versión" }).click();
    await expect(page.getByRole("button", { name: "Publicar" })).toBeVisible();
    for (const service of missing) {
      const add = page.getByLabel("Añadir servicio");
      if (!await add.isVisible()) break;
      const option = add.locator("option").filter({ hasText: service.name }).first();
      if (await option.count()) await add.selectOption({ value: await option.getAttribute("value") ?? "" });
    }
    // Hueco 1-E: the seeded catalog services carry the text «operación» instead of a billing unit code,
    // and the tariff page would send it as is. The run picks the real unit until it is fixed.
    const units = page.getByLabel(/^Unidad de /);
    for (let index = 0; index < await units.count(); index += 1)
      if (await units.nth(index).inputValue() === "operación") await units.nth(index).selectOption("operation");
    const prices = page.getByLabel(/^Precio de /);
    for (let index = 0; index < await prices.count(); index += 1)
      if (["", "0"].includes(await prices.nth(index).inputValue())) await prices.nth(index).fill("125");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.getByRole("button", { name: "Publicar" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByRole("status")).toBeVisible();
  }
  await snap(page, "fase1-finanzas-tarifa-base");
});

test("Superadmin publica la aerolínea sintética de la corrida", async ({ page }) => {
  const run = loadRun();
  const airline = {
    name: `E2E Airways ${run.runId}`,
    legalName: `E2E Airways ${run.runId} S.R.L.`,
    iata: `${Math.floor(Math.random() * 10)}${pick(letters)}`,
    icao: `X${pick(letters)}${pick(letters)}`,
  };
  await loginPrivate(page, "superadmin");
  await openModule(page, "Aerolíneas");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Nueva aerolínea" }) });
  await form.getByLabel("Nombre de origen").fill(airline.name);
  await form.getByLabel("Nombre visible").fill(airline.name);
  await form.getByLabel("Razón social").fill(airline.legalName);
  await form.getByLabel("Región").fill("Caribe");
  await form.getByLabel("País ISO (2 letras)").fill("DO");
  await form.getByLabel("Código IATA").fill(airline.iata);
  await form.getByLabel("Código ICAO").fill(airline.icao);
  await form.getByLabel("Sitio o fuente oficial").fill("https://example.com/e2e-airways");
  await form.getByLabel("Fuente de verificación").fill("https://example.com/e2e-airways/aoc");
  await form.getByLabel("Datos verificados con la fuente indicada").check();
  await form.getByLabel("Disponible para nuevas solicitudes").check();
  await form.getByRole("button", { name: "Guardar aerolínea" }).click();
  await expect(page.getByText(airline.name).first()).toBeVisible();
  await snap(page, "fase1-superadmin-aerolinea");
  saveRun({ airline });
});

test("La aerolínea pide servicios desde el sitio público", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string };
  const representative = { name: "Rosa Martinez Prueba", email: `e2e.${run.runId.toLowerCase()}@e2e-airways.example.com` };
  await forwardApi(page);
  await page.goto(`${PUBLIC_WEB}/solicitar-acceso`);
  const services = page.getByRole("button", { name: /Añadir servicio/ });
  await services.first().waitFor();
  await services.nth(0).click();
  await services.nth(0).click();
  await page.getByRole("button", { name: /Continuar/ }).click();
  await page.locator("#airline-select").selectOption({ label: airline.name });
  await page.getByRole("button", { name: /Continuar/ }).click();
  await page.locator("#representative-name").fill(representative.name);
  await page.locator("#representative-titleOption").selectOption({ index: 1 });
  await page.locator("#representative-email").fill(representative.email);
  await page.locator("#representative-phone").fill("809-555-0100");
  await page.locator("#representative-documentType").selectOption("Passport");
  await page.locator("#representative-nationalityCode").selectOption("DO");
  await page.locator("#representative-documentNumber").fill(`RD${String(Date.now()).slice(-7)}`);
  await page.locator("#representative-country").selectOption("DO");
  await page.locator("#representative-province").selectOption({ index: 1 });
  await page.locator("#representative-municipality").selectOption({ index: 1 });
  await page.locator("#representative-authorityDeclared").check();
  await page.getByRole("button", { name: /Continuar/ }).click();
  await snap(page, "fase1-solicitud-resumen");
  await page.getByRole("button", { name: /Enviar solicitud/ }).click();
  const done = page.getByRole("status").filter({ hasText: "Su solicitud ya está en revisión" });
  await expect(done).toBeVisible();
  await snap(page, "fase1-solicitud-recibida");
  saveRun({ representative, requestReference: (await done.locator("strong").innerText()).trim() });
});

test("Contratos verifica la aerolínea y aprueba la solicitud", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string; legalName: string; iata: string; icao: string };
  await loginPrivate(page, "contracts");
  await openModule(page, "Solicitudes");
  await page.getByLabel("Buscar solicitudes").fill(airline.name);
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  const review = page.locator("section").filter({ has: page.getByRole("heading", { name: airline.name }) });
  await review.getByLabel("Razón social").fill(airline.legalName);
  await review.getByLabel("País (2 letras)").fill("DO");
  await review.getByLabel("IATA (2 caracteres)").fill(airline.iata);
  await review.getByLabel("ICAO (3 letras)").fill(airline.icao);
  await review.getByLabel("Fuente HTTPS").fill("https://example.com/e2e-airways/aoc");
  await review.getByRole("button", { name: "Guardar verificación" }).click();
  await expect(page.getByRole("status")).toContainText("Aerolínea verificada");
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  await review.getByLabel(/PUJ/).check();
  await review.getByRole("button", { name: "Aprobar y crear borrador" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud aprobada");
  await snap(page, "fase1-contratos-solicitud-aprobada");
});

test.fixme("hueco 1-A · Contratos pasa la solicitud a revisión y puede cancelarla con motivo", async () => {});

test("Superadmin crea la cuenta del portal y envía la invitación", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string };
  const representative = run.representative as { email: string };
  await loginPrivate(page, "superadmin");
  const card = page.locator("form").filter({ hasText: airline.name });
  await expect(card).toBeVisible();
  await card.getByLabel("Correo de acceso").fill(representative.email);
  const since = Date.now();
  await card.getByRole("button", { name: "Crear y enviar invitación" }).click();
  await expect(page.getByRole("status")).toContainText("enlace de activación");
  await snap(page, "fase1-superadmin-cuenta");
  saveRun({ invitationSince: since });
});

test("El representante activa su cuenta y entra al portal con el código por correo", async ({ page }) => {
  const run = loadRun();
  const representative = run.representative as { email: string };
  const invitation = await waitForEmail(representative.email, /activ|cuenta|portal/i, Number(run.invitationSince));
  const link = new URL(linkTo(invitation, "/activar"));
  const password = `Portal-${run.runId}-Aa9!x`;
  await forwardApi(page);
  await page.goto(`${PUBLIC_WEB}/activar${link.search}`);
  await page.getByLabel("Contraseña nueva", { exact: true }).fill(password);
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("link", { name: "Ir a iniciar sesión" })).toBeVisible();
  savePassword(representative.email, password);
  await loginPortal(page, representative.email);
  await expect(page.locator("#portal-content")).toBeVisible();
  await snap(page, "fase1-portal-activado");
});

test("Contratos completa las tarifas del borrador y lo envía a Finanzas", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string };
  await loginPrivate(page, "contracts");
  await openModule(page, "Borradores");
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  const editor = page.locator("section").filter({ has: page.getByRole("heading", { name: airline.name }) });
  await editor.getByLabel("Condiciones del contrato").fill("Servicios de rampa en PUJ según el tarifario. Corrida E2E.");
  await editor.getByLabel("Vigente desde").fill(new Date().toISOString().slice(0, 10));
  const prices = editor.getByLabel("Precio");
  for (let index = 0; index < await prices.count(); index += 1)
    if (["", "0"].includes(await prices.nth(index).inputValue())) await prices.nth(index).fill("100");
  const confirms = editor.getByLabel("Confirmar tarifa (0 = cortesía)");
  for (let index = 0; index < await confirms.count(); index += 1) await confirms.nth(index).check();
  await editor.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Borrador actualizado" })).toBeVisible();
  await expect(page.getByText("Cargando paquetes del contrato…")).toBeHidden();
  await snap(page, "fase1-contratos-borrador");
  await editor.getByRole("button", { name: "Enviar a Finanzas" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Enviar" }).click();
  await expect(editor.getByText("En revisión por Finanzas")).toBeVisible();
});

test.fixme("hueco 1-B · Contratos descarta un borrador que no prosperó", async () => {});

test("Finanzas aprueba las tarifas del contrato", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string };
  await loginPrivate(page, "finance");
  await openModule(page, "Aprobación de contratos");
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  await snap(page, "fase1-finanzas-revision");
  await page.getByRole("button", { name: "Aprobar y activar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Aprobar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const token = await login("contracts");
  const contracts = await call<{ contracts: Array<{ airline: string; id: string; versionId?: string }> }>(token, "GET",
    "/contracts/agreements?page=1&limit=50");
  const contract = contracts.data.contracts?.find(item => item.airline === airline.name);
  expect(contract, "the approved contract is listed for Contratos").toBeTruthy();
  saveRun({ contract });
  await snap(page, "fase1-finanzas-aprobado");
});

test.fixme("hueco 1-C · Contratos crea una enmienda que Finanzas puede aprobar", async () => {});
