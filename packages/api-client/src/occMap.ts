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
 * Its weather (ADR-0043, contracts 1.4), for the same readers: `occ/weather`, the METAR and the TAF of the station's
 * airport from aviationweather.gov, with its state in a 200 (`Live`, `Stale`, `Unavailable`, `Disabled`) and the credit
 * of the weather service. The region's weather (plan M6): `occ/weather/region`, `sigmets`, `wind` and `radar`, each with
 * its state, reason, pace and credit in a 200.
 *
 * The validators are strict at every level; a key may be missing or null only where the contract says null. Latitudes
 * and longitudes are checked as positions on Earth, never against a box: the picture reaches 250 NM around the station.
 */
import type {
  GetOccAerodromeWeatherParams,
  GetOccAirPictureParams,
  GetOccAircraftTrackParams,
  GetOccMapFlightsParams,
  GetOccRegionWeatherParams,
  OccAerodromeWeatherResponse,
  OccAircraftTrackResponse,
  OccAirPictureResponse,
  OccMapFlightsResponse,
  OccRadarFramesResponse,
  OccRegionWeatherResponse,
  OccSigmetsResponse,
  OccWindGridResponse,
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

/**
 * The state of the weather: Live (a METAR at most 90 minutes older than the server's time), Stale (an older METAR, or the
 * one kept after the service failed), Unavailable (no METAR; the TAF may still come), Disabled (no weather service).
 */
export const OCC_AERODROME_WEATHER_STATUSES = ["Live", "Stale", "Unavailable", "Disabled"] as const;
export type OccAerodromeWeatherStatus = (typeof OCC_AERODROME_WEATHER_STATUSES)[number];

/** The flight categories a METAR may carry. */
export const OCC_WEATHER_FLIGHT_CATEGORIES = ["VFR", "MVFR", "IFR", "LIFR"] as const;
export type OccWeatherFlightCategory = (typeof OCC_WEATHER_FLIGHT_CATEGORIES)[number];

/** How a period of a TAF starts; the first one has none. */
export const OCC_TAF_CHANGES = ["FM", "BECMG", "TEMPO", "PROB"] as const;
export type OccTafChange = (typeof OCC_TAF_CHANGES)[number];

/** The oldest a live METAR may be, and the most cloud layers (of a report or a period) and TAF periods the server sends. */
export const OCC_AERODROME_WEATHER_LIMITS = Object.freeze({
  liveMetarMinutes: 90,
  maxClouds: 8,
  maxTafPeriods: 30,
});

/** The weather of a station's airport: the station only; the server knows its airport. */
export interface OccAerodromeWeatherQuery {
  readonly stationId: string;
}

/** An ICAO location indicator, four letters in upper case. */
const ICAO_CODE = /^[A-Z]{4}$/;
/** A cloud cover as the report codes it: FEW, SCT, BKN, OVC, VV, CAVOK… */
const CLOUD_COVER = /^[A-Z]{2,5}$/;
/** The longest raw METAR, raw TAF and present weather the server reads. */
const MAX_METAR_LENGTH = 1_000;
const MAX_TAF_LENGTH = 4_000;
const MAX_PRESENT_WEATHER_LENGTH = 64;

const WEATHER_KEYS = ["stationId", "icaoCode", "status", "serverTime", "retrievedAt", "source", "metar", "taf"] as const;
const WEATHER_SOURCE_KEYS = ["name", "homeUrl"] as const;
const METAR_KEYS = ["raw", "observedAt", "flightCategory", "windDirectionDegrees", "windVariable", "windSpeedKnots",
  "windGustKnots", "visibilityStatuteMiles", "temperatureCelsius", "dewpointCelsius", "altimeterHectopascals", "weather",
  "clouds"] as const;
const CLOUD_KEYS = ["cover", "baseFeet"] as const;
const TAF_KEYS = ["raw", "issuedAt", "validFrom", "validTo", "periods"] as const;
const TAF_PERIOD_KEYS = ["from", "to", "change", "probabilityPercent", "windDirectionDegrees", "windVariable",
  "windSpeedKnots", "windGustKnots", "visibilityStatuteMiles", "weather", "clouds"] as const;

const isOptionalNumberIn = (value: unknown, min: number, max: number) => absent(value) || isNumberIn(value, min, max);

/** The credit of the weather service: its name and its home page. */
const isWeatherSource = (value: unknown) => isRecord(value) && hasOnlyKeys(value, WEATHER_SOURCE_KEYS) &&
  isText(value.name, 80) && isHttpsUrl(value.homeUrl);

/** A cloud layer: its cover and its base in feet (0 to 100 000), or no base. */
const isCloudLayer = (value: unknown) => isRecord(value) && hasOnlyKeys(value, CLOUD_KEYS) &&
  matches(value.cover, CLOUD_COVER) && isOptionalWhole(value.baseFeet, 0, 100_000);

const isClouds = (value: unknown) => isListOf(value, OCC_AERODROME_WEATHER_LIMITS.maxClouds, isCloudLayer);

/**
 * The wind of a report or a period: a direction from 0 to 360 degrees and a speed up to 300 knots, as the server bounds
 * them, and a gust up to 400 (the server sends at most 300); a variable wind has no direction.
 */
const isWind = (value: Record<string, unknown>) => isOptionalWhole(value.windDirectionDegrees, 0, 360) &&
  typeof value.windVariable === "boolean" && isOptionalWhole(value.windSpeedKnots, 0, 300) &&
  isOptionalWhole(value.windGustKnots, 0, 400) && (!value.windVariable || absent(value.windDirectionDegrees));

/**
 * A METAR: its raw text and instant, a known flight category, the wind, a visibility up to 100 statute miles, a
 * temperature and a dewpoint from −100 to 100 °C (the server's own bounds), an altimeter from 800 to 1 100 hPa, the
 * present weather and up to eight cloud layers.
 */
const isMetar = (value: unknown) => isRecord(value) && hasOnlyKeys(value, METAR_KEYS) &&
  isText(value.raw, MAX_METAR_LENGTH) && isInstant(value.observedAt) &&
  (absent(value.flightCategory) || isOneOf(value.flightCategory, OCC_WEATHER_FLIGHT_CATEGORIES)) && isWind(value) &&
  isOptionalNumberIn(value.visibilityStatuteMiles, 0, 100) && isOptionalNumberIn(value.temperatureCelsius, -100, 100) &&
  isOptionalNumberIn(value.dewpointCelsius, -100, 100) && isOptionalNumberIn(value.altimeterHectopascals, 800, 1_100) &&
  isOptionalText(value.weather, MAX_PRESENT_WEATHER_LENGTH) && isClouds(value.clouds);

/** One period of a TAF: it ends no earlier than it starts, starts with a known change (or none) and is bounded as a METAR. */
const isTafPeriod = (value: unknown) => isRecord(value) && hasOnlyKeys(value, TAF_PERIOD_KEYS) &&
  isInstant(value.from) && isInstant(value.to) && instantOf(value.from) <= instantOf(value.to) &&
  (absent(value.change) || isOneOf(value.change, OCC_TAF_CHANGES)) && isOptionalWhole(value.probabilityPercent, 0, 100) &&
  isWind(value) && isOptionalNumberIn(value.visibilityStatuteMiles, 0, 100) &&
  isOptionalText(value.weather, MAX_PRESENT_WEATHER_LENGTH) && isClouds(value.clouds);

/** A TAF: its raw text, when it was issued, a validity that ends no earlier than it starts and up to thirty periods. */
const isTaf = (value: unknown) => isRecord(value) && hasOnlyKeys(value, TAF_KEYS) && isText(value.raw, MAX_TAF_LENGTH) &&
  isInstant(value.issuedAt) && isInstant(value.validFrom) && isInstant(value.validTo) &&
  instantOf(value.validFrom) <= instantOf(value.validTo) &&
  isListOf(value.periods, OCC_AERODROME_WEATHER_LIMITS.maxTafPeriods, isTafPeriod);

/**
 * The weather of the station asked for (when `stationId` is given). Beyond each field, the state and its parts agree:
 * Live and Stale show a METAR, and a live one is at most 90 minutes older than `serverTime`; Unavailable and Disabled
 * have none; Disabled has no TAF and was never retrieved either. The credit always comes.
 */
export function isOccAerodromeWeather(value: unknown, stationId?: string): value is OccAerodromeWeatherResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, WEATHER_KEYS) || !isUuid(value.stationId) ||
      (stationId !== undefined && !sameId(value.stationId, stationId)) || !matches(value.icaoCode, ICAO_CODE) ||
      !isOneOf(value.status, OCC_AERODROME_WEATHER_STATUSES) || !isInstant(value.serverTime) ||
      !isOptionalInstant(value.retrievedAt) || !isWeatherSource(value.source) ||
      !(absent(value.metar) || isMetar(value.metar)) || !(absent(value.taf) || isTaf(value.taf)))
    return false;

  const status = value.status;
  const metar = value.metar as { observedAt: string } | null | undefined;
  if ((status === "Live" || status === "Stale") === absent(metar)) return false;
  if (status === "Disabled" && (!absent(value.taf) || !absent(value.retrievedAt))) return false;
  return status !== "Live" || instantOf(value.serverTime as string) - instantOf(metar!.observedAt) <=
    OCC_AERODROME_WEATHER_LIMITS.liveMetarMinutes * 60_000;
}

