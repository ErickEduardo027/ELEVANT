import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { call, expectCall, login } from "./api";
import { goPrivate } from "./browser";
import { loadRun, STATE_DIR } from "./env";

/**
 * What the cycle steps do with a flight once it exists (ADR-0037): OCC's planning snapshot and assignment, today's
 * shift of the seeded ramp agent, OCC's position coverage and the tablet as the APK uses the API. The demo flight
 * walkthrough (ADR-0041) uses them; fase 3 still keeps its own copies of the first ones, which move here once that
 * phase can be run again.
 */

/** The seeded ramp agent (DEV-RA-001), scoped to Terminal A of PUJ. */
export const RAMP_AGENT = "Riley Ramp";

const MINUTE = 60_000;
/** AVIAM's stations keep the calendar of Santo Domingo: UTC−4 all year, without DST. */
const STATION_ZONE = "America/Santo_Domingo";
/** The tablet this harness registers when no cycle run left one (E2E_CYCLE_STATE_DIR). */
const OWN_TABLET_FILE = "tablet.json";
/**
 * How long from now the agent's shift lasts at least when it is checked before any flight exists: a demo flight of the
 * shortest visit (2 minutes to its stand and 20 on the ground) is triggered, imported and assigned within it.
 */
const SHIFT_AHEAD = 45 * MINUTE;
/** The longest shift Gestión Humana accepts (ShiftAdjustmentRules.MaxDuration), in minutes. */
const MAX_SHIFT_MINUTES = 16 * 60;

export type Leg = { id: string; flightNumber: string; scheduledAt: string; estimatedAt: string | null; actualAt: string | null };
export type PlanningTurnaround = {
  id: string; operationCode: string; operationDate: string; status: string; arrival: Leg | null; departure: Leg | null;
  operation: { id: string; status: string; plannedStartAt: string | null; plannedEndAt: string | null } | null;
  agents: Array<{ displayName: string; assignmentId?: string; agentId?: string }>;
  stand?: { id: string; code: string; terminal: { code: string } | null } | null;
  aircraft?: { id: string; icaoCode: string } | null;
  /** Present, and true, only for the turnaround of a demo flight (ADR-0041). */
  isDemo?: boolean;
};
/** GET /occ/planning/turnarounds/{id}: the flight, its version (also the ETag) and the changes it allows. */
export type PlanningDetail = { turnaround: PlanningTurnaround; version: string; allowedActions: string[] };
export type AgentOption = { id: string; displayName: string; eligible: boolean; eligibilityReasons: string[] };
export type Device = Awaited<ReturnType<typeof tablet>>;
type Problem = { code?: string; reasons?: string[] };
/** GET /occ/planning/turnarounds/{id}/agents/{agentId}/shift: the agent's shift of the flight's day (3-E). */
type AgentShift = { shiftId: string; startsAtLocal: string; endsAtLocal: string; terminalCode: string; version: string };
/** An agent with a shift of the coverage board's day: the shift's terminal and its instants. */
export type CoverageAgent = { agentId: string; name: string; terminalId: string; terminalCode: string;
  shiftStartsAt: string; shiftEndsAt: string };
/**
 * GET /occ/coverage: OCC's position coverage of a station's day (ADR-0030). The active terminals, the stands with whom
 * the day's coverages name for each, the agents with a shift that day and the coverages not released.
 */
export type CoverageBoard = {
  terminals: Array<{ terminalId: string; code: string }>;
  stands: Array<{ standId: string; code: string; terminalId: string | null; isActive: boolean; hasBoardingBridge: boolean;
    coveredBy: string[] }>;
  agents: CoverageAgent[];
  coverages: Array<{ id: string; agentId: string; agentName: string; stands: Array<{ standId: string; code: string }>;
    startsAt: string; endsAt: string }>;
};

const localDay = () => new Date().toLocaleDateString("en-CA");
/** A day of the station's calendar («yyyy-MM-dd»), as the API's operation dates. */
const stationDay = (instant = new Date()) => instant.toLocaleDateString("en-CA", { timeZone: STATION_ZONE });

/** OCC's planning snapshot of a station's day; by default this machine's day, as the cycle phases read it. */
export async function todaysTurnarounds(station: string, day = localDay()) {
  const token = await login("occ");
  const snapshot = await expectCall<{ turnarounds: PlanningTurnaround[] }>(200, token, "GET",
    `/occ/planning?stationId=${station}&date=${day}`);
  return snapshot.data.turnarounds;
}

export async function findTurnaround(station: string, flightNumber: string, day = localDay()) {
  return (await todaysTurnarounds(station, day)).find(item => item.arrival?.flightNumber === flightNumber);
}

