import { expect, type Page, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
import { goPrivate, loginPortal, loginPrivate, snap } from "./support/browser";
import { API, loadRun, saveRun } from "./support/env";

// Fase 3 · La operación: OCC registers the run's flight and assigns it to the ramp agent from the
// planning screen, the agent runs it on the tablet (through the API, as the APK does, with its
// installation id), OCC approves the close from the review screen, and the airline sees the
// operation and its Service Order in the portal. The gap steps (huecos 3-A, 3-B, 3-C) then reschedule,
// cancel and divert flights, read the aircraft type the tablet typed and assign an agent after the arrival.

type RunContract = { airline: string; approvedVersions: Array<{ stations: Array<{ id: string; code: string }> }> };
type Leg = { flightNumber: string; scheduledAt: string };
type Turnaround = { id: string; operationCode: string; status: string; arrival: Leg | null; departure: Leg | null;
  operation: { id: string; status: string } | null; agents: Array<{ displayName: string }>;
  stand?: { id: string; code: string } | null; aircraft?: { id: string; icaoCode: string } | null };
type Flight = { arrivalNumber: string; turnaroundId: string; operationCode: string; arrivalAt: string; departureAt: string };
type Shift = { workDate: string; startsAtLocal: string; endsAtLocal: string };
type Window = { arrivalAt: string; departureAt: string };
/** GET /occ/planning/turnarounds/{id} (hueco 3-A): the flight, its version (also the ETag) and the changes it allows. */
type Detail = { turnaround: Turnaround; version: string; allowedActions: string[] };
type Problem = { code?: string; reasons?: string[] };
type ManualOptions = { airlines: Array<{ id: string; iataCode: string }>;
  stands: Array<{ id: string; code: string; terminal: { code: string } | null }>;
  aircraftTypes?: Array<{ id: string; icaoCode: string }> };

const AGENT = "Riley Ramp";
const MINUTE = 60_000;
const localDay = () => new Date().toLocaleDateString("en-CA");
const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * MINUTE).toISOString();
const shifted = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * MINUTE).toISOString();
/** A whole minute from now, as the datetime-local inputs take it. */
const minuteAt = (minutesFromNow: number) =>
  new Date((Math.floor(Date.now() / MINUTE) + minutesFromNow) * MINUTE).toISOString();
/** The flight dialogs take the station's local time (hueco 3-N19): Santo Domingo is UTC−4 all year, without DST. */
const stationInput = (iso: string) => new Date(Date.parse(iso) - 4 * 60 * MINUTE).toISOString().slice(0, 16);
const stationDay = (iso: string) => stationInput(iso).slice(0, 10);
/** Hueco 3-N27: the operation code is the station, its local day and a number of that day. */
const READABLE_CODE = /^PUJ-\d{8}-\d{3,}$/;
const isOpen = (status: string) => !["Cancelled", "Diverted", "Completed"].includes(status);
/** The run's flight numbers: the run's own flight takes these digits (and the next), each gap flight an offset. */
const runDigits = (runId: string) => parseInt(runId.slice(-5), 36) % 9000 + 1000;
const strokes = [[0.05, 0.6, 0.2, 0.2, 0.35, 0.75, 0.5, 0.3]];

/**
 * A 90-minute turnaround inside the agent's shift that ends as close to now as possible (the tablet
 * records past milestones, never future ones) and does not overlap the agent's other flights of the
 * day: an approved operation still holds its agent (hueco 3-D).
 */
