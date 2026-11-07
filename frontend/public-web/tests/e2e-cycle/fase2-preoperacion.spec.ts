import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
import { drawSignature, goPrivate, loginPortal, loginPrivate, openModule, snap } from "./support/browser";
import { API, loadRun, PUBLIC_WEB, saveRun, SHOTS_DIR } from "./support/env";
import { attachment, waitForEmail } from "./support/mailpit";
import { pdfFonts, pdfText } from "./support/pdf";

// Fase 2 · Pre-operación: Contratos fixes the validity, the airline and AVIAM sign with a drawn
// signature, the airline submits its JAC permit and Contratos verifies it, so the contract becomes
// active and the signed PDF goes out by email. Gestión Humana confirms the ramp agent can operate
// and programs today's shift; OCC sees the contract ready to plan at PUJ.

type RunContract = { id: string; code: string; airline: string;
  approvedVersions: Array<{ id: string; versionNumber: number; stations: Array<{ id: string; code: string }> }> };

const AGENT = "Riley Ramp";
/** 1×1 PNG standing in for a drawn signature when a step signs through the API (ADR-0025). */
const SIGNATURE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** The day of an instant in AVIAM's calendar (America/Santo_Domingo, UTC−4 all year). */
function businessDayOf(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit",
    day: "2-digit" }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Contract and permit days are AVIAM's business days on the server (hueco 2-F); local days drive shifts and flights. */
const businessDay = (offsetDays = 0) => businessDayOf(new Date(Date.now() + offsetDays * 86_400_000));
const nextDay = (isoDate: string) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const localDay = () => new Date().toLocaleDateString("en-CA");

// The shift presets Gestión Humana and OCC share (occShiftPresets.js), as minutes after midnight.
const PRESETS = [
  { id: "morning-0700", start: 7 * 60, end: 16 * 60 }, { id: "morning-0800", start: 8 * 60, end: 17 * 60 },
  { id: "day-1100", start: 11 * 60, end: 20 * 60 }, { id: "day-1200", start: 12 * 60, end: 21 * 60 },
  { id: "evening-1500", start: 15 * 60, end: 24 * 60 }, { id: "night-2300", start: 23 * 60, end: 32 * 60 },
];

/**
 * The preset that covers now ± 90 min, where fase 3 puts the run's flight (the tablet records past
 * milestones, never future ones). A shift that ends at midnight goes last.
 */
function pickPreset(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const options = PRESETS.filter(preset => preset.start <= minutes - 90 && preset.end >= minutes + 90);
  options.sort((a, b) => Number(a.end >= 24 * 60) - Number(b.end >= 24 * 60) || b.end - a.end);
  if (!options[0]) throw new Error("No shift preset covers the run's flight; run the cycle between 08:30 and 22:30.");
  return options[0];
}

function contractOf() {
  const run = loadRun();
  const contract = run.contract as RunContract;
  const version = contract.approvedVersions[0];
  return { run, contract, version };
}

async function openContractDetail(page: Page, airline: string, versionNumber: number) {
  await openModule(page, /^Contratos$/);
  await page.locator("article").filter({ hasText: airline }).first()
    .getByRole("button", { name: `Ver detalle, PDF y firmas · versión ${versionNumber}` }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Cargando contrato…")).toBeHidden();
  return drawer;
}

async function openPortalContracts(page: Page, email: string) {
  await loginPortal(page, email);
  await page.getByRole("link", { name: "Contratos", exact: true }).first().click();
  await expect(page).toHaveURL(`${PUBLIC_WEB}/portal/contratos`);
  await expect(page.getByText("Cargando contratos autorizados…")).toBeHidden();
}

/**
 * A tiny but valid one-page PDF, the scanned permit the airline attaches. It is handed to the file
 * input as a buffer: Chrome sends an empty part for a file under the 8.3 temp path (ERICKE~1).
 */
function permitPdf() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>"];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: "permiso-jac.pdf", mimeType: "application/pdf", buffer: Buffer.from(body, "latin1") };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  test.skip(!health?.ok, "The local stack is not running.");
});

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

test("Contratos fija la vigencia y la renovación del contrato aprobado", async ({ page }) => {
  const { run, contract, version } = contractOf();
  const representative = run.representative as { email: string };
  await loginPrivate(page, "contracts");
  const drawer = await openContractDetail(page, contract.airline, version.versionNumber);
  const confirmed = drawer.getByRole("heading", { name: "Vigencia y renovación confirmadas" });
  const before = await expectCall<{ validity: unknown }>(200, await login("contracts"), "GET",
    `/contract-versions/${version.id}/document`);
  if (!before.data.validity) { // a resumed run (--no-deps) may have confirmed it already
    await expect(drawer.getByText("Pendiente: Contratos debe fijar la vigencia y la renovación antes de las firmas.")).toBeVisible();
    const validity = drawer.getByRole("form", { name: "Vigencia y renovación" });
    await validity.getByLabel("Inicio de la vigencia").fill(businessDay());
    await validity.getByLabel("Fin de la vigencia").fill(businessDay(365));
    // A select inside its label is named by the label plus the chosen option.
    await validity.getByRole("combobox", { name: /^Renovación/ }).selectOption("Manual");
    await validity.getByLabel("Condiciones de terminación")
      .fill("Incumplimiento grave de pago o de las normas de seguridad en rampa. Corrida E2E.");
    const since = Date.now();
    await validity.getByRole("button", { name: "Confirmar vigencia" }).click();
    await expect(confirmed).toBeVisible();
    await snap(page, "fase2-contratos-vigencia");
    // Hueco 2-N13: the airline learns by email that it can sign, when the validity is fixed.
    const ready = await waitForEmail(representative.email, /listo para firmar/, since);
    expect(ready.text).toContain("Entra al portal de aerolíneas");
  }

  const token = await login("contracts");
  const document = await expectCall<{ contractCode: string; signableBy: string | null }>(200, token, "GET",
    `/contract-versions/${version.id}/document`);
  expect(document.data.contractCode, "the contract receives its definitive code").not.toMatch(/^DRAFT-/);
  // signableBy is relative to the caller: AVIAM countersigns only after the airline.
  expect(document.data.signableBy, "AVIAM waits for the airline's signature").toBeNull();
  saveRun({ contractCode: document.data.contractCode });
});

