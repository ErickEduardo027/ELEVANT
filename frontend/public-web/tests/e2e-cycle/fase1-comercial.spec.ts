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

test("Contratos verifica la aerolínea y al representante y aprueba la solicitud", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string; legalName: string; iata: string; icao: string };
  const representative = run.representative as { email: string };
  await loginPrivate(page, "contracts");
  await openModule(page, "Solicitudes");
  // The inbox searches on the server, so the run's request is found among any number of open ones.
  await page.getByLabel("Buscar solicitudes").fill(representative.email);
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  const review = page.locator("section").filter({ has: page.getByRole("heading", { name: airline.name }) });
  // Superadmin verified the profile; Contratos confirms it from the request with the official source.
  await review.getByRole("button", { name: "Corregir la verificación" }).click();
  await review.getByLabel("Razón social").fill(airline.legalName);
  await review.getByLabel("País (2 letras)").fill("DO");
  await review.getByLabel("IATA (opcional, 2 caracteres)").fill(airline.iata);
  await review.getByLabel("ICAO (3 letras)").fill(airline.icao);
  await review.getByLabel("Fuente HTTPS").fill("https://example.com/e2e-airways/aoc");
  await review.getByRole("button", { name: "Guardar verificación" }).click();
  await expect(page.getByRole("status")).toContainText("Aerolínea verificada");
  // 1-A: the first verification moves the request to «En revisión».
  await expect(review.getByText(/^En revisión ·/)).toBeVisible();
  // 1-N18: approval needs the recorded confirmation of the representative.
  await expect(review.getByRole("button", { name: "Aprobar y crear borrador" })).toBeDisabled();
  await review.getByLabel("Cómo se confirmó").fill("Llamada a la central de la aerolínea: la gerencia comercial confirmó a la representante.");
  await review.getByRole("button", { name: "Registrar confirmación" }).click();
  await expect(page.getByRole("status")).toContainText("Confirmación del representante registrada");
  await expect(review.getByText(/Representante confirmado por/)).toBeVisible();
  await review.getByLabel(/PUJ/).check();
  const since = Date.now();
  await review.getByRole("button", { name: "Aprobar y crear borrador" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud aprobada");
  await snap(page, "fase1-contratos-solicitud-aprobada");
  // 1-N02: the applicant is told about the decision.
  const decision = await waitForEmail(representative.email, /aprobada/i, since);
  expect(decision.text).toContain(run.requestReference as string);
});

test("Contratos cancela con motivo una segunda solicitud de la aerolínea ya afiliada", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string };
  const catalog = await call<{ airlines: Array<{ id: string; name: string }>; services: Array<{ id: string }> }>(
    null, "GET", "/public/commercial-catalog");
  const profile = catalog.data.airlines.find(item => item.name === airline.name);
  expect(profile, "the run's airline is published").toBeTruthy();
  const email = `e2e.duplicada.${run.runId.toLowerCase()}@e2e-airways.example.com`;
  const submitted = await call(null, "POST", "/public/commercial-requests", {
    requestId: crypto.randomUUID(), airlineProfileId: profile!.id, serviceIds: [catalog.data.services[0]!.id],
    representativeName: "Rosa Martinez Duplicada", representativeTitle: "Gerente de operaciones", representativeEmail: email,
    representativePhone: "809-555-0101", authorityDeclared: true, representativeDocumentType: "NationalId",
    representativeDocumentNumber: "00112345673" });
  expect(submitted.status).toBe(201);

  await loginPrivate(page, "contracts");
  await openModule(page, "Solicitudes");
  await page.getByLabel("Buscar solicitudes").fill(email);
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  const review = page.locator("section").filter({ has: page.getByRole("heading", { name: airline.name }) });
  // 1-N01: the airline already has a draft contract, so a second affiliation is not offered.
  await expect(review.getByRole("note").filter({ hasText: "No admite una segunda afiliación" })).toBeVisible();
  await review.getByLabel("Cómo se confirmó").fill("Llamada a la central: la aerolínea ya tramita su contrato con AVIAM.");
  await review.getByRole("button", { name: "Registrar confirmación" }).click();
  await expect(page.getByRole("status")).toContainText("Confirmación del representante registrada");
  await expect(review.getByText(/^En revisión ·/)).toBeVisible();
  await review.getByLabel(/PUJ/).check();
  await expect(review.getByRole("button", { name: "Aprobar y crear borrador" })).toBeDisabled();
  // 1-A, 1-N02: the cancellation keeps the request, with its reason, and tells the applicant.
  await review.getByLabel("Motivo de cancelación").fill("Solicitud duplicada: la aerolínea ya tiene un contrato en curso.");
  const since = Date.now();
  await review.getByRole("button", { name: "Cancelar solicitud" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud cancelada");
  await snap(page, "fase1-contratos-solicitud-cancelada");
  const notice = await waitForEmail(email, /cancelada/i, since);
  expect(notice.text).toContain("Solicitud duplicada");
  await page.getByLabel("Estado", { exact: true }).selectOption("Cancelled");
  await expect(page.getByRole("button", { name: new RegExp(airline.name) }).first()).toContainText("Cancelada");
});