/** The weather's query: the station in lower case, and nothing else. */
export function normalizedOccAerodromeWeatherQuery(query: OccAerodromeWeatherQuery): GetOccAerodromeWeatherParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId"]))
    throw new TypeError("The aerodrome weather query has unknown or invalid fields.");
  return { stationId: id(query.stationId, "stationId") };
}

/*
 * The region's weather (plan M6, contracts 1.4), for the same readers: four reads under `occ/weather`, each with its
 * state in a 200 (`Live`, `Stale`, `Unavailable`, `Disabled`), the reason it is not live (the air picture's codes), the
 * pace to ask again at and the credit of its service.
 *
 * - `region`: the latest METAR and TAF of every airport of the region (aviationweather.gov), nearest first.
 * - `sigmets`: the international SIGMETs over the region still valid at the server's time, one per area.
 * - `wind`: the wind 10 m above the ground on a 10 × 8 grid (Open-Meteo; its free tier is non-commercial).
 * - `radar`: the latest scans of San Juan's NEXRAD (TJUA) as tiles of the Iowa Environmental Mesonet.
 */

/** Why a layer of the region's weather is not live; the screens translate it and never print it as it is. */
export const OCC_REGION_WEATHER_REASONS = ["not_configured", "rate_limited", "provider_error"] as const;
export type OccRegionWeatherReason = (typeof OCC_REGION_WEATHER_REASONS)[number];

