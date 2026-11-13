/**
 * The OCC map (ADR-0042, contracts 1.3): three reads under `occ/map` for AVIAM internal staff with the station in scope
 * and any of the map permissions (dashboard, flight monitoring, positions map or planning).
 *
 * - `air-picture`: the live aircraft around the station with live traffic, served from memory. Its state always comes
 *   in a 200 (`Live`, `Stale`, `Warming`, `Unavailable`, `Disabled`) with the reason it is not live, the pace to ask
 *   again at (`refreshAfterSeconds`, never faster) and the credit of the network every map shows.
 * - `aircraft/{hex}/track`: one aircraft's trail from memory, its last segment only.
 * - `flights`: the ELEVANT flights of the station, one row per leg, with keys that do not change when OCC imports the
 *   flight, the normalized phase, the recorded milestones and the demo clock.
 *
 * The validators are strict at every level; a key may be missing or null only where the contract says null. Latitudes
 * and longitudes are checked as positions on Earth, never against a box: the picture reaches 250 NM around the station.
 */
import type {
  GetOccAirPictureParams,
  GetOccAircraftTrackParams,
  GetOccMapFlightsParams,
  OccAircraftTrackResponse,
  OccAirPictureResponse,
  OccMapFlightsResponse,
} from "../generated/elevant-api";
import { DEMO_FLIGHT_PHASES, DEMO_FLIGHT_STATES } from "./demoFlights";
import { FLIGHT_REPORT_MILESTONES, isFlightReportMilestoneCode } from "./flightReport";

/** Live; Stale (the last good read is up to ten minutes old); Warming; Unavailable; Disabled (nothing configured). */
export const OCC_AIR_PICTURE_STATUSES = ["Live", "Stale", "Warming", "Unavailable", "Disabled"] as const;
export type OccAirPictureStatus = (typeof OCC_AIR_PICTURE_STATUSES)[number];

/** Why the picture is not live; the screens translate it and never print it as it is. */
export const OCC_AIR_PICTURE_REASONS = ["not_configured", "quota_exceeded", "rate_limited", "unauthorized",
  "provider_error"] as const;
export type OccAirPictureReason = (typeof OCC_AIR_PICTURE_REASONS)[number];

/** `short` (the server's default): up to eight points of each trail; `none`: no trail. Ask `short` once, then `none`. */
export const OCC_AIR_PICTURE_TRAILS = ["short", "none"] as const;
export type OccAirPictureTrails = (typeof OCC_AIR_PICTURE_TRAILS)[number];

/** How a live aircraft was recognised as an ELEVANT flight. */
export const OCC_MAP_MATCHED_BY = ["Registration", "Callsign"] as const;
export type OccMapMatchedBy = (typeof OCC_MAP_MATCHED_BY)[number];

export const OCC_MAP_DIRECTIONS = ["Arrival", "Departure"] as const;
export type OccMapDirection = (typeof OCC_MAP_DIRECTIONS)[number];

/** Where a map flight stands, one closed list whatever the provider's words. */
export const OCC_MAP_FLIGHT_PHASES = ["scheduled", "departed", "enroute", "approaching", "landed", "arrived", "cancelled",
  "diverted", "unknown"] as const;
export type OccMapFlightPhase = (typeof OCC_MAP_FLIGHT_PHASES)[number];

/** What a flight's actual time is: the wheels on the runway, or the aircraft on its stand. */
export const OCC_MAP_ACTUAL_KINDS = ["Runway", "OnBlock"] as const;
export type OccMapActualKind = (typeof OCC_MAP_ACTUAL_KINDS)[number];

export const OCC_MAP_SIZE_CATEGORIES = ["Narrowbody", "Widebody"] as const;

export const OCC_MAP_TURNAROUND_STATUSES = ["Scheduled", "Confirmed", "InProgress", "Completed", "Cancelled",
  "Diverted"] as const;

export const OCC_MAP_OPERATION_STATUSES = ["Planned", "Assigned", "InProgress", "PendingReview", "InReview", "Approved",
  "Returned", "Cancelled"] as const;

/** The window of the map flights; the server applies the same limits and answers `invalid_map_query` outside them. */
export const OCC_MAP_FLIGHT_WINDOW = Object.freeze({
  defaultHoursBack: 2,
  maxHoursBack: 24,
  defaultHoursAhead: 12,
  minHoursAhead: 1,
  maxHoursAhead: 36,
});

