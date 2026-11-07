/**
 * Flight feed review (phase 2, block C): OCC reads the proposals of airlines with a contract in force, the charter
 * candidates apart (2-B, ADR-0033) or the dismissed ones (2-N36); imports a pair with its aircraft type, its stand and
 * as a charter, with an Idempotency-Key and the versions on screen; and restores a dismissed proposal while its flight
 * has not passed. Airlines whose contract at the station is suspended or expired appear in no view (2-N16).
 */
import type { ImportOccFlightRequest, RestoreOccFlightProposalResponse } from "../generated/elevant-api";

export const OCC_FLIGHT_FEED_VIEWS = ["Contracted", "Charter", "Dismissed"] as const;
export type OccFlightFeedView = (typeof OCC_FLIGHT_FEED_VIEWS)[number];

/** «Importar escala»: the pair, the versions OCC saw and, optionally, the type, the stand and the charter mode. */
export interface ImportOccFlightCommand {
  readonly arrivalProposalId: string;
  readonly departureProposalId: string;
  readonly expectedArrivalVersion: string;
  readonly expectedDepartureVersion: string;
  readonly aircraftTypeId?: string | null;
  readonly standId?: string | null;
  readonly charter?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 64;

export const isOccFlightFeedView = (value: unknown): value is OccFlightFeedView =>
  (OCC_FLIGHT_FEED_VIEWS as readonly string[]).includes(value as string);

/** The import body: distinct proposals, both versions, and the optional type, stand and charter mode. */
export function normalizedFlightImport(command: ImportOccFlightCommand): ImportOccFlightRequest {
  if (!isRecord(command) || !hasOnlyKeys(command, ["arrivalProposalId", "departureProposalId", "expectedArrivalVersion",
      "expectedDepartureVersion", "aircraftTypeId", "standId", "charter"]))
    throw new TypeError("The flight import has unknown or invalid fields.");
  if (!isUuid(command.arrivalProposalId) || !isUuid(command.departureProposalId) ||
      command.arrivalProposalId.toLowerCase() === command.departureProposalId.toLowerCase())
    throw new TypeError("An arrival and a departure are required.");
  if (!isVersion(command.expectedArrivalVersion) || !isVersion(command.expectedDepartureVersion))
    throw new TypeError("Both expected versions are required.");
  if (command.aircraftTypeId != null && !isUuid(command.aircraftTypeId) || command.standId != null && !isUuid(command.standId) ||
      command.charter !== undefined && typeof command.charter !== "boolean")
    throw new TypeError("The aircraft type, the stand or the charter mode is invalid.");
  return {
    arrivalProposalId: command.arrivalProposalId, departureProposalId: command.departureProposalId,
    aircraftTypeId: command.aircraftTypeId ?? null, standId: command.standId ?? null, charter: command.charter === true,
    expectedArrivalVersion: command.expectedArrivalVersion, expectedDepartureVersion: command.expectedDepartureVersion,
  };
}

/** The proposal of the route back in the review, with its new version. */
export function isRestoredFlightProposal(value: unknown, proposalId: string): value is RestoreOccFlightProposalResponse {
  return isRecord(value) && hasOnlyKeys(value, ["proposalId", "status", "version", "replayed"]) &&
    isUuid(value.proposalId) && value.proposalId.toLowerCase() === proposalId.toLowerCase() &&
    value.status === "Proposed" && isVersion(value.version) && typeof value.replayed === "boolean";
}