/** Opens a flight of Planificación in its drawer, by the operation code its card shows. */
export async function openPlanningFlight(page: Page, operationCode: string) {
  await goPrivate(page, "/admin-occ/planning");
  const card = page.getByTestId("flight-card").filter({ hasText: operationCode });
  await expect(card).toBeVisible();
  await card.click();
}

/** The seeded agent among the flight's candidates, with the reasons the server gives when it is not eligible. */
export async function agentOption(occ: string, turnaroundId: string) {
  const options = await expectCall<{ agents: AgentOption[] }>(200, occ, "GET",
    `/occ/planning/options?turnaroundId=${turnaroundId}`);
  const agent = options.data.agents.find(item => item.displayName === RAMP_AGENT);
  expect(agent, "the seeded ramp agent is a candidate of the flight").toBeTruthy();
  return { agent: agent!, etag: options.etag };
}

/**
 * OCC assigns the seeded agent through the API with the version of the options it read, under the same rules as the
 * planning screen; the agent's option tells why it is refused.
 */
export async function assignAgent(occ: string, turnaroundId: string) {
  const { agent, etag } = await agentOption(occ, turnaroundId);
  const result = await call<Problem>(occ, "POST", `/occ/planning/turnarounds/${turnaroundId}/assignment`,
    { agentId: agent.id }, { "if-match": etag ?? "" });
  return { agent, status: result.status };
}

/** The shift presets Gestión Humana and OCC share (occShiftPresets.js), in minutes after midnight, as fase 2 uses them. */
const SHIFT_PRESETS = [
  { start: 7 * 60, end: 16 * 60 }, { start: 8 * 60, end: 17 * 60 }, { start: 11 * 60, end: 20 * 60 },
  { start: 12 * 60, end: 21 * 60 }, { start: 15 * 60, end: 24 * 60 }, { start: 23 * 60, end: 32 * 60 },
];

/** Minutes after the station's local midnight of an instant. */
function stationMinutes(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: STATION_ZONE, hour: "2-digit", minute: "2-digit",
    hourCycle: "h23" }).formatToParts(instant);
  const part = (type: string) => Number(parts.find(item => item.type === type)!.value);
  return part("hour") * 60 + part("minute");
}