test("La aerolínea firma el contrato en su portal con la firma dibujada", async ({ page }) => {
  const { run } = contractOf();
  const representative = run.representative as { email: string; name: string };
  await openPortalContracts(page, representative.email);
  const signatures = page.getByRole("list", { name: "Firmas" });
  await expect(signatures).toBeVisible();
  if (await signatures.getByText("Gerente de estación").isVisible()) return; // resumed run: already signed
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Acepto y firmo" }) });
  await expect(form).toBeVisible();
  await form.getByLabel("Nombre completo de quien firma").fill(representative.name);
  await form.getByLabel("Cargo", { exact: true }).fill("Gerente de estación");
  await drawSignature(page, form.getByRole("img", { name: "Firma" }));
  await expect(form.getByText("Firma registrada.")).toBeVisible();
  await form.getByRole("checkbox").check();
  await snap(page, "fase2-portal-firma");
  await form.getByRole("button", { name: "Acepto y firmo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Contrato firmado." })).toBeVisible();
});

test("AVIAM contrafirma el contrato desde Contratos", async ({ page }) => {
  const { contract, version } = contractOf();
  await loginPrivate(page, "contracts");
  const drawer = await openContractDetail(page, contract.airline, version.versionNumber);
  const signedByBoth = drawer.getByText(/Firmado por ambas partes el/);
  if (!await signedByBoth.isVisible()) { // a resumed run may have countersigned already
    const form = drawer.locator("form").filter({ has: page.getByRole("heading", { name: "Firmar por AVIAM" }) });
    await form.getByLabel("Nombre completo").fill("Laura Contratos Prueba");
    await form.getByLabel("Cargo").fill("Gerente de Contratos");
    await form.getByRole("checkbox").check();
    await drawSignature(page, form.getByRole("img", { name: "Firma" }));
    await form.getByRole("button", { name: "Acepto y firmo" }).click();
  }
  await expect(signedByBoth).toBeVisible();
  await snap(page, "fase2-contratos-contrafirma");

  // Signed by both, but without a verified permit the contract cannot be active yet (ADR-0024).
  const token = await login("contracts");
  const list = await expectCall<{ contracts: Array<{ id: string; status: string }> }>(200, token, "GET",
    "/contracts/agreements?page=1&limit=50");
  expect(list.data.contracts.find(item => item.id === contract.id)?.status).toBe("Draft");
});

test("La aerolínea envía su permiso de operación JAC desde el portal", async ({ page }) => {
  const { run } = contractOf();
  const representative = run.representative as { email: string };
  await openPortalContracts(page, representative.email);
  const form = page.getByRole("form", { name: "Enviar un permiso" });
  await form.getByLabel("Tipo de documento").selectOption("OperatingPermit");
  await form.getByLabel("Número").fill(`JAC-E2E-${run.runId}`);
  await form.getByLabel("Emisor").fill("Junta de Aviación Civil");
  await form.getByLabel("Fecha de emisión").fill(businessDay(-30));
  await form.getByLabel("Fecha de vencimiento").fill(businessDay(365));
  await form.getByLabel(/Documento escaneado/).setInputFiles(permitPdf());
  await form.getByRole("button", { name: "Enviar permiso" }).click();
  await expect(form.getByRole("status")).toHaveText(/Permiso enviado/);
  await expect(page.getByRole("list", { name: "Permisos enviados" })).toContainText("En revisión por AVIAM");
  await snap(page, "fase2-portal-permiso");
  saveRun({ permitNumber: `JAC-E2E-${run.runId}` });
});

test("Contratos verifica el permiso y el contrato queda activo con el PDF firmado por correo", async ({ page }) => {
  const { run, contract } = contractOf();
  const representative = run.representative as { email: string };
  await loginPrivate(page, "contracts");
  await openModule(page, "Permisos de aerolíneas");
  const item = page.getByRole("listitem").filter({ hasText: String(run.permitNumber) });
  await expect(item).toContainText(contract.airline);
  // The scanned document reached the media store (Garage) and opens for Contratos.
  const popup = page.waitForEvent("popup");
  await item.getByRole("button", { name: "Abrir documento adjunto" }).click();
  await (await popup).close();
  await snap(page, "fase2-contratos-permiso-por-verificar");
  const since = Date.now();
  await item.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "ya quedó activo" })).toBeVisible();

  const token = await login("contracts");
  const list = await expectCall<{ contracts: Array<{ id: string; status: string; code: string }> }>(200, token, "GET",
    "/contracts/agreements?page=1&limit=50");
  const active = list.data.contracts.find(row => row.id === contract.id);
  expect(active?.status, "approved, signed by both and with a verified permit").toBe("Active");
  const email = await waitForEmail(representative.email, new RegExp(`Contrato ${active!.code} activo`), since);
  const pdf = await attachment(email, /\.pdf$/i);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_DIR, `contrato-${active!.code}-firmado.pdf`), pdf);
  await openModule(page, /^Contratos$/);
  // Hueco 2-N26: the status reads in Spanish, never its code.
  await expect(page.locator("article").filter({ hasText: contract.airline }).first()).toContainText("Activo");
  await snap(page, "fase2-contratos-activo");
});

test("Gestión Humana confirma que el agente de rampa puede operar", async ({ page }) => {
  await loginPrivate(page, "hr");
  await goPrivate(page, "/gestion-humana/users");
  const panel = page.getByRole("region", { name: "¿Puede operar?" });
  await expect(panel.getByText("Revisando agentes…")).toBeHidden();
  await expect(panel.getByRole("button", { name: new RegExp(AGENT) })).toContainText("Puede operar");
  await panel.getByRole("button", { name: new RegExp(AGENT) }).click();
  await snap(page, "fase2-gh-puede-operar");
});

