import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
import { goPrivate, loginPrivate, openModule, snap } from "./support/browser";
import { API } from "./support/env";
import {
  ensureAgentShiftToday, findTurnaround, handOffUnperformed, openPlanningFlight, type PlanningDetail,
  type PlanningTurnaround, RAMP_AGENT, tablet, tabletOperation,
} from "./support/operations";

// Vuelo demo (ADR-0041, PR A1 of «OCC a nivel NOC»). The Superadmin triggers, from «Configuración», a demo flight of the
// seeded airline «Demo Airlines» (ZZ, with its seeded contract) towards a free stand of Terminal A, where the seeded
// ramp agent works. OCC sees it in «Importar vuelos» marked «Demo», with its stand already chosen, and imports it
// without asking the provider for a read; it assigns the agent; the progress worker stamps the landing, the tablet
// records BLOCK_ON and PUSHBACK, the worker stamps the take-off and the Superadmin's list follows each phase. A second
// flight is cancelled before touchdown and leaves OCC's review. It needs no run of the cycle (fase 1 to 4):
//   npx playwright test --config playwright.cycle.config.ts --project=demo

type DemoStand = { standId: string; code: string; terminalCode: string; free: boolean };
type DemoOptions = {
  enabled: boolean; stationId: string | null; operationDate: string | null;
  stations: Array<{ id: string; code: string }>;
  airlines: Array<{ id: string; name: string; iataCode: string | null }>;
  airports: Array<{ iataCode: string }>;
  aircraftTypes: Array<{ id: string; icaoCode: string }>;
  stands: DemoStand[];
  limits: { maxActive: number; active: number };
};
type DemoFlight = {
  id: string; arrivalFlightNumber: string; departureFlightNumber: string; suggestedStandCode: string | null;
  state: "Active" | "Cancelled" | "Finished"; phase: string;
  appearAt: string; touchdownAt: string; onBlockAt: string; scheduledOffBlockAt: string;
  offBlockAt: string | null; takeoffAt: string | null; vanishAt: string | null;
  imported: boolean; turnaroundId: string | null; operationCode: string | null; standCode: string | null;
};
type DemoList = { enabled: boolean; serverTime: string; flights: DemoFlight[] };
type Proposal = {
  proposalId: string; direction: "Arrival" | "Departure"; flightNumber: string; status: string; gate: string | null;
  suggestedDepartureId: string | null; suggestedAircraftTypeId: string | null; version: string; isDemo?: boolean;
};
type Problem = { code?: string };

const MINUTE = 60_000;
/** The stands the seed gives Terminal A, where the seeded agent is scoped; any other free stand there is the fallback. */
const SEEDED_TERMINAL_A = ["A01", "A02"];
/** An API instant in milliseconds; the engines differ beyond milliseconds. */
const ms = (value: string) => Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));

// What one step leaves for the next: the walkthrough is serial and each step needs the previous one.
let station = "";
let day = "";
let airlineId = "";
let aircraftTypeId = "";
let stand: DemoStand | undefined;
let flight: DemoFlight | undefined;
let departureProposalId = "";
let turnaroundId = "";
let operationCode = "";
let operationId = "";
/** The demo flights this walkthrough triggered: the ones nobody imported end with it, even after a failure. */
const triggered = new Set<string>();

// Two browser profiles, as on the day of the demonstration: the Superadmin and OCC never share a session.
let superadminContext: BrowserContext | undefined;
let occContext: BrowserContext | undefined;
let superadminPage: Page;
let occPage: Page;

const demoOptions = async (token: string) =>
  (await expectCall<DemoOptions>(200, token, "GET", "/governance/demo-flights/options")).data;

/** «Vuelos demo de hoy» as the API lists it, and how far the server's clock is ahead of this machine's (ms). */
async function demoList(token: string) {
  const sentAt = Date.now();
  const list = (await expectCall<DemoList>(200, token, "GET", `/governance/demo-flights?stationId=${station}`)).data;
  return { list, offset: ms(list.serverTime) - (sentAt + Date.now()) / 2 };
}

async function demoFlight(token: string, id: string) {
  const found = (await demoList(token)).list.flights.find(item => item.id === id);
  expect(found, "the demo flight is in the Superadmin's list").toBeTruthy();
  return found!;
}

/**
 * Ends the active demo flights nobody imported, of this walkthrough or (`all`) of an earlier attempt: cancelled before
 * the touchdown, finished after it. An imported one belongs to OCC's planning and is left as it is.
 */
