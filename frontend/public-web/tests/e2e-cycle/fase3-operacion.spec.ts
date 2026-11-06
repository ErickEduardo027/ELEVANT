import { expect, type Page, test } from "@playwright/test";
import { expectCall, login } from "./support/api";
import { goPrivate, loginPortal, loginPrivate, snap } from "./support/browser";
import { API, loadRun, saveRun } from "./support/env";

// Fase 3 · La operación: OCC registers the run's flight and assigns it to the ramp agent from the
// planning screen, the agent runs it on the tablet (through the API, as the APK does, with its
// installation id), OCC approves the close from the review screen, and the airline sees the
// operation and its Service Order in the portal.

type RunContract = { airline: string; approvedVersions: Array<{ stations: Array<{ id: string; code: string }> }> };
type Leg = { flightNumber: string; scheduledAt: string };
type Turnaround = { id: string; operationCode: string; status: string; arrival: Leg | null; departure: Leg | null;
  operation: { id: string; status: string } | null; agents: Array<{ displayName: string }> };
type Flight = { arrivalNumber: string; turnaroundId: string; operationCode: string; arrivalAt: string; departureAt: string };

const AGENT = "Riley Ramp";
const MINUTE = 60_000;
const localDay = () => new Date().toLocaleDateString("en-CA");
const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * MINUTE).toISOString();
const shifted = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * MINUTE).toISOString();
/** The manual flight dialog takes UTC times in datetime-local inputs. */
const utcInput = (iso: string) => iso.slice(0, 16);
const strokes = [[0.05, 0.6, 0.2, 0.2, 0.35, 0.75, 0.5, 0.3]];

/**
 * A 90-minute turnaround inside the agent's shift that ends as close to now as possible (the tablet
 * records past milestones, never future ones) and does not overlap the agent's other flights of the
 * day: an approved operation still holds its agent (hueco 3-D).
 */
function freeWindow(shift: { workDate: string; startsAtLocal: string; endsAtLocal: string }, busy: Array<[number, number]>) {
  const start = Date.parse(`${shift.workDate}T${shift.startsAtLocal}-04:00`); // America/Santo_Domingo, no DST
  let end = Date.parse(`${shift.workDate}T${shift.endsAtLocal}-04:00`);
  if (end <= start) end += 24 * 60 * MINUTE;
  for (let arrival = Date.now() - 50 * MINUTE; arrival >= start; arrival -= 15 * MINUTE) {
    const departure = arrival + 90 * MINUTE;
    if (departure > end || busy.some(([from, to]) => arrival < to && departure > from)) continue;
    return { arrivalAt: new Date(arrival).toISOString(), departureAt: new Date(departure).toISOString() };
  }
  throw new Error("The agent's shift has no free 90-minute window left today (hueco 3-D keeps approved flights).");
}

function runState() {
  const run = loadRun();
  const contract = run.contract as RunContract;
  const station = contract.approvedVersions[0].stations.find(item => item.code === "PUJ")!.id;
  return { run, contract, station, airline: run.airline as { name: string; iata: string } };
}

/** The tablet as the APK uses the API: the agent's session plus its installation id on every command. */
async function tablet() {
  const run = loadRun();
  const installationId = (run.installationId as string | undefined) ?? crypto.randomUUID();
  const token = await login("ramp");
  if (!run.installationId) {
    await expectCall([200, 201, 204], token, "PUT", "/mobile/device", { installationId, platform: "Android",
      appVersion: "1.0.0", deviceName: "Tablet E2E ciclo", operatingSystemVersion: "Android 16" });
    saveRun({ installationId });
  }
  const device = { "x-elevant-installation-id": installationId };
  return {
    token, device,
    get: <T>(route: string) => expectCall<T>(200, token, "GET", route, undefined, device),
    send: <T>(expected: number | number[], method: string, route: string, body?: unknown) =>
      expectCall<T>(expected, token, method, route, body, { ...device, "idempotency-key": crypto.randomUUID() }),
  };
}

async function todaysTurnarounds(station: string) {
  const token = await login("occ");
  const snapshot = await expectCall<{ turnarounds: Turnaround[] }>(200, token, "GET",
    `/occ/planning?stationId=${station}&date=${localDay()}`);
  return snapshot.data.turnarounds;
}

async function findTurnaround(station: string, flightNumber: string) {
  return (await todaysTurnarounds(station)).find(item => item.arrival?.flightNumber === flightNumber);
}