/** The pace and sizes of the air picture: 2 seconds while warming, otherwise 10 to 60. */
export const OCC_AIR_PICTURE_LIMITS = Object.freeze({
  warmingRefreshSeconds: 2,
  minRefreshSeconds: 10,
  maxRefreshSeconds: 60,
  maxTrailPoints: 8,
  maxTrackPoints: 600,
  maxRadiusNm: 250,
});

/** The air picture of a station; `trails` absent is the server's default, `short`. */
export interface OccAirPictureQuery {
  readonly stationId: string;
  readonly trails?: OccAirPictureTrails | null;
}

/** The trail of one aircraft: its ICAO 24-bit address, six hexadecimal digits in any case. */
export interface OccAircraftTrackQuery {
  readonly stationId: string;
  readonly hex: string;
}

/** The map flights of a station: 0 to 24 hours back (2 when absent) and 1 to 36 ahead (12 when absent). */
export interface OccMapFlightsQuery {
  readonly stationId: string;
  readonly hoursBack?: number | null;
  readonly hoursAhead?: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
const HEX = /^[0-9a-f]{6}$/;
/** A flight's key: `p:` (a proposal) or `l:` (a leg) and a lower-case id. */
const FLIGHT_KEY = /^[pl]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A visit's key: `p:` (the arrival proposal) or `t:` (a turnaround) and a lower-case id. */
const VISIT_KEY = /^[pt]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An airline's ICAO designator and a number of one to four digits without leading zeros, with an optional letter. */
const CALLSIGN = /^[A-Z]{3}(?:0|[1-9]\d{0,3})[A-Z]?$/;
const MAX_MAP_FLIGHTS = 5000;
const MAX_PICTURE_AIRCRAFT = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const absent = (value: unknown): value is null | undefined => value === null || value === undefined;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isOptionalUuid = (value: unknown) => absent(value) || isUuid(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isOptionalText = (value: unknown, max: number) => absent(value) || isText(value, max);
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const isOneOf = <T extends string>(value: unknown, list: readonly T[]): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);
const isInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) &&
  !Number.isNaN(instantOf(value));
const isOptionalInstant = (value: unknown) => absent(value) || isInstant(value);
/** Milliseconds of an instant; .NET writes up to seven decimals, which `Date.parse` does not take. */
const instantOf = (value: string) => Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
const isWhole = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isOptionalWhole = (value: unknown, min: number, max: number) => absent(value) || isWhole(value, min, max);
const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const isLatitude = (value: unknown): value is number => isNumberIn(value, -90, 90);
const isLongitude = (value: unknown): value is number => isNumberIn(value, -180, 180);
const isListOf = (value: unknown, max: number, valid: (item: unknown) => boolean): value is unknown[] =>
  Array.isArray(value) && value.length <= max && value.every(valid);