async function endUnimported(token: string, all: boolean) {
  const { list, offset } = await demoList(token);
  for (const item of list.flights.filter(entry => entry.state === "Active" && !entry.imported &&
    (all || triggered.has(entry.id)))) {
    const intent = Date.now() + offset < ms(item.touchdownAt) ? "Cancel" : "Finish";
    await call<Problem>(token, "POST", `/governance/demo-flights/${item.id}/cancel`, { intent });
  }
}

/** OCC's review of the provider's flights of the day: what «Importar vuelos» lists, by view. */
const occFeed = async (token: string, view: "Contracted" | "Dismissed") =>
  (await expectCall<{ proposals: Proposal[] }>(200, token, "GET",
    `/occ/flight-feed?stationId=${station}&date=${day}&view=${view}`)).data.proposals;

/** The panel «Vuelo demo» of the Superadmin's «Configuración». */
const demoPanel = () => superadminPage.getByRole("region", { name: "Vuelo demo", exact: true });

/** A flight's row in «Vuelos demo de hoy» (the newest one with those numbers). */
const demoRow = (item: DemoFlight) => demoPanel().getByRole("list", { name: "Vuelos demo de hoy" }).getByRole("listitem")
  .filter({ hasText: `${item.arrivalFlightNumber} / ${item.departureFlightNumber}` }).first();

/**
 * «Disparar vuelo demo»: Demo Airlines from Miami and back, the seeded A320, the stand (or «Sin posición») and the
 * minutes. Returns the new flight as the API lists it, once the panel announced it.
 */
async function trigger(token: string, choice: { stand: DemoStand | null; minutes: number; groundMinutes: number }) {
  const before = new Set((await demoList(token)).list.flights.map(item => item.id));
  const form = demoPanel().getByRole("form", { name: "Disparar vuelo demo" });
  // A select inside its label is named by the label and the chosen option, hence the anchored names.
  await form.getByRole("combobox", { name: /^Aerolínea/ }).selectOption(airlineId);
  await form.getByRole("combobox", { name: /^Origen/ }).selectOption("MIA");
  await form.getByRole("combobox", { name: /^Destino de la salida/ }).selectOption({ label: "El mismo aeropuerto" });
  await form.getByRole("combobox", { name: /^Tipo de avión/ }).selectOption(aircraftTypeId);
  await form.getByRole("combobox", { name: /^Posición/ })
    .selectOption(choice.stand ? { value: choice.stand.standId } : { label: "Sin posición" });
  await form.getByLabel("Llega a la posición en (minutos)").fill(String(choice.minutes));
  await form.getByLabel("Tiempo en tierra (minutos)").fill(String(choice.groundMinutes));
  await snap(superadminPage, "demo-superadmin-disparar");
  await form.getByRole("button", { name: "Disparar vuelo demo" }).click();
  let created: DemoFlight | undefined;
  await expect.poll(async () => {
    created = (await demoList(token)).list.flights.find(item => !before.has(item.id));
    return created?.id ?? null;
  }, { message: "the trigger created a demo flight", timeout: 30_000 }).not.toBeNull();
  triggered.add(created!.id);
  await expect(form.getByRole("status"))
    .toContainText(`Vuelo demo ${created!.arrivalFlightNumber} / ${created!.departureFlightNumber} creado.`);
  return created!;
}

/** The flight's turnaround in OCC's planning of the day, once the poll found it with the leg time it waits for. */
async function pollTurnaround(leg: "arrival" | "departure", message: string, timeout: number) {
  let found: PlanningTurnaround | undefined;
  await expect.poll(async () => {
    found = await findTurnaround(station, flight!.arrivalFlightNumber, day);
    return found?.[leg]?.actualAt ?? null;
  }, { message, timeout, intervals: [2_000, 5_000, 10_000] }).not.toBeNull();
  return found!;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }, testInfo) => {
  const health = await fetch(`${API}/health`).catch(() => null);
  test.skip(!health?.ok, "The local stack is not running.");
  const superadmin = await login("superadmin");
  const options = await demoOptions(superadmin);
  test.skip(!options.enabled, "Los vuelos demo están apagados en este stack (DemoFlights:Mode).");
  expect(options.stations.find(item => item.id === options.stationId)?.code, "the demo flights default to PUJ").toBe("PUJ");
  station = options.stationId!;
  day = options.operationDate!;
  // A rerun after a failure finds flights an earlier attempt left in the air: three active ones block the trigger.
  await endUnimported(superadmin, true);
  const { limits } = await demoOptions(superadmin);
  test.skip(limits.active >= limits.maxActive, `Ya hay ${limits.active} vuelos demo activos en PUJ, importados por ` +
    `OCC, y el límite es ${limits.maxActive}: espere a que terminen.`);
  const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 };
  superadminContext = await browser.newContext({ viewport });
  occContext = await browser.newContext({ viewport });
  superadminPage = await superadminContext.newPage();
  occPage = await occContext.newPage();
  await loginPrivate(superadminPage, "superadmin");
  await loginPrivate(occPage, "occ");
});

