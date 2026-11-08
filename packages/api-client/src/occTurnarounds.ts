/**
 * One turnaround as OCC edits it from Planificación (phase 3, block A): «Editar vuelo» before the operation starts,
 * «Cancelar vuelo» or «Marcar desviado» with a reason, and the minimal carrier of a charter (3-A, 3-N21). Every change
 * travels with an Idempotency-Key and, for the turnaround, its strong ETag in If-Match. The positions map's commands
 * may carry the same headers (3-N10) and the arrival its local time, aircraft type and correction reason (3-N08, 3-B).
 */
import type {
  ChangeOccTurnaroundStatusRequest,
  CreateOccCharterAirlineRequest,
  OccCharterAirlineResponse,
  OccTurnaroundDetailResponse,
  RampAircraftTypesResponse,
  RescheduleOccTurnaroundRequest,
} from "../generated/elevant-api";

/** The changes the server may offer on a turnaround now (`allowedActions`). */
export const OCC_TURNAROUND_ACTIONS = ["reschedule", "cancel", "divert", "correctArrival"] as const;
export type OccTurnaroundAction = (typeof OCC_TURNAROUND_ACTIONS)[number];

export const OCC_TURNAROUND_OUTCOMES = ["Cancelled", "Diverted"] as const;
export type OccTurnaroundOutcome = (typeof OCC_TURNAROUND_OUTCOMES)[number];

/** The turnaround detail and the strong ETag the next change sends back in If-Match. */
export interface OccTurnaroundWithMetadata {
  readonly turnaround: OccTurnaroundDetailResponse;
  readonly etag: string;
}

/** The headers of one change: the intent's Idempotency-Key and the ETag of the version on screen. */
export interface OccTurnaroundCommandHeaders {
  readonly ifMatch: string;
  readonly idempotencyKey: string;
}

/** Optional headers of a positions map command (expand, 3-N10): with a key the ETag is required. */
export interface OccPositionCommandHeaders {
  readonly ifMatch?: string | null;
  readonly idempotencyKey?: string | null;
}

/**
 * «Editar vuelo»: numbers and airports of both legs, their UTC times (the screen converts from the station's local
 * time) and the reason; the stand and the aircraft type are optional, null keeps the current one.
 */
export interface RescheduleOccTurnaroundCommand {
  readonly arrivalFlightNumber: string;
  readonly arrivalOriginIata: string;
  readonly arrivalScheduledAt: string;
  readonly departureFlightNumber: string;
  readonly departureDestinationIata: string;
  readonly departureScheduledAt: string;
  readonly standId?: string | null;
  readonly aircraftTypeId?: string | null;
  readonly reason: string;
}

export interface ChangeOccTurnaroundStatusCommand {
  readonly outcome: OccTurnaroundOutcome;
  readonly reason: string;
}

/** A carrier without contract for a charter: name, three-letter ICAO designator and an optional IATA one. */
export interface CreateOccCharterAirlineCommand {
  readonly name: string;
  readonly icaoCode: string;
  readonly iataCode?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?Z$/;
const DAY = 24 * 60 * 60 * 1000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isUtc = (value: unknown): value is string =>
  typeof value === "string" && DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));

/** «ev 311» and «EV311» are the same flight, as the server writes it. */
export const normalizedFlightNumber = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";

const isFlightNumber = (value: string) => /^[A-Z0-9]{2,16}$/.test(value);
const iata = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : "");

/** The reason of a change, trimmed: 5 to 500 characters (`reason_required` otherwise). */
export function normalizedTurnaroundReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 5 || reason.length > 500) throw new TypeError("The reason needs 5 to 500 characters.");
  return reason;
}

export const isOccTurnaroundAction = (value: unknown): value is OccTurnaroundAction =>
  (OCC_TURNAROUND_ACTIONS as readonly string[]).includes(value as string);

/** The body of «Editar vuelo»: valid numbers and airports, UTC times within a day, the reason. */
export function normalizedTurnaroundReschedule(command: RescheduleOccTurnaroundCommand): RescheduleOccTurnaroundRequest {
  if (!isRecord(command) || !hasOnlyKeys(command, ["arrivalFlightNumber", "arrivalOriginIata", "arrivalScheduledAt",
      "departureFlightNumber", "departureDestinationIata", "departureScheduledAt", "standId", "aircraftTypeId", "reason"]))
    throw new TypeError("The flight change has unknown or invalid fields.");
  const arrivalFlightNumber = normalizedFlightNumber(command.arrivalFlightNumber);
  const departureFlightNumber = normalizedFlightNumber(command.departureFlightNumber);
  const arrivalOriginIata = iata(command.arrivalOriginIata);
  const departureDestinationIata = iata(command.departureDestinationIata);
  if (!isFlightNumber(arrivalFlightNumber) || !isFlightNumber(departureFlightNumber) ||
      !/^[A-Z]{3}$/.test(arrivalOriginIata) || !/^[A-Z]{3}$/.test(departureDestinationIata))
    throw new TypeError("The flight numbers or the airports are invalid.");
  if (!isUtc(command.arrivalScheduledAt) || !isUtc(command.departureScheduledAt))
    throw new TypeError("The scheduled times must be UTC instants.");
  const span = Date.parse(command.departureScheduledAt) - Date.parse(command.arrivalScheduledAt);
  if (span <= 0 || span > DAY) throw new TypeError("The departure must follow the arrival within a day.");
  if (command.standId != null && !isUuid(command.standId) || command.aircraftTypeId != null && !isUuid(command.aircraftTypeId))
    throw new TypeError("The stand or the aircraft type is invalid.");
  return {
    arrivalFlightNumber, arrivalOriginIata, arrivalScheduledAt: command.arrivalScheduledAt,
    departureFlightNumber, departureDestinationIata, departureScheduledAt: command.departureScheduledAt,
    standId: command.standId ?? null, aircraftTypeId: command.aircraftTypeId ?? null,
    reason: normalizedTurnaroundReason(command.reason),
  };
}