test("Gestión Humana programa el turno de hoy del agente", async ({ page }) => {
  const today = localDay();
  const preset = pickPreset();
  await loginPrivate(page, "hr");
  await goPrivate(page, "/gestion-humana/schedules");
  const editor = page.getByRole("region", { name: "Editor semanal de turnos" });
  await expect(editor).toBeVisible();
  if (await editor.getByRole("button", { name: `Quitar turno de ${AGENT} el ${today}` }).count() === 0) {
    await editor.getByRole("button", { name: `Asignar turno a ${AGENT} el ${today}` }).click();
    const form = page.getByRole("form", { name: "Asignar turno" });
    await expect(form.getByText("Cargando estaciones del agente…")).toBeHidden();
    await form.getByLabel("Plantilla").selectOption(preset.id);
    await form.getByRole("button", { name: "Asignar turno" }).click();
    await expect(editor.getByRole("status")).toContainText(`asignado a ${AGENT} el ${today}`);
  }
  await snap(page, "fase2-gh-turno");

  const token = await login("hr");
  const shifts = await expectCall<{ shifts: Array<{ id: string; agentName: string; workDate: string; startsAtLocal: string;
    endsAtLocal: string; stationCode?: string }> }>(200, token, "GET",
    `/human-resources/shifts?from=${today}&to=${today}&page=1&limit=100`);
  const shift = shifts.data.shifts.find(item => item.agentName === AGENT);
  expect(shift, "the agent has today's shift").toBeTruthy();
  saveRun({ shift });
});

test("OCC ve el contrato listo para planificar en PUJ", async ({ page }) => {
  const { contract } = contractOf();
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/contracts");
  const list = page.getByRole("list", { name: "Contratos listos para operar" });
  await expect(list.getByRole("listitem").filter({ hasText: contract.airline })).toBeVisible();
  await snap(page, "fase2-occ-contratos-listos");
});

test("OCC revisa el mapa de posiciones y el feed de vuelos sin llamar al proveedor", async ({ page }) => {
  const { version } = contractOf();
  const station = version.stations.find(item => item.code === "PUJ")!;
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/positions-map");
  await page.waitForLoadState("networkidle");
  await snap(page, "fase2-occ-mapa-posiciones");
  // Only reads the stored feed: the E2E stack runs the simulated feed (or none), never AeroDataBox, so no paid unit is spent.
  const token = await login("occ");
  const feed = await call<{ budget: { configured: boolean } }>(token, "GET",
    `/occ/flight-feed?stationId=${station.id}&date=${localDay()}`);
  expect(feed.status).toBe(200);
  saveRun({ feedConfigured: feed.data.budget.configured });
});

