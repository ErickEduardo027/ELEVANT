/**
 * Gestión Humana › Configuración (ADR-0045): the custom permit types next to the two system ones and the equipment
 * types of the qualifications, under `human_resources.settings.*`, and the permits OCC requires at a stand. Every
 * command takes an Idempotency-Key and an update also the version on screen; nothing is deleted. The validators are
 * strict at every level.
 */
import type {
  ApplyStandRequiredPermitsInput,
  CreateEquipmentTypeInput,
  CreatePermitTypeInput,
  EquipmentTypeSettingData,
  EquipmentTypeSettingsData,
  PermitTypeSettingData,
  MasterStandData,
  PermitTypeSettingsData,
  SetStandRequiredPermitsInput,
  StandRequiredPermitsBatchData,
  StandPermitOptionData,
  StandRequiredPermitData,
  UpdateEquipmentTypeInput,
  UpdatePermitTypeInput,
} from "../generated/elevant-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
/** The two permit types defined by the platform, with their own rules. */
export const SYSTEM_PERMIT_TYPE_CODES = ["AirportId", "RampDriverLicense"] as const;
/** A custom permit type code: 2 to 32 upper-case letters, digits or hyphens. */
const PERMIT_CODE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
/** An equipment type code: the same shape, up to 40 characters. */
const EQUIPMENT_CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
const MAX_REQUIRED_PERMITS = 10;
const MAX_BATCH_STANDS = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isSystemCode = (value: unknown) => (SYSTEM_PERMIT_TYPE_CODES as readonly unknown[]).includes(value);
/** A code a permit cycle or a stand requirement keeps: a system one or a custom one. */
export const isPermitTypeCode = (value: unknown): value is string =>
  isSystemCode(value) || (typeof value === "string" && PERMIT_CODE.test(value));
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** A permit type: a system one has no id nor version and is always active. */
export function isPermitTypeSetting(value: unknown, permitTypeId?: string): value is PermitTypeSettingData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "code", "name", "description", "isActive", "isSystem", "inUse",
      "version"]) || !isPermitTypeCode(value.code) || !isText(value.name, 160) ||
      !(value.description == null || isText(value.description, 500)) || typeof value.isActive !== "boolean" ||
      typeof value.isSystem !== "boolean" || typeof value.inUse !== "boolean") return false;
  if (value.isSystem) return isSystemCode(value.code) && value.id == null && value.version == null && value.isActive;
  return !isSystemCode(value.code) && isUuid(value.id) && (permitTypeId === undefined || sameId(value.id, permitTypeId)) &&
    isText(value.version, 64);
}

export function isPermitTypeSettings(value: unknown): value is PermitTypeSettingsData {
  return isRecord(value) && hasOnlyKeys(value, ["permitTypes", "canCreate", "canUpdate"]) &&
    typeof value.canCreate === "boolean" && typeof value.canUpdate === "boolean" &&
    Array.isArray(value.permitTypes) && value.permitTypes.length <= 1000 &&
    value.permitTypes.every(item => isPermitTypeSetting(item)) &&
    new Set((value.permitTypes as PermitTypeSettingData[]).map(item => item.code)).size === value.permitTypes.length;
}

export function isEquipmentTypeSetting(value: unknown, equipmentTypeId?: string): value is EquipmentTypeSettingData {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name", "requiresQualification", "isActive", "isLocked", "inUse", "version"]) &&
    isUuid(value.id) && (equipmentTypeId === undefined || sameId(value.id, equipmentTypeId)) && isText(value.code, 40) &&
    isText(value.name, 160) && typeof value.requiresQualification === "boolean" && typeof value.isActive === "boolean" &&
    typeof value.isLocked === "boolean" && typeof value.inUse === "boolean" && isText(value.version, 64);
}

export function isEquipmentTypeSettings(value: unknown): value is EquipmentTypeSettingsData {
  return isRecord(value) && hasOnlyKeys(value, ["equipmentTypes", "canCreate", "canUpdate"]) &&
    typeof value.canCreate === "boolean" && typeof value.canUpdate === "boolean" &&
    Array.isArray(value.equipmentTypes) && value.equipmentTypes.length <= 1000 &&
    value.equipmentTypes.every(item => isEquipmentTypeSetting(item));
}

/** A permit a stand requires: its code and the name the screens show. */
export const isStandRequiredPermit = (value: unknown): value is StandRequiredPermitData => isRecord(value) &&
  hasOnlyKeys(value, ["code", "name"]) && isPermitTypeCode(value.code) && isText(value.name, 160);

/** A permit type OCC may require: a system one or an active custom one. */
export const isStandPermitOption = (value: unknown): value is StandPermitOptionData => isRecord(value) &&
  hasOnlyKeys(value, ["code", "name", "isSystem"]) && isPermitTypeCode(value.code) && isText(value.name, 160) &&
  typeof value.isSystem === "boolean" && value.isSystem === isSystemCode(value.code);

/** The permits of one stand: absent or null for an older server, otherwise at most ten distinct ones. */
export const isRequiredPermitList = (value: unknown) => value == null || (Array.isArray(value) &&
  value.length <= MAX_REQUIRED_PERMITS && value.every(isStandRequiredPermit) &&
  new Set(value.map(item => (item as StandRequiredPermitData).code)).size === value.length);

