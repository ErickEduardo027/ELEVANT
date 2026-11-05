/**
 * AVIAM forms of a ramp operation (ADR-0032): Orden de Servicio, Reporte de Vuelo and Check-List
 * del Puente, signed on the tablet against the exact content hash, plus walk-around damage marks.
 */
import type {
  AirlineServiceOrderResponse,
  DamageMarkResponse,
  OperationDocumentResponse,
  OperationDocumentsResponse,
  OperationDocumentSignatureResponse,
} from "../generated/elevant-api";

export const OPERATION_DOCUMENT_KINDS = ["ServiceOrder", "FlightReport", "BridgeChecklist", "CharterServiceRequest"] as const;
export type OperationDocumentKind = (typeof OPERATION_DOCUMENT_KINDS)[number];

export const OPERATION_SIGNATURE_ROLES = ["AirlineRepresentative", "AviamAgent", "Coordinator", "BridgeOperator"] as const;
export type OperationSignatureRole = (typeof OPERATION_SIGNATURE_ROLES)[number];

/** Who signs each form, as the server requires it. */
export const OPERATION_DOCUMENT_SIGNERS: Readonly<Record<OperationDocumentKind, readonly OperationSignatureRole[]>> = {
  ServiceOrder: ["AirlineRepresentative", "AviamAgent"],
  FlightReport: ["Coordinator"],
  BridgeChecklist: ["BridgeOperator"],
  CharterServiceRequest: ["AirlineRepresentative", "AviamAgent"],
};

/** Top view of an airliner, nose to the left, in a box `ASPECT` times wider than tall (same as the PDF). */
export const AIRCRAFT_SILHOUETTE = {
  aspect: 1.6,
  outline: [
    [0.02, 0.5], [0.05, 0.465], [0.1, 0.45], [0.38, 0.45], [0.56, 0.04], [0.62, 0.04], [0.52, 0.45],
    [0.82, 0.45], [0.92, 0.24], [0.96, 0.24], [0.94, 0.47], [0.99, 0.48], [0.99, 0.52], [0.94, 0.53],
    [0.96, 0.76], [0.92, 0.76], [0.82, 0.55], [0.52, 0.55], [0.62, 0.96], [0.56, 0.96], [0.38, 0.55],
    [0.1, 0.55], [0.05, 0.535],
  ] as readonly (readonly [number, number])[],
} as const;

/** Signature pad ratio (width : height) the strokes are normalized to. */
export const SIGNATURE_PAD_ASPECT = 3;
export const SIGNATURE_MAX_STROKES = 64;
export const SIGNATURE_MAX_POINTS = 2_000;

export interface SignOperationDocumentCommand {
  readonly signerName: string;
  readonly documentSha256: string;
  /** Strokes as flat lists of normalized points [x0, y0, x1, y1, …], each value 0–1. */
  readonly strokes: readonly (readonly number[])[];
  /** ID or passport number; only the charter service request asks for it, and the API never returns it. */
  readonly signerIdentification?: string | null;
}

export interface RecordDamageMarkCommand {
  readonly x: number;
  readonly y: number;
  readonly note: string;
  readonly reportedAt: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max = 2_000): value is string => typeof value === "string" && value.length <= max;
const isOptionalText = (value: unknown, max = 200) => value === null || value === undefined || isText(value, max);
const isOptionalInt = (value: unknown, max: number) =>
  value === null || value === undefined || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max);
const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const isOptionalNumber = (value: unknown) => value === null || value === undefined || isNumber(value);
const isInstant = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isUnit = (value: unknown) => isNumber(value) && (value as number) >= 0 && (value as number) <= 1;

export const isOperationDocumentKind = (value: unknown): value is OperationDocumentKind =>
  typeof value === "string" && (OPERATION_DOCUMENT_KINDS as readonly string[]).includes(value);
export const isOperationSignatureRole = (value: unknown): value is OperationSignatureRole =>
  typeof value === "string" && (OPERATION_SIGNATURE_ROLES as readonly string[]).includes(value);

const isSignature = (value: unknown): value is OperationDocumentSignatureResponse =>
  isRecord(value) && isOperationSignatureRole(value.role) && isText(value.signerName, 120) && isInstant(value.signedAt);