const sameId = (left: unknown, right: unknown) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const isHttpsUrl = (value: unknown) => {
  if (!isText(value, 300)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};
/** The instants of a list, oldest first (equal ones allowed). */
const isChronological = (points: readonly { at: string }[]) =>
  points.every((point, index) => index === 0 || instantOf(points[index - 1]!.at) <= instantOf(point.at));

const SOURCE_KEYS = ["name", "homeUrl", "licenseName", "licenseUrl"] as const;
const CENTER_KEYS = ["latitude", "longitude", "radiusNm"] as const;
const POINT_KEYS = ["at", "latitude", "longitude", "altitudeFeet", "onGround"] as const;
const AIRCRAFT_KEYS = ["hex", "callsign", "registration", "typeIcaoCode", "category", "latitude", "longitude",
  "altitudeFeet", "onGround", "groundSpeedKnots", "trackDegrees", "verticalRateFeetPerMinute", "squawk", "positionAt",
  "matchedFlightKey", "matchedBy", "trail"] as const;
const PICTURE_KEYS = ["stationId", "status", "reason", "serverTime", "observedAt", "ageSeconds", "refreshAfterSeconds",
  "source", "center", "aircraft"] as const;
const TRACK_KEYS = ["hex", "serverTime", "source", "points"] as const;

/** The credit of a network: its name, its home page and its licence (with a link when it has one). */
const isSource = (value: unknown) => isRecord(value) && hasOnlyKeys(value, SOURCE_KEYS) && isText(value.name, 80) &&
  isHttpsUrl(value.homeUrl) && isText(value.licenseName, 120) && (absent(value.licenseUrl) || isHttpsUrl(value.licenseUrl));

/** Altitudes and vertical rates as the server bounds them (±200 000 ft, ±100 000 ft/min); null on the ground or unknown. */
const isPoint = (value: unknown) => isRecord(value) && hasOnlyKeys(value, POINT_KEYS) && isInstant(value.at) &&
  isLatitude(value.latitude) && isLongitude(value.longitude) && isOptionalWhole(value.altitudeFeet, -200_000, 200_000) &&
  typeof value.onGround === "boolean";

const isTrail = (value: unknown, max: number) =>
  isListOf(value, max, isPoint) && isChronological(value as { at: string }[]);

const isAircraft = (value: unknown) => {
  if (!isRecord(value) || !hasOnlyKeys(value, AIRCRAFT_KEYS) || !matches(value.hex, HEX) ||
      !isOptionalText(value.callsign, 16) || !isOptionalText(value.registration, 16) ||
      !isOptionalText(value.typeIcaoCode, 8) || !(absent(value.category) || matches(value.category, /^[A-D][0-7]$/)) ||
      !isLatitude(value.latitude) || !isLongitude(value.longitude) ||
      !isOptionalWhole(value.altitudeFeet, -200_000, 200_000) || typeof value.onGround !== "boolean" ||
      !(absent(value.groundSpeedKnots) || isNumberIn(value.groundSpeedKnots, 0, Number.MAX_VALUE)) ||
      !(absent(value.trackDegrees) || isNumberIn(value.trackDegrees, 0, 360)) ||
      !isOptionalWhole(value.verticalRateFeetPerMinute, -100_000, 100_000) ||
      !(absent(value.squawk) || matches(value.squawk, /^[0-7]{4}$/)) || !isInstant(value.positionAt) ||
      !(absent(value.matchedFlightKey) || matches(value.matchedFlightKey, FLIGHT_KEY)) ||
      !(absent(value.matchedBy) || isOneOf(value.matchedBy, OCC_MAP_MATCHED_BY)) ||
      !isTrail(value.trail, OCC_AIR_PICTURE_LIMITS.maxTrailPoints))
    return false;
  // An aircraft names a flight and how it recognised it, or neither.
  return absent(value.matchedFlightKey) === absent(value.matchedBy);
};

/**
 * The air picture of the station asked for (when `stationId` is given). Beyond each field, the state and its parts agree:
 * Live and Warming carry no reason, Unavailable always carries one, and `not_configured` belongs to Disabled alone; only
 * Live and Stale carry aircraft and the instant they describe (with its age); a picture warming is asked again in 2
 * seconds and any other in 10 to 60; a disabled one has no credit. Each aircraft is listed once, with at most eight trail
 * points, oldest first, and none when the query asked `trails: "none"`.
 */
export function isOccAirPicture(value: unknown, stationId?: string, trails?: OccAirPictureTrails | null):
  value is OccAirPictureResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, PICTURE_KEYS) || !isUuid(value.stationId) ||
      (stationId !== undefined && !sameId(value.stationId, stationId)) ||
      !isOneOf(value.status, OCC_AIR_PICTURE_STATUSES) ||
      !(absent(value.reason) || isOneOf(value.reason, OCC_AIR_PICTURE_REASONS)) || !isInstant(value.serverTime) ||
      !isOptionalInstant(value.observedAt) || !isOptionalWhole(value.ageSeconds, 0, 2_147_483_647) ||
      !Number.isInteger(value.refreshAfterSeconds) || !(absent(value.source) || isSource(value.source)) ||
      !isRecord(value.center) || !hasOnlyKeys(value.center, CENTER_KEYS) || !isLatitude(value.center.latitude) ||
      !isLongitude(value.center.longitude) ||
      !isWhole(value.center.radiusNm, 1, OCC_AIR_PICTURE_LIMITS.maxRadiusNm) ||
      !isListOf(value.aircraft, MAX_PICTURE_AIRCRAFT, isAircraft))
    return false;

  const status = value.status;
  const reason = value.reason ?? null;
  const aircraft = value.aircraft as { hex: string; trail: unknown[] }[];
  const refresh = value.refreshAfterSeconds as number;
  if (status === "Warming"
    ? refresh !== OCC_AIR_PICTURE_LIMITS.warmingRefreshSeconds
    : refresh < OCC_AIR_PICTURE_LIMITS.minRefreshSeconds || refresh > OCC_AIR_PICTURE_LIMITS.maxRefreshSeconds)
    return false;
  const reasonFits = status === "Live" || status === "Warming" ? reason === null
    : status === "Disabled" ? reason === "not_configured"
      : status === "Unavailable" ? reason !== null && reason !== "not_configured"
        : reason !== "not_configured";
  if (!reasonFits) return false;
  // The instant the network described and its age come together: Live and Stale have them, Warming and Disabled never,
  // and Unavailable when what it last read is too old to show.
  const described = !absent(value.observedAt);
  if (described === absent(value.ageSeconds)) return false;
  if (status === "Live" || status === "Stale" ? !described : status !== "Unavailable" && described) return false;
  if (aircraft.length > 0 && status !== "Live" && status !== "Stale") return false;
  if (status === "Disabled" && !absent(value.source)) return false;
  if (new Set(aircraft.map(item => item.hex)).size !== aircraft.length) return false;
  return trails !== "none" || aircraft.every(item => item.trail.length === 0);
}