function freeWindow(shift: Shift, busy: Array<[number, number]>) {
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

/**
 * A short window for a gap flight the agent works (hueco 3-C): inside the shift and clear of the agent's other flights
 * of the day, ahead of now when it fits, otherwise earlier in the shift. Null when the shift has no room left.
 */
function agentWindow(shift: Shift, busy: Array<[number, number]>, minutes: number): Window | null {
  const start = Date.parse(`${shift.workDate}T${shift.startsAtLocal}-04:00`); // America/Santo_Domingo, no DST
  let end = Date.parse(`${shift.workDate}T${shift.endsAtLocal}-04:00`);
  if (end <= start) end += 24 * 60 * MINUTE;
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;
  const length = minutes * MINUTE;
  const candidates: number[] = [];
  for (let from = now + 10 * MINUTE; from + length <= end; from += 5 * MINUTE) candidates.push(from);
  for (let from = now - length - 5 * MINUTE; from >= start; from -= 5 * MINUTE) candidates.push(from);
  const free = candidates.find(from => from >= start && from + length <= end &&
    !busy.some(([taken, until]) => from < until && from + length > taken));
  return free === undefined ? null
    : { arrivalAt: new Date(free).toISOString(), departureAt: new Date(free + length).toISOString() };
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

/**
 * OCC enters a flight of the run's airline at PUJ through the API, without agent, on the first stand (of the given
 * terminals, or the given one) free in its window: a stand taken in that window answers 409 and the next is tried.
 */
async function planFlight(occ: string, station: string, offset: number, window: Window,
  place: { terminals?: string[]; standCode?: string } = {}) {
  const { run, airline } = runState();
  const number = `${airline.iata}${runDigits(run.runId) + offset}`;
  const day = stationDay(window.arrivalAt);
  const options = (await expectCall<ManualOptions>(200, occ, "GET",
    `/occ/planning/manual-options?stationId=${station}&date=${day}`)).data;
  const airlineId = options.airlines.find(item => item.iataCode === airline.iata)?.id;
  expect(airlineId, "the run's airline is contracted at PUJ that day").toBeTruthy();
  const stands = options.stands.filter(item => (place.standCode ? item.code === place.standCode
    : (place.terminals ?? ["A", "B"]).includes(item.terminal?.code ?? "")));
  for (const stand of stands) {
    const body = { turnaroundId: crypto.randomUUID(), stationId: station, airlineId, standId: stand.id, operationDate: day,
      arrivalFlightNumber: number, arrivalOriginIata: "MIA", arrivalScheduledAt: window.arrivalAt,
      departureFlightNumber: `${number}D`, departureDestinationIata: "MIA", departureScheduledAt: window.departureAt };
    const created = await call<{ turnaroundId: string; operationCode: string } & Problem>(occ, "POST",
      "/occ/planning/turnarounds", body);
    if (created.status === 201) return { ...created.data, body, standCode: stand.code };
    if (created.status !== 409 || created.data.code === "flight_already_planned")
      throw new Error(`POST /occ/planning/turnarounds → HTTP ${created.status} ${created.data.code ?? ""}`);
  }
  throw new Error(`No stand is free for ${number} between ${window.arrivalAt} and ${window.departureAt}.`);
}

/** «Cancelar vuelo» or «Marcar desviado» through the API, with the intent's key and the ETag OCC just read. */
async function changeStatus(occ: string, turnaroundId: string, outcome: "Cancelled" | "Diverted", reason: string) {
  const read = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${turnaroundId}`);
  return expectCall<Detail>(200, occ, "POST", `/occ/planning/turnarounds/${turnaroundId}/status-changes`,
    { outcome, reason }, { "idempotency-key": crypto.randomUUID(), "if-match": read.etag ?? "" });
}

/** Gap flights an earlier attempt of this run left open are cancelled first, so a retried step starts clean. */
async function cancelLeftovers(occ: string, station: string, offsets: number[]) {
  const { run, airline } = runState();
  const numbers = offsets.map(offset => `${airline.iata}${runDigits(run.runId) + offset}`);
  for (const item of await todaysTurnarounds(station)) {
    if (!item.arrival || !numbers.includes(item.arrival.flightNumber) || !isOpen(item.status)) continue;
    const detail = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${item.id}`);
    if (detail.data.allowedActions.includes("cancel"))
      await changeStatus(occ, item.id, "Cancelled", "Limpieza de un intento anterior del ciclo E2E.");
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  test.skip(!health?.ok, "The local stack is not running.");
});

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

