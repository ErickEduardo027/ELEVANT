import { expect, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
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
    // 1-E: every proposed unit is an active unit code, also for a service whose catalog unit is a legacy name.
    const units = page.getByLabel(/^Unidad de /);
    for (let index = 0; index < await units.count(); index += 1)
      expect(await units.nth(index).inputValue()).not.toBe("operación");
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
  // The record names who confirmed and when; the checklist below repeats «Representante confirmado por Contratos».
  await expect(review.getByText(/Representante confirmado por .+ el \d/)).toBeVisible();
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
  await page.getByRole("combobox", { name: "Estado", exact: true }).selectOption("Cancelled");
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
  // 1-N21: the invitation by email is the default; the temporary password is the explicit alternative.
  await expect(page.getByText(/Por defecto, ELEVANT deja en cola una invitación por correo/)).toBeVisible();
  await card.getByLabel("Correo de acceso").fill(representative.email);
  const since = Date.now();
  await card.getByRole("button", { name: "Crear y enviar invitación" }).click();
  // ADR-0022, 1-N08: the screen says the invitation is queued, never that it was sent.
  const notice = page.getByRole("status").filter({ hasText: "enlace de activación" });
  await expect(notice).toContainText(`La invitación quedó en cola para ${representative.email}`);
  await expect(notice).not.toContainText("Enviamos");
  await snap(page, "fase1-superadmin-cuenta");
  saveRun({ invitationSince: since });

  // 1-N22: the outbox shows the invitation with the account it is for, in Spanish.
  const superadmin = await login("superadmin");
  const outbox = await expectCall<{ entries: Array<{ recipient: string; purpose: string; status: string;
    reference: { kind: string } | null }> }>(200, superadmin, "GET", "/governance/email/outbox?status=All&page=1&limit=50");
  const invitation = outbox.data.entries.find(item => item.recipient === representative.email && item.purpose === "Activation");
  expect(invitation?.reference?.kind).toBe("account");
  await openModule(page, "Configuración");
  await expect(page.getByRole("list", { name: "Correos de la bandeja" })).toContainText("Activación de cuenta");
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

test("La aerolínea comenta el borrador y Contratos le responde desde Borradores", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string };
  const representative = run.representative as { email: string };
  await loginPortal(page, representative.email);
  await page.getByRole("link", { name: "Contratos", exact: true }).first().click();
  await expect(page.getByText("Cargando contratos autorizados…")).toBeHidden();
  const question = `¿El precio incluye la asistencia nocturna? Corrida ${run.runId}`;
  await page.getByLabel("Enviar una observación a Contratos").first().fill(question);
  await page.getByRole("button", { name: "Enviar observación" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Observación enviada a Contratos." })).toBeVisible();
  await snap(page, "fase1-portal-observacion");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await loginPrivate(page, "contracts");
  await openModule(page, "Borradores");
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  const editor = page.locator("section").filter({ has: page.getByRole("heading", { name: airline.name }) });
  await expect(editor.getByText(question)).toBeVisible();
  const answer = "El recargo nocturno se cobra aparte según el tarifario de Finanzas.";
  await editor.getByLabel("Responder a la aerolínea").fill(answer);
  await editor.getByRole("button", { name: "Enviar respuesta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Respuesta enviada" })).toBeVisible();
  // The airline reads the answer signed by Contratos, never by an internal name.
  const portal = await login({ email: representative.email });
  const drafts = await expectCall<Array<{ comments: Array<{ author: string; body: string; isAirline: boolean }> }>>(200,
    portal, "GET", "/airline/contract-drafts");
  const reply = drafts.data.flatMap(item => item.comments).find(comment => comment.body === answer);
  expect(reply).toMatchObject({ author: "Contratos AVIAM", isAirline: false });
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
  // 1-D, 1-N14: the checklist comes from the server and every requirement is met.
  const checks = editor.getByRole("list", { name: "Requisitos para enviar a Finanzas" });
  await expect(checks).toBeVisible();
  await expect(checks.getByText(/^○/)).toHaveCount(0);
  await snap(page, "fase1-contratos-borrador");
  await editor.getByRole("button", { name: "Enviar a Finanzas" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Enviar" }).click();
  await expect(editor.getByText("En revisión por Finanzas")).toBeVisible();
});

test("Contratos descarta un borrador que no prosperó y el contrato queda cerrado sin borrar nada", async ({ page }) => {
  const run = loadRun();
  const name = `E2E Desistida ${run.runId}`;
  const email = `e2e.desistida.${run.runId.toLowerCase()}@e2e-desist.example.com`;
  const contracts = await login("contracts");
  const catalog = await call<{ services: Array<{ id: string }> }>(null, "GET", "/public/commercial-catalog");
  // An airline that is not listed asks for services (1-N25); Contratos verifies and approves it by API.
  await expectCall(201, null, "POST", "/public/commercial-requests", {
    requestId: crypto.randomUUID(), proposedAirline: { name, countryCode: "DO", iataCode: null,
      icaoCode: `W${pick(letters)}${pick(letters)}`, websiteUrl: "https://e2e-desist.example.com" },
    serviceIds: [catalog.data.services[0]!.id], representativeName: "Marta Desistida Prueba",
    representativeTitle: "Gerente comercial", representativeEmail: email, representativePhone: "809-555-0103",
    authorityDeclared: true, representativeDocumentType: "NationalId", representativeDocumentNumber: "00112345673" });
  type InboxRequest = { id: string; version: string; contractId: string | null };
  const request = async () => (await expectCall<{ requests: InboxRequest[] }>(200, contracts, "GET",
    `/contracts/commercial-requests/inbox?status=All&search=${encodeURIComponent(email)}`)).data.requests[0]!;
  await expectCall(200, contracts, "POST", `/contracts/commercial-requests/${(await request()).id}/representative-confirmation`,
    { expectedVersion: (await request()).version, note: "Llamada a la central: la aerolínea confirmó a la representante." });
  for (let attempt = 0; ; attempt += 1) {
    const current = await request();
    const verified = await call(contracts, "POST", `/contracts/commercial-requests/${current.id}/airline-verification`, {
      expectedVersion: current.version, legalName: `${name} S.R.L.`, countryCode: "DO", iataCode: null,
      icaoCode: `W${pick(letters)}${pick(letters)}`, verificationSourceUrl: "https://e2e-desist.example.com/aoc" });
    if (verified.status === 200) break;
    // A random ICAO may already be taken by another run's airline.
    if (attempt >= 4 || (verified.data as { code?: string })?.code !== "airline_profile_conflict")
      throw new Error(`verification → HTTP ${verified.status} ${JSON.stringify(verified.data)}`);
  }
  const stations = await expectCall<Array<{ id: string; code: string }>>(200, contracts, "GET",
    "/contracts/commercial-requests/stations");
  const puj = stations.data.find(station => station.code === "PUJ")!;
  const approved = await expectCall<{ id: string }>(200, contracts, "POST",
    `/contracts/commercial-requests/${(await request()).id}/decision`,
    { approve: true, stationIds: [puj.id], expectedVersion: (await request()).version });

  // The negotiation fails: Contratos discards the draft from Borradores with a reason.
  await loginPrivate(page, "contracts");
  await openModule(page, "Borradores");
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const editor = page.locator("section").filter({ has: page.getByRole("heading", { name }) });
  await editor.getByRole("button", { name: "Descartar borrador" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/también quedará terminado/)).toBeVisible();
  await dialog.getByLabel("Motivo").fill("La aerolínea desistió de la afiliación. Corrida E2E.");
  await dialog.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Borrador descartado" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);
  await snap(page, "fase1-contratos-borrador-descartado");

  // Nothing is deleted: the contract is terminated, it leaves the drafts and Superadmin's tasks.
  const drafts = await expectCall<Array<{ contractId: string }>>(200, contracts, "GET", "/contracts/drafts");
  expect(drafts.data.some(item => item.contractId === approved.data.id)).toBe(false);
  const tasks = await expectCall<Array<{ contractId: string }>>(200, await login("superadmin"), "GET",
    "/governance/provisioning");
  expect(tasks.data.some(task => task.contractId === approved.data.id)).toBe(false);
});

test("Superadmin vincula la cuenta que ya existía y cierra su invitación con una contraseña temporal", async ({ page }) => {
  const run = loadRun();
  const name = `E2E Vinculada ${run.runId}`;
  const email = `e2e.vinculada.${run.runId.toLowerCase()}@e2e-link.example.com`;
  const contracts = await login("contracts");
  const superadmin = await login("superadmin");
  const catalog = await call<{ services: Array<{ id: string }> }>(null, "GET", "/public/commercial-catalog");
  // An airline that is not listed is verified and approved by API (1-N25), as in the discarded draft above.
  await expectCall(201, null, "POST", "/public/commercial-requests", {
    requestId: crypto.randomUUID(), proposedAirline: { name, countryCode: "DO", iataCode: null,
      icaoCode: `V${pick(letters)}${pick(letters)}`, websiteUrl: "https://e2e-link.example.com" },
    serviceIds: [catalog.data.services[0]!.id], representativeName: "Lucía Vinculada Prueba",
    representativeTitle: "Gerente comercial", representativeEmail: email, representativePhone: "809-555-0104",
    authorityDeclared: true, representativeDocumentType: "NationalId", representativeDocumentNumber: "00112345673" });
  type InboxRequest = { id: string; version: string };
  const request = async () => (await expectCall<{ requests: InboxRequest[] }>(200, contracts, "GET",
    `/contracts/commercial-requests/inbox?status=All&search=${encodeURIComponent(email)}`)).data.requests[0]!;
  await expectCall(200, contracts, "POST", `/contracts/commercial-requests/${(await request()).id}/representative-confirmation`,
    { expectedVersion: (await request()).version, note: "Llamada a la central: la aerolínea confirmó a la representante." });
  for (let attempt = 0; ; attempt += 1) {
    const current = await request();
    const verified = await call(contracts, "POST", `/contracts/commercial-requests/${current.id}/airline-verification`, {
      expectedVersion: current.version, legalName: `${name} S.R.L.`, countryCode: "DO", iataCode: null,
      icaoCode: `V${pick(letters)}${pick(letters)}`, verificationSourceUrl: "https://e2e-link.example.com/aoc" });
    if (verified.status === 200) break;
    // A random ICAO may already be taken by another run's airline.
    if (attempt >= 4 || (verified.data as { code?: string })?.code !== "airline_profile_conflict")
      throw new Error(`verification → HTTP ${verified.status} ${JSON.stringify(verified.data)}`);
  }
  const stations = await expectCall<Array<{ id: string; code: string }>>(200, contracts, "GET",
    "/contracts/commercial-requests/stations");
  await expectCall(200, contracts, "POST", `/contracts/commercial-requests/${(await request()).id}/decision`,
    { approve: true, stationIds: [stations.data.find(station => station.code === "PUJ")!.id],
      expectedVersion: (await request()).version });

  // Clientes already invited the representative before the provisioning (1-N13).
  const clients = await expectCall<Array<{ organizationId: string; name: string }>>(200, superadmin, "GET",
    "/governance/clients");
  const organization = clients.data.find(item => item.name.includes("Vinculada") && item.name.includes(run.runId))!;
  await expectCall(201, superadmin, "POST", `/governance/clients/${organization.organizationId}/users`,
    { firstName: "Lucía", lastName: "Vinculada", email });
  const tasks = await expectCall<Array<{ requestId: string; airline: string; version: string }>>(200, superadmin, "GET",
    "/governance/provisioning");
  const task = tasks.data.find(item => item.airline === name)!;
  const refused = await call<{ code?: string }>(superadmin, "POST", `/governance/provisioning/${task.requestId}`,
    { email, expectedVersion: task.version });
  expect([refused.status, refused.data.code]).toEqual([409, "email_has_account"]);

  // Superadmin links the existing account instead of creating a second one.
  await loginPrivate(page, "superadmin");
  const card = page.locator("form").filter({ hasText: name });
  await card.getByLabel("Correo de acceso").fill(email);
  await card.getByRole("button", { name: "Crear y enviar invitación" }).click();
  await expect(card.getByRole("alert")).toContainText("Puede vincularla");
  await card.getByRole("button", { name: "Vincular cuenta existente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "quedó vinculada" })).toBeVisible();
  await expect(page.locator("form").filter({ hasText: name })).toHaveCount(0);
  await snap(page, "fase1-superadmin-vincula-cuenta");

  // 1-N12: the invitation is still pending; a temporary password closes it and the user can sign in.
  await openModule(page, "Usuarios");
  await openModule(page, "Clientes");
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("Invitación pendiente de activar");
  await row.getByRole("button", { name: "Asignar contraseña temporal" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("la invitación se da por aceptada");
  const temporary = `Temporal-${run.runId}-Aa9!x`;
  await dialog.getByLabel("Nueva contraseña temporal", { exact: true }).fill(temporary);
  await dialog.getByRole("button", { name: "Asignar contraseña" }).click();
  await expect(page.getByRole("status").filter({ hasText: "La invitación quedó cerrada" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: email })).not.toContainText("Invitación pendiente de activar");
  const session = await call<{ code?: string }>(null, "POST", "/auth/session", { email, password: temporary });
  expect([session.status, session.data.code]).toEqual([409, "password_change_required"]);
});

test("Finanzas aprueba las tarifas del contrato", async ({ page }) => {
  const run = loadRun();
  const airline = run.airline as { name: string };
  await loginPrivate(page, "finance");
  await openModule(page, "Aprobación de contratos");
  await page.getByRole("button", { name: new RegExp(airline.name) }).first().click();
  await snap(page, "fase1-finanzas-revision");
  // 1-F: Finance approves the prices; the modal says what still has to happen before the contract activates.
  await page.getByRole("button", { name: "Aprobar precios" }).click();
  const dialog = page.getByRole("dialog", { name: "Aprobar precios" });
  await expect(dialog.getByText(/firman la aerolínea y AVIAM/)).toBeVisible();
  await dialog.getByRole("button", { name: "Aprobar precios" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Precios aprobados" })).toBeVisible();
  const token = await login("contracts");
  const contracts = await call<{ contracts: Array<{ airline: string; id: string; status: string; versionId?: string }> }>(token,
    "GET", "/contracts/agreements?page=1&limit=50");
  const contract = contracts.data.contracts?.find(item => item.airline === airline.name);
  expect(contract, "the approved contract is listed for Contratos").toBeTruthy();
  // The approval does not activate it: the validity, both signatures and the permit come in fase 2.
  expect(contract?.status).toBe("Draft");
  saveRun({ contract });
  await snap(page, "fase1-finanzas-aprobado");
});

test("Contratos no da de baja un servicio contratado; da de baja y reactiva uno sin contratos", async ({ page }) => {
  const run = loadRun();
  const contracts = await login("contracts");
  type Service = { id: string; code: string; name: string; description: string; billingUnit: string;
    imageUrl?: string | null; videoUrl?: string | null; displayOrder: number; isPublic: boolean; isActive: boolean;
    version: string };
  const services = async () => (await expectCall<Service[]>(200, contracts, "GET", "/contracts/catalog/services")).data;
  const form = (service: Service, change: Partial<Service> = {}) => ({ code: service.code, name: service.name,
    description: service.description, billingUnit: service.billingUnit, imageUrl: service.imageUrl ?? null,
    videoUrl: service.videoUrl ?? null, displayOrder: service.displayOrder, isPublic: service.isPublic,
    isActive: service.isActive, version: service.version, ...change });

  // 1-N03: the run's contract, with the prices Finance approved, keeps its services: none can be retired.
  type RunContract = { approvedVersions?: Array<{ rates: Array<{ serviceCode: string }> }> };
  const contractedCode = (run.contract as RunContract).approvedVersions?.[0]?.rates[0]?.serviceCode;
  expect(contractedCode, "the run's approved contract has a rate").toBeTruthy();
  const contracted = (await services()).find(item => item.code === contractedCode)!;
  const refused = await call<{ code?: string }>(contracts, "POST",
    `/contracts/catalog/services/${contracted.id}/retirement`,
    { expectedVersion: contracted.version, reason: `Corrida E2E ${run.runId}: un servicio contratado no se da de baja.` });
  if (refused.status === 200) {
    // Never leave a contracted service retired for the next phases: put it back before failing.
    const retired = (await services()).find(item => item.id === contracted.id)!;
    const active = await call<Service>(contracts, "PUT", `/contracts/catalog/services/${contracted.id}`,
      form(retired, { isActive: true, isPublic: false }));
    if (contracted.isPublic && active.status === 200)
      await call(contracts, "PUT", `/contracts/catalog/services/${contracted.id}`, form(active.data, { isPublic: true }));
  }
  expect([refused.status, refused.data?.code]).toEqual([409, "service_in_active_contract"]);

  // A service no contract uses: Contratos retires it from the screen with a reason, then reactivates it.
  const name = "Servicio E2E de catálogo";
  let synthetic = (await services()).find(item => item.code === "E2E-CATALOGO");
  if (!synthetic) {
    const highest = Math.max(0, ...(await services()).map(item => item.displayOrder));
    synthetic = (await expectCall<Service>(201, contracts, "POST", "/contracts/catalog/services", {
      code: "E2E-CATALOGO", name, description: "Servicio sintético de la corrida E2E del catálogo comercial.",
      billingUnit: "operation", imageUrl: null, videoUrl: null, displayOrder: Math.min(10_000, highest + 1),
      isPublic: false, isActive: true, version: null })).data;
  } else if (!synthetic.isActive) {
    // An earlier run stopped halfway: start again from an active, hidden service.
    await expectCall(200, contracts, "PUT", `/contracts/catalog/services/${synthetic.id}`,
      form(synthetic, { isActive: true, isPublic: false }));
  }

  await loginPrivate(page, "contracts");
  await openModule(page, /^Servicios$/);
  await expect(page.getByText("Cargando servicios…")).toBeHidden();
  const card = page.getByRole("article").filter({ hasText: name });
  const next = page.getByRole("navigation", { name: "Paginación de servicios" }).getByRole("button", { name: "Siguiente" });
  while (!await card.isVisible() && await next.isEnabled()) await next.click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Dar de baja" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Dar de baja ${name}` });
  await expect(dialog.getByRole("button", { name: "Dar de baja" })).toBeDisabled();
  await dialog.getByLabel("Motivo de la baja").fill(`Corrida E2E ${run.runId}: el servicio sintético deja de ofrecerse.`);
  await dialog.getByRole("button", { name: "Dar de baja" }).click();
  await expect(page.getByRole("status").filter({ hasText: "quedó dado de baja" })).toBeVisible();
  await expect(card.getByText("Dado de baja", { exact: true })).toBeVisible();
  await snap(page, "fase1-contratos-servicio-baja");

  // 1-N11: a retired service is reactivated, still hidden, before anyone can republish it.
  await card.getByRole("button", { name: "Reactivar" }).click();
  await page.getByRole("dialog", { name: "Reactivar servicio" }).getByRole("button", { name: "Reactivar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "está activo otra vez" })).toBeVisible();
  await expect(card.getByText("Oculto", { exact: true })).toBeVisible();
  const reactivated = (await services()).find(item => item.code === "E2E-CATALOGO")!;
  expect([reactivated.isActive, reactivated.isPublic]).toEqual([true, false]);
});

// Hueco 1-C (enmienda) needs an active contract, so it runs at the end of fase 2.