/** The radar tiles' provider; RainViewer (personal and educational use only) is never used. */
export const OCC_RADAR_PROVIDERS = ["iem-tjua"] as const;
export type OccRadarProvider = (typeof OCC_RADAR_PROVIDERS)[number];

/** The pace of each read (the soonest and the latest to ask again, in seconds) and the sizes the server bounds. */
export const OCC_REGION_WEATHER_LIMITS = Object.freeze({
  regionRefreshSeconds: Object.freeze({ min: 300, max: 900 }),
  sigmetsRefreshSeconds: Object.freeze({ min: 300, max: 900 }),
  windRefreshSeconds: Object.freeze({ min: 300, max: 3600 }),
  radarRefreshSeconds: Object.freeze({ min: 300, max: 900 }),
  liveMetarMinutes: 90,
  liveRadarMinutes: 30,
  maxStations: 64,
  maxSigmets: 200,
  maxPolygonPoints: 1001,
  maxSigmetRawLength: 8000,
  maxLevelFeet: 100_000,
  maxWindGridSide: 32,
  maxWindKnots: 300,
  maxRadarFrames: 12,
  maxRadarZoom: 22,
});

/** A read of the region's weather: the station only; the server knows its airport and its region. */
export interface OccRegionWeatherQuery {
  readonly stationId: string;
}

const LAYER_KEYS = ["stationId", "status", "reason", "serverTime", "refreshAfterSeconds", "credit"] as const;
const REGION_KEYS = [...LAYER_KEYS, "stations"] as const;
const REGION_STATION_KEYS = ["icao", "iata", "name", "latitude", "longitude", "metar", "taf"] as const;
const REGION_METAR_KEYS = ["raw", "observedAt", "windDirectionDegrees", "windSpeedKnots", "windGustKnots",
  "visibilityStatuteMiles", "ceilingFeet", "flightCategory", "temperatureCelsius", "dewpointCelsius",
  "altimeterHectopascals"] as const;
const REGION_TAF_KEYS = ["raw", "issuedAt", "validFrom", "validTo"] as const;
const SIGMETS_KEYS = [...LAYER_KEYS, "sigmets"] as const;
const SIGMET_KEYS = ["id", "firId", "hazard", "qualifier", "validFrom", "validTo", "baseFeet", "topFeet", "raw",
  "polygon"] as const;