const isDocument = (value: unknown): value is OperationDocumentResponse => {
  if (!isRecord(value) || !isOperationDocumentKind(value.kind) || !isText(value.number, 24) || !isText(value.title, 200) ||
      !isText(value.formCode, 40) || typeof value.contentSha256 !== "string" || !SHA256.test(value.contentSha256) ||
      !Array.isArray(value.requiredRoles) || !value.requiredRoles.every(isOperationSignatureRole) ||
      !Array.isArray(value.signatures) || !value.signatures.every(isSignature) ||
      !Array.isArray(value.staleRoles) || !value.staleRoles.every(isOperationSignatureRole) ||
      typeof value.isFullySigned !== "boolean" || !isRecord(value.summary))
    return false;
  const summary = value.summary;
  return isOptionalText(summary.flightIn, 16) && isOptionalText(summary.flightOut, 16) &&
    isOptionalText(summary.registration, 16) && isOptionalText(summary.aircraftType, 120) &&
    isOptionalText(summary.position, 32) && isOptionalInt(summary.passengersIn, 999) &&
    isOptionalInt(summary.passengersOut, 999) && isOptionalInt(summary.mtowKg, 700_000) &&
    Array.isArray(summary.services) && summary.services.every(line => isRecord(line) && isText(line.code, 64) &&
      isText(line.name, 200) && isNumber(line.quantity) && isText(line.unit, 40) && isOptionalNumber(line.amount)) &&
    Array.isArray(summary.surcharges) && summary.surcharges.every(item => isText(item, 300)) &&
    isOptionalText(summary.currencyCode, 3) && isOptionalNumber(summary.totalAmount) &&
    [summary.milestoneCount, summary.checklistAnswered, summary.checklistTotal, summary.damageCount]
      .every(count => Number.isInteger(count) && (count as number) >= 0);
};

const isDamageMark = (value: unknown): value is DamageMarkResponse =>
  isRecord(value) && typeof value.id === "string" && UUID.test(value.id) && isUnit(value.x) && isUnit(value.y) &&
  isText(value.note, 500) && isInstant(value.reportedAt) && typeof value.hasPhoto === "boolean";

export const isOperationDocumentsResponse = (value: unknown, operationId?: string): value is OperationDocumentsResponse =>
  isRecord(value) && typeof value.operationId === "string" &&
  (operationId === undefined || value.operationId.toLowerCase() === operationId.toLowerCase()) &&
  Array.isArray(value.documents) && value.documents.every(isDocument) &&
  Array.isArray(value.damageMarks) && value.damageMarks.every(isDamageMark);

export const isAirlineServiceOrderResponse = (value: unknown, operationId?: string): value is AirlineServiceOrderResponse =>
  isRecord(value) && typeof value.operationId === "string" &&
  (operationId === undefined || value.operationId.toLowerCase() === operationId.toLowerCase()) &&
  isText(value.number, 24) && typeof value.contentSha256 === "string" && SHA256.test(value.contentSha256) &&
  Array.isArray(value.signatures) && value.signatures.every(isSignature) &&
  isOptionalText(value.currencyCode, 3) && isOptionalNumber(value.totalAmount);

/** Returns the command ready to send, or null when it is not a plausible signature. */
export const normalizedSignature = (command: SignOperationDocumentCommand): SignOperationDocumentCommand | null => {
  const signerName = typeof command?.signerName === "string" ? command.signerName.trim().replace(/\s+/g, " ") : "";
  if (signerName.length < 2 || signerName.length > 120 || typeof command.documentSha256 !== "string" ||
      !SHA256.test(command.documentSha256) || !Array.isArray(command.strokes) || command.strokes.length === 0 ||
      command.strokes.length > SIGNATURE_MAX_STROKES)
    return null;
  let points = 0;
  const strokes: number[][] = [];
  for (const stroke of command.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length % 2 !== 0 || !stroke.every(isUnit)) return null;
    points += stroke.length / 2;
    strokes.push(stroke.map(value => Math.round(value * 1000) / 1000));
  }
  if (points < 2 || points > SIGNATURE_MAX_POINTS) return null;
  if (command.signerIdentification === undefined || command.signerIdentification === null)
    return { signerName, documentSha256: command.documentSha256, strokes };
  const signerIdentification = typeof command.signerIdentification === "string"
    ? command.signerIdentification.replace(/\s+/g, "").toUpperCase() : "";
  return /^[A-Z0-9-]{4,40}$/.test(signerIdentification)
    ? { signerName, documentSha256: command.documentSha256, strokes, signerIdentification } : null;
};

export const isValidDamageMark = (command: RecordDamageMarkCommand) =>
  isRecord(command) && isUnit(command.x) && isUnit(command.y) && typeof command.note === "string" &&
  command.note.trim().length >= 3 && command.note.trim().length <= 500 && isInstant(command.reportedAt);
