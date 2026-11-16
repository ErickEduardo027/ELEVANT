/**
 * The AeroDataBox reference reads (ADR-0028 and ADR-0043, notes of 15 November 2026), always through the API, never from
 * the browser:
 *
 * - `occ/aviation/aircraft`: an aircraft by its registration (tier 1, kept a day per registration);
 * - `occ/aviation/routes`: the daily routes from the station's airport (tier 3, kept 24 hours);
 * - `occ/aviation/delays`: the current delays of the station's airport or of another one (tier 3, kept an hour);
 * - `contracts/airline-fleet`: an airline's fleet size and type mix (tier 3, kept seven days), for Contratos and
 *   Superadministración. It informs; it blocks nothing.
 *
 * Each answer carries its state in a 200: `Available`, `NotFound`, `Disabled`, `DailyLimitReached`,
 * `MonthlyLimitReached`, `Unavailable` or (an aircraft only) `NotApplicable`, a demo flight's synthetic registration.
 * A cap reached is never an error: the screens say «Límite diario alcanzado» and may still show the last value kept.
 */
import type {
  AircraftReferenceResponse,
  AirlineFleetResponse,
  GetAirlineFleetParams,
  GetOccAircraftReferenceParams,
  GetOccAirportDelaysParams,
  GetOccAirportRoutesParams,
  OccAircraftReferenceResponse,
  OccAirportDelaysResponse,
  OccAirportRoutesResponse,
} from "../generated/elevant-api";

/** The states of a reference read. */
export const AVIATION_REFERENCE_STATUSES = ["Available", "NotFound", "Disabled", "DailyLimitReached",
  "MonthlyLimitReached", "Unavailable", "NotApplicable"] as const;
export type AviationReferenceStatus = (typeof AVIATION_REFERENCE_STATUSES)[number];

/** States in which the provider gave a value that may come with the answer (the last kept, for the last three). */
const MAY_HAVE_VALUE: readonly AviationReferenceStatus[] = ["Available", "DailyLimitReached", "MonthlyLimitReached",
  "Unavailable"];

/** How long each read is kept by the API, and the most routes and fleet types it sends. */
export const AVIATION_REFERENCE_LIMITS = Object.freeze({
  aircraftCacheHours: 24,
  routesCacheHours: 24,
  delaysCacheMinutes: 60,
  fleetCacheDays: 7,
  maxRoutes: 80,
  maxRouteOperators: 12,
  maxFleetSample: 25,
});

export interface OccAircraftReferenceQuery {
  readonly stationId: string;
  readonly registration: string;
}

export interface OccAirportRoutesQuery {
  readonly stationId: string;
}

export interface OccAirportDelaysQuery {
  readonly stationId: string;
  /** Another airport (IATA or ICAO); absent for the station's own. */
  readonly airport?: string | null;
}