/** The trail of the aircraft asked for (when `hex` is given): at most 600 points, oldest first. */
export function isOccAircraftTrack(value: unknown, hex?: string): value is OccAircraftTrackResponse {
  return isRecord(value) && hasOnlyKeys(value, TRACK_KEYS) && matches(value.hex, HEX) &&
    (hex === undefined || value.hex === hex.toLowerCase()) && isInstant(value.serverTime) &&
    (absent(value.source) || isSource(value.source)) && isTrail(value.points, OCC_AIR_PICTURE_LIMITS.maxTrackPoints);
}

const FLIGHTS_KEYS = ["stationId", "stationCode", "serverTime", "windowFrom", "windowTo", "stationAirport", "flights"] as const;
const FLIGHT_KEYS = ["flightKey", "visitKey", "proposalId", "legId", "turnaroundId", "direction", "flightNumber",
  "callsign", "airline", "counterpart", "scheduledAt", "estimatedAt", "actualAt", "actualKind", "phase", "providerStatus",
  "aircraft", "imported", "turnaround", "stand", "suggestedStandCode", "milestones", "isDemo", "demo"] as const;
const AIRLINE_KEYS = ["id", "name", "iataCode", "icaoCode"] as const;
const AIRPORT_KEYS = ["iataCode", "icaoCode", "name", "latitude", "longitude"] as const;
const MAP_AIRCRAFT_KEYS = ["registration", "typeIcaoCode", "model", "sizeCategory"] as const;
const TURNAROUND_KEYS = ["id", "operationCode", "status", "operationId", "operationStatus"] as const;
const STAND_KEYS = ["id", "code", "terminalCode"] as const;
const MILESTONE_KEYS = ["code", "actualAt"] as const;
const DEMO_KEYS = ["demoFlightId", "state", "phase", "appearAt", "touchdownAt", "onBlockAt", "scheduledOffBlockAt",
  "offBlockAt", "takeoffAt", "vanishAt"] as const;

const isAirline = (value: unknown) => isRecord(value) && hasOnlyKeys(value, AIRLINE_KEYS) && isUuid(value.id) &&
  isText(value.name, 160) && isOptionalText(value.iataCode, 2) && isText(value.icaoCode, 3);

/** An airport with its reference point: both coordinates or neither. */
const isAirport = (value: unknown) => isRecord(value) && hasOnlyKeys(value, AIRPORT_KEYS) && isText(value.iataCode, 3) &&
  isOptionalText(value.icaoCode, 4) && isText(value.name, 180) && (absent(value.latitude) || isLatitude(value.latitude)) &&
  (absent(value.longitude) || isLongitude(value.longitude)) && absent(value.latitude) === absent(value.longitude);

const isMapAircraft = (value: unknown) => isRecord(value) && hasOnlyKeys(value, MAP_AIRCRAFT_KEYS) &&
  isOptionalText(value.registration, 16) && isOptionalText(value.typeIcaoCode, 4) && isOptionalText(value.model, 201) &&
  (absent(value.sizeCategory) || isOneOf(value.sizeCategory, OCC_MAP_SIZE_CATEGORIES));

