/**
 * Master data (phase 2, block C, 2-A): the stations the superadministrator keeps and the terminals, stands and
 * aircraft types OCC keeps under `operations.master_data.*`. Every command takes an Idempotency-Key and an update also
 * the version on screen; nothing is deleted, only deactivated. The validators are strict at every level.
 */
import type {
  CreateAircraftTypeInput,
  CreateStandInput,
  CreateStationInput,
  CreateTerminalInput,
  MasterAircraftTypeData,
  MasterStandData,
  MasterTerminalData,
  OccMasterData,
  StationAirportData,
  StationCatalogData,
  StationCatalogItemData,
  UpdateAircraftTypeInput,
  UpdateStandInput,
  UpdateStationInput,
  UpdateTerminalInput,
} from "../generated/elevant-api";
// The largest aircraft a stand admits and the size of a type share the ground-time categories; null admits any size.
import { AIRCRAFT_SIZE_CATEGORIES, type AircraftSizeCategory } from "./operationalClose";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const isSize = (value: unknown) => value === null || value === undefined ||
  (AIRCRAFT_SIZE_CATEGORIES as readonly string[]).includes(value as string);
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const isAirport = (value: unknown): value is StationAirportData => isRecord(value) &&
  hasOnlyKeys(value, ["id", "iataCode", "icaoCode", "name", "city", "countryCode"]) && isUuid(value.id) &&
  matches(value.iataCode, /^[A-Z0-9]{3}$/) && matches(value.icaoCode, /^[A-Z0-9]{4}$/) && isText(value.name, 180) &&
  isText(value.city, 120) && matches(value.countryCode, /^[A-Z]{2}$/);

/** A station as the superadministrator sees it: code, name, IANA zone, airport, history and version. */
export function isStationCatalogItem(value: unknown, stationId?: string): value is StationCatalogItemData {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name", "ianaTimeZone", "isActive", "hasHistory", "airport", "version"]) &&
    isUuid(value.id) && (stationId === undefined || sameId(value.id, stationId)) && isText(value.code, 16) &&
    isText(value.name, 120) && isText(value.ianaTimeZone, 64) && typeof value.isActive === "boolean" &&
    typeof value.hasHistory === "boolean" && isAirport(value.airport) && isText(value.version, 64);
}

/** Every station, active or not, and the known airports that have no station yet. */
export function isStationCatalog(value: unknown): value is StationCatalogData {
  return isRecord(value) && hasOnlyKeys(value, ["stations", "availableAirports"]) &&
    Array.isArray(value.stations) && value.stations.length <= 1000 &&
    value.stations.every(station => isStationCatalogItem(station)) &&
    Array.isArray(value.availableAirports) && value.availableAirports.length <= 5000 && value.availableAirports.every(isAirport);
}

/** A terminal of the station; its code is fixed once it has history. */
export function isMasterTerminal(value: unknown, terminalId?: string): value is MasterTerminalData {
  return isRecord(value) && hasOnlyKeys(value, ["id", "code", "name", "isActive", "hasHistory", "version"]) &&
    isUuid(value.id) && (terminalId === undefined || sameId(value.id, terminalId)) && isText(value.code, 16) &&
    isText(value.name, 120) && typeof value.isActive === "boolean" && typeof value.hasHistory === "boolean" &&
    isText(value.version, 64);
}

/** A stand of the station; its code and terminal are fixed once flights or coverages used it. */
export function isMasterStand(value: unknown, standId?: string): value is MasterStandData {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "terminalId", "code", "hasBoardingBridge", "isRemote", "maxAircraftSize", "isActive",
      "hasHistory", "version"]) &&
    isUuid(value.id) && (standId === undefined || sameId(value.id, standId)) &&
    (value.terminalId === null || value.terminalId === undefined || isUuid(value.terminalId)) && isText(value.code, 24) &&
    typeof value.hasBoardingBridge === "boolean" && typeof value.isRemote === "boolean" && isSize(value.maxAircraftSize) &&
    typeof value.isActive === "boolean" && typeof value.hasHistory === "boolean" && isText(value.version, 64);
}