test.afterAll(async () => {
  try {
    if (triggered.size > 0) await endUnimported(await login("superadmin"), false);
  } catch {
    // The stack went away: nothing is left to end.
  }
  for (const page of [superadminPage, occPage]) if (page) await page.unrouteAll({ behavior: "ignoreErrors" });
  await superadminContext?.close();
  await occContext?.close();
});

test("Superadmin dispara un vuelo demo hacia una posición libre de la Terminal A", async () => {
  const superadmin = await login("superadmin");
  const options = await demoOptions(superadmin);
  const airline = options.airlines.find(item => item.iataCode === "ZZ");
  expect(airline, "Demo Airlines (ZZ) has exactly one contract in force today at PUJ").toBeTruthy();
  const type = options.aircraftTypes.find(item => item.icaoCode === "A320");
  expect(type, "the seeded A320 is active").toBeTruthy();
  expect(options.airports.map(item => item.iataCode)).toContain("MIA");
  const terminalA = options.stands.filter(item => item.terminalCode === "A" && item.free);
  stand = SEEDED_TERMINAL_A.map(code => terminalA.find(item => item.code === code)).find(Boolean) ?? terminalA[0];
  expect(stand, "a stand of Terminal A, where the seeded agent works, is free for the visit").toBeTruthy();
  airlineId = airline!.id;
  aircraftTypeId = type!.id;

  await openModule(superadminPage, "Configuración");
  await expect(demoPanel().getByText("Disponible en este entorno")).toBeVisible();
  flight = await trigger(superadmin, { stand: stand!, minutes: 2, groundMinutes: 20 });
  // The server owns the clock: 2 minutes to the stand leave 90 s of taxi (the minimum), so the wheels touch the
  // runway 30 s after the trigger, and the departure is scheduled 20 minutes after the on-block.
  expect([flight.state, flight.imported, flight.suggestedStandCode]).toEqual(["Active", false, stand!.code]);
  expect(ms(flight.onBlockAt) - ms(flight.appearAt)).toBe(2 * MINUTE);
  expect(ms(flight.onBlockAt) - ms(flight.touchdownAt)).toBe(90_000);
  expect(ms(flight.scheduledOffBlockAt) - ms(flight.onBlockAt)).toBe(20 * MINUTE);
  await expect(demoRow(flight)).toContainText(`OCC aún no lo importa · Posición sugerida ${stand!.code}`);
  await snap(superadminPage, "demo-superadmin-vuelo-creado");

  // OCC's review already lists both legs, marked as demo: the arrival with the stand as its gate, its departure and the
  // aircraft type its model names.
  const proposals = await occFeed(await login("occ"), "Contracted");
  const arrival = proposals.find(item => item.direction === "Arrival" && item.flightNumber === flight!.arrivalFlightNumber);
  const departure = proposals.find(item => item.direction === "Departure" &&
    item.flightNumber === flight!.departureFlightNumber);
  expect([arrival?.isDemo, departure?.isDemo, arrival?.status, arrival?.gate]).toEqual([true, true, "Proposed", stand!.code]);
  expect([arrival?.suggestedDepartureId, arrival?.suggestedAircraftTypeId]).toEqual([departure?.proposalId, aircraftTypeId]);
  departureProposalId = departure!.proposalId;
});

