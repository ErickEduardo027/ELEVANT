import { expect, type Page, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
import { goPrivate, loginPortal, loginPrivate, snap } from "./support/browser";
import { API, loadRun, saveRun } from "./support/env";
import { pdfText } from "./support/pdf";

// Fase 3 · La operación: OCC registers the run's flight and assigns it to the ramp agent from the
// planning screen, the agent runs it on the tablet (through the API, as the APK does, with its
// installation id), OCC approves the close from the review screen, and the airline sees the
// operation and its Service Order in the portal. The gap steps (huecos 3-A, 3-B, 3-C) then reschedule,
// cancel and divert flights, read the aircraft type the tablet typed and assign an agent after the arrival; then
// (huecos 3-D, 3-E, 3-F, 3-J) the approval frees the agent and the stand, the agent carries up to three flights at once,
// OCC adjusts the agent's shift of the day, hands a started operation over and repeats its coverage commands safely;
// (huecos 3-G, 3-H) OCC manages the incidents of a flight still on the ramp and reopens the run's approval nothing was
// invoiced from, then approves it again; (huecos 3-I, 3-K) the tablet's queue sends the start and the services with the
// time they were tapped, and OCC opens the photo of a walk-around damage in the review. Last (huecos 3-N13 to 3-N26),
// the OCC and Gestión Humana reports count what each agent worked and what Finance bills, in Spanish and in the
// station's local time, as the airline's portal shows its times.

type RunContract = { airline: string; approvedVersions: Array<{ stations: Array<{ id: string; code: string }> }> };
type Leg = { flightNumber: string; scheduledAt: string };
type Turnaround = { id: string; operationCode: string; status: string; arrival: Leg | null; departure: Leg | null;
  operation: { id: string; status: string } | null;
  agents: Array<{ displayName: string; assignmentId?: string; agentId?: string }>;
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
type AgentOption = { id: string; displayName: string; eligible: boolean; eligibilityReasons: string[] };
/** A shift as Gestión Humana lists it: its version is the expected version of «Ajustar horario» (hueco 3-E). */
type HumanResourcesShift = { id: string; agentName: string; workDate: string; startsAtLocal: string; endsAtLocal: string;
  terminalCode: string; version: string };
/** «Relevar agente» (hueco 3-F): who works the started operation now and who may take what is left of it. */
type HandoverOptions = { operationStatus: string; currentAssignmentId: string; currentAgentId: string;
  currentAgentName: string; agents: AgentOption[] };
type CoverageBoard = { terminals: Array<{ terminalId: string; code: string }>;
  stands: Array<{ standId: string; code: string; terminalId: string | null; isActive: boolean; hasBoardingBridge: boolean }>;
  agents: Array<{ agentId: string; name: string; terminalId: string }>;
  coverages: Array<{ id: string; agentId: string }> };
type Device = Awaited<ReturnType<typeof tablet>>;

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
/** A 1×1 PNG: the walk-around photo the tablet uploads in the gap steps (hueco 3-K). */
const PNG_PIXEL = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

/**
 * A 90-minute turnaround inside the agent's shift that ends as close to now as possible (the tablet
 * records past milestones, never future ones) and does not overlap the agent's other flights of the
 * day, so the run's flight, its review and its documents stay on their own.
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
  throw new Error("The agent's shift has no free 90-minute window left today.");
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
  const refusals: string[] = [];
  for (const stand of stands) {
    const body = { turnaroundId: crypto.randomUUID(), stationId: station, airlineId, standId: stand.id, operationDate: day,
      arrivalFlightNumber: number, arrivalOriginIata: "MIA", arrivalScheduledAt: window.arrivalAt,
      departureFlightNumber: `${number}D`, departureDestinationIata: "MIA", departureScheduledAt: window.departureAt };
    const created = await call<{ turnaroundId: string; operationCode: string } & Problem>(occ, "POST",
      "/occ/planning/turnarounds", body);
    if (created.status === 201) return { ...created.data, body, standCode: stand.code };
    if (created.status !== 409 || created.data.code === "flight_already_planned")
      throw new Error(`POST /occ/planning/turnarounds → HTTP ${created.status} ${created.data.code ?? ""}`);
    refusals.push(`${stand.code} ${created.data.code ?? "409"}${created.data.reasons?.length ? ` (${created.data.reasons.join(", ")})` : ""}`);
  }
  throw new Error(`No stand is free for ${number} between ${window.arrivalAt} and ${window.departureAt}: ${refusals.join("; ") || "no stand"}.`);
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

/**
 * The first of the offsets whose flight number has no open flight today: a started gap flight of an earlier attempt
 * cannot be cancelled, and the same flight is planned once a day (hueco 3-N07).
 */
async function freeOffset(station: string, offsets: number[]) {
  const { run, airline } = runState();
  const open = new Set((await todaysTurnarounds(station)).filter(item => isOpen(item.status))
    .map(item => item.arrival?.flightNumber));
  return offsets.find(offset => !open.has(`${airline.iata}${runDigits(run.runId) + offset}`)) ?? null;
}

/** The statuses whose operation holds its agent (hueco 3-D): approved, handed-over or cancelled ones do not. */
const HOLDS_AGENT = ["Assigned", "InProgress", "Returned"];

/** The windows of today's flights whose operation holds the run's agent. */
async function holdingWindows(station: string) {
  return (await todaysTurnarounds(station))
    .filter(item => item.operation && HOLDS_AGENT.includes(item.operation.status) &&
      item.agents.some(agent => agent.displayName === AGENT) && item.arrival && item.departure)
    .map(item => [Date.parse(item.arrival!.scheduledAt), Date.parse(item.departure!.scheduledAt)] as [number, number]);
}

/** Handed over and not yet approved: the operation no longer holds its agent but still holds its stand (hueco 3-D). */
const HOLDS_STAND = ["PendingReview", "InReview"];

/**
 * The windows a new flight of the run's agent must avoid: those of its flights that hold it and of those that, handed
 * over, still hold their stand. Terminal A has three stands, so the steps that hand a flight over would otherwise all
 * take the same window until no stand is left there.
 */
async function busyWindows(station: string) {
  return (await todaysTurnarounds(station))
    .filter(item => item.operation && [...HOLDS_AGENT, ...HOLDS_STAND].includes(item.operation.status) &&
      item.agents.some(agent => agent.displayName === AGENT) && item.arrival && item.departure)
    .map(item => [Date.parse(item.arrival!.scheduledAt), Date.parse(item.departure!.scheduledAt)] as [number, number]);
}

/**
 * OCC assigns the run's agent through the API with the version of the options it read, under the same rules as the
 * planning screen; the agent's option tells why it is refused.
 */
async function assignAgent(occ: string, turnaroundId: string) {
  const options = await expectCall<{ agents: AgentOption[] }>(200, occ, "GET", `/occ/planning/options?turnaroundId=${turnaroundId}`);
  const agent = options.data.agents.find(item => item.displayName === AGENT);
  expect(agent, "the agent is a candidate of the flight").toBeTruthy();
  const result = await call<Problem>(occ, "POST", `/occ/planning/turnarounds/${turnaroundId}/assignment`,
    { agentId: agent!.id }, { "if-match": options.etag ?? "" });
  return { agent: agent!, status: result.status };
}

/** Today's shift of the run's agent as Gestión Humana lists it, with its version. */
async function todaysShift(hr: string) {
  const day = localDay();
  const shifts = await expectCall<{ shifts: HumanResourcesShift[] }>(200, hr, "GET",
    `/human-resources/shifts?from=${day}&to=${day}&page=1&limit=100`);
  const shift = shifts.data.shifts.find(item => item.agentName === AGENT);
  expect(shift, "the agent has today's shift").toBeTruthy();
  return shift!;
}

/** A local clock (HH:mm or HH:mm:ss) moved by whole minutes within the day, as HH:mm:00. */
function clockPlus(clock: string, minutes: number) {
  const value = ((Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5)) + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}:00`;
}

/** The operation of a flight on the agent's tablet. */
async function tabletOperation(device: Device, turnaroundId: string) {
  const mine = await device.get<{ operations: Array<{ operation: { id: string }; turnaround: { id: string };
    services: Array<{ id: string }> }> }>("/ramp/operations");
  const found = mine.data.operations.find(item => item.turnaround.id === turnaroundId);
  expect(found, "the flight reaches the agent's tablet").toBeTruthy();
  return found!;
}

/**
 * The agent closes a started gap flight from the tablet so it no longer holds the agent: every service not
 * performed, the checklist and the hand-off to OCC (the operation waits in the review, unbilled).
 */
async function handOffUnperformed(device: Device, turnaroundId: string) {
  const { operation, services } = await tabletOperation(device, turnaroundId);
  for (const service of services)
    await device.send(200, "POST", `/ramp/operations/${operation.id}/services/${service.id}/transition`,
      { targetStatus: "NotPerformed", executedQuantity: 0, note: "No se prestó: vuelo de prueba del ciclo E2E." });
  const checklist = await device.get<{ checklist: { id: string; sections: Array<{ items: Array<{ id: string }> }> } }>(
    `/ramp/operations/${operation.id}/checklist`);
  await device.send(200, "POST", `/ramp/operations/${operation.id}/checklist/submit`, {
    checklistId: checklist.data.checklist.id,
    answers: checklist.data.checklist.sections.flatMap(section => section.items)
      .map(item => ({ itemId: item.id, value: "Ok", note: null })),
  });
  await device.send([200, 201], "POST", `/ramp/operations/${operation.id}/submit`,
    { agentNote: "Vuelo de prueba del ciclo E2E: no se prestaron servicios." });
}

/**
 * A stand of the agent's terminal created once per stack (never removed): the seeded terminal has two, and three
 * flights of the agent at the same time need three stands (hueco 3-D).
 */
async function ensureStand(occ: string, station: string, terminalCode: string, code: string) {
  type Master = { terminals: Array<{ id: string; code: string; isActive: boolean }>; stands: Array<{ code: string }> };
  const data = (await expectCall<Master>(200, occ, "GET", `/occ/master-data?stationId=${station}`)).data;
  if (data.stands.some(item => item.code === code)) return;
  const terminal = data.terminals.find(item => item.code === terminalCode && item.isActive);
  expect(terminal, `terminal ${terminalCode} is active at PUJ`).toBeTruthy();
  await expectCall(201, occ, "POST", "/occ/stands", { stationId: station, terminalId: terminal!.id, code,
    hasBoardingBridge: false, isRemote: false, maxAircraftSize: null });
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
    // The arrival as the positions map sends it (hueco 3-N10): the intent's key with the flight's version.
    const occ = await login("occ");
    const read = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
    await expectCall(200, occ, "POST", `/occ/turnarounds/${flight.turnaroundId}/arrival`,
      { aircraftRegistration: "N123AA", arrivedAt: shifted(flight.arrivalAt, 8) },
      { "idempotency-key": crypto.randomUUID(), "if-match": read.etag ?? "" });
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

  // Hueco 3-N08: from the first submission the arrival is evidence; OCC neither records nor corrects it any more.
  const flight = loadRun().flight as Flight;
  const occ = await login("occ");
  const read = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect(read.data.allowedActions).not.toContain("correctArrival");
  const locked = await call<Problem>(occ, "POST", `/occ/turnarounds/${flight.turnaroundId}/arrival`,
    { aircraftRegistration: "N123AA", arrivedAt: shifted(flight.arrivalAt, 6), reason: "Corrección tras la entrega (ciclo E2E)." },
    { "idempotency-key": crypto.randomUUID(), "if-match": read.etag ?? "" });
  // A resumed run may find the flight already approved and closed.
  expect([locked.status, locked.data.code])
    .toEqual([409, read.data.turnaround.status === "Completed" ? "turnaround_closed" : "arrival_locked"]);
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
  // Hueco 3-N20: the approval, the actual times and the signatures at PUJ's local time, as the signed PDF prints them.
  await expect(page.getByText(/\(hora local PUJ\)/).first()).toBeVisible();
  await expect(page.getByText(/\bUTC\b/)).toHaveCount(0);
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
  // OVERTIME is automatic exactly when the ground time exceeds the allowance by more than the grace Finance gave the
  // charge: 15 minutes in the Development tariff (ADR-0034). The ground time depends on the run, so it can land in the grace.
  const overtimeGraceMinutes = 15;
  const overtime = close.charges.some(charge => charge.code === "OVERTIME" && charge.source === "Automatic");
  expect(overtime, "OVERTIME is automatic exactly when the ground time exceeds the allowance and its grace")
    .toBe((close.timing.groundMinutes ?? 0) >
      (close.timing.allowedGroundMinutes ?? Number.POSITIVE_INFINITY) + overtimeGraceMinutes);
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
test("hueco 3-D · aprobar libera al agente y la posición; un agente opera hasta 3 vuelos simultáneos", async ({ page }) => {
  const { run, station } = runState();
  const occ = await login("occ");
  await cancelLeftovers(occ, station, [6, 7, 8, 9]);
  const approved = run.flight as Flight;
  const record = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${approved.turnaroundId}`);
  expect(record.data.turnaround.operation?.status, "OCC approved the run's flight").toBe("Approved");
  const standCode = record.data.turnaround.stand?.code;
  expect(standCode, "the approved flight keeps its stand of record").toBeTruthy();
  // The approved flight's window: it no longer holds its agent nor its stand there.
  const window = { arrivalAt: approved.arrivalAt, departureAt: approved.departureAt };
  const [from, until] = [Date.parse(window.arrivalAt), Date.parse(window.departureAt)];
  const holding = (await holdingWindows(station)).filter(([start, end]) => start < until && end > from).length;
  if (holding >= 3) {
    test.skip(true, "El agente ya lleva tres operaciones en esa ventana.");
    return;
  }
  await ensureStand(occ, station, "A", "A-E2E");

  // Another flight takes the approved flight's stand in that window, and the agent takes it and the next ones.
  const flights = [await planFlight(occ, station, 6, window, { standCode: standCode! })];
  for (let index = 1; index < 3 - holding; index += 1)
    flights.push(await planFlight(occ, station, 6 + index, window, { terminals: ["A"] }));
  for (const flight of flights)
    expect((await assignAgent(occ, flight.turnaroundId)).status, `${flight.operationCode} is assigned`).toBe(200);
  // A fourth flight at the same time is one too many: the API refuses it and the screen says why.
  const fourth = await planFlight(occ, station, 9, window);
  const refused = await assignAgent(occ, fourth.turnaroundId);
  expect(refused.agent.eligibilityReasons).toContain("assignment_conflict");
  expect(refused.status).toBe(409);
  await loginPrivate(page, "occ");
  await openFlight(page, fourth.operationCode);
  const form = page.getByRole("form", { name: "Asignación de operación" });
  await expect(form.locator("label").filter({ hasText: AGENT })).toContainText("Ya tiene 3 operaciones simultáneas");
  await snap(page, "fase3-hueco-3d-tope-de-tres");

  // The tablet lists the active operations first and keeps the recently approved one after them (hueco 3-N01).
  const device = await tablet();
  const queue = (await device.get<{ operations: Array<{ turnaround: { id: string } }> }>("/ramp/operations"))
    .data.operations.map(item => item.turnaround.id);
  const positions = flights.map(flight => queue.indexOf(flight.turnaroundId));
  expect(positions.every(position => position >= 0), "the assigned flights reach the tablet").toBe(true);
  expect(queue.indexOf(approved.turnaroundId)).toBeGreaterThan(Math.max(...positions));

  // Hueco 3-N07: «Editar vuelo» never gives a flight the number of another open flight of the airline that day.
  const before = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${fourth.turnaroundId}`);
  const renumbered = await call<Problem>(occ, "PUT", `/occ/planning/turnarounds/${fourth.turnaroundId}/schedule`, {
    arrivalFlightNumber: flights[0].body.arrivalFlightNumber, arrivalOriginIata: "MIA",
    arrivalScheduledAt: fourth.body.arrivalScheduledAt, departureFlightNumber: fourth.body.departureFlightNumber,
    departureDestinationIata: "MIA", departureScheduledAt: fourth.body.departureScheduledAt,
    reason: "Número de otro vuelo abierto del día (ciclo E2E).",
  }, { "idempotency-key": crypto.randomUUID(), "if-match": before.etag ?? "" });
  expect([renumbered.status, renumbered.data.code]).toEqual([409, "flight_already_planned"]);

  for (const flight of [...flights, fourth])
    await changeStatus(occ, flight.turnaroundId, "Cancelled", "Vuelo de prueba del ciclo E2E (hueco 3-D): se cancela al terminar.");
});
test("hueco 3-E · OCC ajusta el turno del día de un agente", async ({ page }) => {
  const { station } = runState();
  const occ = await login("occ");
  const hr = await login("hr");
  await cancelLeftovers(occ, station, [10]);
  const shift = await todaysShift(hr);
  const original = { start: shift.startsAtLocal.slice(0, 5), end: shift.endsAtLocal.slice(0, 5) };
  // A flight in the agent's terminal that blocks before the shift starts: the shift of the day does not cover it.
  const shiftStart = Date.parse(`${shift.workDate}T${shift.startsAtLocal}-04:00`); // America/Santo_Domingo, no DST
  const window = { arrivalAt: new Date(shiftStart - 45 * MINUTE).toISOString(),
    departureAt: new Date(shiftStart - 15 * MINUTE).toISOString() };
  if (stationDay(window.arrivalAt) !== shift.workDate) {
    test.skip(true, "El turno del agente empieza demasiado temprano para un vuelo previo el mismo día.");
    return;
  }
  const flight = await planFlight(occ, station, 10, window, { terminals: [shift.terminalCode] });

  // OCC adjusts the agent's shift from Planificación instead of programming a second one, in the station's local time.
  await loginPrivate(page, "occ");
  await openFlight(page, flight.operationCode);
  const programming = page.getByRole("form", { name: "Programación de turno" });
  await expect(programming).toBeVisible();
  const agents = programming.getByLabel("Agente para turno");
  await agents.selectOption((await agents.locator("option").filter({ hasText: AGENT }).getAttribute("value"))!);
  const adjust = page.getByRole("form", { name: "Ajustar turno del día" });
  await expect(adjust).toContainText(`Turno actual: ${original.start}–${original.end}`);
  // The proposal widens the shift until it covers the flight.
  await expect(adjust.getByLabel("Inicio del turno local")).toHaveValue(stationInput(window.arrivalAt).slice(11, 16));
  await expect(adjust.getByLabel("Fin del turno local")).toHaveValue(original.end);
  await adjust.getByLabel("Motivo del ajuste").fill("El agente cubre la llegada temprana (ciclo E2E, hueco 3-E).");
  await snap(page, "fase3-hueco-3e-ajustar-turno");
  await adjust.getByRole("button", { name: "Ajustar turno" }).click();
  await expect(page.getByText("Turno ajustado. Actualizando elegibilidad antes de asignar.")).toBeVisible();
  const assignment = page.getByRole("form", { name: "Asignación de operación" });
  await expect(assignment.locator("label").filter({ hasText: AGENT })).toContainText("Elegible");

  // The same shift, widened; the version OCC read before is stale.
  const widened = await todaysShift(hr);
  expect([widened.id, widened.startsAtLocal.slice(0, 5), widened.endsAtLocal.slice(0, 5)])
    .toEqual([shift.id, stationInput(window.arrivalAt).slice(11, 16), original.end]);
  const route = `/human-resources/shifts/${shift.id}`;
  const back = { startsAtLocal: shift.startsAtLocal, endsAtLocal: shift.endsAtLocal,
    reason: "Se restaura el horario del turno (ciclo E2E).", expectedVersion: shift.version };
  const stale = await call<Problem>(occ, "PATCH", route, back);
  expect([stale.status, stale.data.code]).toEqual([409, "version_conflict"]);
  // With the flight assigned, the shift no longer shrinks back: it would leave the flight uncovered.
  expect((await assignAgent(occ, flight.turnaroundId)).status).toBe(200);
  const uncovering = await call<Problem>(occ, "PATCH", route, { ...back, expectedVersion: widened.version });
  expect([uncovering.status, uncovering.data.code]).toEqual([409, "shift_uncovers_work"]);
  await changeStatus(occ, flight.turnaroundId, "Cancelled", "Vuelo de prueba del ciclo E2E (hueco 3-E): se cancela al terminar.");

  // The same key and body replay the adjustment; that key with another body is refused.
  const key = { "idempotency-key": crypto.randomUUID() };
  const halfway = { ...back, startsAtLocal: clockPlus(shift.startsAtLocal, -5),
    reason: "Ajuste intermedio del turno (ciclo E2E).", expectedVersion: (await todaysShift(hr)).version };
  const adjusted = await expectCall<{ version: string }>(200, hr, "PATCH", route, halfway, key);
  expect((await expectCall<{ version: string }>(200, hr, "PATCH", route, halfway, key)).data.version)
    .toBe(adjusted.data.version);
  const reused = await call<Problem>(hr, "PATCH", route, { ...halfway, reason: "Otro motivo con la misma clave." }, key);
  expect([reused.status, reused.data.code]).toEqual([409, "idempotency_conflict"]);

  // Gestión Humana gives the shift its hours back from the weekly editor.
  await loginPrivate(page, "hr");
  await goPrivate(page, "/gestion-humana/schedules");
  const editor = page.getByRole("region", { name: "Editor semanal de turnos" });
  await editor.getByRole("button", { name: `Ajustar horario de ${AGENT} el ${shift.workDate}` }).click();
  const restore = page.getByRole("form", { name: "Ajustar horario" });
  await restore.getByLabel("Inicio", { exact: true }).fill(original.start);
  await restore.getByLabel("Fin", { exact: true }).fill(original.end);
  await restore.getByLabel("Motivo del ajuste").fill("Se restaura el horario del turno (ciclo E2E, hueco 3-E).");
  await snap(page, "fase3-hueco-3e-gh-ajustar-horario");
  await restore.getByRole("button", { name: "Guardar horario" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "ajustado a" }))
    .toContainText(`ajustado a ${original.start}–${original.end}`);
  const restored = await todaysShift(hr);
  expect([restored.startsAtLocal.slice(0, 5), restored.endsAtLocal.slice(0, 5)]).toEqual([original.start, original.end]);
});
test("hueco 3-F · OCC pasa una operación iniciada a otro agente (relevo)", async ({ page }) => {
  const { run, station } = runState();
  const occ = await login("occ");
  const offset = await freeOffset(station, [12, 14, 16, 18]);
  const window = agentWindow(run.shift as Shift, await busyWindows(station), 45);
  if (offset === null || !window) {
    test.skip(true, "No queda un número de vuelo libre o una ventana de 45 minutos en el turno del agente hoy.");
    return;
  }
  const flight = await planFlight(occ, station, offset, window, { terminals: ["A"] });
  expect((await assignAgent(occ, flight.turnaroundId)).status).toBe(200);
  const device = await tablet();
  const { operation } = await tabletOperation(device, flight.turnaroundId);
  await device.send(200, "POST", `/ramp/operations/${operation.id}/start`);

  // Started, the agent is no longer released: OCC hands the operation over (hueco 3-J).
  const started = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  const current = started.data.turnaround.agents[0]!;
  const release = await call<Problem>(occ, "POST",
    `/occ/planning/turnarounds/${flight.turnaroundId}/assignment/release?expectedAssignmentId=${current.assignmentId}`);
  expect([release.status, release.data.code]).toEqual([409, "operation_started"]);

  // «Relevar agente»: who works it now and who may take what is left of it; the current agent is never offered.
  const options = (await expectCall<HandoverOptions>(200, occ, "GET",
    `/occ/planning/turnarounds/${flight.turnaroundId}/assignment/handover-options`)).data;
  expect([options.operationStatus, options.currentAgentName, options.currentAssignmentId])
    .toEqual(["InProgress", AGENT, current.assignmentId]);
  expect(options.agents.some(agent => agent.id === options.currentAgentId)).toBe(false);
  await loginPrivate(page, "occ");
  await openFlight(page, flight.operationCode);
  const handover = page.getByRole("form", { name: "Relevar agente" });
  await expect(handover).toContainText(`Agente actual: ${AGENT}`);
  const eligible = options.agents.filter(agent => agent.eligible);
  if (eligible.length === 0) await expect(handover).toContainText("No hay agentes elegibles ahora.");
  await snap(page, "fase3-hueco-3f-relevo");

  // A handover names another eligible agent, the assignment OCC saw and a reason.
  const route = `/occ/planning/turnarounds/${flight.turnaroundId}/assignment/handover`;
  const reason = "El agente pasa a cubrir otra posición (ciclo E2E, hueco 3-F).";
  const refusals: Array<[Record<string, string>, number, string]> = [
    [{ agentId: options.currentAgentId, expectedAssignmentId: options.currentAssignmentId, reason }, 400, "same_agent"],
    [{ agentId: crypto.randomUUID(), expectedAssignmentId: crypto.randomUUID(), reason }, 409, "assignment_changed"],
    [{ agentId: crypto.randomUUID(), expectedAssignmentId: options.currentAssignmentId, reason }, 409, "agent_not_eligible"],
    [{ agentId: crypto.randomUUID(), expectedAssignmentId: options.currentAssignmentId, reason: "ok" }, 400, "reason_required"],
  ];
  for (const [body, status, code] of refusals) {
    const refused = await call<Problem>(occ, "POST", route, body);
    expect([refused.status, refused.data.code], code).toEqual([status, code]);
  }
  // An approved operation is not handed over.
  const closed = await call<Problem>(occ, "GET",
    `/occ/planning/turnarounds/${(run.flight as Flight).turnaroundId}/assignment/handover-options`);
  expect([closed.status, closed.data.code]).toEqual([409, "handover_not_allowed"]);

  if (eligible.length > 0) {
    // Another agent of the station takes it: the operation keeps its status and the agent's tablet lets it go.
    const target = eligible[0]!;
    await handover.getByLabel("Agente que recibe la operación").selectOption(target.id);
    await handover.getByLabel("Motivo del relevo").fill(reason);
    await handover.getByRole("button", { name: "Relevar agente" }).click();
    await expect(page.getByText(`Operación relevada a ${target.displayName}.`)).toBeVisible();
    // The section reads its options again: the agent who took the operation is the current one now.
    await expect(handover).toContainText(`Agente actual: ${target.displayName}`);
    const handed = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
    expect([handed.data.turnaround.operation?.status, handed.data.turnaround.agents.map(agent => agent.displayName)])
      .toEqual(["InProgress", [target.displayName]]);
    const queue = await device.get<{ operations: Array<{ turnaround: { id: string } }> }>("/ramp/operations");
    expect(queue.data.operations.some(item => item.turnaround.id === flight.turnaroundId)).toBe(false);
    // OCC still records the attendance of the relieved agent, who worked until the handover: the board no longer lists
    // him, the drawer does («(relevado)») and OCC saves its note on his assignment.
    const attendance = (await expectCall<{ assignments: Array<{ assignmentId: string; releasedAt: string | null }> }>(
      200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}/attendance-assignments`)).data;
    expect(attendance.assignments.find(item => item.assignmentId === current.assignmentId)?.releasedAt,
      "the relieved assignment is listed with its release").toBeTruthy();
    const attendanceAgent = page.getByLabel("Agente para asistencia");
    await expect(attendanceAgent.locator("option", { hasText: `${AGENT} (relevado)` })).toHaveCount(1);
    await attendanceAgent.selectOption(current.assignmentId!);
    await expect(page.getByRole("heading", { name: `Asistencia de ${AGENT} (relevado)` })).toBeVisible();
    await page.getByLabel("Nota de OCC").fill("Trabajó hasta el relevo (ciclo E2E, hueco 3-F).");
    await page.getByRole("button", { name: "Guardar observación OCC" }).click();
    await expect(page.getByText("Versión guardada: 1")).toBeVisible();
    await snap(page, "fase3-hueco-3f-asistencia-relevado");
    // Back to the run's agent, with the same key and body replaying the answer, so the run closes it from its tablet.
    const key = { "idempotency-key": crypto.randomUUID() };
    const giveBack = { agentId: options.currentAgentId, expectedAssignmentId: handed.data.turnaround.agents[0]!.assignmentId,
      reason: "El agente original retoma la operación (ciclo E2E)." };
    const returned = await expectCall<{ assignmentId: string; replayed: boolean }>(200, occ, "POST", route, giveBack, key);
    const replayed = await expectCall<{ assignmentId: string; replayed: boolean }>(200, occ, "POST", route, giveBack, key);
    expect([replayed.data.assignmentId, replayed.data.replayed]).toEqual([returned.data.assignmentId, true]);
  }

  // The agent closes the test flight from the tablet: it no longer holds the agent nor waits on the ramp.
  await handOffUnperformed(device, flight.turnaroundId);
});
test("hueco 3-G · OCC gestiona las incidencias de la operación", async ({ page }) => {
  const { run, station } = runState();
  const occ = await login("occ");
  const offset = await freeOffset(station, [33, 35, 37]);
  const window = agentWindow(run.shift as Shift, await busyWindows(station), 30);
  if (offset === null || !window) {
    test.skip(true, "No queda un número de vuelo libre o una ventana de 30 minutos en el turno del agente hoy.");
    return;
  }
  const flight = await planFlight(occ, station, offset, window, { terminals: ["A"] });
  expect((await assignAgent(occ, flight.turnaroundId)).status).toBe(200);
  const device = await tablet();
  const { operation } = await tabletOperation(device, flight.turnaroundId);
  await device.send(200, "POST", `/ramp/operations/${operation.id}/start`);
  // The agent reports from the tablet while the flight is on the ramp: OCC manages it live, before any hand-off.
  const spill = `Derrame de combustible en la posición (ciclo E2E, hueco 3-G, ${run.runId})`;
  await device.send(200, "POST", `/ramp/operations/${operation.id}/incidents`,
    { incidentType: "Safety", severity: "High", description: spill, occurredAt: at(0) });
  type Incident = { id: string; status: string; description: string; reportedByKind: string; version: string;
    resolutionNote: string | null; allowedStatuses: string[]; history: Array<{ toStatus: string }> };
  type Incidents = { operationStatus: string; canReport: boolean; incidents: Incident[] };
  const incidentsRoute = `/occ/operations/${operation.id}/incidents`;
  const listed = (await expectCall<Incidents>(200, occ, "GET", incidentsRoute)).data;
  expect([listed.operationStatus, listed.canReport]).toEqual(["InProgress", true]);
  const fromTablet = listed.incidents.find(item => item.description === spill);
  expect(fromTablet?.reportedByKind, "the live list carries the agent's report").toBe("Agent");

  // The alert opens the review: no hand-off yet, the live incidents in Spanish; OCC takes the agent's into review
  // with a note and reports its own in the station's local time.
  await loginPrivate(page, "occ");
  await goPrivate(page, `/admin-occ/review?operationId=${operation.id}`);
  const detail = page.getByRole("region", { name: "Detalle de entrega" });
  await expect(detail.getByText("La operación sigue en curso; aún no hay entrega.")).toBeVisible();
  const panel = detail.getByRole("region", { name: "Incidencias de la operación" });
  const row = panel.getByRole("listitem").filter({ hasText: spill });
  await expect(row).toContainText("Seguridad · Alta");
  await row.getByRole("button", { name: "Pasar a revisión" }).click();
  const change = row.getByRole("form", { name: "Pasar a revisión" });
  await change.getByLabel("Nota (8 a 2000 caracteres)").fill("OCC coordina la limpieza con los bomberos.");
  await change.getByRole("button", { name: "Guardar" }).click();
  await expect(panel.getByText("Incidencia actualizada.")).toBeVisible();
  const delay = `Demora del equipaje informada por la aerolínea (ciclo E2E, ${run.runId})`;
  await panel.getByRole("button", { name: "Reportar incidencia" }).click();
  const report = panel.getByRole("form", { name: "Nueva incidencia de OCC" });
  await report.getByLabel("Tipo").selectOption("Operational");
  await report.getByLabel("Severidad").selectOption("Low");
  await report.getByLabel("Descripción (8 a 2000 caracteres)").fill(delay);
  await report.getByRole("button", { name: "Reportar" }).click();
  await expect(panel.getByText("Incidencia reportada.")).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: delay })).toContainText("Reportada por");
  await snap(page, "fase3-hueco-3g-incidencias");

  // The change kept its note in the history; OCC's report is its own.
  const after = (await expectCall<Incidents>(200, occ, "GET", incidentsRoute)).data;
  const taken = after.incidents.find(item => item.id === fromTablet!.id)!;
  expect([taken.status, taken.history.map(step => step.toStatus)]).toEqual(["InReview", ["Open", "InReview"]]);
  const own = after.incidents.find(item => item.description === delay);
  expect([own?.reportedByKind, own?.status]).toEqual(["Occ", "Open"]);

  // A change names the version OCC saw (missing: 428; old: 412); the same key and body repeat it.
  const statusRoute = `/occ/incidents/${taken.id}/status`;
  const resolve = { status: "Resolved", note: "Limpieza terminada; la posición quedó habilitada." };
  const unversioned = await call<Problem>(occ, "POST", statusRoute, resolve, { "idempotency-key": crypto.randomUUID() });
  expect([unversioned.status, unversioned.data.code]).toEqual([428, "expected_version_required"]);
  const stale = await call<Problem>(occ, "POST", statusRoute, resolve,
    { "idempotency-key": crypto.randomUUID(), "if-match": `"${fromTablet!.version}"` });
  expect([stale.status, stale.data.code]).toEqual([412, "version_conflict"]);
  const intent = { "idempotency-key": crypto.randomUUID(), "if-match": `"${taken.version}"` };
  const resolved = await expectCall<Incident>(200, occ, "POST", statusRoute, resolve, intent);
  expect([resolved.data.status, resolved.data.resolutionNote]).toEqual(["Resolved", resolve.note]);
  const repeated = await expectCall<Incident>(200, occ, "POST", statusRoute, resolve, intent);
  expect(repeated.data.version).toBe(resolved.data.version);
  const reused = await call<Problem>(occ, "POST", statusRoute, { ...resolve, note: "Otra nota con la misma clave." }, intent);
  expect([reused.status, reused.data.code]).toEqual([409, "idempotency_conflict"]);
  // A closed incident is final.
  const closed = await expectCall<Incident>(200, occ, "POST", statusRoute,
    { status: "Closed", note: "Cierre confirmado con la aerolínea." },
    { "idempotency-key": crypto.randomUUID(), "if-match": `"${resolved.data.version}"` });
  expect(closed.data.allowedStatuses).toEqual([]);

  // The tablet keeps reading the same keys and sees OCC's report too; then it hands the flight to OCC.
  const center = await device.get<{ incidents: Array<{ id: string; status: string }> }>(
    `/ramp/operations/${operation.id}/incidents`);
  expect(center.data.incidents.map(item => item.id)).toEqual(expect.arrayContaining([taken.id, own!.id]));
  await handOffUnperformed(device, flight.turnaroundId);
});
test("hueco 3-H · OCC reabre una operación aprobada que aún no se facturó", async ({ page }) => {
  const { run, station } = runState();
  const flight = run.flight as Flight;
  const operationId = String(run.operationId);
  const occ = await login("occ");
  type Review = { submissionId: string; revisionNumber: number; status: string; reviewVersion: string;
    serviceOrderState?: string | null; reopening?: { fromRevisionNumber: number; reason: string } | null;
    close?: { canAdjustCharges: boolean } };
  const reviewRoute = `/occ/review/operations/${operationId}`;
  const read = async () => (await expectCall<Review>(200, occ, "GET", reviewRoute)).data;
  const finance = await login("finance");
  const day = stationDay(flight.arrivalAt);
  /** The run's services in «Por facturar», with the preinvoice that holds them, if any. */
  const toInvoice = async () => (await expectCall<{ services: Array<{ operationId: string; preinvoiceId?: string | null }> }>(
    200, finance, "GET", `/finance/approved-services?stationId=${station}&from=${day}&to=${day}`))
    .data.services.filter(item => item.operationId === operationId);
  let review = await read();
  if (review.status === "Approved") {
    const listed = await toInvoice();
    if (listed.length === 0 || listed.some(item => item.preinvoiceId)) {
      test.skip(true, "La operación del ciclo ya está en una prefactura: su corrección es una nota de crédito.");
      return;
    }
  }
  await loginPrivate(page, "occ");
  const detail = page.getByRole("region", { name: "Detalle de entrega" });
  // A resumed run may find the revision reopened already: it goes straight to the checks and the new approval.
  if (review.status === "Approved") {
    expect(review.serviceOrderState, "the run's approval stands on its signed Service Order").toMatch(/^(Signed|Corrected)$/);
    await goPrivate(page, `/admin-occ/review?operationId=${operationId}`);
    await detail.getByRole("button", { name: "Reabrir revisión" }).click();
    await detail.getByLabel("Motivo de la reapertura (8 a 2000 caracteres)")
      .fill("La aerolínea pidió revisar los recargos del vuelo (ciclo E2E, hueco 3-H).");
    await detail.getByRole("button", { name: "Confirmar reapertura" }).click();
    await expect(page.getByText(/^Revisión reabierta como revisión \d+: vuelve a Pendiente de revisión\.$/)).toBeVisible();
    await expect(detail.getByText(/^Revisión reabierta por OCC:/)).toBeVisible();
    await expect(detail.getByRole("button", { name: "Devolver con correcciones" })).toHaveCount(0);
    await snap(page, "fase3-hueco-3h-reabierta");
    review = await read();
  }
  expect([review.status, review.reopening?.fromRevisionNumber, review.close?.canAdjustCharges])
    .toEqual(["PendingReview", review.revisionNumber - 1, true]);

  // Reopened, nothing of the release is undone: the flight stays closed (hueco 3-D) and Finance stops seeing it.
  const planned = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect(planned.data.turnaround.status).toBe("Completed");
  expect(await toInvoice()).toEqual([]);
  // A reopened revision is never returned to the ramp, and only an approval is reopened.
  const decision = `${reviewRoute}/decision`;
  const returned = await call<Problem>(occ, "POST", decision,
    { submissionId: review.submissionId, outcome: "Returned", reason: "Corregir los recargos del vuelo." },
    { "if-match": review.reviewVersion, "idempotency-key": crypto.randomUUID() });
  expect([returned.status, returned.data.code]).toEqual([409, "reopened_review_cannot_return"]);
  const reopening = `${reviewRoute}/reopening`;
  const body = { submissionId: review.submissionId, reason: "Otra reapertura del ciclo E2E (hueco 3-H)." };
  const unversioned = await call<Problem>(occ, "POST", reopening, body, { "idempotency-key": crypto.randomUUID() });
  expect([unversioned.status, unversioned.data.code]).toEqual([428, "expected_version_required"]);
  const pending = await call<Problem>(occ, "POST", reopening, body,
    { "if-match": review.reviewVersion, "idempotency-key": crypto.randomUUID() });
  expect([pending.status, pending.data.code]).toEqual([409, "review_not_approved"]);

  // OCC approves the reopened revision again from the review screen: Finance sees it to invoice as before.
  await goPrivate(page, `/admin-occ/review?operationId=${operationId}`);
  await detail.getByRole("button", { name: "Aprobar", exact: true }).click();
  await detail.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(page.getByText("Entrega aprobada y registrada.")).toBeVisible();
  const approved = await read();
  expect([approved.status, approved.close?.canAdjustCharges]).toEqual(["Approved", false]);
  expect((await toInvoice()).length).toBeGreaterThan(0);
});
test("hueco 3-I · la tablet sin conexión encola inicio, servicios, cargos, checklist y chat con su hora", async () => {
  const { run, station } = runState();
  const occ = await login("occ");
  const offset = await freeOffset(station, [27, 29, 31]);
  const window = agentWindow(run.shift as Shift, await busyWindows(station), 30);
  if (offset === null || !window) {
    test.skip(true, "No queda un número de vuelo libre o una ventana de 30 minutos en el turno del agente hoy.");
    return;
  }
  const flight = await planFlight(occ, station, offset, window, { terminals: ["A"] });
  expect((await assignAgent(occ, flight.turnaroundId)).status).toBe(200);
  const device = await tablet();
  const { operation, services } = await tabletOperation(device, flight.turnaroundId);
  const mine = await device.get<{ operations: Array<{ operation: { id: string }; assignment: { assignedAt: string } }> }>(
    "/ramp/operations");
  const assignedAt = Date.parse(mine.data.operations.find(item => item.operation.id === operation.id)!.assignment.assignedAt);
  // The tablet's queue sends each command later with the key it saved: the same key and body always replay.
  const queued = <T>(key: string, method: string, route: string, body?: unknown) =>
    call<T & Problem>(device.token, method, route, body, { ...device.device, "idempotency-key": key });
  const startRoute = `/ramp/operations/${operation.id}/start`;

  // A start tapped before the assignment it starts does not fit the operation: refused with its code, and the
  // receipt repeats that refusal for the same key and body.
  const early = crypto.randomUUID();
  const earlyBody = { startedAt: at(-30) };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const refused = await queued(early, "POST", startRoute, earlyBody);
    expect([refused.status, refused.data.code]).toEqual([409, "time_outside_operation_window"]);
  }
  // «Iniciar» tapped right after the assignment reached the tablet, without signal, and sent seconds later from the
  // queue: ELEVANT keeps the tapped time, not the moment it arrives.
  const tapped = new Date(Math.ceil(assignedAt / 1000) * 1000 + 1000).toISOString();
  while (Date.now() < Date.parse(tapped) + 3000) await new Promise(resolve => setTimeout(resolve, 250));
  const startKey = crypto.randomUUID();
  const started = await queued<{ receiptId: string; operation: { actualStartAt: string } }>(startKey, "POST", startRoute,
    { startedAt: tapped });
  expect(started.status).toBe(200);
  expect(Date.parse(started.data.operation.actualStartAt)).toBe(Date.parse(tapped));
  const replayed = await queued<{ receiptId: string }>(startKey, "POST", startRoute, { startedAt: tapped });
  expect([replayed.status, replayed.data.receiptId]).toEqual([200, started.data.receiptId]);
  const reused = await queued(startKey, "POST", startRoute, { startedAt: at(0) });
  expect([reused.status, reused.data.code]).toEqual([409, "idempotency_conflict"]);

  // The first service keeps its tapped times, in order; the others were not performed.
  expect(services.length, "the contracted services reach the tablet").toBeGreaterThan(0);
  const [first, ...others] = services;
  const transition = `/ramp/operations/${operation.id}/services/${first.id}/transition`;
  const begun = new Date(Date.parse(tapped) + 1000).toISOString();
  expect((await queued(crypto.randomUUID(), "POST", transition,
    { targetStatus: "InProgress", executedQuantity: null, note: null, occurredAt: begun })).status).toBe(200);
  const backwards = await queued(crypto.randomUUID(), "POST", transition,
    { targetStatus: "Completed", executedQuantity: 1, note: "Servicio completado", occurredAt: tapped });
  expect([backwards.status, backwards.data.code]).toEqual([409, "service_time_out_of_order"]);
  expect((await queued(crypto.randomUUID(), "POST", transition,
    { targetStatus: "Completed", executedQuantity: 1, note: "Servicio completado", occurredAt: at(0) })).status).toBe(200);
  for (const service of others)
    await device.send(200, "POST", `/ramp/operations/${operation.id}/services/${service.id}/transition`,
      { targetStatus: "NotPerformed", executedQuantity: 0, note: "No se prestó: vuelo de prueba del ciclo E2E." });

  // A charge, the chat and the checklist go out from the queue too: sent twice with their key, they count once.
  type Charges = { services: Array<{ serviceId: string; canEdit: boolean;
    available: Array<{ id: string; allowMultiple: boolean }>; applied: Array<{ chargeId: string; source?: string }> }> };
  const charges = await device.get<Charges>(`/ramp/operations/${operation.id}/charges`);
  const editable = charges.data.services.find(item => item.canEdit && item.available.some(option => !option.allowMultiple) &&
    item.applied.length === 0);
  if (editable) {
    const option = editable.available.find(item => !item.allowMultiple)!;
    const chargeKey = crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1)
      expect((await queued(chargeKey, "POST", `/ramp/operations/${operation.id}/services/${editable.serviceId}/charges`,
        { chargeId: option.id, action: "Apply" })).status).toBe(200);
    const marked = await device.get<Charges>(`/ramp/operations/${operation.id}/charges`);
    expect(marked.data.services.find(item => item.serviceId === editable.serviceId)!.applied
      .filter(mark => mark.chargeId === option.id)).toHaveLength(1);
  }
  const content = `Sin señal en la posición (ciclo E2E, hueco 3-I, ${run.runId})`;
  const messageKey = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1)
    expect([200, 201]).toContain((await queued(messageKey, "POST", `/chat/conversations/${operation.id}/messages`,
      { content })).status);
  const thread = await device.get<{ messages: Array<{ content: string }> }>(`/chat/conversations/${operation.id}/messages`);
  expect(thread.data.messages.filter(item => item.content === content)).toHaveLength(1);
  const checklist = await device.get<{ checklist: { id: string; sections: Array<{ items: Array<{ id: string }> }> } }>(
    `/ramp/operations/${operation.id}/checklist`);
  const answers = { checklistId: checklist.data.checklist.id,
    answers: checklist.data.checklist.sections.flatMap(section => section.items).map(item => ({ itemId: item.id, value: "Ok" })) };
  const checklistKey = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1)
    expect((await queued(checklistKey, "POST", `/ramp/operations/${operation.id}/checklist/submit`, answers)).status).toBe(200);

  // The tablet reads the operation as ELEVANT keeps it and hands it to OCC, so it no longer holds the agent.
  const after = await device.get<{ operations: Array<{ operation: { id: string; status: string; actualStartAt: string | null } }> }>(
    "/ramp/operations");
  const current = after.data.operations.find(item => item.operation.id === operation.id)!.operation;
  expect([current.status, Date.parse(current.actualStartAt ?? "")]).toEqual(["InProgress", Date.parse(tapped)]);
  await device.send([200, 201], "POST", `/ramp/operations/${operation.id}/submit`,
    { agentNote: "Vuelo de prueba del ciclo E2E (hueco 3-I): registros enviados desde la cola del dispositivo." });
});