async function openFlight(page: Page, operationCode: string) {
  await goPrivate(page, "/admin-occ/planning");
  const card = page.getByTestId("flight-card").filter({ hasText: operationCode });
  await expect(card).toBeVisible();
  await card.click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  test.skip(!health?.ok, "The local stack is not running.");
});

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

test("OCC registra el vuelo de la aerolínea desde Planificación", async ({ page }) => {
  const { run, station, airline } = runState();
  const digits = String(parseInt(run.runId.slice(-5), 36) % 9000 + 1000);
  const arrivalNumber = `${airline.iata}${digits}`;
  const today = await todaysTurnarounds(station);
  if (today.some(item => item.arrival?.flightNumber === arrivalNumber)) return; // resumed run: already registered
  const busy = today.filter(item => item.agents.some(agent => agent.displayName === AGENT) && item.arrival && item.departure)
    .map(item => [Date.parse(item.arrival!.scheduledAt), Date.parse(item.departure!.scheduledAt)] as [number, number]);
  const window = freeWindow(run.shift as { workDate: string; startsAtLocal: string; endsAtLocal: string }, busy);
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/planning");
  await page.getByRole("button", { name: "Nuevo vuelo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo vuelo" });
  await expect(dialog.getByText("Consultando contratos y aeropuertos…")).toBeHidden();
  await dialog.getByLabel("Fecha operativa").fill(localDay());
  const airlines = dialog.getByRole("combobox", { name: /^Aerolínea contratada/ });
  await airlines.selectOption({ label: `${airline.name} · ${airline.iata}` });
  await dialog.getByLabel("Vuelo de llegada").fill(arrivalNumber);
  await dialog.getByRole("combobox", { name: /^Origen de llegada/ }).selectOption("MIA");
  await dialog.getByLabel("Vuelo de salida").fill(`${airline.iata}${Number(digits) + 1}`);
  await dialog.getByRole("combobox", { name: /^Destino de salida/ }).selectOption("MIA");
  await dialog.getByLabel("Llegada programada (UTC)").fill(utcInput(window.arrivalAt));
  await dialog.getByLabel("Salida programada (UTC)").fill(utcInput(window.departureAt));
  const stands = dialog.getByRole("combobox", { name: /^Posición de estacionamiento/ });
  const options = await stands.locator("option").evaluateAll(items =>
    items.map(item => ({ value: (item as HTMLOptionElement).value, label: item.textContent ?? "" })));
  // A stand still held by an earlier run's flight is rejected (hueco 3-A): try the next free one.
  for (const option of options.filter(item => item.value && item.label.includes("Terminal A"))) {
    await stands.selectOption(option.value);
    await snap(page, "fase3-occ-nuevo-vuelo");
    await dialog.getByRole("button", { name: "Crear vuelo" }).click();
    const outcome = await Promise.race([
      dialog.waitFor({ state: "hidden", timeout: 30_000 }).then(() => "created"),
      dialog.getByRole("alert").waitFor({ timeout: 30_000 }).then(() => "rejected"),
    ]);
    if (outcome === "created") break;
  }
  const turnaround = await findTurnaround(station, arrivalNumber);
  expect(turnaround, "the manual flight was created").toBeTruthy();
  saveRun({ flight: { arrivalNumber, turnaroundId: turnaround!.id, operationCode: turnaround!.operationCode, ...window } });
});

test("OCC asigna el vuelo al agente de rampa dentro de su turno", async ({ page }) => {
  const { run, station } = runState();
  const flight = run.flight as Flight;
  const before = await findTurnaround(station, flight.arrivalNumber);
  if (!before?.agents.some(agent => agent.displayName === AGENT)) {
    await loginPrivate(page, "occ");
    await openFlight(page, flight.operationCode);
    const form = page.getByRole("form", { name: "Asignación de operación" });
    await expect(form).toBeVisible();
    const choice = form.locator("label").filter({ hasText: AGENT });
    await expect(choice, "the agent with today's shift is eligible").toContainText("Elegible");
    await choice.getByRole("radio").check();
    await snap(page, "fase3-occ-asignacion");
    await form.getByRole("button", { name: "Asignar operación" }).click();
    await expect(page.getByText(`Operación asignada a ${AGENT}.`)).toBeVisible();
  }
  const device = await tablet();
  const mine = await device.get<{ operations: Array<{ operation: { id: string }; turnaround: { id: string } }> }>(
    "/ramp/operations");
  const operation = mine.data.operations.find(item => item.turnaround.id === flight.turnaroundId);
  expect(operation, "the flight reaches the agent's tablet").toBeTruthy();
  const notices = await device.get<{ notifications: Array<{ kind: string }> }>("/notifications");
  expect(notices.data.notifications.some(item => item.kind === "operation_assigned")).toBe(true);
  saveRun({ operationId: operation!.operation.id });
});

