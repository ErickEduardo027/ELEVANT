/**
 * OCC's incidents of an operation (phase 3, block D, 3-G): the live list, OCC's own reports and the state changes with
 * their note and history. Every command takes an Idempotency-Key; a state change also the incident's ETag.
 */
import type {
  OccIncidentEventResponse,
  OccIncidentListResponse,
  OccIncidentResponse,
} from "../generated/elevant-api";
import { isIataDelayCode } from "./flightReport";

export const OCC_INCIDENT_TYPES = ["Operational", "Safety", "Equipment", "Documentation", "Deviation"] as const;
export type OccIncidentType = (typeof OCC_INCIDENT_TYPES)[number];
export const OCC_INCIDENT_SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
export type OccIncidentSeverity = (typeof OCC_INCIDENT_SEVERITIES)[number];
export const OCC_INCIDENT_STATUSES = ["Open", "InReview", "Resolved", "Closed"] as const;
export type OccIncidentStatus = (typeof OCC_INCIDENT_STATUSES)[number];
/** The states OCC moves an incident to (an incident is reported Open). */
export const OCC_INCIDENT_TARGETS = ["InReview", "Resolved", "Closed"] as const;
export type OccIncidentTarget = (typeof OCC_INCIDENT_TARGETS)[number];

/** An incident OCC reports, with the time it occurred in UTC (the screen converts the station's local time). */
export interface ReportOccIncidentCommand {
  readonly incidentType: OccIncidentType;
  readonly severity: OccIncidentSeverity;
  readonly description: string;
  readonly occurredAt: string;
  /** The IATA delay code of a deviation; none for the other types. */
  readonly delayCode?: string | null;
}

/** A change of an incident's state with its note (8 to 2000 characters). */
export interface ChangeOccIncidentStatusCommand {
  readonly status: OccIncidentTarget;
  readonly note: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isOptionalText = (value: unknown, max: number) =>
  value === null || value === undefined || (typeof value === "string" && value.length <= max);
const isInstant = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isOptionalInstant = (value: unknown) => value === null || value === undefined || isInstant(value);
const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);
const hasNoControl = (value: string) =>
  [...value].every(character => {
    const code = character.charCodeAt(0);
    return !(code < 32 && code !== 9 && code !== 10 && code !== 13) && code !== 127;
  });

const isEvent = (value: unknown): value is OccIncidentEventResponse =>
  isRecord(value) && hasOnlyKeys(value, ["fromStatus", "toStatus", "note", "occurredAt", "actor"]) &&
  (value.fromStatus === null || value.fromStatus === undefined || isOneOf(value.fromStatus, OCC_INCIDENT_STATUSES)) &&
  isOneOf(value.toStatus, OCC_INCIDENT_STATUSES) && isText(value.note, 2000) && isInstant(value.occurredAt) &&
  isText(value.actor, 200);

/** One incident as OCC manages it; every level is strict. */
export const isOccIncident = (value: unknown): value is OccIncidentResponse =>
  isRecord(value) &&
  hasOnlyKeys(value, ["id", "type", "severity", "status", "description", "occurredAt", "reportedAt", "delayCode",
    "reportedBy", "reportedByKind", "resolutionNote", "resolvedAt", "resolvedBy", "version", "allowedStatuses",
    "history"]) &&
  isUuid(value.id) && isText(value.type, 80) && isOneOf(value.severity, OCC_INCIDENT_SEVERITIES) &&
  isOneOf(value.status, OCC_INCIDENT_STATUSES) && isText(value.description, 4000) && isInstant(value.occurredAt) &&
  isInstant(value.reportedAt) &&
  (value.delayCode === null || value.delayCode === undefined || isIataDelayCode(value.delayCode)) &&
  isText(value.reportedBy, 200) && (value.reportedByKind === "Agent" || value.reportedByKind === "Occ") &&
  isOptionalText(value.resolutionNote, 2000) && isOptionalInstant(value.resolvedAt) &&
  isOptionalText(value.resolvedBy, 200) && isText(value.version, 64) &&
  Array.isArray(value.allowedStatuses) && value.allowedStatuses.every(status => isOneOf(status, OCC_INCIDENT_TARGETS)) &&
  Array.isArray(value.history) && value.history.length <= 500 && value.history.every(isEvent);

/** The live incidents of one operation, of the operation asked for. */
export const isOccIncidentList = (value: unknown, operationId: string): value is OccIncidentListResponse =>
  isRecord(value) &&
  hasOnlyKeys(value, ["operationId", "operationCode", "operationStatus", "ianaTimeZone", "canReport", "incidents"]) &&
  isUuid(value.operationId) && value.operationId.toLowerCase() === operationId.toLowerCase() &&
  isText(value.operationCode, 64) && isText(value.operationStatus, 32) && isText(value.ianaTimeZone, 64) &&
  typeof value.canReport === "boolean" && Array.isArray(value.incidents) && value.incidents.length <= 500 &&
  value.incidents.every(isOccIncident);

/** The report as the API takes it: a known type and severity, a description of 8 to 2000 and, for a deviation, its code. */
export function normalizedOccIncidentReport(command: ReportOccIncidentCommand): ReportOccIncidentCommand | null {
  if (!isRecord(command) || !isOneOf(command.incidentType, OCC_INCIDENT_TYPES) ||
      !isOneOf(command.severity, OCC_INCIDENT_SEVERITIES) || typeof command.description !== "string" ||
      !isInstant(command.occurredAt))
    return null;
  const description = command.description.trim();
  if (description.length < 8 || description.length > 2000 || !hasNoControl(description)) return null;
  const delayCode = typeof command.delayCode === "string" && command.delayCode.trim()
    ? command.delayCode.trim().toUpperCase() : null;
  if (command.incidentType === "Deviation" ? !isIataDelayCode(delayCode) : delayCode !== null) return null;
  return {
    incidentType: command.incidentType, severity: command.severity, description,
    occurredAt: new Date(command.occurredAt).toISOString(), delayCode,
  };
}

/** The change as the API takes it: a target state and a note of 8 to 2000 characters. */
export function normalizedOccIncidentStatus(
  command: ChangeOccIncidentStatusCommand,
): ChangeOccIncidentStatusCommand | null {
  if (!isRecord(command) || !isOneOf(command.status, OCC_INCIDENT_TARGETS) || typeof command.note !== "string")
    return null;
  const note = command.note.trim();
  return note.length >= 8 && note.length <= 2000 && hasNoControl(note) ? { status: command.status, note } : null;
}