test("hueco 3-J · crear y liberar cobertura y liberar un agente son idempotentes", async ({ page }) => {
  const { run, station } = runState();
  const occ = await login("occ");
  const date = localDay();
  const board = (await expectCall<CoverageBoard>(200, occ, "GET", `/occ/coverage?stationId=${station}&date=${date}`)).data;
  const agent = board.agents.find(item => item.name === AGENT);
  expect(agent, "the agent has today's shift at PUJ").toBeTruthy();
  const mine = (value: CoverageBoard) => value.coverages.filter(item => item.agentId === agent!.agentId);
  for (const left of mine(board)) // an earlier attempt's coverage of the agent
    await expectCall(200, occ, "POST", `/occ/coverage/${left.id}/release?date=${date}`);
  const stand = board.stands.find(item => item.terminalId === agent!.terminalId && item.isActive && !item.hasBoardingBridge);
  const terminal = board.terminals.find(item => item.terminalId === agent!.terminalId);
  expect(stand && terminal, "the agent's terminal has a stand without a bridge").toBeTruthy();

  // The same key and body answer the board again: one coverage, never «El agente ya cubre posiciones en ese horario».
  const body = { stationId: station, date, agentId: agent!.agentId, terminalId: agent!.terminalId, standIds: [stand!.standId],
    startsAt: null, endsAt: null, mentorAgentId: null, vehicleCode: null, isReinforcement: false };
  const key = { "idempotency-key": crypto.randomUUID() };
  const created = await expectCall<CoverageBoard>(200, occ, "POST", "/occ/coverage", body, key);
  expect(mine(created.data)).toHaveLength(1);
  const again = await expectCall<CoverageBoard>(200, occ, "POST", "/occ/coverage", body, key);
  expect(mine(again.data).map(item => item.id)).toEqual(mine(created.data).map(item => item.id));
  const reused = await call<Problem>(occ, "POST", "/occ/coverage", { ...body, isReinforcement: true }, key);
  expect([reused.status, reused.data.code]).toEqual([409, "idempotency_conflict"]);
  const another = await call<Problem>(occ, "POST", "/occ/coverage", body); // a new intent with a new key
  expect(another.status).toBe(422);
  expect(another.data.reasons).toContain("agent_overlap");
  // Releasing answers the board; the same key repeats it and that key with another date is refused.
  const coverage = mine(created.data)[0]!.id;
  const release = { "idempotency-key": crypto.randomUUID() };
  const released = await expectCall<CoverageBoard>(200, occ, "POST", `/occ/coverage/${coverage}/release?date=${date}`,
    undefined, release);
  expect(mine(released.data)).toHaveLength(0);
  await expectCall(200, occ, "POST", `/occ/coverage/${coverage}/release?date=${date}`, undefined, release);
  const tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 24 * 60 * MINUTE).toISOString().slice(0, 10);
  const otherDay = await call<Problem>(occ, "POST", `/occ/coverage/${coverage}/release?date=${tomorrow}`, undefined, release);
  expect([otherDay.status, otherDay.data.code]).toEqual([409, "idempotency_conflict"]);

  // The coverage screen hands the stand to the agent and frees it, each intent with its own key.
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/position-coverage");
  await expect(page.getByText("Cargando la cobertura de posiciones…")).toBeHidden();
  await page.getByRole("navigation", { name: "Terminal y vista" })
    .getByRole("button", { name: `Terminal ${terminal!.code}`, exact: true }).click();
  const form = page.getByRole("form", { name: "Asignar posiciones" });
  // The label wraps the select, so its text includes the options: select it by its accessible name.
  const agents = form.getByRole("combobox", { name: "Agente", exact: true });
  await agents.selectOption((await agents.locator("option").filter({ hasText: AGENT }).getAttribute("value"))!);
  await form.getByRole("button", { name: stand!.code, exact: true }).click();
  await snap(page, "fase3-hueco-3j-cobertura");
  await form.getByRole("button", { name: "Asignar posiciones" }).click();
  const row = page.getByRole("region", { name: "Coberturas del día" }).getByRole("listitem").filter({ hasText: AGENT });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Liberar" }).click();
  await expect(row).toHaveCount(0);

  // «Liberar agente» names the assignment OCC saw: a key needs it, another one is refused, the same key repeats it.
  const offset = await freeOffset(station, [13, 15, 17]);
  const window = agentWindow(run.shift as Shift, await busyWindows(station), 30);
  if (offset === null || !window) {
    test.skip(true, "No queda un número de vuelo libre o una ventana de 30 minutos en el turno del agente hoy.");
    return;
  }
  const flight = await planFlight(occ, station, offset, window, { terminals: ["A"] });
  expect((await assignAgent(occ, flight.turnaroundId)).status).toBe(200);
  const assigned = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  const assignmentId = assigned.data.turnaround.agents[0]!.assignmentId;
  const route = `/occ/planning/turnarounds/${flight.turnaroundId}/assignment/release`;
  const unversioned = await call<Problem>(occ, "POST", route);
  expect([unversioned.status, unversioned.data.code]).toEqual([400, "expected_version_required"]);
  const changed = await call<Problem>(occ, "POST", `${route}?expectedAssignmentId=${crypto.randomUUID()}`);
  expect([changed.status, changed.data.code]).toEqual([409, "assignment_changed"]);
  const intent = { "idempotency-key": crypto.randomUUID() };
  await expectCall(204, occ, "POST", `${route}?expectedAssignmentId=${assignmentId}`, undefined, intent);
  await expectCall(204, occ, "POST", `${route}?expectedAssignmentId=${assignmentId}`, undefined, intent);
  const freed = await expectCall<Detail>(200, occ, "GET", `/occ/planning/turnarounds/${flight.turnaroundId}`);
  expect([freed.data.turnaround.operation?.status, freed.data.turnaround.agents]).toEqual(["Planned", []]);
  await changeStatus(occ, flight.turnaroundId, "Cancelled", "Vuelo de prueba del ciclo E2E (hueco 3-J): se cancela al terminar.");
});
test("hueco 3-K · OCC ve la foto de un daño del walk-around en la revisión", async ({ page }) => {
  const { run, station } = runState();
  const occ = await login("occ");
  const offset = await freeOffset(station, [21, 23, 25]);
  const window = agentWindow(run.shift as Shift, await busyWindows(station), 30);
  if (offset === null || !window) {
    test.skip(true, "No queda un número de vuelo libre o una ventana de 30 minutos en el turno del agente hoy.");
    return;
  }
  const flight = await planFlight(occ, station, offset, window, { terminals: ["A"] });
  expect((await assignAgent(occ, flight.turnaroundId)).status).toBe(200);
  const device = await tablet();
  const { operation } = await tabletOperation(device, flight.turnaroundId);
  await device.send(200, "POST", `/ramp/operations/${operation.id}/start`);
  // The walk-around: a damage on the silhouette and its photo, as the tablet's queue sends them.
  const markId = crypto.randomUUID();
  const note = "Abolladura en la puerta 2L (ciclo E2E, hueco 3-K)";
  await device.send(200, "PUT", `/ramp/operations/${operation.id}/damage-marks/${markId}`,
    { x: 0.42, y: 0.31, note, reportedAt: at(0) });
  const upload = await fetch(`${API}/api/v1/ramp/operations/${operation.id}/damage-marks/${markId}/photo`, {
    method: "PUT", body: PNG_PIXEL,
    headers: { authorization: `Bearer ${device.token}`, "content-type": "image/png", ...device.device } });
  expect([200, 503], "the photo is stored, or this stack has no photo storage").toContain(upload.status);
  await handOffUnperformed(device, flight.turnaroundId);

  // OCC reviews the hand-off: the damage with its note and the photo, read only when OCC opens it.
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/review");
  const row = page.getByRole("row").filter({ hasText: flight.operationCode });
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  const forms = page.getByRole("region", { name: "Detalle de entrega" }).getByRole("region", { name: "Formularios AVIAM" });
  const mark = forms.getByRole("listitem").filter({ hasText: note });
  await expect(mark).toBeVisible();
  if (upload.status === 200) {
    await mark.getByRole("button", { name: "Ver foto" }).click();
    await expect(mark.getByRole("img", { name: "Foto del daño" })).toBeVisible();
    const photo = await fetch(`${API}/api/v1/occ/operations/${operation.id}/damage-marks/${markId}/photo`,
      { headers: { authorization: `Bearer ${occ}` } });
    expect([photo.status, photo.headers.get("content-type")]).toEqual([200, "image/png"]);
  } else {
    await expect(mark).toContainText("Sin foto");
  }
  await snap(page, "fase3-hueco-3k-foto-dano");
});