/** A turnaround and its operation: the operation's id and status come together. */
const isTurnaround = (value: unknown) => isRecord(value) && hasOnlyKeys(value, TURNAROUND_KEYS) && isUuid(value.id) &&
  isText(value.operationCode, 40) && isOneOf(value.status, OCC_MAP_TURNAROUND_STATUSES) &&
  isOptionalUuid(value.operationId) && (absent(value.operationStatus) || isOneOf(value.operationStatus,
    OCC_MAP_OPERATION_STATUSES)) && absent(value.operationId) === absent(value.operationStatus);

const isStand = (value: unknown) => isRecord(value) && hasOnlyKeys(value, STAND_KEYS) && isUuid(value.id) &&
  isText(value.code, 24) && isOptionalText(value.terminalCode, 16);

const isMilestone = (value: unknown) => isRecord(value) && hasOnlyKeys(value, MILESTONE_KEYS) &&
  isFlightReportMilestoneCode(value.code) && isInstant(value.actualAt);

const isDemo = (value: unknown) => isRecord(value) && hasOnlyKeys(value, DEMO_KEYS) && isUuid(value.demoFlightId) &&
  isOneOf(value.state, DEMO_FLIGHT_STATES) && isOneOf(value.phase, DEMO_FLIGHT_PHASES) && isInstant(value.appearAt) &&
  isInstant(value.touchdownAt) && isInstant(value.onBlockAt) && isInstant(value.scheduledOffBlockAt) &&
  isOptionalInstant(value.offBlockAt) && isOptionalInstant(value.takeoffAt) && isOptionalInstant(value.vanishAt);

/**
 * One leg of the map. Beyond each field: an actual time comes with its kind; a leg (`imported`) carries its leg, its
 * turnaround (of the same id) and never a suggested stand; an open proposal carries nothing of OCC (no leg, turnaround,
 * stand or milestone) and its key is `p:` and its own id; an `l:` key is the leg's own and a `t:` visit the turnaround's;
 * only a demo flight has a demo clock or a suggested stand. The milestones are those of the flight report, each once.
 */
const isMapFlight = (value: unknown) => {
  if (!isRecord(value) || !hasOnlyKeys(value, FLIGHT_KEYS) || !matches(value.flightKey, FLIGHT_KEY) ||
      !matches(value.visitKey, VISIT_KEY) || !isOptionalUuid(value.proposalId) || !isOptionalUuid(value.legId) ||
      !isOptionalUuid(value.turnaroundId) || !isOneOf(value.direction, OCC_MAP_DIRECTIONS) ||
      !isText(value.flightNumber, 16) || !(absent(value.callsign) || matches(value.callsign, CALLSIGN)) ||
      !isAirline(value.airline) || !(absent(value.counterpart) || isAirport(value.counterpart)) ||
      !isInstant(value.scheduledAt) || !isOptionalInstant(value.estimatedAt) || !isOptionalInstant(value.actualAt) ||
      !(absent(value.actualKind) || isOneOf(value.actualKind, OCC_MAP_ACTUAL_KINDS)) ||
      !isOneOf(value.phase, OCC_MAP_FLIGHT_PHASES) || !isOptionalText(value.providerStatus, 32) ||
      !(absent(value.aircraft) || isMapAircraft(value.aircraft)) || typeof value.imported !== "boolean" ||
      !(absent(value.turnaround) || isTurnaround(value.turnaround)) || !(absent(value.stand) || isStand(value.stand)) ||
      !isOptionalText(value.suggestedStandCode, 16) ||
      !isListOf(value.milestones, FLIGHT_REPORT_MILESTONES.length, isMilestone) || typeof value.isDemo !== "boolean" ||
      !(absent(value.demo) || isDemo(value.demo)))
    return false;

  const milestones = value.milestones as { code: string }[];
  if (new Set(milestones.map(item => item.code)).size !== milestones.length) return false;
  if (absent(value.actualAt) !== absent(value.actualKind)) return false;
  if (!absent(value.demo) && !value.isDemo) return false;
  const flightKey = value.flightKey as string;
  const visitKey = value.visitKey as string;
  if (value.imported) {
    const turnaround = value.turnaround as { id: string } | null | undefined;
    return isUuid(value.legId) && isUuid(value.turnaroundId) && !absent(turnaround) &&
      sameId(turnaround.id, value.turnaroundId) && absent(value.suggestedStandCode) &&
      (!flightKey.startsWith("l:") || flightKey === `l:${(value.legId as string).toLowerCase()}`) &&
      (!visitKey.startsWith("t:") || visitKey === `t:${(value.turnaroundId as string).toLowerCase()}`);
  }
  return isUuid(value.proposalId) && absent(value.legId) && absent(value.turnaroundId) && absent(value.turnaround) &&
    absent(value.stand) && milestones.length === 0 && flightKey === `p:${(value.proposalId as string).toLowerCase()}` &&
    visitKey.startsWith("p:") && (absent(value.suggestedStandCode) || value.isDemo);
};