test("OCC ve el vuelo demo con «Demo» y su posición preseleccionada y lo importa sin pulsar «Actualizar ahora»", async () => {
  await goPrivate(occPage, "/admin-occ/planning");
  await occPage.getByLabel("Fecha operativa", { exact: true }).first().fill(day);
  await occPage.getByRole("button", { name: "Importar vuelos" }).click();
  const dialog = occPage.getByRole("dialog", { name: "Importar vuelos del proveedor" });
  await expect(dialog.getByText("Cargando vuelos propuestos…")).toBeHidden();
  // Opening the dialog only reads what is stored, and the demo flight needs no provider read: «Actualizar ahora», which
  // spends paid units where AeroDataBox is configured, is never pressed.
  const row = dialog.getByRole("list", { name: "Llegadas propuestas" }).getByRole("listitem")
    .filter({ hasText: flight!.arrivalFlightNumber }).filter({ hasText: "desde MIA" });
  // The badge, not the airline's name («Demo Airlines»).
  await expect(row.getByText("Demo", { exact: true })).toBeVisible();
  await expect(row.getByRole("combobox", { name: /^Sale como/ })).toHaveValue(departureProposalId);
  await expect(row.getByRole("combobox", { name: /^Tipo de avión \(sugerido\)/ })).toHaveValue(aircraftTypeId);
  // The stand of the demo gate is preselected, compared as the API compares stand codes (A01 is A1).
  await expect(row.getByRole("combobox", { name: /^Posición \(sugerida\)/ })).toHaveValue(stand!.standId);
  await snap(occPage, "demo-occ-importar");
  await row.getByRole("button", { name: "Importar escala" }).click();
  const imported = dialog.getByRole("status").filter({ hasText: /^Escala importada \([A-Z]{3}-\d{8}-\d{3,}\)/ });
  await expect(imported).toBeVisible();
  operationCode = /\(([A-Z]{3}-\d{8}-\d{3,})\)/.exec(await imported.innerText())![1];
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(occPage.getByTestId("flight-card").filter({ hasText: operationCode })
    .getByText("Demo", { exact: true })).toBeVisible();
  await snap(occPage, "demo-occ-importado");

  // A real turnaround of Demo Airlines, marked as demo, on the trigger's stand with its aircraft type.
  const turnaround = await findTurnaround(station, flight!.arrivalFlightNumber, day);
  expect(turnaround, "the import created the turnaround").toBeTruthy();
  expect([turnaround!.operationCode, turnaround!.isDemo, turnaround!.stand?.code, turnaround!.aircraft?.icaoCode,
    turnaround!.operation?.status]).toEqual([operationCode, true, stand!.code, "A320", "Planned"]);
  turnaroundId = turnaround!.id;
  type Board = { positions: Array<{ code: string; turnarounds: Array<{ turnaroundId: string; isDemo?: boolean }> }> };
  const board = await expectCall<Board>(200, await login("occ"), "GET", `/occ/positions?stationId=${station}&date=${day}`);
  expect(board.data.positions.find(item => item.code === stand!.code)?.turnarounds
    .find(item => item.turnaroundId === turnaroundId)?.isDemo, "the positions board marks the demo flight").toBe(true);
  // The Superadmin's list follows OCC's side of the flight (it is read every 5 to 20 seconds).
  await expect(demoRow(flight!)).toContainText(`Importado por OCC · ${operationCode} · Posición ${stand!.code}`,
    { timeout: 45_000 });
  await snap(superadminPage, "demo-superadmin-importado");
});

test("OCC asigna el vuelo demo al agente de rampa dentro de su turno", async () => {
  // The agent needs a shift of the flight's day in the stand's terminal: programmed, or widened, when it lacks one.
  const agent = await ensureAgentShiftToday(await login("occ"), turnaroundId);
  expect(agent.eligibilityReasons, "the seeded agent can take the demo flight").toEqual([]);
  await openPlanningFlight(occPage, operationCode);
  const form = occPage.getByRole("form", { name: "Asignación de operación" });
  await expect(form).toBeVisible();
  const choice = form.locator("label").filter({ hasText: RAMP_AGENT });
  await expect(choice, "the agent with today's shift is eligible").toContainText("Elegible");
  await choice.getByRole("radio").check();
  await snap(occPage, "demo-occ-asignacion");
  await form.getByRole("button", { name: "Asignar operación" }).click();
  await expect(occPage.getByText(`Operación asignada a ${RAMP_AGENT}.`)).toBeVisible();
  const { operation } = await tabletOperation(await tablet(), turnaroundId);
  expect(operation.status).toBe("Assigned");
  operationId = operation.id;
});