test("OCC y el agente conversan por el chat de la operación", async () => {
  const operationId = String(loadRun().operationId);
  const occ = await login("occ");
  await expectCall([200, 201], occ, "POST", `/chat/conversations/${operationId}/messages`,
    { content: "Ciclo E2E: ¿todo listo para el bloqueo?" });
  const device = await tablet();
  const conversations = await device.get<{ conversations: Array<{ operationId: string; unreadCount: number }> }>(
    "/chat/conversations");
  expect(conversations.data.conversations.find(item => item.operationId === operationId)?.unreadCount ?? 0)
    .toBeGreaterThanOrEqual(1);
  const messages = await device.get<{ messages: Array<{ id: string }> }>(`/chat/conversations/${operationId}/messages`);
  await expectCall([200, 204], device.token, "PUT", `/chat/conversations/${operationId}/read`,
    { messageId: messages.data.messages.at(-1)?.id }, device.device);
  await device.send([200, 201], "POST", `/chat/conversations/${operationId}/messages`, { content: "Listo, en posición." });
});

test("El agente opera el vuelo en la tablet: inicio, hitos, datos, servicios y checklist", async () => {
  const run = loadRun();
  const operationId = String(run.operationId);
  const flight = run.flight as Flight;
  const device = await tablet();
  const assigned = await device.get<{ operations: Array<{ operation: { id: string; status: string } }> }>("/ramp/operations");
  // A resumed run (--no-deps) finds the operation already started: repeated taps may answer 409.
  const resumed = assigned.data.operations.find(item => item.operation.id === operationId)?.operation.status !== "Assigned";
  const again = resumed ? [200, 409] : 200;
  if (!resumed) {
    const occ = await login("occ");
    await expectCall(200, occ, "POST", `/occ/turnarounds/${flight.turnaroundId}/arrival`,
      { aircraftRegistration: "N123AA", arrivedAt: shifted(flight.arrivalAt, 8) });
    await device.send(200, "POST", `/ramp/operations/${operationId}/start`);
  }
  // Milestones at their times within the turnaround window, never in the future.
  const pushback = new Date(Math.min(Date.parse(flight.departureAt) - 2 * MINUTE, Date.now() - MINUTE)).toISOString();
  for (const [code, when] of [["BLOCK_ON", shifted(flight.arrivalAt, 10)], ["WALKAROUND_START", shifted(flight.arrivalAt, 12)],
    ["WALKAROUND_END", shifted(flight.arrivalAt, 20)], ["PUSHBACK", pushback]] as const)
    await device.send(again, "PUT", `/ramp/operations/${operationId}/milestones/${code}`, { occurredAt: when });
  await device.send(409, "PUT", `/ramp/operations/${operationId}/milestones/BOARDING`, { occurredAt: at(90) });
  await device.send(200, "PUT", `/ramp/operations/${operationId}/flight-data`,
    { passengersIn: 140, passengersOut: 138, mtowKg: 73500, aircraftRegistration: "N123AA" });
  // An incident must not predate the server's start time and has no clock tolerance, unlike the
  // milestones above (hueco 3-L): it carries the current time.
  await device.send(200, "POST", `/ramp/operations/${operationId}/incidents`, { incidentType: "Deviation",
    severity: "Medium", description: "GPU no disponible al bloqueo", occurredAt: at(0), delayCode: "34" });
  const checklist = await device.get<{ checklist: { id: string; sections: Array<{ items: Array<{ id: string }> }> } }>(
    `/ramp/operations/${operationId}/checklist`);
  await device.send(200, "POST", `/ramp/operations/${operationId}/checklist/submit`, {
    checklistId: checklist.data.checklist.id,
    answers: checklist.data.checklist.sections.flatMap(section => section.items).map(item => ({ itemId: item.id, value: "Ok", note: null })),
  });
  const operations = await device.get<{ operations: Array<{ operation: { id: string }; services: Array<{ id: string; code: string }> }> }>(
    "/ramp/operations");
  const services = operations.data.operations.find(item => item.operation.id === operationId)!.services;
  expect(services.length, "the contracted services reach the tablet").toBeGreaterThan(0);
  for (const service of services) {
    await device.send(200, "POST", `/ramp/operations/${operationId}/services/${service.id}/transition`,
      { targetStatus: "InProgress", executedQuantity: null, note: null });
    await device.send(200, "POST", `/ramp/operations/${operationId}/services/${service.id}/transition`,
      { targetStatus: "Completed", executedQuantity: 1, note: "Servicio completado" });
  }
});