/** An aircraft type of the shared catalog; its ICAO designator never changes. */
export function isMasterAircraftType(value: unknown, aircraftTypeId?: string): value is MasterAircraftTypeData {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "icaoCode", "iataCode", "manufacturer", "model", "sizeCategory", "isActive", "version"]) &&
    isUuid(value.id) && (aircraftTypeId === undefined || sameId(value.id, aircraftTypeId)) &&
    matches(value.icaoCode, /^[A-Z][A-Z0-9]{3}$/) &&
    (value.iataCode === null || value.iataCode === undefined || matches(value.iataCode, /^[A-Z0-9]{3}$/)) &&
    isText(value.manufacturer, 100) && isText(value.model, 100) && isSize(value.sizeCategory) &&
    typeof value.isActive === "boolean" && isText(value.version, 64);
}

/** Terminals and stands of the station of the request (every stand in one of its terminals) and the aircraft types. */
export function isOccMasterData(value: unknown, stationId: string): value is OccMasterData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stationId", "stationCode", "terminals", "stands", "aircraftTypes",
      "canCreate", "canUpdate"]) || !isUuid(value.stationId) || !sameId(value.stationId, stationId) ||
      !isText(value.stationCode, 16) || typeof value.canCreate !== "boolean" || typeof value.canUpdate !== "boolean" ||
      !Array.isArray(value.terminals) || value.terminals.length > 500 || !value.terminals.every(item => isMasterTerminal(item)) ||
      !Array.isArray(value.stands) || value.stands.length > 2000 || !value.stands.every(item => isMasterStand(item)) ||
      !Array.isArray(value.aircraftTypes) || value.aircraftTypes.length > 2000 ||
      !value.aircraftTypes.every(item => isMasterAircraftType(item)))
    return false;
  const terminals = new Set((value.terminals as MasterTerminalData[]).map(item => item.id.toLowerCase()));
  return (value.stands as MasterStandData[]).every(stand => stand.terminalId == null || terminals.has(stand.terminalId.toLowerCase()));
}

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const name = (value: unknown, max: number, field: string) => {
  const text = trimmed(value);
  if (text.length < 2 || text.length > max) throw new TypeError(`${field} must have 2 to ${max} characters.`);
  return text;
};
const code = (value: unknown, pattern: RegExp, field: string) => {
  const text = trimmed(value).toUpperCase();
  if (!pattern.test(text)) throw new TypeError(`${field} is invalid.`);
  return text;
};
const size = (value: unknown, field: string): AircraftSizeCategory | null => {
  if (value === null || value === undefined || value === "") return null;
  if (!(AIRCRAFT_SIZE_CATEGORIES as readonly string[]).includes(value as string)) throw new TypeError(`${field} is invalid.`);
  return value as AircraftSizeCategory;
};
const flag = (value: unknown, field: string) => {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean.`);
  return value;
};
const version = (value: unknown) => {
  if (!isText(value, 64)) throw new TypeError("expectedVersion is required.");
  return value as string;
};
const keys = (value: unknown, allowed: readonly string[], label: string): Record<string, unknown> => {
  if (!isRecord(value) || !hasOnlyKeys(value, allowed)) throw new TypeError(`${label} has unknown or invalid fields.`);
  return value;
};
const zone = (value: unknown) => {
  const text = trimmed(value);
  if (!text || text.length > 64 || !/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/.test(text))
    throw new TypeError("ianaTimeZone must be an IANA time zone.");
  return text;
};

const TERMINAL = /^[A-Z0-9](?:[A-Z0-9-]{0,14}[A-Z0-9])?$/;
const STAND = /^[A-Z0-9](?:[A-Z0-9-]{0,22}[A-Z0-9])?$/;

/** A new station: its code is the airport's IATA code; the airport fields are only needed for an unknown airport. */
export function normalizedStationCreate(input: CreateStationInput): CreateStationInput {
  const value = keys(input, ["code", "name", "ianaTimeZone", "airportIcaoCode", "airportName", "airportCity",
    "airportCountryCode"], "Station");
  const icao = optional(value.airportIcaoCode);
  const country = optional(value.airportCountryCode);
  return {
    code: code(value.code, /^[A-Z]{3}$/, "code"), name: name(value.name, 120, "name"), ianaTimeZone: zone(value.ianaTimeZone),
    airportIcaoCode: icao === null ? null : code(icao, /^[A-Z]{4}$/, "airportIcaoCode"),
    airportName: optional(value.airportName) === null ? null : name(value.airportName, 180, "airportName"),
    airportCity: optional(value.airportCity) === null ? null : name(value.airportCity, 120, "airportCity"),
    airportCountryCode: country === null ? null : code(country, /^[A-Z]{2}$/, "airportCountryCode"),
  };
}

export function normalizedStationUpdate(input: UpdateStationInput): UpdateStationInput {
  const value = keys(input, ["name", "ianaTimeZone", "isActive", "expectedVersion"], "Station");
  return { name: name(value.name, 120, "name"), ianaTimeZone: zone(value.ianaTimeZone), isActive: flag(value.isActive, "isActive"),
    expectedVersion: version(value.expectedVersion) };
}

export function normalizedTerminalCreate(input: CreateTerminalInput): CreateTerminalInput {
  const value = keys(input, ["stationId", "code", "name"], "Terminal");
  if (!isUuid(value.stationId)) throw new TypeError("stationId must be a canonical UUID.");
  return { stationId: value.stationId, code: code(value.code, TERMINAL, "code"), name: name(value.name, 120, "name") };
}

export function normalizedTerminalUpdate(input: UpdateTerminalInput): UpdateTerminalInput {
  const value = keys(input, ["code", "name", "isActive", "expectedVersion"], "Terminal");
  return { code: code(value.code, TERMINAL, "code"), name: name(value.name, 120, "name"),
    isActive: flag(value.isActive, "isActive"), expectedVersion: version(value.expectedVersion) };
}

export function normalizedStandCreate(input: CreateStandInput): CreateStandInput {
  const value = keys(input, ["stationId", "terminalId", "code", "hasBoardingBridge", "isRemote", "maxAircraftSize"], "Stand");
  if (!isUuid(value.stationId) || !isUuid(value.terminalId)) throw new TypeError("stationId and terminalId must be UUIDs.");
  return { stationId: value.stationId, terminalId: value.terminalId, code: code(value.code, STAND, "code"),
    hasBoardingBridge: flag(value.hasBoardingBridge, "hasBoardingBridge"), isRemote: flag(value.isRemote, "isRemote"),
    maxAircraftSize: size(value.maxAircraftSize, "maxAircraftSize") };
}

export function normalizedStandUpdate(input: UpdateStandInput): UpdateStandInput {
  const value = keys(input, ["terminalId", "code", "hasBoardingBridge", "isRemote", "maxAircraftSize", "isActive",
    "expectedVersion"], "Stand");
  if (!isUuid(value.terminalId)) throw new TypeError("terminalId must be a canonical UUID.");
  return { terminalId: value.terminalId, code: code(value.code, STAND, "code"),
    hasBoardingBridge: flag(value.hasBoardingBridge, "hasBoardingBridge"), isRemote: flag(value.isRemote, "isRemote"),
    maxAircraftSize: size(value.maxAircraftSize, "maxAircraftSize"), isActive: flag(value.isActive, "isActive"),
    expectedVersion: version(value.expectedVersion) };
}

const iata = (value: unknown) => {
  const text = optional(value);
  return text === null ? null : code(text, /^[A-Z0-9]{3}$/, "iataCode");
};

export function normalizedAircraftTypeCreate(input: CreateAircraftTypeInput): CreateAircraftTypeInput {
  const value = keys(input, ["icaoCode", "iataCode", "manufacturer", "model", "sizeCategory"], "Aircraft type");
  return { icaoCode: code(value.icaoCode, /^[A-Z][A-Z0-9]{3}$/, "icaoCode"), iataCode: iata(value.iataCode),
    manufacturer: name(value.manufacturer, 100, "manufacturer"), model: name(value.model, 100, "model"),
    sizeCategory: size(value.sizeCategory, "sizeCategory") };
}

export function normalizedAircraftTypeUpdate(input: UpdateAircraftTypeInput): UpdateAircraftTypeInput {
  const value = keys(input, ["iataCode", "manufacturer", "model", "sizeCategory", "isActive", "expectedVersion"],
    "Aircraft type");
  return { iataCode: iata(value.iataCode), manufacturer: name(value.manufacturer, 100, "manufacturer"),
    model: name(value.model, 100, "model"), sizeCategory: size(value.sizeCategory, "sizeCategory"),
    isActive: flag(value.isActive, "isActive"), expectedVersion: version(value.expectedVersion) };
}