/** Names of permits a refusal or a board carries («Le falta: …», «Exige: …»). */
export const isPermitNameList = (value: unknown) => value == null || (Array.isArray(value) &&
  value.length <= MAX_REQUIRED_PERMITS && value.every(item => isText(item, 160)));

/** The stands a batch changed: exactly the ones of the request, each one a valid master-data stand. */
export function isMasterStandBatch(value: unknown, standIds: readonly string[]): value is StandRequiredPermitsBatchData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stands"]) || !Array.isArray(value.stands) ||
      value.stands.length !== standIds.length) return false;
  const wanted = new Set(standIds.map(id => id.toLowerCase()));
  return value.stands.every(stand => isRecord(stand) && isUuid(stand.id) && wanted.delete(stand.id.toLowerCase()) &&
    isMasterStandShape(stand as unknown as MasterStandData));
}

let isMasterStandShape: (stand: MasterStandData) => boolean = () => false;
/** masterData.ts registers its stand validator here (it imports this module, so the reverse import would cycle). */
export function useMasterStandValidator(validator: (stand: MasterStandData) => boolean) {
  isMasterStandShape = validator;
}

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const keys = (value: unknown, allowed: readonly string[], label: string): Record<string, unknown> => {
  if (!isRecord(value) || !hasOnlyKeys(value, allowed)) throw new TypeError(`${label} has unknown or invalid fields.`);
  return value;
};
const name = (value: unknown) => {
  const text = trimmed(value);
  if (text.length < 2 || text.length > 160) throw new TypeError("name must have 2 to 160 characters.");
  return text;
};
const description = (value: unknown) => {
  const text = trimmed(value);
  if (text.length > 500) throw new TypeError("description must have up to 500 characters.");
  return text || null;
};
const flag = (value: unknown, field: string) => {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean.`);
  return value;
};
const version = (value: unknown) => {
  if (!isText(value, 64)) throw new TypeError("expectedVersion is required.");
  return value as string;
};
const customCode = (value: unknown) => {
  const text = trimmed(value).toUpperCase();
  if (!PERMIT_CODE.test(text) || SYSTEM_PERMIT_TYPE_CODES.some(code => code.toUpperCase() === text))
    throw new TypeError("code is invalid.");
  return text;
};
const equipmentCode = (value: unknown) => {
  const text = trimmed(value).toUpperCase();
  if (!EQUIPMENT_CODE.test(text)) throw new TypeError("code is invalid.");
  return text;
};
const requiredCodes = (value: unknown) => {
  if (!Array.isArray(value)) throw new TypeError("documentTypeCodes must be a list.");
  const codes = [...new Set(value.map(item => trimmed(item)))].sort();
  if (codes.length > MAX_REQUIRED_PERMITS || !codes.every(isPermitTypeCode))
    throw new TypeError("documentTypeCodes is invalid.");
  return codes;
};

export function normalizedPermitTypeCreate(input: CreatePermitTypeInput): CreatePermitTypeInput {
  const value = keys(input, ["code", "name", "description"], "Permit type");
  return { code: customCode(value.code), name: name(value.name), description: description(value.description) };
}

export function normalizedPermitTypeUpdate(input: UpdatePermitTypeInput): UpdatePermitTypeInput {
  const value = keys(input, ["code", "name", "description", "isActive", "expectedVersion"], "Permit type");
  return { code: customCode(value.code), name: name(value.name), description: description(value.description),
    isActive: flag(value.isActive, "isActive"), expectedVersion: version(value.expectedVersion) };
}

export function normalizedEquipmentTypeCreate(input: CreateEquipmentTypeInput): CreateEquipmentTypeInput {
  const value = keys(input, ["code", "name", "requiresQualification"], "Equipment type");
  return { code: equipmentCode(value.code), name: name(value.name),
    requiresQualification: flag(value.requiresQualification, "requiresQualification") };
}

export function normalizedEquipmentTypeUpdate(input: UpdateEquipmentTypeInput): UpdateEquipmentTypeInput {
  const value = keys(input, ["code", "name", "requiresQualification", "isActive", "expectedVersion"], "Equipment type");
  return { code: equipmentCode(value.code), name: name(value.name),
    requiresQualification: flag(value.requiresQualification, "requiresQualification"),
    isActive: flag(value.isActive, "isActive"), expectedVersion: version(value.expectedVersion) };
}

export function normalizedStandRequiredPermits(input: SetStandRequiredPermitsInput): SetStandRequiredPermitsInput {
  const value = keys(input, ["documentTypeCodes", "expectedVersion"], "Stand required permits");
  return { documentTypeCodes: requiredCodes(value.documentTypeCodes), expectedVersion: version(value.expectedVersion) };
}

export function normalizedStandRequiredPermitsBatch(input: ApplyStandRequiredPermitsInput): ApplyStandRequiredPermitsInput {
  const value = keys(input, ["stationId", "standIds", "documentTypeCodes"], "Stand required permits");
  if (!isUuid(value.stationId)) throw new TypeError("stationId must be a canonical UUID.");
  if (!Array.isArray(value.standIds) || value.standIds.length === 0 || value.standIds.length > MAX_BATCH_STANDS ||
      !value.standIds.every(isUuid)) throw new TypeError("standIds must list 1 to 200 stands.");
  return { stationId: value.stationId, standIds: [...new Set((value.standIds as string[]).map(id => id.toLowerCase()))],
    documentTypeCodes: requiredCodes(value.documentTypeCodes) };
}