test("El avión demo aterriza, la tablet marca BLOCK_ON y PUSHBACK y el vuelo despega", async () => {
  test.setTimeout(10 * MINUTE);
  const superadmin = await login("superadmin");
  // Once the pair is imported the worker (every 5 s) stamps the landing: the leg's actual time is the planned touchdown.
  const landed = await pollTurnaround("arrival", "the worker stamps the landing", 90_000);
  expect(ms(landed.arrival!.actualAt!)).toBe(ms(flight!.touchdownAt));

  const device = await tablet();
  await device.send(200, "POST", `/ramp/operations/${operationId}/start`);
  // The tablet records past times only, on the server's clock: the block-on when the aircraft parked and, at least a
  // minute later, a push-back half a minute ago.
  const { offset } = await demoList(superadmin);
  const serverNow = () => Date.now() + offset;
  await expect.poll(serverNow, { message: "the aircraft is on its stand", timeout: 3 * MINUTE })
    .toBeGreaterThan(ms(flight!.onBlockAt) + 90_000);
  const pushbackAt = new Date(serverNow() - 30_000).toISOString();
  await device.send(200, "PUT", `/ramp/operations/${operationId}/milestones/BLOCK_ON`, { occurredAt: flight!.onBlockAt });
  await device.send(200, "PUT", `/ramp/operations/${operationId}/milestones/PUSHBACK`, { occurredAt: pushbackAt });

  // The push-back decides the off-block; the lift-off follows 5 minutes of taxi later.
  const leaving = await demoFlight(superadmin, flight!.id);
  expect(leaving.phase).toBe("TaxiOut");
  expect(Math.abs(ms(leaving.offBlockAt!) - ms(pushbackAt))).toBeLessThan(1_000);
  expect(ms(leaving.takeoffAt!) - ms(leaving.offBlockAt!)).toBe(5 * MINUTE);
  const row = demoRow(flight!);
  await expect(row).toContainText("Saliendo", { timeout: 60_000 });
  await snap(superadminPage, "demo-superadmin-saliendo");

  // The worker stamps the take-off on the departure leg at that instant; a marked take-off finishes the demo flight.
  const departed = await pollTurnaround("departure", "the worker stamps the take-off", 7 * MINUTE);
  expect(ms(departed.departure!.actualAt!)).toBe(ms(leaving.takeoffAt!));
  await expect(row).toContainText(/Despegó|Terminado/, { timeout: 60_000 });
  await snap(superadminPage, "demo-superadmin-despego");
  expect((await demoFlight(superadmin, flight!.id)).state).toBe("Finished");
});

test("Un segundo vuelo demo se cancela antes de tocar pista y sale de los vuelos propuestos", async () => {
  const superadmin = await login("superadmin");
  const second = await trigger(superadmin, { stand: null, minutes: 15, groundMinutes: 20 });
  expect([second.state, second.suggestedStandCode ?? null]).toEqual(["Active", null]);
  const row = demoRow(second);
  await expect(row).toContainText("En aproximación");
  await row.getByRole("button", { name: "Cancelar vuelo" }).click();
  const confirm = superadminPage.getByRole("alertdialog", { name: "Cancelar vuelo demo" });
  await expect(confirm).toContainText(`El vuelo ${second.arrivalFlightNumber} saldrá de los vuelos propuestos de OCC.`);
  await snap(superadminPage, "demo-superadmin-cancelar");
  await confirm.getByRole("button", { name: "Cancelar vuelo" }).click();
  await expect(demoPanel().getByRole("status").filter({
    hasText: `Vuelo demo ${second.arrivalFlightNumber} / ${second.departureFlightNumber} cancelado.` })).toBeVisible();
  await expect(row).toContainText("Cancelado");
  await snap(superadminPage, "demo-superadmin-cancelado");
  expect((await demoFlight(superadmin, second.id)).state).toBe("Cancelled");

  // Cancelled before anyone imported it, as a provider would: both legs leave OCC's review and never come back.
  const occ = await login("occ");
  const numbers = [second.arrivalFlightNumber, second.departureFlightNumber];
  expect((await occFeed(occ, "Contracted")).filter(item => numbers.includes(item.flightNumber))).toEqual([]);
  const dismissed = (await occFeed(occ, "Dismissed")).find(item => item.flightNumber === second.arrivalFlightNumber);
  expect(dismissed?.isDemo, "the cancelled arrival is in «Descartadas»").toBe(true);
  const restored = await call<Problem>(occ, "POST", `/occ/flight-feed/proposals/${dismissed!.proposalId}/restore`,
    { expectedVersion: dismissed!.version });
  expect([restored.status, restored.data.code]).toEqual([409, "flight_proposal_passed"]);
});

test("Limpieza · el agente entrega la operación demo sin servicios y OCC libera la posición", async () => {
  // The push-back does not free the stand yet (PR A2 brings that rule): the hand-off frees the agent, and OCC releases
  // the stand that the operation holds until its review.
  await handOffUnperformed(await tablet(), turnaroundId);
  const occ = await login("occ");
  const read = await expectCall<PlanningDetail>(200, occ, "GET", `/occ/planning/turnarounds/${turnaroundId}`);
  expect([read.data.turnaround.operation?.status, read.data.turnaround.stand?.code]).toEqual(["PendingReview", stand!.code]);
  await expectCall(200, occ, "POST", `/occ/turnarounds/${turnaroundId}/stand/release`, undefined,
    { "idempotency-key": crypto.randomUUID(), "if-match": read.etag ?? "" });
  const released = await expectCall<PlanningDetail>(200, occ, "GET", `/occ/planning/turnarounds/${turnaroundId}`);
  expect(released.data.turnaround.stand ?? null).toBeNull();
});