export interface AirlineFleetQuery {
  readonly airlineCode: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REGISTRATION = /^[A-Z0-9]{2,10}$/;
const AIRPORT = /^[A-Z]{3,4}$/;
const AIRLINE = /^(?:[A-Z]{3}|(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const absent = (value: unknown): value is null | undefined => value === null || value === undefined;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isOptionalText = (value: unknown, max: number) => absent(value) || isText(value, max);
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const isInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) &&
  !Number.isNaN(Date.parse(value.replace(/(\.\d{3})\d+/, "$1")));
const isOptionalInstant = (value: unknown) => absent(value) || isInstant(value);
const isOptionalDate = (value: unknown) => absent(value) || matches(value, DATE);
const isWhole = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isOptionalWhole = (value: unknown, min: number, max: number) => absent(value) || isWhole(value, min, max);
const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const isOptionalNumberIn = (value: unknown, min: number, max: number) => absent(value) || isNumberIn(value, min, max);
const isStatus = (value: unknown): value is AviationReferenceStatus =>
  typeof value === "string" && (AVIATION_REFERENCE_STATUSES as readonly string[]).includes(value);
const sameId = (left: unknown, right: unknown) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

const AIRCRAFT_KEYS = ["registration", "active", "model", "typeName", "icaoType", "iataType", "operator", "serial",
  "modeS", "seats", "engines", "engineType", "ageYears", "firstFlight", "delivered", "registered", "isFreighter"] as const;
const AIRCRAFT_ANSWER_KEYS = ["stationId", "registration", "status", "serverTime", "retrievedAt", "source",
  "aircraft"] as const;
const ROUTES_KEYS = ["stationId", "airportIcao", "status", "serverTime", "retrievedAt", "source", "routes"] as const;
const ROUTE_KEYS = ["destinationIata", "destinationIcao", "name", "city", "countryCode", "latitude", "longitude",
  "averageDailyFlights", "operators"] as const;
const DELAYS_KEYS = ["stationId", "airport", "status", "serverTime", "retrievedAt", "source", "delays"] as const;
const DELAY_FACTS_KEYS = ["airportIcao", "from", "to", "arrivals", "departures"] as const;
const BATCH_KEYS = ["total", "qualified", "cancelled", "medianDelayMinutes", "delayIndex"] as const;
const FLEET_KEYS = ["airlineCode", "status", "serverTime", "retrievedAt", "source", "totalAircraft", "sampledAircraft",
  "types"] as const;
const FLEET_TYPE_KEYS = ["icaoType", "model", "count"] as const;

/** The parts every answer shares: a known state, the server's instant, when the provider gave it, and the credit. */
const isEnvelope = (value: Record<string, unknown>) => isStatus(value.status) && isInstant(value.serverTime) &&
  isOptionalInstant(value.retrievedAt) && isText(value.source, 40);

const isAircraft = (value: unknown): value is AircraftReferenceResponse => isRecord(value) &&
  hasOnlyKeys(value, AIRCRAFT_KEYS) && matches(value.registration, REGISTRATION_OUT) && typeof value.active === "boolean" &&
  isOptionalText(value.model, 120) && isOptionalText(value.typeName, 120) && isOptionalText(value.icaoType, 8) &&
  isOptionalText(value.iataType, 8) && isOptionalText(value.operator, 180) && isOptionalText(value.serial, 40) &&
  isOptionalText(value.modeS, 8) && isOptionalWhole(value.seats, 0, 1_000) && isOptionalWhole(value.engines, 0, 8) &&
  isOptionalText(value.engineType, 24) && isOptionalNumberIn(value.ageYears, 0, 150) && isOptionalDate(value.firstFlight) &&
  isOptionalDate(value.delivered) && isOptionalDate(value.registered) && typeof value.isFreighter === "boolean";
/** The provider writes registrations with dashes («HI-1055»). */
const REGISTRATION_OUT = /^[A-Z0-9-]{2,12}$/;

/**
 * An aircraft answer for the registration asked (when given). A value comes only in the states that may carry one;
 * `NotFound`, `Disabled` and `NotApplicable` have none.
 */
export function isOccAircraftReference(value: unknown, stationId?: string, registration?: string):
  value is OccAircraftReferenceResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, AIRCRAFT_ANSWER_KEYS) || !isUuid(value.stationId) ||
      (stationId !== undefined && !sameId(value.stationId, stationId)) || !matches(value.registration, REGISTRATION) ||
      (registration !== undefined && value.registration !== registration) || !isEnvelope(value) ||
      !(absent(value.aircraft) || isAircraft(value.aircraft)))
    return false;
  return absent(value.aircraft) || MAY_HAVE_VALUE.includes(value.status as AviationReferenceStatus);
}

const isRoute = (value: unknown) => isRecord(value) && hasOnlyKeys(value, ROUTE_KEYS) &&
  isOptionalText(value.destinationIata, 3) && isOptionalText(value.destinationIcao, 4) && isText(value.name, 180) &&
  isOptionalText(value.city, 120) && isOptionalText(value.countryCode, 2) &&
  isOptionalNumberIn(value.latitude, -90, 90) && isOptionalNumberIn(value.longitude, -180, 180) &&
  absent(value.latitude) === absent(value.longitude) && isNumberIn(value.averageDailyFlights, 0, 10_000) &&
  Array.isArray(value.operators) && value.operators.length <= AVIATION_REFERENCE_LIMITS.maxRouteOperators &&
  value.operators.every(name => isText(name, 180));

/** The daily routes of the station asked (when given): up to 80; none outside the states that may carry them. */
export function isOccAirportRoutes(value: unknown, stationId?: string): value is OccAirportRoutesResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ROUTES_KEYS) || !isUuid(value.stationId) ||
      (stationId !== undefined && !sameId(value.stationId, stationId)) || !matches(value.airportIcao, AIRPORT) ||
      !isEnvelope(value) || value.status === "NotApplicable" || !Array.isArray(value.routes) ||
      value.routes.length > AVIATION_REFERENCE_LIMITS.maxRoutes || !value.routes.every(isRoute))
    return false;
  return value.routes.length === 0 || MAY_HAVE_VALUE.includes(value.status as AviationReferenceStatus);
}

const isBatch = (value: unknown) => isRecord(value) && hasOnlyKeys(value, BATCH_KEYS) && isWhole(value.total, 0, 100_000) &&
  isWhole(value.qualified, 0, 100_000) && isWhole(value.cancelled, 0, 100_000) &&
  isOptionalWhole(value.medianDelayMinutes, -1_440, 10_080) && isOptionalNumberIn(value.delayIndex, 0, 5);