const WIND_KEYS = [...LAYER_KEYS, "validAt", "grid"] as const;
const WIND_GRID_KEYS = ["lonMin", "lonMax", "latMin", "latMax", "columns", "rows", "points"] as const;
const WIND_POINT_KEYS = ["latitude", "longitude", "speedKnots", "directionDegrees"] as const;
const RADAR_KEYS = [...LAYER_KEYS, "provider", "maxZoom", "frames"] as const;
const RADAR_FRAME_KEYS = ["time", "tileUrlTemplate"] as const;
const CREDIT_KEYS = ["name", "url"] as const;

const IATA_CODE = /^[A-Z]{3}$/;
/** A SIGMET's hazard as the service codes it: TS, TURB, ICE, VA, MTW, TC… */
const HAZARD = /^[A-Z]{2,8}$/;
/** A FIR's indicator: four to eight upper-case letters, digits or «/». */
const FIR_ID = /^[A-Z0-9/]{4,8}$/;
/** The rounding of a wind point's coordinates (three decimals) the server applies inside the grid's box. */
const GRID_TOLERANCE = 0.001;
const MAX_REGION_AIRPORT_NAME_LENGTH = 120;

/** The credit of a layer's service: its name and an https page. */
const isCredit = (value: unknown) => isRecord(value) && hasOnlyKeys(value, CREDIT_KEYS) && isText(value.name, 80) &&
  isHttpsUrl(value.url);

type Layer = Record<string, unknown> & { status: OccAerodromeWeatherStatus; serverTime: string };

/**
 * The parts every layer shares: its station (the one asked for, when given), a known state that agrees with its reason
 * (Live has none; Disabled is `not_configured`; Stale and Unavailable have none or a failure's), the server's time, the
 * pace within `pace` and the credit.
 */
const isLayer = (value: unknown, keys: readonly string[], pace: { min: number; max: number }, stationId?: string):
  value is Layer => {
  if (!isRecord(value) || !hasOnlyKeys(value, keys) || !isUuid(value.stationId) ||
      (stationId !== undefined && !sameId(value.stationId, stationId)) ||
      !isOneOf(value.status, OCC_AERODROME_WEATHER_STATUSES) || !isInstant(value.serverTime) ||
      !isWhole(value.refreshAfterSeconds, pace.min, pace.max) || !isCredit(value.credit) ||
      !(absent(value.reason) || isOneOf(value.reason, OCC_REGION_WEATHER_REASONS)))
    return false;
  if (value.status === "Live") return absent(value.reason);
  if (value.status === "Disabled") return value.reason === "not_configured";
  return value.reason !== "not_configured";
};

/**
 * A METAR of the region: its raw text and instant, the wind (no direction when variable or not given), a visibility up
 * to 100 statute miles, the ceiling in feet, a known flight category, a temperature and a dewpoint from −100 to 100 °C
 * and an altimeter from 800 to 1 100 hPa.
 */
const isRegionMetar = (value: unknown) => isRecord(value) && hasOnlyKeys(value, REGION_METAR_KEYS) &&
  isText(value.raw, MAX_METAR_LENGTH) && isInstant(value.observedAt) &&
  isOptionalWhole(value.windDirectionDegrees, 0, 360) && isOptionalWhole(value.windSpeedKnots, 0, 300) &&
  isOptionalWhole(value.windGustKnots, 0, 400) && isOptionalNumberIn(value.visibilityStatuteMiles, 0, 100) &&
  isOptionalWhole(value.ceilingFeet, 0, OCC_REGION_WEATHER_LIMITS.maxLevelFeet) &&
  (absent(value.flightCategory) || isOneOf(value.flightCategory, OCC_WEATHER_FLIGHT_CATEGORIES)) &&
  isOptionalNumberIn(value.temperatureCelsius, -100, 100) && isOptionalNumberIn(value.dewpointCelsius, -100, 100) &&
  isOptionalNumberIn(value.altimeterHectopascals, 800, 1_100);

/** A TAF of the region: its raw text, when it was issued and a validity that ends no earlier than it starts. */
const isRegionTaf = (value: unknown) => isRecord(value) && hasOnlyKeys(value, REGION_TAF_KEYS) &&
  isText(value.raw, MAX_TAF_LENGTH) && isInstant(value.issuedAt) && isInstant(value.validFrom) &&
  isInstant(value.validTo) && instantOf(value.validFrom) <= instantOf(value.validTo);

/** An airport of the region: its ICAO code, its IATA code and name (or none), where it is and its reports (or none). */
const isRegionStation = (value: unknown) => isRecord(value) && hasOnlyKeys(value, REGION_STATION_KEYS) &&
  matches(value.icao, ICAO_CODE) && (absent(value.iata) || matches(value.iata, IATA_CODE)) &&
  isOptionalText(value.name, MAX_REGION_AIRPORT_NAME_LENGTH) && isLatitude(value.latitude) &&
  isLongitude(value.longitude) && (absent(value.metar) || isRegionMetar(value.metar)) &&
  (absent(value.taf) || isRegionTaf(value.taf));

