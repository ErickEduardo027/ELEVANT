import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
import { goPrivate, loginPrivate, openModule, snap } from "./support/browser";
import { API } from "./support/env";
import {
  type CoverageBoard, coverageBoard, ensureAgentShiftNow, ensureAgentShiftToday, findTurnaround, handOffUnperformed,
  openPlanningFlight, type PlanningDetail, type PlanningTurnaround, RAMP_AGENT, tablet, tabletOperation,
} from "./support/operations";

// Vuelo demo (ADR-0041, PRs A1 and A2 of «OCC a nivel NOC»). The Superadmin loads the Punta Cana stands from
// «Configuración», and OCC covers one stand of Terminal A with the seeded ramp agent for the day. The Superadmin then
// triggers, with «Al azar», a demo flight of the seeded airline «Demo Airlines» (ZZ, with its seeded contract): the
// server draws the covered stand, the only one an eligible agent covers. OCC sees the flight in «Importar vuelos» marked
// «Demo», with that stand already chosen, and imports it without asking the provider for a read; it assigns the agent;
// the progress worker stamps the landing, the tablet records BLOCK_ON and PUSHBACK, the positions board frees the stand at
// the push-back while the flight keeps it as its stand of record, the worker stamps the take-off and the Superadmin's
// list follows each phase. A second flight is cancelled before touchdown and leaves OCC's review. It needs no run of the
// cycle (fase 1 to 4):
//   npx playwright test --config playwright.cycle.config.ts --project=demo