/**
 * The map flights of the station asked for (when `stationId` is given): its airport, the window the rows were chosen by
 * (its start never after its end) and the rows, each key once.
 */
export function isOccMapFlights(value: unknown, stationId?: string): value is OccMapFlightsResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, FLIGHTS_KEYS) || !isUuid(value.stationId) ||
      (stationId !== undefined && !sameId(value.stationId, stationId)) || !isText(value.stationCode, 16) ||
      !isInstant(value.serverTime) || !isInstant(value.windowFrom) || !isInstant(value.windowTo) ||
      instantOf(value.windowFrom) > instantOf(value.windowTo) || !isAirport(value.stationAirport) ||
      !isListOf(value.flights, MAX_MAP_FLIGHTS, isMapFlight))
    return false;
  const keys = (value.flights as { flightKey: string }[]).map(flight => flight.flightKey);
  return new Set(keys).size === keys.length;
}

const id = (value: unknown, field: string) => {
  if (!isUuid(value)) throw new TypeError(`${field} must be a non-empty canonical UUID.`);
  return value.toLowerCase();
};

/** The air picture's query: the station in lower case and the trail choice by its exact name (absent: `short`). */
export function normalizedOccAirPictureQuery(query: OccAirPictureQuery): GetOccAirPictureParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "trails"]))
    throw new TypeError("The air picture query has unknown or invalid fields.");
  const params: GetOccAirPictureParams = { stationId: id(query.stationId, "stationId") };
  if (!absent(query.trails)) {
    if (!isOneOf(query.trails, OCC_AIR_PICTURE_TRAILS)) throw new TypeError("trails must be short or none.");
    params.trails = query.trails;
  }
  return params;
}

/** A track's query: the station in lower case and the address as six lower-case hexadecimal digits. */
export function normalizedOccAircraftTrackQuery(query: OccAircraftTrackQuery):
  GetOccAircraftTrackParams & { readonly hex: string } {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "hex"]))
    throw new TypeError("The aircraft track query has unknown or invalid fields.");
  const stationId = id(query.stationId, "stationId");
  if (typeof query.hex !== "string" || !/^[0-9a-f]{6}$/i.test(query.hex))
    throw new TypeError("hex must be six hexadecimal digits.");
  return { stationId, hex: query.hex.toLowerCase() };
}

const hours = (value: unknown, min: number, max: number, field: string) => {
  if (!isWhole(value, min, max)) throw new TypeError(`${field} must be a whole number from ${min} to ${max}.`);
  return value;
};

/** The map flights' query: the station in lower case and each side of the window inside its range, or left out. */
export function normalizedOccMapFlightsQuery(query: OccMapFlightsQuery): GetOccMapFlightsParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "hoursBack", "hoursAhead"]))
    throw new TypeError("The map flights query has unknown or invalid fields.");
  // The URL keeps this order: the station and the two sides of the window.
  const params: GetOccMapFlightsParams = { stationId: id(query.stationId, "stationId") };
  if (!absent(query.hoursBack)) params.hoursBack = hours(query.hoursBack, 0, OCC_MAP_FLIGHT_WINDOW.maxHoursBack, "hoursBack");
  if (!absent(query.hoursAhead))
    params.hoursAhead = hours(query.hoursAhead, OCC_MAP_FLIGHT_WINDOW.minHoursAhead, OCC_MAP_FLIGHT_WINDOW.maxHoursAhead,
      "hoursAhead");
  return params;
}