/**
 * The region's weather for the station asked for (when `stationId` is given). Beyond each field: every airport comes
 * once; Live and Stale show at least one METAR, and Live one at most 90 minutes older than `serverTime`; Unavailable
 * and Disabled show none; Disabled shows no TAF either.
 */
export function isOccRegionWeather(value: unknown, stationId?: string): value is OccRegionWeatherResponse {
  if (!isLayer(value, REGION_KEYS, OCC_REGION_WEATHER_LIMITS.regionRefreshSeconds, stationId) ||
      !isListOf(value.stations, OCC_REGION_WEATHER_LIMITS.maxStations, isRegionStation))
    return false;
  const stations = value.stations as { icao: string; metar?: { observedAt: string } | null; taf?: unknown }[];
  if (new Set(stations.map(station => station.icao)).size !== stations.length) return false;
  const observed = stations.flatMap(station => station.metar ? [instantOf(station.metar.observedAt)] : []);
  const status = value.status;
  if ((status === "Live" || status === "Stale") === (observed.length === 0)) return false;
  if (status === "Disabled" && stations.some(station => !absent(station.taf))) return false;
  const now = instantOf(value.serverTime);
  return status !== "Live" || observed.some(at => now - at <= OCC_REGION_WEATHER_LIMITS.liveMetarMinutes * 60_000);
}

/** A `[longitude, latitude]` pair on Earth. */
const isLonLat = (value: unknown) => Array.isArray(value) && value.length === 2 && isLongitude(value[0]) &&
  isLatitude(value[1]);

/** A closed ring of at least four `[longitude, latitude]` pairs (its last is its first), ready for GeoJSON. */
const isRing = (value: unknown) => {
  if (!isListOf(value, OCC_REGION_WEATHER_LIMITS.maxPolygonPoints, isLonLat) || value.length < 4) return false;
  const first = value[0] as number[];
  const last = value[value.length - 1] as number[];
  return first[0] === last[0] && first[1] === last[1];
};

/** One SIGMET: its id, FIR, hazard, qualifier, a validity that ends after it starts, its levels, raw text and area. */
const isSigmet = (value: unknown) => isRecord(value) && hasOnlyKeys(value, SIGMET_KEYS) && isText(value.id, 64) &&
  (absent(value.firId) || matches(value.firId, FIR_ID)) && matches(value.hazard, HAZARD) &&
  isOptionalText(value.qualifier, 64) && isInstant(value.validFrom) && isInstant(value.validTo) &&
  instantOf(value.validFrom) < instantOf(value.validTo) &&
  isOptionalWhole(value.baseFeet, 0, OCC_REGION_WEATHER_LIMITS.maxLevelFeet) &&
  isOptionalWhole(value.topFeet, 0, OCC_REGION_WEATHER_LIMITS.maxLevelFeet) &&
  isText(value.raw, OCC_REGION_WEATHER_LIMITS.maxSigmetRawLength) && isRing(value.polygon);

/**
 * The SIGMETs over the region for the station asked for (when `stationId` is given). Beyond each field: every id comes
 * once, every SIGMET is still valid at `serverTime`, and Unavailable and Disabled have none.
 */
export function isOccSigmets(value: unknown, stationId?: string): value is OccSigmetsResponse {
  if (!isLayer(value, SIGMETS_KEYS, OCC_REGION_WEATHER_LIMITS.sigmetsRefreshSeconds, stationId) ||
      !isListOf(value.sigmets, OCC_REGION_WEATHER_LIMITS.maxSigmets, isSigmet))
    return false;
  const sigmets = value.sigmets as { id: string; validTo: string }[];
  if (new Set(sigmets.map(sigmet => sigmet.id)).size !== sigmets.length) return false;
  const now = instantOf(value.serverTime);
  if (sigmets.some(sigmet => instantOf(sigmet.validTo) <= now)) return false;
  return (value.status !== "Unavailable" && value.status !== "Disabled") || sigmets.length === 0;
}