type DemoStand = {
  standId: string; code: string; terminalCode: string; located: boolean; free: boolean; coveredBy: string[];
  eligibleAgents: number; eligible: boolean; reasons: string[];
};
/** The station against the Punta Cana catalogue, as the card «Posiciones de Punta Cana» shows it. */
type DemoLayout = {
  supported: boolean; catalogTerminals: number; terminals: number; catalogStands: number; stands: number;
  activeStands: number; locatedStands: number; missingStands: string[]; unmatchedStands: string[]; complete: boolean;
};
type DemoOptions = {
  enabled: boolean; stationId: string | null; operationDate: string | null;
  stations: Array<{ id: string; code: string }>;
  airlines: Array<{ id: string; name: string; iataCode: string | null }>;
  airports: Array<{ iataCode: string }>;
  aircraftTypes: Array<{ id: string; icaoCode: string }>;
  stands: DemoStand[];
  limits: { maxActive: number; active: number };
  warnings: Array<{ code: string; reasons: string[] }>;
  layout: DemoLayout | null;
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
/** GET /occ/positions: each stand with its status and the flights it holds, and the flights without a stand. */
type PositionBoard = {
  positions: Array<{ code: string; status: string; turnarounds: Array<{ turnaroundId: string; isDemo?: boolean }> }>;
  unassigned: Array<{ turnaroundId: string }>;
};
type Problem = { code?: string };

const MINUTE = 60_000;
/** The visit of the walkthrough's flight: the shortest of the form, 2 minutes to its stand and 20 on the ground. */
const VISIT = { minutes: 2, groundMinutes: 20 };
/** The stands of the Punta Cana catalogue: the owner's coordinate document without B33, which the AIP retired. */
const CATALOGUE_STANDS = 41;
/** The values of «Al azar» and «Sin posición» in the field «Posición»; any other value is a stand's id. */
const RANDOM_STAND = "random";
const NO_STAND = "none";
/** An API instant in milliseconds; the engines differ beyond milliseconds. */
const ms = (value: string) => Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
/** A stand code as the API compares them (StandCodes.Normalize): A01, a-1 and A1 are one stand. */
const standCode = (code: string) =>
  code.toUpperCase().replace(/[\s.-]/g, "").replace(/^([A-Z]*)0*(\d+)([A-Z]*)$/, "$1$2$3");

// What one step leaves for the next: the walkthrough is serial and each step needs the previous one.
let station = "";
let day = "";
let airlineId = "";
let aircraftTypeId = "";
/** The stand OCC covered with the agent, the only eligible one; the draw gives it to the flight. */
let covered: DemoStand | undefined;
/** The coverage the walkthrough created; it is released at the end, even after a failure. */
let coverageId = "";
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

/**
 * What «Disparar vuelo demo» offers. Without `forVisit`, the stands are evaluated for the server's default visit (8 and
 * 60 minutes, any aircraft); with it, for the walkthrough's flight (`VISIT` and the seeded A320), as the panel reads them
 * once its form has those values.
 */
async function demoOptions(token: string, forVisit = false) {
  const query = forVisit ? `?stationId=${station}&aircraftTypeId=${aircraftTypeId}&minutesToOnBlock=${VISIT.minutes}` +
    `&groundMinutes=${VISIT.groundMinutes}` : "";
  return (await expectCall<DemoOptions>(200, token, "GET", `/governance/demo-flights/options${query}`)).data;
}

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

/** Releases a coverage of the walkthrough's day; the answer is the coverage board as it is then. */
const releaseCoverage = async (occ: string, id: string) =>
  (await expectCall<CoverageBoard>(200, occ, "POST", `/occ/coverage/${id}/release?date=${day}`)).data;

/** OCC's review of the provider's flights of the day: what «Importar vuelos» lists, by view. */
const occFeed = async (token: string, view: "Contracted" | "Dismissed") =>
  (await expectCall<{ proposals: Proposal[] }>(200, token, "GET",
    `/occ/flight-feed?stationId=${station}&date=${day}&view=${view}`)).data.proposals;

/** The panel «Vuelo demo» of the Superadmin's «Configuración». */
const demoPanel = () => superadminPage.getByRole("region", { name: "Vuelo demo", exact: true });

/** The card «Posiciones de Punta Cana» of the panel. */
const standsCard = () => demoPanel().getByRole("region", { name: "Posiciones de Punta Cana", exact: true });

/** A flight's row in «Vuelos demo de hoy» (the newest one with those numbers). */
const demoRow = (item: DemoFlight) => demoPanel().getByRole("list", { name: "Vuelos demo de hoy" }).getByRole("listitem")
  .filter({ hasText: `${item.arrivalFlightNumber} / ${item.departureFlightNumber}` }).first();

/**
 * Puts «Configuración» back on the Superadmin page. Under `next dev`, the first visit to a route that the dev server has
 * not compiled yet reloads every open page of the app (Fast Refresh rebuilds it), and the Superadmin shell opens again
 * on «Inicio»; a production build never does this. The session lives in sessionStorage, so the tab is still signed in.
 */
async function showDemoPanel() {
  if (!(await demoPanel().isVisible())) await openModule(superadminPage, "Configuración");
  await expect(demoPanel()).toBeVisible();
}

/** Waits until a flight's row in «Vuelos demo de hoy» says `text`, reopening the panel if a dev reload closed it. */
async function expectDemoRow(item: DemoFlight, text: string | RegExp, timeout = 15_000) {
  await expect(async () => {
    await showDemoPanel();
    await expect(demoRow(item)).toContainText(text, { timeout: 5_000 });
  }).toPass({ timeout });
}

/**
 * «Disparar vuelo demo»: Demo Airlines from Miami and back, the seeded A320, the minutes and the stand: «Al azar»
 * (`"random"`), a stand or «Sin posición» (`null`). Returns the new flight as the API lists it, once the panel announced
 * it.
 */
async function trigger(token: string,
  choice: { stand: DemoStand | typeof RANDOM_STAND | null; minutes: number; groundMinutes: number }) {
  const before = new Set((await demoList(token)).list.flights.map(item => item.id));
  await showDemoPanel();
  const form = demoPanel().getByRole("form", { name: "Disparar vuelo demo" });
  // A select inside its label is named by the label and the chosen option, hence the anchored names.
  await form.getByRole("combobox", { name: /^Aerolínea/ }).selectOption(airlineId);
  await form.getByRole("combobox", { name: /^Origen/ }).selectOption("MIA");
  await form.getByRole("combobox", { name: /^Destino de la salida/ }).selectOption({ label: "El mismo aeropuerto" });
  await form.getByRole("combobox", { name: /^Tipo de avión/ }).selectOption(aircraftTypeId);
  await form.getByLabel("Llega a la posición en (minutos)").fill(String(choice.minutes));
  await form.getByLabel("Tiempo en tierra (minutos)").fill(String(choice.groundMinutes));
  // The stand goes last: the panel reads the stands again for the aircraft type and the minutes of the form, and offers
  // «Al azar», or a stand, only while one is eligible for that visit. Playwright waits for the option to be enabled.
  const field = form.getByRole("combobox", { name: /^Posición/ });
  const value = choice.stand === RANDOM_STAND ? RANDOM_STAND : choice.stand?.standId ?? NO_STAND;
  await field.selectOption(choice.stand === RANDOM_STAND ? { label: "Al azar" }
    : choice.stand ? { value } : { label: "Sin posición" });
  await expect(field).toHaveValue(value);
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
  // OCC first, with the one OCC screen the spec opens later: under `next dev` compiling a route reloads every open
  // page, so it happens now, before the Superadmin's panel is on screen (showDemoPanel covers what is left).
  await loginPrivate(occPage, "occ");
  await goPrivate(occPage, "/admin-occ/planning");
  await loginPrivate(superadminPage, "superadmin");
});