/** The body of «Cancelar vuelo» or «Marcar desviado». */
export function normalizedTurnaroundStatusChange(command: ChangeOccTurnaroundStatusCommand): ChangeOccTurnaroundStatusRequest {
  if (!isRecord(command) || !hasOnlyKeys(command, ["outcome", "reason"]) ||
      !(OCC_TURNAROUND_OUTCOMES as readonly string[]).includes(command.outcome as string))
    throw new TypeError("The outcome must be Cancelled or Diverted.");
  return { outcome: command.outcome, reason: normalizedTurnaroundReason(command.reason) };
}

/** The body of the minimal charter carrier: the name, the ICAO designator and the optional IATA one, in capitals. */
export function normalizedCharterAirline(command: CreateOccCharterAirlineCommand): CreateOccCharterAirlineRequest {
  if (!isRecord(command) || !hasOnlyKeys(command, ["name", "icaoCode", "iataCode"]))
    throw new TypeError("The charter airline has unknown or invalid fields.");
  const name = typeof command.name === "string" ? command.name.trim().replace(/\s+/g, " ") : "";
  const icaoCode = iata(command.icaoCode);
  const iataCode = command.iataCode == null || String(command.iataCode).trim() === "" ? null : iata(command.iataCode);
  if (name.length < 2 || name.length > 160 || !/^[A-Z]{3}$/.test(icaoCode) ||
      iataCode !== null && !/^[A-Z0-9]{2}$/.test(iataCode))
    throw new TypeError("The charter airline needs a name, a three-letter ICAO code and an optional IATA code.");
  return { name, icaoCode, iataCode };
}

export function isOccCharterAirline(value: unknown): value is OccCharterAirlineResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "icaoCode", "iataCode", "name"]) && isUuid(value.id) &&
    typeof value.icaoCode === "string" && /^[A-Z]{3}$/.test(value.icaoCode) &&
    (value.iataCode === undefined || value.iataCode === null ||
      typeof value.iataCode === "string" && /^[A-Z0-9]{2}$/.test(value.iataCode)) &&
    typeof value.name === "string" && value.name.length > 0;
}

/** The ramp catalog of active aircraft types (3-B). */
export function isRampAircraftTypes(value: unknown): value is RampAircraftTypesResponse {
  return isRecord(value) && hasOnlyKeys(value, ["aircraftTypes"]) && Array.isArray(value.aircraftTypes) &&
    value.aircraftTypes.every(type => isRecord(type) &&
      hasOnlyKeys(type, ["id", "icaoCode", "iataCode", "manufacturer", "model"]) && isUuid(type.id) &&
      typeof type.icaoCode === "string" && type.icaoCode.length > 0 &&
      (type.iataCode === undefined || type.iataCode === null || typeof type.iataCode === "string") &&
      typeof type.manufacturer === "string" && typeof type.model === "string");
}

/** The headers of a turnaround change; the ETag must be strong and the key a UUID. */
export function validatedTurnaroundHeaders(headers: OccTurnaroundCommandHeaders): OccTurnaroundCommandHeaders {
  if (!isRecord(headers) || !isStrongEntityTag(headers.ifMatch) || !isUuid(headers.idempotencyKey))
    throw new TypeError("A turnaround change needs its ETag and an Idempotency-Key.");
  return headers;
}

/** The optional headers of a positions command: a key needs the ETag (3-N10). */
export function validatedPositionHeaders(headers: OccPositionCommandHeaders | undefined): OccPositionCommandHeaders {
  const ifMatch = headers?.ifMatch ?? null;
  const idempotencyKey = headers?.idempotencyKey ?? null;
  if (ifMatch !== null && !isStrongEntityTag(ifMatch) || idempotencyKey !== null && !isUuid(idempotencyKey) ||
      idempotencyKey !== null && ifMatch === null)
    throw new TypeError("A positions command with a key needs the turnaround's ETag.");
  return { ifMatch, idempotencyKey };
}

export function isStrongEntityTag(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.trim() === value && value.startsWith('"') &&
    value.endsWith('"') && !value.startsWith('W/"') && !/["\u0000- \u007f]/.test(value.slice(1, -1));
}