test("huecos 3-N13 a 3-N26 · los reportes de OCC y Gestión Humana cuentan lo trabajado y hablan español en hora local", async () => {
  const { run, station, airline } = runState();
  const flight = run.flight as Flight;
  const day = stationDay(flight.arrivalAt);
  const query = `stationId=${station}&from=${day}&to=${day}`;
  type Report = { columns: string[]; rows: Array<Array<{ value: string; type: string }>> };
  const occ = await login("occ");
  const read = async (key: string) =>
    (await expectCall<Report>(200, occ, "GET", `/occ/reports/${key}?${query}&limit=100`)).data;

  // Hueco 3-N13: every failure carries its code; an export is the whole period or a 422 report_too_large.
  const inverted = await call<Problem>(occ, "GET", `/occ/reports/operations?stationId=${station}&from=${day}&to=2000-01-01`);
  expect([inverted.status, inverted.data.code]).toEqual([400, "invalid_report_query"]);
  const unknown = await call<Problem>(occ, "GET", `/occ/reports/sla?${query}`);
  expect([unknown.status, unknown.data.code]).toEqual([404, "report_not_found"]);

  // Hueco 3-N15: the run's approved flight is billed by its completed services, and only billable services count;
  // hueco 3-N26: the unit is the name Finance gives it, never the code of the rate.
  const services = await read("services-by-airline");
  const billed = services.rows.filter(row => row[0].value === airline.name);
  expect(billed.length, "the run's approved services are in the report").toBeGreaterThan(0);
  expect(billed.filter(row => /^[a-z_]+$/.test(row[2].value)), "every unit is Finance's name").toEqual([]);

  // Hueco 3-N14: the agent who worked the run's flight has it, approved, with its minutes.
  const productivity = await read("agent-productivity");
  const agent = productivity.rows.find(row => row[0].value === AGENT);
  expect(agent, "the agent who worked the run's flight").toBeTruthy();
  expect(Number(agent![3].value), "approved operations of the agent").toBeGreaterThan(0);

  // Hueco 3-N26: the review lists the run's deviation in Spanish and the CSV says when it was generated, locally.
  const reviews = await read("reviews");
  expect(reviews.rows.filter(row => row[1].value === flight.operationCode).map(row => row[7].value).join(" "))
    .toContain("Desviación (media)");
  const csv = await expectCall<string>(200, occ, "GET", `/occ/reports/reviews/export?${query}&format=csv`);
  expect(csv.data).toContain("(hora local)");
  expect(csv.data).not.toContain("UTC");

  // Hueco 3-N16: Gestión Humana's PDF is titled and dated in Spanish, at the station's local time.
  const hr = await login("hr");
  const pdf = await expectCall<Buffer>(200, hr, "GET",
    `/human-resources/reports/staff-distribution/export?${query}&format=pdf`);
  const text = pdfText(pdf.data);
  expect(text).toContain("Distribución de turnos · PUJ");
  expect(text).toContain("(hora local)");
  expect(text).not.toContain("StaffDistribution");
  const movements = await call<Problem>(hr, "GET",
    `/human-resources/reports/account-movements?stationId=${station}&from=${day}&to=2000-01-01`);
  expect([movements.status, movements.data.code]).toEqual([400, "invalid_report_query"]);
});