test("hueco 1-C · Contratos crea una enmienda del contrato activo y Finanzas aprueba sus precios", async ({ page }) => {
  const { contract } = contractOf();
  type Agreement = { id: string; status: string;
    approvedVersions: Array<{ id: string; versionNumber: number; status: string; validFrom: string; validTo: string | null }> };
  const agreement = async () => (await expectCall<{ contracts: Agreement[] }>(200, await login("contracts"), "GET",
    "/contracts/agreements?page=1&limit=50")).data.contracts.find(item => item.id === contract.id)!;
  const before = await agreement();
  expect(before.status, "the contract is active after fase 2").toBe("Active");
  const approved = before.approvedVersions.filter(item => item.status === "Approved")
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]!;
  // «Vigente desde» falls after the start of the approved version in force and not after its end.
  const start = [businessDay(30), nextDay(approved.validFrom)].sort().at(-1)!;

  await loginPrivate(page, "contracts");
  const drawer = await openContractDetail(page, contract.airline, approved.versionNumber);
  await drawer.getByRole("button", { name: "Crear enmienda" }).click();
  const amendment = page.getByRole("dialog", { name: /^Crear enmienda del contrato/ });
  await amendment.getByLabel("Vigente desde").fill(start);
  await amendment.getByRole("button", { name: "Crear enmienda" }).click();
  await expect(amendment).toBeHidden();
  await expect(drawer.getByText(/Se creó la enmienda como borrador/)).toBeVisible();
  await snap(page, "fase2-contratos-enmienda");
  await drawer.getByRole("button", { name: "Abrir Borradores" }).click();

  // Contratos confirms the copied prices, changes one and sends the amendment to Finance.
  await page.getByRole("button", { name: new RegExp(contract.airline) }).first().click();
  const editor = page.locator("section").filter({ has: page.getByRole("heading", { name: contract.airline }) });
  await expect(editor.getByLabel("Vigente desde")).toHaveValue(start);
  await editor.getByLabel("Precio").first().fill("115");
  const confirms = editor.getByLabel("Confirmar tarifa (0 = cortesía)");
  for (let index = 0; index < await confirms.count(); index += 1) await confirms.nth(index).check();
  await editor.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Borrador actualizado" })).toBeVisible();
  const checks = editor.getByRole("list", { name: "Requisitos para enviar a Finanzas" });
  await expect(checks.getByText(/^○/)).toHaveCount(0);
  await editor.getByRole("button", { name: "Enviar a Finanzas" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Enviar" }).click();
  await expect(editor.getByText("En revisión por Finanzas")).toBeVisible();

  // Finance approves the prices without any conflict: the amendment starts after the version in force.
  await loginPrivate(page, "finance");
  await openModule(page, "Aprobación de contratos");
  await page.getByRole("button", { name: new RegExp(contract.airline) }).first().click();
  await page.getByRole("button", { name: "Aprobar precios" }).click();
  await page.getByRole("dialog", { name: "Aprobar precios" }).getByRole("button", { name: "Aprobar precios" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Precios aprobados" })).toBeVisible();
  await snap(page, "fase2-finanzas-enmienda-aprobada");
  const after = await agreement();
  expect(after.status).toBe("Active");
  expect(after.approvedVersions.find(item => item.validFrom === start)?.status).toBe("Approved");
});

/** Run-unique A–Z letters (the run id's digits become letters) for the synthetic master data of a run. */
const runLetters = (runId: string, length: number) => runId.toUpperCase()
  .replace(/[0-9]/g, digit => "ABCDEFGHIJ"[Number(digit)]!).replace(/[^A-Z]/g, "").slice(-length).padStart(length, "Q");

type MasterData = {
  terminals: Array<{ id: string; code: string; isActive: boolean; version: string }>;
  stands: Array<{ id: string; terminalId: string | null; code: string; hasBoardingBridge: boolean; isRemote: boolean;
    maxAircraftSize: string | null; isActive: boolean; version: string }>;
  aircraftTypes: Array<{ id: string; icaoCode: string; iataCode: string | null; manufacturer: string; model: string;
    sizeCategory: string | null; isActive: boolean; version: string }>;
};
type RunMasterData = { terminalCode: string; standId: string; standCode: string; aircraftTypeId: string; aircraftTypeIcao: string };

test("hueco 2-A · Superadmin crea una estación y OCC sus terminales, posiciones y tipos de avión", async ({ page }) => {
  const { run, version } = contractOf();
  const puj = version.stations.find(item => item.code === "PUJ")!;
  // A station code is its airport's IATA code and never changes: each run uses a synthetic airport of its own.
  const code = `Q${runLetters(run.runId, 2)}`;
  const superadmin = await login("superadmin");
  const contracts = await login("contracts");
  const stations = async () => (await expectCall<{ stations: Array<{ code: string; isActive: boolean }> }>(200, superadmin,
    "GET", "/governance/stations")).data.stations;
  const contractStations = async () => (await expectCall<Array<{ code: string }>>(200, contracts, "GET",
    "/contracts/commercial-requests/stations")).data.map(item => item.code);

  await loginPrivate(page, "superadmin");
  await openModule(page, "Estaciones");
  await expect(page.getByText("Cargando estaciones…")).toBeHidden();
  if (!(await stations()).some(item => item.code === code)) { // a resumed run created it already
    const form = page.getByRole("form", { name: "Nueva estación" });
    await form.getByLabel("Código IATA").fill(code);
    await form.getByLabel("Nombre", { exact: true }).fill(`Estación E2E ${run.runId}`);
    await form.getByLabel("Zona horaria (IANA)").fill("America/Santo_Domingo");
    // A new airport needs its data; a known one is reused without typing it again.
    if (await form.getByLabel("Código OACI").isVisible()) {
      await form.getByLabel("Código OACI").fill(`Q${runLetters(run.runId, 3)}`);
      await form.getByLabel("Nombre del aeropuerto").fill(`Aeropuerto E2E ${run.runId}`);
      await form.getByLabel("Ciudad").fill("Ciudad E2E");
      await form.getByLabel("País (ISO, 2 letras)").fill("DO");
    }
    await form.getByRole("button", { name: "Crear estación" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Estación ${code} creada` })).toBeVisible();
  }
  const created = page.getByRole("region", { name: "Estaciones registradas" }).getByRole("listitem").filter({ hasText: code });
  await expect(created).toBeVisible();
  await snap(page, "fase2-hueco-2a-estacion");
  // Contratos can assign the new station; once deactivated it no longer offers it, and the row stays.
  if ((await stations()).find(item => item.code === code)?.isActive) {
    expect(await contractStations()).toContain(code);
    await created.getByLabel(`Estación ${code} activa`).uncheck();
    await created.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Estación ${code} desactivada.` })).toBeVisible();
  }
  expect(await contractStations()).not.toContain(code);
  expect((await stations()).find(item => item.code === code)?.isActive).toBe(false);

  // OCC loads its own layout in Datos maestros: a terminal, a stand and an aircraft type of this run.
  const occ = await login("occ");
  const terminalCode = `E2E-${runLetters(run.runId, 4)}`;
  const standCode = `${terminalCode}-1`;
  const aircraftTypeIcao = `Z${runLetters(run.runId, 3)}`;
  const masterData = async () => (await expectCall<MasterData>(200, occ, "GET", `/occ/master-data?stationId=${puj.id}`)).data;
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/master-data");
  await expect(page.getByText("Cargando los datos maestros…")).toBeHidden();
  let data = await masterData();
  if (!data.terminals.some(item => item.code === terminalCode)) {
    const form = page.getByRole("form", { name: "Nueva terminal" });
    await form.getByLabel("Código").fill(terminalCode);
    await form.getByLabel("Nombre").fill(`Terminal E2E ${run.runId}`);
    await form.getByRole("button", { name: "Crear terminal" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Terminal ${terminalCode} creada.` })).toBeVisible();
    data = await masterData();
  }
  const terminal = data.terminals.find(item => item.code === terminalCode)!;
  if (!data.stands.some(item => item.code === standCode)) {
    const form = page.getByRole("form", { name: "Nueva posición" });
    await form.getByRole("combobox", { name: /^Terminal/ }).selectOption(terminal.id);
    await form.getByLabel("Código").fill(standCode);
    await form.getByRole("button", { name: "Crear posición" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Posición ${standCode} creada.` })).toBeVisible();
  }
  if (!data.aircraftTypes.some(item => item.icaoCode === aircraftTypeIcao)) {
    const form = page.getByRole("form", { name: "Nuevo tipo de avión" });
    await form.getByLabel("OACI").fill(aircraftTypeIcao);
    await form.getByLabel("Fabricante").fill("E2E Aero");
    await form.getByLabel("Modelo").fill(`Sintético ${run.runId}`);
    await form.getByRole("combobox", { name: /^Tamaño/ }).selectOption("Narrowbody");
    await form.getByRole("button", { name: "Crear tipo de avión" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Tipo de avión ${aircraftTypeIcao} creado.` })).toBeVisible();
  }
  data = await masterData();
  const stand = data.stands.find(item => item.code === standCode)!;
  const aircraftType = data.aircraftTypes.find(item => item.icaoCode === aircraftTypeIcao)!;
  expect([stand.terminalId, stand.isActive, aircraftType.isActive]).toEqual([terminal.id, true, true]);
  await snap(page, "fase2-hueco-2a-datos-maestros");

  // The new terminal reaches Cobertura, and the stand and the type the «Nuevo vuelo» form («type once»).
  const coverage = await expectCall<{ terminals: Array<{ code: string }> }>(200, occ, "GET",
    `/occ/coverage?stationId=${puj.id}&date=${localDay()}`);
  expect(coverage.data.terminals.map(item => item.code)).toContain(terminalCode);
  await goPrivate(page, "/admin-occ/planning");
  await page.getByRole("button", { name: "Nuevo vuelo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo vuelo" });
  await expect(dialog.getByText("Consultando contratos y aeropuertos…")).toBeHidden();
  await expect(dialog.getByRole("combobox", { name: /^Posición de estacionamiento/ }).locator("option")
    .filter({ hasText: `${standCode} · Terminal ${terminalCode}` })).toHaveCount(1);
  await expect(dialog.getByRole("combobox", { name: /^Tipo de avión/ }).locator("option")
    .filter({ hasText: aircraftTypeIcao })).toHaveCount(1);
  await snap(page, "fase2-hueco-2a-nuevo-vuelo");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  saveRun({ masterData: { terminalCode, standId: stand.id, standCode, aircraftTypeId: aircraftType.id,
    aircraftTypeIcao } satisfies RunMasterData });
});

/** «ZZ 1234» and «ZZ1234» are the same flight, as the server compares them (hueco 3-N07). */
const flightKey = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toUpperCase();

/** The arrival and departure numbers of the station's open flights of the day. */
async function plannedFlightNumbers(token: string, stationId: string, day: string) {
  type Planned = { status: string; arrival: { flightNumber: string } | null; departure: { flightNumber: string } | null };
  const snapshot = await expectCall<{ turnarounds: Planned[] }>(200, token, "GET",
    `/occ/planning?stationId=${stationId}&date=${day}`);
  const open = snapshot.data.turnarounds.filter(item => !["Cancelled", "Diverted", "Completed"].includes(item.status));
  return { arrivals: new Set(open.map(item => flightKey(item.arrival?.flightNumber))),
    departures: new Set(open.map(item => flightKey(item.departure?.flightNumber))) };
}

/** Whether an arrival or the departure it suggests is already planned: the import would link instead of creating. */
function isPlannedPair(arrival: { flightNumber: string; suggestedDepartureId: string | null },
  proposals: Array<{ proposalId: string; flightNumber: string }>, planned: { arrivals: Set<string>; departures: Set<string> }) {
  const departure = proposals.find(item => item.proposalId === arrival.suggestedDepartureId);
  return planned.arrivals.has(flightKey(arrival.flightNumber)) ||
    (departure !== undefined && planned.departures.has(flightKey(departure.flightNumber)));
}

test("hueco 2-B · el feed simulado propone un vuelo con modelo de avión, posición y charter", async ({ page }) => {
  const { run, version } = contractOf();
  const puj = version.stations.find(item => item.code === "PUJ")!;
  const master = run.masterData as RunMasterData | undefined;
  expect(master, "the 2-A step left its synthetic stand and aircraft type").toBeTruthy();
  const occ = await login("occ");
  const day = localDay();
  type Proposal = { proposalId: string; direction: string; flightNumber: string; airlineName: string; status: string;
    scheduledAt: string; suggestedDepartureId: string | null; aircraftModel: string | null; counterpartIata: string | null };
  type Feed = { budget: { configured: boolean; provider: string }; proposals: Proposal[] };
  const feed = async (view: "Contracted" | "Charter" | "Dismissed") => (await expectCall<Feed>(200, occ, "GET",
    `/occ/flight-feed?stationId=${puj.id}&date=${day}&view=${view}`)).data;
  // Only the simulated provider is ever refreshed here: the harness never spends a paid read (AeroDataBox).
  const current = await feed("Contracted");
  test.skip(current.budget.provider !== "Simulated" || !current.budget.configured,
    "El stack no tiene el feed simulado (SimulatedFlightFeed__Enabled en compose.local.e2e.yml).");

  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/planning");
  // Planificación opens on the day the server resolves (3-N17 makes it the station's today): pick today explicitly.
  await page.getByLabel("Fecha operativa", { exact: true }).first().fill(day);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Importar vuelos" }).click();
  const dialog = page.getByRole("dialog", { name: "Importar vuelos del proveedor" });
  await expect(dialog.getByText("Cargando vuelos propuestos…")).toBeHidden();
  const refresh = dialog.getByRole("button", { name: "Actualizar ahora" });
  if (await refresh.isEnabled()) {
    await refresh.click();
    await expect(dialog.getByRole("status").filter({ hasText: /Lista actualizada|sin gastar unidades|Ya se actualizó/ }))
      .toBeVisible();
  }
  // Arrivals still ahead, with the model the provider reported and the departure the same aircraft turns into. A flight
  // already planned today (an earlier run imported the same number) would join that turnaround instead (hueco 3-N07).
  const planned = await plannedFlightNumbers(occ, puj.id, day);
  const contracted = (await feed("Contracted")).proposals;
  const ahead = contracted.filter(item => item.direction === "Arrival" && item.status === "Proposed" &&
    item.suggestedDepartureId && item.aircraftModel && item.counterpartIata && Date.parse(item.scheduledAt) > Date.now() + 15 * 60_000 &&
    !isPlannedPair(item, contracted, planned));
  const chosen = ahead.find(item => item.airlineName === "Demo Airlines") ?? ahead[0];
  expect(chosen, "the simulated feed proposed a contracted arrival still ahead today").toBeTruthy();
  const arrivals = dialog.getByRole("list", { name: "Llegadas propuestas" });
  // The simulated feed can repeat a flight number on the same day from another origin: the row is the number and its origin.
  const row = arrivals.getByRole("listitem").filter({ hasText: chosen!.flightNumber })
    .filter({ hasText: `desde ${chosen!.counterpartIata}` });
  await expect(row).toContainText(chosen!.aircraftModel!);
  // A select inside its label is named by the label and the chosen option, hence the anchored names.
  await row.getByRole("combobox", { name: /^Tipo de avión/ }).selectOption(master!.aircraftTypeId);
  await row.getByRole("combobox", { name: /^Posición/ }).selectOption(master!.standId);
  await snap(page, "fase2-hueco-2b-importar");
  await row.getByRole("button", { name: "Importar escala" }).click();
  // The readable code of the station and local day (hueco 3-N27).
  await expect(dialog.getByRole("status").filter({ hasText: /^Escala importada \([A-Z]{3}-\d{8}-\d{3,}\)/ })).toBeVisible();

  // The flight came in with its stand and its aircraft type: neither can be deactivated while it is pending.
  const positions = await expectCall<{ positions: Array<{ code: string;
    turnarounds: Array<{ arrivalFlightNumber: string | null }> }> }>(200, occ, "GET", `/occ/positions?stationId=${puj.id}&date=${day}`);
  expect(positions.data.positions.find(item => item.code === master!.standCode)?.turnarounds
    .some(item => item.arrivalFlightNumber === chosen!.flightNumber)).toBe(true);
  const data = (await expectCall<MasterData>(200, occ, "GET", `/occ/master-data?stationId=${puj.id}`)).data;
  const stand = data.stands.find(item => item.id === master!.standId)!;
  const standOff = await call<{ code?: string }>(occ, "PUT", `/occ/stands/${stand.id}`, { terminalId: stand.terminalId,
    code: stand.code, hasBoardingBridge: stand.hasBoardingBridge, isRemote: stand.isRemote,
    maxAircraftSize: stand.maxAircraftSize, isActive: false, expectedVersion: stand.version });
  expect([standOff.status, standOff.data.code]).toEqual([409, "stand_in_use"]);
  const type = data.aircraftTypes.find(item => item.id === master!.aircraftTypeId)!;
  const typeOff = await call<{ code?: string }>(occ, "PUT", `/occ/aircraft-types/${type.id}`, { iataCode: type.iataCode,
    manufacturer: type.manufacturer, model: type.model, sizeCategory: type.sizeCategory, isActive: false,
    expectedVersion: type.version });
  expect([typeOff.status, typeOff.data.code]).toEqual([409, "aircraft_type_in_use"]);

  // A dismissed arrival comes back from «Descartadas» while its flight has not passed (2-N36).
  const other = ahead.find(item => item.proposalId !== chosen!.proposalId);
  if (other) {
    await arrivals.getByRole("listitem").filter({ hasText: other.flightNumber }).filter({ hasText: `desde ${other.counterpartIata}` })
      .getByRole("button", { name: "Descartar" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: `${other.flightNumber} descartado` })).toBeVisible();
    await dialog.getByRole("button", { name: "Descartadas" }).click();
    const dismissed = dialog.getByRole("list", { name: "Llegadas descartadas" }).getByRole("listitem")
      .filter({ hasText: other.flightNumber }).filter({ hasText: `desde ${other.counterpartIata}` });
    await dismissed.getByRole("button", { name: "Restaurar" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: `${other.flightNumber} volvió a la revisión.` })).toBeVisible();
    expect((await feed("Contracted")).proposals.some(item => item.proposalId === other.proposalId)).toBe(true);
  }

  // A carrier without contract only comes in as a charter, with its prepayment pending in Finanzas (ADR-0033).
  await dialog.getByRole("button", { name: "Charter sin contrato" }).click();
  await expect(dialog.getByText("Cargando vuelos propuestos…")).toBeHidden();
  const charters = (await feed("Charter")).proposals;
  const charter = charters.find(item => item.direction === "Arrival" && item.status === "Proposed" &&
    item.suggestedDepartureId && item.counterpartIata && !isPlannedPair(item, charters, planned));
  if (charter) {
    await dialog.getByRole("list", { name: "Llegadas propuestas" }).getByRole("listitem").filter({ hasText: charter.flightNumber })
      .filter({ hasText: `desde ${charter.counterpartIata}` }).getByRole("button", { name: "Importar como charter" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: /^Charter importado/ })).toBeVisible();
    const charters = await expectCall<{ charters: Array<{ airlineName: string; prepaymentStatus: string }> }>(200,
      await login("finance"), "GET", "/finance/charters");
    expect(charters.data.charters.some(item => item.airlineName === charter.airlineName && item.prepaymentStatus === "Pending"))
      .toBe(true);
  } else {
    await expect(dialog.getByText("No hay vuelos de aerolíneas sin contrato propuestos para esta fecha.")).toBeVisible();
    test.info().annotations.push({ type: "charter", description: "Ninguna aerolínea activa sin contrato: no hubo charter que importar." });
  }
  await snap(page, "fase2-hueco-2b-charter");
});
test("hueco 2-C · una renovación aprobada por Finanzas no cambia precios hasta estar firmada y vigente", async ({ page }) => {
  const { run, contract, version } = contractOf();
  const representative = run.representative as { email: string; name: string };
  const station = version.stations.find(item => item.code === "PUJ")!;
  type Agreement = { id: string; status: string;
    approvedVersions: Array<{ id: string; versionNumber: number; status: string; validFrom: string; validTo: string | null }> };
  const agreement = async () => (await expectCall<{ contracts: Agreement[] }>(200, await login("contracts"), "GET",
    "/contracts/agreements?page=1&limit=50")).data.contracts.find(item => item.id === contract.id)!;
  type Ready = { contracts: Array<{ contractId: string; versionId: string; versionNumber: number }> };
  const governingOn = async (date: string) => (await expectCall<Ready>(200, await login("occ"), "GET",
    `/occ/contracts?stationId=${station.id}&date=${date}`)).data.contracts.find(item => item.contractId === contract.id);

  // The amendment Finance approved in the 1-C step waits for both signatures; the version in force governs.
  const before = await agreement();
  const amendment = before.approvedVersions.filter(item => item.status === "Approved")
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]!;
  const inForce = before.approvedVersions.find(item => item.id === version.id)!;
  expect(amendment.id, "the 1-C step left an approved amendment").not.toBe(inForce.id);
  expect((await governingOn(amendment.validFrom))?.versionId, "Finance approval alone changes nothing that is billed")
    .toBe(inForce.id);

  // Contratos fixes the amendment's validity; the airline signs it; prices still do not change.
  await loginPrivate(page, "contracts");
  const drawer = await openContractDetail(page, contract.airline, amendment.versionNumber);
  const validity = drawer.getByRole("form", { name: "Vigencia y renovación" });
  await expect(validity.getByLabel("Inicio de la vigencia")).toHaveValue(amendment.validFrom);
  await validity.getByLabel("Condiciones de terminación").fill("Incumplimiento grave de pago. Enmienda E2E.");
  await validity.getByRole("button", { name: "Confirmar vigencia" }).click();
  await expect(drawer.getByRole("heading", { name: "Vigencia y renovación confirmadas" })).toBeVisible();
  const airline = await login({ email: representative.email });
  const unsigned = await expectCall<{ contentSha256: string; signableBy: string | null }>(200, airline, "GET",
    `/contract-versions/${amendment.id}/document`);
  expect(unsigned.data.signableBy).toBe("Airline");
  await expectCall(200, airline, "POST", `/contract-versions/${amendment.id}/signatures`, {
    signerName: representative.name, signerTitle: "Gerente de estación", documentSha256: unsigned.data.contentSha256,
    accepted: true, signatureImagePng: SIGNATURE_PNG });
  expect((await governingOn(amendment.validFrom))?.versionId, "one signature is not enough").toBe(inForce.id);

  // AVIAM countersigns the same content: from its start the amendment governs, and the day before the
  // version it replaces still does.
  await page.reload();
  const signed = await openContractDetail(page, contract.airline, amendment.versionNumber);
  const form = signed.locator("form").filter({ has: page.getByRole("heading", { name: "Firmar por AVIAM" }) });
  await form.getByLabel("Nombre completo").fill("Laura Contratos Prueba");
  await form.getByLabel("Cargo").fill("Gerente de Contratos");
  await form.getByRole("checkbox").check();
  await drawSignature(page, form.getByRole("img", { name: "Firma" }));
  await form.getByRole("button", { name: "Acepto y firmo" }).click();
  await expect(signed.getByText(/Firmado por ambas partes el/)).toBeVisible();
  await snap(page, "fase2-hueco-2c-enmienda-firmada");
  expect((await governingOn(amendment.validFrom))?.versionId).toBe(amendment.id);
  const dayBefore = new Date(Date.parse(`${amendment.validFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  expect((await governingOn(dayBefore))?.versionId).toBe(inForce.id);
  const after = await agreement();
  expect(after.approvedVersions.find(item => item.id === inForce.id)).toMatchObject({ status: "Superseded", validTo: dayBefore });
  expect(after.status, "the contract stays active").toBe("Active");
});
test("hueco 2-D · los PDF de Finanzas, Gestión Humana y OCC muestran las tildes", async () => {
  const { version } = contractOf();
  const station = version.stations.find(item => item.code === "PUJ")!;
  const day = businessDay();
  const reports = [
    { who: "occ" as const, name: "OCC", route: `/occ/reports/operations/export?stationId=${station.id}&from=${day}&to=${day}&format=pdf`,
      words: ["Operaciones del período", "Aerolínea", "Página 1"] },
    { who: "hr" as const, name: "Gestión Humana",
      route: `/human-resources/reports/staff-distribution/export?stationId=${station.id}&from=${day}&to=${day}&format=pdf`,
      words: ["GESTIÓN HUMANA", "Página 1"] },
    { who: "finance" as const, name: "Finanzas", route: `/finance/reports/receivables/export?format=pdf&from=${day}&to=${day}`,
      words: ["Cuentas por cobrar y antigüedad", "Pág. 1"] },
  ];
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const report of reports) {
    const result = await expectCall<Buffer>(200, await login(report.who), "GET", report.route);
    const pdf = result.data;
    expect(pdf.subarray(0, 5).toString("latin1"), report.name).toBe("%PDF-");
    fs.writeFileSync(path.join(SHOTS_DIR, `hueco-2d-${report.who}.pdf`), pdf);
    // Unicode Type0 fonts with the complete Noto Sans faces: a WinAnsi subset loses the accent components.
    const fonts = pdfFonts(pdf);
    expect(fonts.subtypes, report.name).toContain("Type0");
    expect(fonts.subtypes, report.name).not.toContain("TrueType");
    expect(fonts.encodings.every(encoding => encoding === "Identity-H"), report.name).toBe(true);
    expect(fonts.fontFileLengths.length, report.name).toBeGreaterThan(0);
    expect(fonts.fontFileLengths.every(length => length > 400_000), `${report.name}: complete font file`).toBe(true);
    const text = pdfText(pdf);
    for (const word of report.words) expect(text, `${report.name}: «${word}»`).toContain(word);
  }
});
test("hueco 2-E · OCC y Gestión Humana muestran el usuario de la sesión, no el de ejemplo", async ({ page }) => {
  // The shells receive the signed-in account; the example users of the prototype data never show.
  const shells = [
    { role: "occ", route: "/admin-occ/contracts", example: "Laisha Ramírez" },
    { role: "hr", route: "/gestion-humana/users", example: "Camila Reyes" },
  ] as const;
  for (const shell of shells) {
    await loginPrivate(page, shell.role);
    await goPrivate(page, shell.route);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(page.getByText(shell.example)).toHaveCount(0);
    await snap(page, `fase2-2E-usuario-${shell.role}`);
  }
});
test("hueco 2-F · el día de los contratos sigue el calendario de República Dominicana, no UTC", async ({ page }) => {
  const { run, version } = contractOf();
  const representative = run.representative as { email: string };
  // The server dates a version's signature by AVIAM's business day of its second signature.
  const document = await expectCall<{ signedOn: string | null; signatures: Array<{ signedAt: string }> }>(200,
    await login("contracts"), "GET", `/contract-versions/${version.id}/document`);
  expect(document.data.signatures).toHaveLength(2);
  const second = document.data.signatures.map(item => item.signedAt).sort().at(-1)!;
  expect(document.data.signedOn).toBe(businessDayOf(new Date(second)));

  // At 21:30 in Santo Domingo the UTC day is already tomorrow: the portal still limits permits by today.
  await openPortalContracts(page, representative.email);
  const form = page.getByRole("form", { name: "Enviar un permiso" });
  await expect(form).toBeVisible();
  const yesterday = businessDay(-1);
  await page.clock.setFixedTime(new Date(`${yesterday}T21:30:00-04:00`));
  // Any keystroke renders the form again with the frozen clock.
  await form.getByLabel("Número").fill("JAC-2F");
  await expect(form.getByLabel("Fecha de vencimiento")).toHaveAttribute("min", yesterday);
  await expect(form.getByLabel("Fecha de emisión")).toHaveAttribute("max", yesterday);
  await form.getByLabel("Número").fill("");
  await snap(page, "fase2-hueco-2f-dia-habil");
});

test("hueco 2-N20 · la representante gestiona los usuarios del portal y AVIAM marca firmantes", async ({ page }) => {
  const { run } = contractOf();
  const representative = run.representative as { email: string };
  const airline = run.airline as { name: string };
  type PortalUser = { id: string; email: string; version: string; representative: boolean; signer: boolean;
    invitationPending: boolean };
  type PortalUsers = { me: { representative: boolean; signer: boolean; canSign: boolean; canManageUsers: boolean };
    users: PortalUser[] };
  const token = await login({ email: representative.email });
  const read = async () => (await expectCall<PortalUsers>(200, token, "GET", "/airline/portal/users")).data;
  const byEmail = (users: PortalUser[], email: string) =>
    users.find(user => user.email.toLowerCase() === email.toLowerCase());
  // The account provisioned for the airline represents it: it manages the users and signs.
  const before = await read();
  expect(before.me).toMatchObject({ representative: true, canSign: true, canManageUsers: true });

  // It invites a colleague by email; a retry with the same key answers the same user, never a second account.
  const email = `e2e.consulta.${run.runId.toLowerCase()}@e2e-portal.example.com`;
  if (!byEmail(before.users, email)) {
    const since = Date.now();
    const body = { firstName: "Lucía", lastName: "Consulta", email, signer: false };
    const headers = { "idempotency-key": crypto.randomUUID() };
    const invited = await expectCall<PortalUser>(201, token, "POST", "/airline/portal/users", body, headers);
    expect(invited.data).toMatchObject({ invitationPending: true, signer: false, representative: false });
    const replay = await expectCall<PortalUser>(200, token, "POST", "/airline/portal/users", body, headers);
    expect(replay.data.id).toBe(invited.data.id);
    await waitForEmail(email, /Activa tu cuenta/i, since);
  }
  // A representative never changes itself: AVIAM does.
  const own = byEmail((await read()).users, representative.email)!;
  const refused = await call<{ code?: string }>(token, "POST", `/airline/portal/users/${own.id}/status`,
    { isActive: false, expectedVersion: own.version });
  expect([refused.status, refused.data.code]).toEqual([409, "portal_user_protected"]);

  // AVIAM marks the colleague as a signer from Clientes; the representative's notice goes through the outbox.
  const superadmin = await login("superadmin");
  const clients = await expectCall<Array<{ organizationId: string; name: string }>>(200, superadmin, "GET",
    "/governance/clients");
  const organization = clients.data.find(item => item.name === airline.name) ??
    clients.data.find(item => item.name.includes(run.runId) && item.name.includes("Airways"))!;
  expect(organization, airline.name).toBeTruthy();
  const listed = await expectCall<Array<PortalUser>>(200, superadmin, "GET",
    `/governance/clients/${organization.organizationId}/users`);
  const colleague = byEmail(listed.data, email)!;
  expect(byEmail(listed.data, representative.email)?.representative).toBe(true);
  if (!colleague.signer) {
    const since = Date.now();
    await expectCall(200, superadmin, "POST", `/governance/clients/${organization.organizationId}/users/${colleague.id}/portal-role`,
      { representative: false, signer: true, expectedVersion: colleague.version });
    await waitForEmail(representative.email, /usuarios del portal/i, since);
  }
  expect(byEmail((await read()).users, email)?.signer).toBe(true);

  // «Perfil» shows who has access, who signs and the invitation form of a representative.
  await loginPortal(page, representative.email);
  await page.getByRole("link", { name: "Perfil", exact: true }).first().click();
  await expect(page).toHaveURL(`${PUBLIC_WEB}/portal/perfil`);
  const users = page.getByRole("list", { name: "Usuarios del portal" });
  await expect(users).toContainText(email);
  await expect(users).toContainText("Firmante");
  await expect(page.getByRole("form", { name: "Invitar a un usuario" })).toBeVisible();
  await snap(page, "fase2-hueco-2n20-usuarios-portal");
});

test("huecos 2-N38 y 2-N02 · la gobernanza heredada se retiró y OCC ve las tablets de la estación", async ({ page }) => {
  const { version } = contractOf();
  // 2-N38: the role editor and the direct creation of accounts answer 410 with their code, whatever the body.
  const superadmin = await login("superadmin");
  for (const [method, route] of [["POST", "/governance/users"], ["POST", "/governance/roles"]] as const) {
    const retired = await call<{ code?: string }>(superadmin, method, route, { name: "Rol", firstName: "Ana" });
    expect([retired.status, retired.data.code], `${method} ${route}`).toEqual([410, "legacy_governance_retired"]);
  }
  // 2-N02: OCC reads who holds each shared tablet of its station and may free or revoke them.
  const station = version.stations.find(item => item.code === "PUJ")!;
  const devices = await expectCall<{ stationCode: string; canUnbind: boolean; canRevoke: boolean; devices: unknown[] }>(
    200, await login("occ"), "GET", `/occ/devices?stationId=${station.id}`);
  expect(devices.data).toMatchObject({ stationCode: "PUJ", canUnbind: true, canRevoke: true });
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/devices");
  await expect(page.getByRole("heading", { name: "Tablets", exact: true })).toBeVisible();
  await expect(page.getByText("Cargando las tablets…")).toBeHidden();
  await snap(page, "fase2-hueco-2n02-tablets");
});
