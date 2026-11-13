import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { call, expectCall, login } from "./api";
import { goPrivate } from "./browser";
import { loadRun, STATE_DIR } from "./env";

/**
 * What the cycle steps do with a flight once it exists (ADR-0037): OCC's planning snapshot and assignment, today's
 * shift of the seeded ramp agent and the tablet as the APK uses the API. The demo flight walkthrough (ADR-0041) uses
 * them; fase 3 still keeps its own copies of the first ones, which move here once that phase can be run again.
 */

/** The seeded ramp agent (DEV-RA-001), scoped to Terminal A of PUJ. */
export const RAMP_AGENT = "Riley Ramp";

const MINUTE = 60_000;
/** AVIAM's stations keep the calendar of Santo Domingo: UTC−4 all year, without DST. */
const STATION_ZONE = "America/Santo_Domingo";
/** The tablet this harness registers when no cycle run left one (E2E_CYCLE_STATE_DIR). */
const OWN_TABLET_FILE = "tablet.json";

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

const localDay = () => new Date().toLocaleDateString("en-CA");

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
function shiftPreset(now = new Date()) {
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
  const mine = await device.get<{ operations: Array<{ operation: { id: string; status: string }; turnaround: { id: string };
    services: Array<{ id: string }> }> }>("/ramp/operations");
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