const isDelayFacts = (value: unknown) => isRecord(value) && hasOnlyKeys(value, DELAY_FACTS_KEYS) &&
  typeof value.airportIcao === "string" && value.airportIcao.length <= 4 && isInstant(value.from) && isInstant(value.to) &&
  isBatch(value.arrivals) && isBatch(value.departures);

/** The delays of the airport asked (when given): its facts only in the states that may carry them. */
export function isOccAirportDelays(value: unknown, stationId?: string, airport?: string): value is OccAirportDelaysResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, DELAYS_KEYS) || !isUuid(value.stationId) ||
      (stationId !== undefined && !sameId(value.stationId, stationId)) || !matches(value.airport, AIRPORT) ||
      (airport !== undefined && value.airport !== airport) || !isEnvelope(value) || value.status === "NotApplicable" ||
      !(absent(value.delays) || isDelayFacts(value.delays)))
    return false;
  return absent(value.delays) || MAY_HAVE_VALUE.includes(value.status as AviationReferenceStatus);
}

const isFleetType = (value: unknown) => isRecord(value) && hasOnlyKeys(value, FLEET_TYPE_KEYS) &&
  isOptionalText(value.icaoType, 8) && isText(value.model, 120) &&
  isWhole(value.count, 1, AVIATION_REFERENCE_LIMITS.maxFleetSample);

/** An airline's fleet for the code asked (when given): the sample's types add up to the sampled aircraft. */
export function isAirlineFleet(value: unknown, airlineCode?: string): value is AirlineFleetResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, FLEET_KEYS) || !matches(value.airlineCode, AIRLINE) ||
      (airlineCode !== undefined && value.airlineCode !== airlineCode) || !isEnvelope(value) ||
      value.status === "NotApplicable" || !isOptionalWhole(value.totalAircraft, 0, 100_000) ||
      !isWhole(value.sampledAircraft, 0, AVIATION_REFERENCE_LIMITS.maxFleetSample) || !Array.isArray(value.types) ||
      !value.types.every(isFleetType))
    return false;
  const counted = (value.types as { count: number }[]).reduce((sum, type) => sum + type.count, 0);
  if (counted !== value.sampledAircraft) return false;
  if (absent(value.totalAircraft)) return value.sampledAircraft === 0;
  return (value.totalAircraft as number) >= (value.sampledAircraft as number) &&
    MAY_HAVE_VALUE.includes(value.status as AviationReferenceStatus);
}

const stationOf = (value: unknown) => {
  if (!isUuid(value)) throw new TypeError("stationId must be a UUID.");
  return value.toLowerCase();
};

/** A registration in upper case without spaces or dashes, as the API keeps it. */
export function normalizedRegistration(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, "");
  return REGISTRATION.test(compact) ? compact : null;
}

export function normalizedOccAircraftReferenceQuery(query: OccAircraftReferenceQuery): GetOccAircraftReferenceParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "registration"]))
    throw new TypeError("The aircraft reference query has unknown or invalid fields.");
  const registration = normalizedRegistration(query.registration);
  if (!registration) throw new TypeError("registration must be 2 to 10 letters or digits.");
  return { stationId: stationOf(query.stationId), registration };
}

export function normalizedOccAirportRoutesQuery(query: OccAirportRoutesQuery): GetOccAirportRoutesParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId"]))
    throw new TypeError("The airport routes query has unknown or invalid fields.");
  return { stationId: stationOf(query.stationId) };
}

export function normalizedOccAirportDelaysQuery(query: OccAirportDelaysQuery): GetOccAirportDelaysParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "airport"]))
    throw new TypeError("The airport delays query has unknown or invalid fields.");
  const params: GetOccAirportDelaysParams = { stationId: stationOf(query.stationId) };
  if (!absent(query.airport)) {
    const airport = typeof query.airport === "string" ? query.airport.trim().toUpperCase() : "";
    if (!AIRPORT.test(airport)) throw new TypeError("airport must be an IATA or ICAO code.");
    params.airport = airport;
  }
  return params;
}

export function normalizedAirlineFleetQuery(query: AirlineFleetQuery): GetAirlineFleetParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["airlineCode"]))
    throw new TypeError("The airline fleet query has unknown or invalid fields.");
  const code = typeof query.airlineCode === "string" ? query.airlineCode.trim().toUpperCase() : "";
  if (!AIRLINE.test(code)) throw new TypeError("airlineCode must be an ICAO (3 letters) or IATA (2 characters) code.");
  return { airlineCode: code };
}