test("OCC registra el vuelo de la aerolínea desde Planificación", async ({ page }) => {
  const { run, station, airline } = runState();
  const digits = String(runDigits(run.runId));
  const arrivalNumber = `${airline.iata}${digits}`;
  const today = await todaysTurnarounds(station);
  if (today.some(item => item.arrival?.flightNumber === arrivalNumber)) return; // resumed run: already registered
  const busy = today.filter(item => item.agents.some(agent => agent.displayName === AGENT) && item.arrival && item.departure)
    .map(item => [Date.parse(item.arrival!.scheduledAt), Date.parse(item.departure!.scheduledAt)] as [number, number]);
  const window = freeWindow(run.shift as Shift, busy);
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
  // The station's local time, never UTC (hueco 3-N19): the dialog sends the instant in UTC.
  await dialog.getByLabel(/^Llegada programada \(hora local/).fill(stationInput(window.arrivalAt));
  await dialog.getByLabel(/^Salida programada \(hora local/).fill(stationInput(window.departureAt));
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
  // Hueco 3-B: the agent types the aircraft type once, from ELEVANT's catalog; the close prices its ground time.
  const types = await device.get<{ aircraftTypes: Array<{ id: string; icaoCode: string }> }>("/ramp/aircraft-types");
  const aircraftType = types.data.aircraftTypes.find(item => item.icaoCode === "A320");
  expect(aircraftType, "the tablet's catalog lists the seeded A320").toBeTruthy();
  await device.send(200, "PUT", `/ramp/operations/${operationId}/flight-data`,
    { passengersIn: 140, passengersOut: 138, mtowKg: 73500, aircraftRegistration: "N123AA", aircraftTypeId: aircraftType!.id });
  saveRun({ aircraftType });
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

test("hueco 3-A · OCC cancela o desvía un vuelo y corrige su horario; la posición se libera", async ({ page }) => {
  const { run, station } = runState();
  const occ = await login("occ");
  await cancelLeftovers(occ, station, [2, 3]);
  const window = { arrivalAt: minuteAt(30), departureAt: minuteAt(75) };
  const flight = await planFlight(occ, station, 2, window);
  // Hueco 3-N27: a readable code on the invoice, the portal and the tablet. Hueco 3-N07: the same flight of the day is
  // planned once, typed or imported.
  expect(flight.operationCode).toMatch(READABLE_CODE);
  const twice = await call<Problem>(occ, "POST", "/occ/planning/turnarounds", { ...flight.body, turnaroundId: crypto.randomUUID() });
  expect([twice.status, twice.data.code]).toEqual([409, "flight_already_planned"]);

  // «Editar vuelo» from the flight's detail, in the station's local time (hueco 3-N19); no action that does nothing is
  // offered (hueco 3-N28).
  await loginPrivate(page, "occ");
  await openFlight(page, flight.operationCode);
  await expect(page.getByRole("button", { name: "Exportar" })).toHaveCount(0);
  const drawer = page.getByTestId("planning-drawer");
  await expect(drawer.getByRole("button", { name: "Crear Work Order" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Editar vuelo" }).click();
  const edit = page.getByRole("dialog", { name: "Editar vuelo" });
  const moved = { arrivalAt: shifted(window.arrivalAt, 10), departureAt: shifted(window.departureAt, 10) };
  await edit.getByLabel(/^Llegada programada \(hora local/).fill(stationInput(moved.arrivalAt));
  await edit.getByLabel(/^Salida programada \(hora local/).fill(stationInput(moved.departureAt));
  await edit.getByLabel("Motivo").fill("El aeropuerto movió la llegada diez minutos (ciclo E2E).");
  await snap(page, "fase3-hueco-3a-editar-vuelo");
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(`Vuelo ${flight.operationCode} actualizado.`)).toBeVisible();
  const edited = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect(Date.parse(edited.data.turnaround.arrival!.scheduledAt)).toBe(Date.parse(moved.arrivalAt));
  expect(edited.etag).toBe(`"${edited.data.version}"`);

  // «Cancelar vuelo» before the operation starts: the flight keeps its history and its stand is free again.
  await openFlight(page, flight.operationCode);
  await drawer.getByRole("button", { name: "Cancelar vuelo" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancelar vuelo" });
  await cancel.getByLabel("Motivo").fill("La aerolínea canceló el vuelo (ciclo E2E).");
  await cancel.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(page.getByText(`Vuelo ${flight.operationCode} cancelado.`)).toBeVisible();
  await snap(page, "fase3-hueco-3a-cancelado");
  const cancelled = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect([cancelled.data.turnaround.status, cancelled.data.turnaround.operation?.status, cancelled.data.allowedActions])
    .toEqual(["Cancelled", "Cancelled", []]);
  const board = await expectCall<{ positions: Array<{ turnarounds: Array<{ turnaroundId: string }> }> }>(200, occ, "GET",
    `/occ/positions?stationId=${station}&date=${stationDay(window.arrivalAt)}`);
  expect(board.data.positions.some(item => item.turnarounds.some(parked => parked.turnaroundId === flight.turnaroundId)))
    .toBe(false);

  // Another flight takes that stand in the same window, and is diverted through the API with its key and version.
  const other = await planFlight(occ, station, 3, moved, { standCode: flight.standCode });
  const read = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${other.turnaroundId}`);
  const route = `/occ/planning/turnarounds/${other.turnaroundId}/status-changes`;
  const divert = { outcome: "Diverted", reason: "El vuelo se desvió a SDQ por meteorología (ciclo E2E)." };
  const headers = { "idempotency-key": crypto.randomUUID(), "if-match": read.etag ?? "" };
  const diverted = await expectCall<Detail>(200, occ, "POST", route, divert, headers);
  expect(diverted.data.turnaround.status).toBe("Diverted");
  // The same key and body replay the answer; that key with another body, the version read before, or none, are refused.
  expect((await expectCall<Detail>(200, occ, "POST", route, divert, headers)).data.version).toBe(diverted.data.version);
  const reused = await call<Problem>(occ, "POST", route, { ...divert, reason: "Otro motivo con la misma clave." }, headers);
  expect([reused.status, reused.data.code]).toEqual([409, "idempotency_conflict"]);
  const stale = await call<Problem>(occ, "POST", route, divert, { ...headers, "idempotency-key": crypto.randomUUID() });
  expect([stale.status, stale.data.code]).toEqual([412, "version_conflict"]);
  const unversioned = await call<Problem>(occ, "POST", route, divert);
  expect([unversioned.status, unversioned.data.code]).toEqual([428, "expected_version_required"]);

  // What was operated is closed through the review, never cancelled.
  const operated = (run.flight as Flight).turnaroundId;
  const executed = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${operated}`);
  expect(executed.data.allowedActions).toEqual([]);
  const refused = await call<Problem>(occ, "POST", `/occ/planning/turnarounds/${operated}/status-changes`,
    { outcome: "Cancelled", reason: "Lo ya ejecutado no se cancela." },
    { "idempotency-key": crypto.randomUUID(), "if-match": executed.etag ?? "" });
  expect(refused.status).toBe(409);
  expect(["operation_started", "turnaround_closed"]).toContain(refused.data.code);
});

test("hueco 3-B · el tipo de avión se captura y el recargo por tiempo extra se aplica solo", async () => {
  const run = loadRun();
  const operationId = String(run.operationId);
  const flight = run.flight as Flight;
  const typed = run.aircraftType as { id: string; icaoCode: string } | undefined;
  expect(typed, "the tablet step typed the aircraft type").toBeTruthy();
  // The tablet offers the active types of ELEVANT's catalog; it keeps them only as a cache.
  const device = await tablet();
  const catalog = await device.get<{ aircraftTypes: Array<{ id: string; icaoCode: string }> }>("/ramp/aircraft-types");
  expect(catalog.data.aircraftTypes.some(item => item.id === typed!.id)).toBe(true);
  // Typed once on the ramp, the type reaches the flight OCC planned.
  const occ = await login("occ");
  const detail = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect(detail.data.turnaround.aircraft?.icaoCode).toBe(typed!.icaoCode);
  // The hand-off froze its category and Finance's allowance; the package-exceeded surcharge followed them by itself.
  type Close = { timing: { groundMinutes: number | null; allowedGroundMinutes: number | null; aircraftCategory: string | null };
    charges: Array<{ code: string; source: string }> };
  const review = await expectCall<{ close?: Close }>(200, occ, "GET", `/occ/review/operations/${operationId}`);
  const close = review.data.close!;
  expect(close.timing.aircraftCategory, "the aircraft type gives the category").toBe("Narrowbody");
  expect(close.timing.allowedGroundMinutes, "Finance's allowance for the category").not.toBeNull();
  const overtime = close.charges.some(charge => charge.code === "OVERTIME" && charge.source === "Automatic");
  expect(overtime, "OVERTIME is automatic exactly when the ground time exceeds the allowance")
    .toBe((close.timing.groundMinutes ?? 0) > (close.timing.allowedGroundMinutes ?? Number.POSITIVE_INFINITY));
  // From the first submission the type is evidence: the tablet no longer changes it.
  const other = catalog.data.aircraftTypes.find(item => item.id !== typed!.id);
  if (other) {
    const refused = await call<Problem>(device.token, "PUT", `/ramp/operations/${operationId}/flight-data`,
      { passengersIn: 140, passengersOut: 138, mtowKg: 73500, aircraftRegistration: "N123AA", aircraftTypeId: other.id },
      { ...device.device, "idempotency-key": crypto.randomUUID() });
    expect(refused.status).toBe(409);
  }
});

test("hueco 3-C · OCC asigna un agente después de registrar la llegada", async ({ page }) => {
  const { run, station } = runState();
  const occ = await login("occ");
  await cancelLeftovers(occ, station, [5]);
  const busy = (await todaysTurnarounds(station))
    .filter(item => item.status !== "Cancelled" && item.agents.some(agent => agent.displayName === AGENT) &&
      item.arrival && item.departure)
    .map(item => [Date.parse(item.arrival!.scheduledAt), Date.parse(item.departure!.scheduledAt)] as [number, number]);
  const window = agentWindow(run.shift as Shift, busy, 45);
  if (!window) {
    test.skip(true, "El turno del agente ya no tiene una ventana libre de 45 minutos hoy.");
    return;
  }
  const flight = await planFlight(occ, station, 5, window, { terminals: ["A"] });

  // The arrival through the positions map's API (hueco 3-N10): the intent's key and the version OCC read, with the
  // aircraft type seen on the stand (hueco 3-B). The flight is on blocks (InProgress) and its operation still Planned.
  const options = (await expectCall<ManualOptions>(200, occ, "GET",
    `/occ/planning/manual-options?stationId=${station}&date=${stationDay(window.arrivalAt)}`)).data;
  const narrow = options.aircraftTypes?.find(item => item.icaoCode === "A320");
  const read = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  const route = `/occ/turnarounds/${flight.turnaroundId}/arrival`;
  const arrival = { aircraftRegistration: "N456AA", arrivedAt: minuteAt(-1), ...(narrow && { aircraftTypeId: narrow.id }) };
  const headers = { "idempotency-key": crypto.randomUUID(), "if-match": read.etag ?? "" };
  const recorded = await expectCall(200, occ, "POST", route, arrival, headers);
  expect(recorded.etag, "the arrival answers the flight's new version").not.toBe(read.etag);
  await expectCall(200, occ, "POST", route, arrival, headers);
  const stale = await call<Problem>(occ, "POST", route, { ...arrival, reason: "Hora corregida con la versión vieja." },
    { ...headers, "idempotency-key": crypto.randomUUID() });
  expect([stale.status, stale.data.code]).toEqual([412, "version_conflict"]);
  const arrived = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect([arrived.data.turnaround.status, arrived.data.turnaround.operation?.status]).toEqual(["InProgress", "Planned"]);
  if (narrow) expect(arrived.data.turnaround.aircraft?.icaoCode).toBe("A320");
  // Hueco 3-N08: a recorded arrival is corrected only with its reason, before the first submission.
  expect(arrived.data.allowedActions).toContain("correctArrival");
  const correction = { aircraftRegistration: "N456AA", arrivedAt: minuteAt(-3) };
  const unexplained = await call<Problem>(occ, "POST", route, correction,
    { "idempotency-key": crypto.randomUUID(), "if-match": arrived.etag ?? "" });
  expect([unexplained.status, unexplained.data.code]).toEqual([400, "reason_required"]);
  await expectCall(200, occ, "POST", route, { ...correction, reason: "El avión bloqueó dos minutos antes (ciclo E2E)." },
    { "idempotency-key": crypto.randomUUID(), "if-match": arrived.etag ?? "" });

  // Hueco 3-C: with the arrival recorded, OCC assigns the agent; released, the operation takes an agent again.
  const assign = async () => {
    await openFlight(page, flight.operationCode);
    const form = page.getByRole("form", { name: "Asignación de operación" });
    await expect(form).toBeVisible();
    const choice = form.locator("label").filter({ hasText: AGENT });
    await expect(choice, "the agent with today's shift is eligible").toContainText("Elegible");
    await choice.getByRole("radio").check();
    await form.getByRole("button", { name: "Asignar operación" }).click();
    await expect(page.getByText(`Operación asignada a ${AGENT}.`)).toBeVisible();
  };
  await loginPrivate(page, "occ");
  await assign();
  await snap(page, "fase3-hueco-3c-asignada-tras-llegada");
  await openFlight(page, flight.operationCode);
  page.once("dialog", dialog => void dialog.accept());
  await page.getByTestId("planning-drawer").getByRole("button", { name: "Liberar agente" }).click();
  await expect(page.getByText("Agente liberado. Ya puedes asignar a otro.")).toBeVisible();
  await assign();
  const assigned = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect(assigned.data.turnaround.operation?.status).toBe("Assigned");
  expect(assigned.data.turnaround.agents.map(agent => agent.displayName)).toContain(AGENT);

  // Cancelled before it starts (hueco 3-A), the flight frees the agent, whose tablet hears «assignment_released».
  await changeStatus(occ, flight.turnaroundId, "Cancelled", "Vuelo de prueba del ciclo E2E: se cancela al terminar.");
  const device = await tablet();
  const mine = await device.get<{ operations: Array<{ turnaround: { id: string } }> }>("/ramp/operations");
  expect(mine.data.operations.some(item => item.turnaround.id === flight.turnaroundId)).toBe(false);
  const notices = await device.get<{ notifications: Array<{ kind: string }> }>("/notifications");
  expect(notices.data.notifications.some(item => item.kind === "assignment_released")).toBe(true);
});
test.fixme("hueco 3-D · aprobar libera al agente y la posición; un agente opera hasta 3 vuelos simultáneos", async () => {});
test.fixme("hueco 3-E · OCC ajusta el turno del día de un agente", async () => {});
test.fixme("hueco 3-F · OCC pasa una operación iniciada a otro agente (relevo)", async () => {});
test.fixme("hueco 3-G · OCC gestiona las incidencias de la operación", async () => {});
test.fixme("hueco 3-H · OCC reabre una operación aprobada que aún no se facturó", async () => {});
test.fixme("hueco 3-I · la tablet sin conexión encola inicio, servicios, cargos, checklist y chat con su hora", async () => {});
test.fixme("hueco 3-J · crear y liberar cobertura y liberar un agente son idempotentes", async () => {});
test.fixme("hueco 3-K · sin código muerto en la tablet ni en el cliente", async () => {});