/** One point of the wind grid: where it is, its speed in knots and the whole degrees it blows from. */
const isWindPoint = (value: unknown) => isRecord(value) && hasOnlyKeys(value, WIND_POINT_KEYS) &&
  isLatitude(value.latitude) && isLongitude(value.longitude) &&
  isNumberIn(value.speedKnots, 0, OCC_REGION_WEATHER_LIMITS.maxWindKnots) && isWhole(value.directionDegrees, 0, 360);

/** The grid: a box that is not inverted, its shape, and at most one point per node, each inside the box. */
const isWindGrid = (value: unknown) => {
  if (!isRecord(value) || !hasOnlyKeys(value, WIND_GRID_KEYS) || !isLongitude(value.lonMin) ||
      !isLongitude(value.lonMax) || !isLatitude(value.latMin) || !isLatitude(value.latMax) ||
      value.lonMin >= value.lonMax || value.latMin >= value.latMax ||
      !isWhole(value.columns, 2, OCC_REGION_WEATHER_LIMITS.maxWindGridSide) ||
      !isWhole(value.rows, 2, OCC_REGION_WEATHER_LIMITS.maxWindGridSide) ||
      !isListOf(value.points, value.columns * value.rows, isWindPoint))
    return false;
  const { lonMin, lonMax, latMin, latMax } = value;
  return (value.points as { latitude: number; longitude: number }[]).every(point =>
    point.longitude >= lonMin - GRID_TOLERANCE && point.longitude <= lonMax + GRID_TOLERANCE &&
    point.latitude >= latMin - GRID_TOLERANCE && point.latitude <= latMax + GRID_TOLERANCE);
};

/**
 * The region's wind for the station asked for (when `stationId` is given). Beyond each field: a grid with points has
 * the time it is valid at; Live and Stale have points, and Unavailable and Disabled have none.
 */
export function isOccWindGrid(value: unknown, stationId?: string): value is OccWindGridResponse {
  if (!isLayer(value, WIND_KEYS, OCC_REGION_WEATHER_LIMITS.windRefreshSeconds, stationId) ||
      !isOptionalInstant(value.validAt) || !isWindGrid(value.grid))
    return false;
  const points = (value.grid as { points: unknown[] }).points.length;
  if (points > 0 && absent(value.validAt)) return false;
  return (value.status === "Live" || value.status === "Stale") === (points > 0);
}

/** An XYZ tile address: https, with `{z}`, `{x}` and `{y}` to fill. */
const isTileTemplate = (value: unknown) => isHttpsUrl(value) &&
  ["{z}", "{x}", "{y}"].every(part => (value as string).includes(part));

const isRadarFrame = (value: unknown) => isRecord(value) && hasOnlyKeys(value, RADAR_FRAME_KEYS) &&
  isInstant(value.time) && isTileTemplate(value.tileUrlTemplate);

/**
 * The region's radar for the station asked for (when `stationId` is given). Beyond each field: frames come oldest
 * first, each scan once; a provider and a zoom from 1 come with frames, and no provider and zoom 0 without; Live and
 * Stale have frames, and a live one's latest scan is at most 30 minutes older than `serverTime`; Unavailable and
 * Disabled have none.
 */
export function isOccRadarFrames(value: unknown, stationId?: string): value is OccRadarFramesResponse {
  if (!isLayer(value, RADAR_KEYS, OCC_REGION_WEATHER_LIMITS.radarRefreshSeconds, stationId) ||
      !(absent(value.provider) || isOneOf(value.provider, OCC_RADAR_PROVIDERS)) ||
      !isWhole(value.maxZoom, 0, OCC_REGION_WEATHER_LIMITS.maxRadarZoom) ||
      !isListOf(value.frames, OCC_REGION_WEATHER_LIMITS.maxRadarFrames, isRadarFrame))
    return false;
  const times = (value.frames as { time: string }[]).map(frame => instantOf(frame.time));
  if (times.some((time, index) => index > 0 && times[index - 1]! >= time)) return false;
  const drawn = times.length > 0;
  if (absent(value.provider) === drawn || (value.maxZoom === 0) === drawn) return false;
  if ((value.status === "Live" || value.status === "Stale") !== drawn) return false;
  return value.status !== "Live" ||
    instantOf(value.serverTime) - times[times.length - 1]! <= OCC_REGION_WEATHER_LIMITS.liveRadarMinutes * 60_000;
}

/** A read of the region's weather: the station in lower case, and nothing else. */
export function normalizedOccRegionWeatherQuery(query: OccRegionWeatherQuery): GetOccRegionWeatherParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId"]))
    throw new TypeError("The region weather query has unknown or invalid fields.");
  return { stationId: id(query.stationId, "stationId") };
}
