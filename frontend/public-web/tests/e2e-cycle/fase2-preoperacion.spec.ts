import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
import { drawSignature, goPrivate, loginPortal, loginPrivate, openModule, snap } from "./support/browser";
import { API, loadRun, PUBLIC_WEB, saveRun, SHOTS_DIR } from "./support/env";
import { attachment, waitForEmail } from "./support/mailpit";

// Fase 2 · Pre-operación: Contratos fixes the validity, the airline and AVIAM sign with a drawn
// signature, the airline submits its JAC permit and Contratos verifies it, so the contract becomes
// active and the signed PDF goes out by email. Gestión Humana confirms the ramp agent can operate
// and programs today's shift; OCC sees the contract ready to plan at PUJ.

type RunContract = { id: string; code: string; airline: string;
  approvedVersions: Array<{ id: string; versionNumber: number; stations: Array<{ id: string; code: string }> }> };

const AGENT = "Riley Ramp";
/** Contract days are UTC days on the server (hueco 2-F); local days drive shifts and flights. */
const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
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
  const { contract, version } = contractOf();
  await loginPrivate(page, "contracts");
  const drawer = await openContractDetail(page, contract.airline, version.versionNumber);
  const confirmed = drawer.getByRole("heading", { name: "Vigencia y renovación confirmadas" });
  const before = await expectCall<{ validity: unknown }>(200, await login("contracts"), "GET",
    `/contract-versions/${version.id}/document`);
  if (!before.data.validity) { // a resumed run (--no-deps) may have confirmed it already
    await expect(drawer.getByText("Pendiente: Contratos debe fijar la vigencia y la renovación antes de las firmas.")).toBeVisible();
    const validity = drawer.getByRole("form", { name: "Vigencia y renovación" });
    await validity.getByLabel("Inicio de la vigencia").fill(utcDay());
    await validity.getByLabel("Fin de la vigencia").fill(utcDay(365));
    // A select inside its label is named by the label plus the chosen option.
    await validity.getByRole("combobox", { name: /^Renovación/ }).selectOption("Manual");
    await validity.getByLabel("Condiciones de terminación")
      .fill("Incumplimiento grave de pago o de las normas de seguridad en rampa. Corrida E2E.");
    await validity.getByRole("button", { name: "Confirmar vigencia" }).click();
    await expect(confirmed).toBeVisible();
    await snap(page, "fase2-contratos-vigencia");
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
  await form.getByLabel("Fecha de emisión").fill(utcDay(-30));
  await form.getByLabel("Fecha de vencimiento").fill(utcDay(365));
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
  await expect(page.locator("article").filter({ hasText: contract.airline }).first()).toContainText("Active");
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
  // Only reads the stored feed; this stack has AeroDataBox off, so no provider unit is spent.
  const token = await login("occ");
  const feed = await call<{ budget: { configured: boolean } }>(token, "GET",
    `/occ/flight-feed?stationId=${station.id}&date=${localDay()}`);
  expect(feed.status).toBe(200);
  saveRun({ feedConfigured: feed.data.budget.configured });
});

test.fixme("hueco 2-A · Superadmin crea una estación y OCC sus terminales, posiciones y tipos de avión", async () => {});
test.fixme("hueco 2-B · el feed simulado propone un vuelo con modelo de avión, posición y charter", async () => {});
test.fixme("hueco 2-C · una renovación aprobada por Finanzas no cambia precios hasta estar firmada y vigente", async () => {});
test.fixme("hueco 2-D · los PDF de Finanzas, Gestión Humana y OCC muestran las tildes", async () => {});
test.fixme("hueco 2-E · OCC y Gestión Humana muestran el usuario de la sesión, no el de ejemplo", async () => {});
test.fixme("hueco 2-F · el día de los contratos sigue el calendario de República Dominicana, no UTC", async () => {});