test.afterAll(async () => {
  try {
    if (triggered.size > 0) await endUnimported(await login("superadmin"), false);
  } catch {
    // The stack went away: nothing is left to end.
  }
  try {
    // A walkthrough that stopped early would leave the agent covering its stand for the rest of the shift.
    if (coverageId) await releaseCoverage(await login("occ"), coverageId);
  } catch {
    // The stack went away, or the coverage was already released.
  }
  for (const page of [superadminPage, occPage]) if (page) await page.unrouteAll({ behavior: "ignoreErrors" });
  await superadminContext?.close();
  await occContext?.close();
});

test("Superadmin carga las posiciones de Punta Cana", async () => {
  // «Cargar posiciones» only creates what the station lacks, without coordinates (ADR-0041): on the seed, the FBO
  // terminal and 39 stands, adopting A01 and A02 as the catalogue's A1 and A2. A stack that already has them shows the
  // card complete, without the button.
  await showDemoPanel();
  const load = standsCard().getByRole("button", { name: "Cargar posiciones", exact: true });
  const loaded = standsCard()
    .getByText(`Las terminales y las ${CATALOGUE_STANDS} posiciones de Punta Cana ya están cargadas.`);
  await expect(load.or(loaded).first()).toBeVisible();
  if (await load.isVisible()) {
    await snap(superadminPage, "demo-superadmin-posiciones-por-cargar");
    await load.click();
    await expect(standsCard().getByRole("status")).toHaveText("Se cargaron las posiciones de Punta Cana.");
  }
  // The answer is the station as it is afterwards: complete, so the card offers no button any more.
  await expect(async () => {
    await showDemoPanel();
    await expect(loaded).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(standsCard())
    .toContainText(`Terminales: 3 de 3 · Posiciones: ${CATALOGUE_STANDS} de ${CATALOGUE_STANDS}`);
  await expect(load).toHaveCount(0);
  await snap(superadminPage, "demo-superadmin-posiciones-cargadas");

  // The API says the same, and the map locates A1 (the seed's A01) by its code: the catalogue has it.
  const { layout, stands } = await demoOptions(await login("superadmin"));
  expect([layout?.supported, layout?.complete, layout?.terminals, layout?.stands])
    .toEqual([true, true, 3, CATALOGUE_STANDS]);
  expect(stands.find(item => standCode(item.code) === "A1")?.located, "the catalogue locates A1").toBe(true);
});

test("OCC cubre hoy una posición de la Terminal A con el agente de rampa", async () => {
  // «Al azar» draws among the stands an eligible agent covers when the aircraft parks (owner decision 22): the seeded
  // agent needs a shift around now, in Terminal A, and OCC hands it one stand.
  const agent = await ensureAgentShiftNow(station, day);
  const occ = await login("occ");
  let board = await coverageBoard(occ, station, day);
  // An agent covers one window at a time, and a coverage an earlier attempt left would make a second stand eligible.
  for (const earlier of board.coverages.filter(item => item.agentId === agent.agentId))
    board = await releaseCoverage(occ, earlier.id);

  const superadmin = await login("superadmin");
  const type = (await demoOptions(superadmin)).aircraftTypes.find(item => item.icaoCode === "A320");
  expect(type, "the seeded A320 is active").toBeTruthy();
  aircraftTypeId = type!.id;
  // The first stand of Terminal A, as people count them, that the map locates and that is free for the visit, without a
  // boarding bridge (no qualification is asked for) and that nobody covers.
  const target = (await demoOptions(superadmin, true)).stands.find(item => item.terminalCode === "A" && item.located &&
    item.free && board.stands.some(row => row.standId === item.standId && row.isActive && !row.hasBoardingBridge &&
      row.coveredBy.length === 0));
  expect(target, "Terminal A has a located stand without a bridge, free for the visit and not covered").toBeTruthy();
  const terminal = board.terminals.find(item => item.code === "A");
  expect(terminal, "the coverage board lists Terminal A").toBeTruthy();
  // Without times, the coverage takes the agent's shift of the day.
  board = (await expectCall<CoverageBoard>(200, occ, "POST", "/occ/coverage", {
    stationId: station, date: day, agentId: agent.agentId, terminalId: terminal!.terminalId, standIds: [target!.standId],
    startsAt: null, endsAt: null, mentorAgentId: null, vehicleCode: null, isReinforcement: false,
  })).data;
  coverageId = board.coverages.find(item => item.agentId === agent.agentId &&
    item.stands.some(row => row.standId === target!.standId))?.id ?? "";
  expect(coverageId, "the board lists the new coverage").not.toBe("");

  // For the walkthrough's visit the covered stand is now the one eligible stand, and it says who covers it.
  const options = await demoOptions(superadmin, true);
  const eligible = options.stands.filter(item => item.eligible);
  expect(eligible.map(item => item.code), "the covered stand is the only one an eligible agent covers")
    .toEqual([target!.code]);
  expect([eligible[0].coveredBy, eligible[0].eligibleAgents]).toEqual([[RAMP_AGENT], 1]);
  expect(options.warnings.map(item => item.code)).not.toContain("no_eligible_stand");
  covered = eligible[0];
});

test("Superadmin dispara un vuelo demo «Al azar» y el servidor sortea la posición cubierta", async () => {
  const superadmin = await login("superadmin");
  const options = await demoOptions(superadmin);
  const airline = options.airlines.find(item => item.iataCode === "ZZ");
  expect(airline, "Demo Airlines (ZZ) has exactly one contract in force today at PUJ").toBeTruthy();
  expect(options.airports.map(item => item.iataCode)).toContain("MIA");
  airlineId = airline!.id;

  await showDemoPanel();
  // Exact: the badge of a stack where they are off, «No disponible en este entorno», contains these words too.
  await expect(demoPanel().getByText("Disponible en este entorno", { exact: true })).toBeVisible();
  flight = await trigger(superadmin, { stand: RANDOM_STAND, ...VISIT });
  // The server drew the stand among the eligible ones, with the Idempotency-Key as the seed: the covered one.
  expect([flight.state, flight.imported, flight.suggestedStandCode]).toEqual(["Active", false, covered!.code]);
  stand = covered;
  // The server owns the clock: 2 minutes to the stand leave 90 s of taxi (the minimum), so the wheels touch the
  // runway 30 s after the trigger, and the departure is scheduled 20 minutes after the on-block.
  expect(ms(flight.onBlockAt) - ms(flight.appearAt)).toBe(VISIT.minutes * MINUTE);
  expect(ms(flight.onBlockAt) - ms(flight.touchdownAt)).toBe(90_000);
  expect(ms(flight.scheduledOffBlockAt) - ms(flight.onBlockAt)).toBe(VISIT.groundMinutes * MINUTE);
  await expectDemoRow(flight, `OCC aún no lo importa · Posición sugerida ${stand!.code}`);
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
  // The drawn stand is preselected, compared as the API compares stand codes (A01 is A1).
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

  // A real turnaround of Demo Airlines, marked as demo, on the drawn stand with its aircraft type.
  const turnaround = await findTurnaround(station, flight!.arrivalFlightNumber, day);
  expect(turnaround, "the import created the turnaround").toBeTruthy();
  expect([turnaround!.operationCode, turnaround!.isDemo, turnaround!.stand?.code, turnaround!.aircraft?.icaoCode,
    turnaround!.operation?.status]).toEqual([operationCode, true, stand!.code, "A320", "Planned"]);
  turnaroundId = turnaround!.id;
  const board = await expectCall<PositionBoard>(200, await login("occ"), "GET",
    `/occ/positions?stationId=${station}&date=${day}`);
  expect(board.data.positions.find(item => item.code === stand!.code)?.turnarounds
    .find(item => item.turnaroundId === turnaroundId)?.isDemo, "the positions board marks the demo flight").toBe(true);
  // The Superadmin's list follows OCC's side of the flight (it is read every 5 to 20 seconds).
  await expectDemoRow(flight!, `Importado por OCC · ${operationCode} · Posición ${stand!.code}`, 45_000);
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

test("El avión demo aterriza, la tablet marca BLOCK_ON y PUSHBACK, la posición queda libre y el vuelo despega", async () => {
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
  await expectDemoRow(flight!, "Saliendo", 60_000);
  await snap(superadminPage, "demo-superadmin-saliendo");

  // Owner decision 23: the aircraft that pushed back left its stand, so the positions board frees it at once (free, or
  // holding its next planned flight) and lists the flight neither on it nor among the flights without a stand. The stand
  // assignment stays open as the flight's stand of record: OCC's planning and the agent's tablet still name the stand.
  const occ = await login("occ");
  let position: PositionBoard["positions"][number] | undefined;
  await expect.poll(async () => {
    const board = (await expectCall<PositionBoard>(200, occ, "GET", `/occ/positions?stationId=${station}&date=${day}`)).data;
    position = board.positions.find(item => item.code === stand!.code);
    return {
      onStand: position ? position.turnarounds.some(item => item.turnaroundId === turnaroundId) : null,
      unassigned: board.unassigned.some(item => item.turnaroundId === turnaroundId),
    };
  }, { message: "the positions board frees the stand at the push-back", timeout: 30_000 })
    .toEqual({ onStand: false, unassigned: false });
  if (position!.turnarounds.length === 0) expect(position!.status, "a stand without flights is free").toBe("available");
  const planning = await expectCall<PlanningDetail>(200, occ, "GET", `/occ/planning/turnarounds/${turnaroundId}`);
  expect([planning.data.turnaround.operation?.status, planning.data.turnaround.stand?.code],
    "OCC's planning still names the flight's stand").toEqual(["InProgress", stand!.code]);
  expect((await tabletOperation(device, turnaroundId)).turnaround.stand?.code, "the tablet still names the stand")
    .toBe(stand!.code);

  // The worker stamps the take-off on the departure leg at that instant; a marked take-off finishes the demo flight.
  const departed = await pollTurnaround("departure", "the worker stamps the take-off", 7 * MINUTE);
  expect(ms(departed.departure!.actualAt!)).toBe(ms(leaving.takeoffAt!));
  await expectDemoRow(flight!, /Despegó|Terminado/, 60_000);
  await snap(superadminPage, "demo-superadmin-despego");
  expect((await demoFlight(superadmin, flight!.id)).state).toBe("Finished");
});

test("Un segundo vuelo demo se cancela antes de tocar pista y sale de los vuelos propuestos", async () => {
  const superadmin = await login("superadmin");
  const second = await trigger(superadmin, { stand: null, minutes: 15, groundMinutes: 20 });
  expect([second.state, second.suggestedStandCode ?? null]).toEqual(["Active", null]);
  await expectDemoRow(second, "En aproximación");
  const row = demoRow(second);
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

test("Limpieza · el agente entrega la operación demo sin servicios y OCC libera la cobertura", async () => {
  // The push-back already freed the stand (owner decision 23): OCC presses no «Liberar», and the operation takes its
  // stand of record into the review. The hand-off frees the agent, and OCC releases the walkthrough's coverage.
  await handOffUnperformed(await tablet(), turnaroundId);
  const occ = await login("occ");
  const read = await expectCall<PlanningDetail>(200, occ, "GET", `/occ/planning/turnarounds/${turnaroundId}`);
  expect([read.data.turnaround.operation?.status, read.data.turnaround.stand?.code]).toEqual(["PendingReview", stand!.code]);
  const board = await releaseCoverage(occ, coverageId);
  expect(board.coverages.some(item => item.id === coverageId), "the walkthrough's coverage is released").toBe(false);
  coverageId = "";
});