/** Minutes after midnight of a local clock («HH:mm» or «HH:mm:ss»). */
const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** «HH:mm:00» of minutes after midnight; a shift that ends at or after midnight wraps to the next day. */
function clockOf(minutes: number) {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}:00`;
}

/**
 * The preset that covers now ± 90 minutes in the station's time, the one fase 2 programs (a cycle run later that day
 * keeps it); a shift that ends at midnight goes last.
 */
export function shiftPreset(now = new Date()) {
  const minutes = stationMinutes(now);
  const options = SHIFT_PRESETS.filter(preset => preset.start <= minutes - 90 && preset.end >= minutes + 90);
  options.sort((a, b) => Number(a.end >= 24 * 60) - Number(b.end >= 24 * 60) || b.end - a.end);
  if (!options[0]) throw new Error("No shift preset covers the flight; run the cycle between 08:30 and 22:30.");
  return { startsAtLocal: clockOf(options[0].start), endsAtLocal: clockOf(options[0].end) };
}

/**
 * The seeded agent's shift of the flight's day covers the flight (ADR-0026). When the server finds no compatible
 * shift, OCC programs the shared preset from the flight («Programar turno», in the stand's terminal) or, when the agent
 * already has a shift that day, widens it until it covers the flight («Ajustar turno del día», hueco 3-E). Returns the
 * agent's option as the server evaluates it afterwards.
 */
export async function ensureAgentShiftToday(occ: string, turnaroundId: string) {
  const { agent } = await agentOption(occ, turnaroundId);
  if (agent.eligible || !agent.eligibilityReasons.includes("shift_not_compatible")) return agent;
  const route = `/occ/planning/turnarounds/${turnaroundId}/shift`;
  const programmed = await call<Problem>(occ, "POST", route, { agentId: agent.id, ...shiftPreset() });
  if (programmed.status === 409 && programmed.data.code === "shift_day_taken") await widenShift(occ, turnaroundId, agent.id);
  else if (programmed.status !== 200 && programmed.status !== 201)
    throw new Error(`POST ${route} → HTTP ${programmed.status} ${programmed.data.code ?? ""}`);
  return (await agentOption(occ, turnaroundId)).agent;
}

/** Widens the agent's shift of the flight's day to the flight's planned window, keeping what it already covered. */
async function widenShift(occ: string, turnaroundId: string, agentId: string) {
  const flight = (await expectCall<PlanningDetail>(200, occ, "GET", `/occ/planning/turnarounds/${turnaroundId}`))
    .data.turnaround;
  const shift = (await expectCall<AgentShift>(200, occ, "GET",
    `/occ/planning/turnarounds/${turnaroundId}/agents/${agentId}/shift`)).data;
  expect(shift.terminalCode, "the agent's shift of the day is in the terminal of the flight's stand")
    .toBe(flight.stand?.terminal?.code);
  const [start, end] = [minutesOf(shift.startsAtLocal), minutesOf(shift.endsAtLocal)];
  expect(end > start, "the agent's shift of the day ends before midnight").toBe(true);
  expect(flight.operation?.plannedStartAt && flight.operation.plannedEndAt, "the flight has its planned window").toBeTruthy();
  const from = stationMinutes(new Date(flight.operation!.plannedStartAt!));
  // The end rounded up to the minute: the shift covers the whole window.
  const until = stationMinutes(new Date(Date.parse(flight.operation!.plannedEndAt!) + MINUTE - 1));
  await expectCall(200, occ, "PATCH", `/human-resources/shifts/${shift.shiftId}`, {
    startsAtLocal: clockOf(Math.min(start, from)), endsAtLocal: clockOf(Math.max(end, until)),
    reason: "El agente cubre un vuelo del ciclo E2E.", expectedVersion: shift.version,
  });
}

/** OCC's position coverage of a station's day, as «Cobertura de posiciones» reads it (ADR-0030). */
export async function coverageBoard(occ: string, station: string, day: string) {
  return (await expectCall<CoverageBoard>(200, occ, "GET", `/occ/coverage?stationId=${station}&date=${day}`)).data;
}

/** The agent's shift covers from now until `SHIFT_AHEAD` later. */
const coversAhead = (agent: CoverageAgent, now = Date.now()) =>
  Date.parse(agent.shiftStartsAt) <= now && now + SHIFT_AHEAD <= Date.parse(agent.shiftEndsAt);

/**
 * The seeded agent has a shift of the station's day in Terminal A, where it is scoped, from now until at least
 * `SHIFT_AHEAD` later (ADR-0026). It is checked before any flight exists, on OCC's coverage board, which lists the agents
 * with a shift that day: a stand coverage and the stands a demo flight can be drawn to need it (ADR-0041). Without a
 * shift that day, Gestión Humana programs the shared preset around now in Terminal A; a shift of that day that starts
 * later or ends sooner is widened, keeping what it already covered (3-E) within the 16-hour cap of a shift: its start
 * moves later when needed. Returns the agent as the board lists it then.
 */
export async function ensureAgentShiftNow(station: string, day = stationDay()) {
  const occ = await login("occ");
  const board = await coverageBoard(occ, station, day);
  const current = board.agents.find(item => item.name === RAMP_AGENT);
  if (current) {
    expect(current.terminalCode, "the agent's shift of the day is in Terminal A, where the agent is scoped").toBe("A");
    if (coversAhead(current)) return current;
    await widenShiftToNow(station, day);
  } else {
    await programShiftNow(station, day, board);
  }
  const agent = (await coverageBoard(occ, station, day)).agents.find(item => item.name === RAMP_AGENT);
  expect(agent !== undefined && coversAhead(agent), "the agent's shift of the day covers the next minutes").toBe(true);
  return agent!;
}

/**
 * Gestión Humana programs the agent's shift of the day in Terminal A with the preset that covers now, as fase 2 does
 * from its weekly editor: `PUT /human-resources/shifts/{id}`, whose new id is the intent.
 */
async function programShiftNow(station: string, day: string, board: CoverageBoard) {
  const terminal = board.terminals.find(item => item.code === "A");
  expect(terminal, "the station has an active Terminal A").toBeTruthy();
  const hr = await login("hr");
  type Profiles = { profiles: Array<{ id: string; firstName: string; lastName: string }> };
  const profile = (await expectCall<Profiles>(200, hr, "GET", "/human-resources/ramp-profiles")).data.profiles
    .find(item => `${item.firstName} ${item.lastName}` === RAMP_AGENT);
  expect(profile, "Gestión Humana has the seeded agent's ramp profile").toBeTruthy();
  await expectCall(200, hr, "PUT", `/human-resources/shifts/${crypto.randomUUID()}`, {
    rampProfileId: profile!.id, stationId: station, terminalId: terminal!.terminalId, workDate: day, ...shiftPreset(),
    notes: "Turno del agente para el vuelo demo del ciclo E2E.",
  });
}

/**
 * Gestión Humana widens the agent's shift of the day until it covers from now to `SHIFT_AHEAD` later, keeping what it
 * already covered («Ajustar horario», 3-E). A shift lasts at most 16 hours: when the widened shift would be longer its
 * start moves later (the seeded 06:00–14:00 shift run at night starts after 07:00 and still covers the seeded 08:00
 * visit).
 */
async function widenShiftToNow(station: string, day: string) {
  const hr = await login("hr");
  type Shifts = { shifts: Array<{ id: string; agentName: string; stationId: string; startsAtLocal: string;
    endsAtLocal: string; version: string }> };
  const shift = (await expectCall<Shifts>(200, hr, "GET", `/human-resources/shifts?from=${day}&to=${day}&page=1&limit=100`))
    .data.shifts.find(item => item.agentName === RAMP_AGENT && item.stationId.toLowerCase() === station.toLowerCase());
  expect(shift, "Gestión Humana lists the agent's shift of the day").toBeTruthy();
  const start = minutesOf(shift!.startsAtLocal);
  // An end at or before the start is the next day's: the 15:00–00:00 preset ends at midnight.
  const end = minutesOf(shift!.endsAtLocal) + (minutesOf(shift!.endsAtLocal) <= start ? 24 * 60 : 0);
  const now = new Date();
  const from = stationMinutes(now);
  // The end rounded up to the minute: the shift covers the whole stretch.
  const until = stationMinutes(new Date(now.getTime() + SHIFT_AHEAD + MINUTE - 1));
  expect(until > from, "the stretch the shift must cover ends before the station's midnight").toBe(true);
  const newEnd = Math.max(end, until);
  const newStart = Math.max(Math.min(start, from), newEnd - MAX_SHIFT_MINUTES);
  test.skip(newStart > from,
    `A shift of at most 16 hours cannot cover from now to ${SHIFT_AHEAD / MINUTE} minutes later; run between 08:30 and 22:30.`);
  await expectCall(200, hr, "PATCH", `/human-resources/shifts/${shift!.id}`, {
    startsAtLocal: clockOf(newStart), endsAtLocal: clockOf(newEnd),
    reason: "El agente cubre el vuelo demo del ciclo E2E.", expectedVersion: shift!.version,
  });
}

/**
 * The installation the tablet uses: the one the cycle run registered in fase 3, else this harness's own, kept outside
 * the repository so every walkthrough uses the same tablet.
 */
function installationId(): string {
  try {
    const saved = loadRun().installationId;
    if (typeof saved === "string") return saved;
  } catch {
    // No cycle run in progress: the walkthrough uses its own tablet.
  }
  const file = path.join(STATE_DIR, OWN_TABLET_FILE);
  if (fs.existsSync(file)) {
    const saved = (JSON.parse(fs.readFileSync(file, "utf8")) as { installationId?: unknown }).installationId;
    if (typeof saved === "string") return saved;
  }
  const created = crypto.randomUUID();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ installationId: created }, null, 2), { mode: 0o600 });
  return created;
}

/**
 * The tablet as the APK uses the API: the agent's session plus its installation id on every command. Like the APK, it
 * registers the installation at each sign-in; for the agent's own tablet that only renews its binding (2-N02).
 */
export async function tablet() {
  const installation = installationId();
  const token = await login("ramp");
  await expectCall([200, 201, 204], token, "PUT", "/mobile/device", { installationId: installation, platform: "Android",
    appVersion: "1.0.0", deviceName: "Tablet E2E ciclo", operatingSystemVersion: "Android 16" });
  const device = { "x-elevant-installation-id": installation };
  return {
    token, device,
    get: <T>(route: string) => expectCall<T>(200, token, "GET", route, undefined, device),
    send: <T>(expected: number | number[], method: string, route: string, body?: unknown) =>
      expectCall<T>(expected, token, method, route, body, { ...device, "idempotency-key": crypto.randomUUID() }),
  };
}

/** The operation of a flight on the agent's tablet. */
export async function tabletOperation(device: Device, turnaroundId: string) {
  const mine = await device.get<{ operations: Array<{ operation: { id: string; status: string };
    turnaround: { id: string; stand: { code: string } | null }; services: Array<{ id: string }> }> }>("/ramp/operations");
  const found = mine.data.operations.find(item => item.turnaround.id === turnaroundId);
  expect(found, "the flight reaches the agent's tablet").toBeTruthy();
  return found!;
}

/**
 * The agent closes a started flight from the tablet so it no longer holds the agent: every service not performed, the
 * checklist and the hand-off to OCC (the operation waits in the review, unbilled).
 */
export async function handOffUnperformed(device: Device, turnaroundId: string) {
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