test("El representante y el agente firman la Orden de Servicio y los formularios AVIAM", async () => {
  const operationId = String(loadRun().operationId);
  const device = await tablet();
  const signers = [["ServiceOrder", "AirlineRepresentative", "Ana Pérez"], ["ServiceOrder", "AviamAgent", AGENT],
    ["FlightReport", "Coordinator", AGENT], ["BridgeChecklist", "BridgeOperator", AGENT]] as const;
  for (const [kind, role, name] of signers) {
    const documents = await device.get<{ documents: Array<{ kind: string; contentSha256: string }> }>(
      `/ramp/operations/${operationId}/documents`);
    const current = documents.data.documents.find(item => item.kind === kind);
    if (!current) continue; // e.g. no bridge in this operation
    await device.send(200, "PUT", `/ramp/operations/${operationId}/documents/${kind}/signatures/${role}`,
      { signerName: name, documentSha256: current.contentSha256, strokes });
  }
});

test("El agente entrega la operación a OCC", async () => {
  const operationId = String(loadRun().operationId);
  const device = await tablet();
  await device.send([200, 201], "POST", `/ramp/operations/${operationId}/submit`, { agentNote: "Operación cerrada en el ciclo E2E." });
  const charges = await device.get<{ services: Array<{ applied: Array<{ code: string; source: string }> }> }>(
    `/ramp/operations/${operationId}/charges`);
  saveRun({ automaticCharges: charges.data.services.flatMap(item => item.applied)
    .filter(mark => mark.source === "Automatic").map(mark => mark.code) });
});

test("OCC revisa el cierre y aprueba la operación", async ({ page }) => {
  const run = loadRun();
  const flight = run.flight as Flight;
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/review");
  const row = page.getByRole("row").filter({ hasText: flight.operationCode });
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  const detail = page.getByRole("region", { name: "Detalle de entrega" });
  await expect(detail.getByRole("region", { name: "Cierre de la operación" })).toBeVisible();
  await snap(page, "fase3-occ-revision");
  await detail.getByRole("button", { name: "Aprobar", exact: true }).click();
  await detail.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(page.getByText("Entrega aprobada y registrada.")).toBeVisible();
  await snap(page, "fase3-occ-aprobada");
  const token = await login("occ");
  const review = await expectCall<{ status?: string; close?: { canAdjustCharges: boolean } }>(200, token, "GET",
    `/occ/review/operations/${String(run.operationId)}`);
  expect(review.data.close?.canAdjustCharges, "approved charges are frozen").toBe(false);
});

test("La aerolínea ve la operación aprobada y su Orden de Servicio en el portal", async ({ page }) => {
  const run = loadRun();
  const flight = run.flight as Flight;
  await loginPortal(page, (run.representative as { email: string }).email);
  await page.getByRole("link", { name: "Vuelos", exact: true }).first().click();
  await page.getByRole("link", { name: `Ver ${flight.operationCode}` }).click();
  await expect(page.getByRole("heading", { name: "Ejecución aprobada" })).toBeVisible();
  await expect(page.getByText("Orden de Servicio").first()).toBeVisible();
  await snap(page, "fase3-portal-operacion");
});

test.fixme("hueco 3-A · OCC cancela o desvía un vuelo y corrige su horario; la posición se libera", async () => {});
test.fixme("hueco 3-B · el tipo de avión se captura y el recargo por tiempo extra se aplica solo", async () => {});
test.fixme("hueco 3-C · OCC asigna un agente después de registrar la llegada", async () => {});
test.fixme("hueco 3-D · aprobar libera al agente y la posición; un agente opera hasta 3 vuelos simultáneos", async () => {});
test.fixme("hueco 3-E · OCC ajusta el turno del día de un agente", async () => {});
test.fixme("hueco 3-F · OCC pasa una operación iniciada a otro agente (relevo)", async () => {});
test.fixme("hueco 3-G · OCC gestiona las incidencias de la operación", async () => {});
test.fixme("hueco 3-H · OCC reabre una operación aprobada que aún no se facturó", async () => {});
test.fixme("hueco 3-I · la tablet sin conexión encola inicio, servicios, cargos, checklist y chat con su hora", async () => {});
test.fixme("hueco 3-J · crear y liberar cobertura y liberar un agente son idempotentes", async () => {});
test.fixme("hueco 3-K · sin código muerto en la tablet ni en el cliente", async () => {});