test("Una aerolínea que no aparece en el listado se propone y Contratos la ve como propuesta", async ({ page }) => {
  const run = loadRun();
  const name = `E2E Propuesta ${run.runId}`;
  const email = `e2e.propuesta.${run.runId.toLowerCase()}@e2e-proposal.example.com`;
  await forwardApi(page);
  await page.goto(`${PUBLIC_WEB}/solicitar-acceso`);
  const services = page.getByRole("button", { name: /Añadir servicio/ });
  await services.first().waitFor();
  await services.nth(0).click();
  await page.getByRole("button", { name: /Continuar/ }).click();
  // 1-N25: the applicant describes the airline; 1-N17: an operator without IATA leaves it empty.
  await page.getByRole("button", { name: "Mi aerolínea no aparece" }).click();
  await page.locator("#proposal-name").fill(name);
  await page.locator("#proposal-countryCode").selectOption("DO");
  await page.locator("#proposal-icaoCode").fill(`Q${pick(letters)}${pick(letters)}`);
  await page.locator("#proposal-websiteUrl").fill("https://e2e-proposal.example.com");
  await page.getByRole("button", { name: /Continuar/ }).click();
  await page.locator("#representative-name").fill("Luis Propuesta Prueba");
  await page.locator("#representative-titleOption").selectOption({ index: 1 });
  await page.locator("#representative-email").fill(email);
  await page.locator("#representative-phone").fill("809-555-0102");
  await page.locator("#representative-documentType").selectOption("NationalId");
  await page.locator("#representative-documentNumber").fill("00112345673");
  await page.locator("#representative-country").selectOption("DO");
  await page.locator("#representative-province").selectOption({ index: 1 });
  await page.locator("#representative-municipality").selectOption({ index: 1 });
  await page.locator("#representative-authorityDeclared").check();
  await page.getByRole("button", { name: /Continuar/ }).click();
  await expect(page.getByText(/No figura en el listado/)).toBeVisible();
  await page.getByRole("button", { name: /Enviar solicitud/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Su solicitud ya está en revisión" })).toBeVisible();
  await snap(page, "fase1-solicitud-aerolinea-propuesta");

  // Contratos sees the proposal; this run closes it without publishing a profile.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await loginPrivate(page, "contracts");
  await openModule(page, "Solicitudes");
  await page.getByLabel("Buscar solicitudes").fill(email);
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const review = page.locator("section").filter({ has: page.getByRole("heading", { name }) });
  await expect(review.getByText("Aerolínea propuesta por el solicitante")).toBeVisible();
  await expect(review.getByText("Sin IATA")).toBeVisible();
  await review.getByLabel("Motivo de cancelación").fill("Corrida E2E: la propuesta se cierra sin publicar la ficha.");
  await review.getByRole("button", { name: "Cancelar solicitud" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud cancelada");
});

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
