import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';

/**
 * Gestión Humana › Configuración (ADR-0045): the custom permit types next to the two system ones and the equipment
 * types of the qualifications. Commands carry the intent's Idempotency-Key; an update carries the version on screen.
 */
function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** The names of the system permit types, for screens that could not read the catalog. */
export const SYSTEM_PERMIT_TYPE_NAMES = Object.freeze({
  AirportId: 'Carnet aeroportuario',
  RampDriverLicense: 'Licencia de conducir en rampa',
});

/** What a code no catalog names is called. */
export const UNKNOWN_PERMIT_TYPE_NAME = 'Permiso';

/** The name of a permit type code: the catalog's, else the system name, else «Permiso». */
export function permitTypeName(code, names = SYSTEM_PERMIT_TYPE_NAMES) {
  return names?.[code] ?? SYSTEM_PERMIT_TYPE_NAMES[code] ?? UNKNOWN_PERMIT_TYPE_NAME;
}

/** Spanish explanation of each Problem Details code of «Configuración». */
export const SETTINGS_PROBLEM_MESSAGES = Object.freeze({
  invalid_settings: 'Revisa los datos: el código lleva letras, dígitos o guiones y empieza por letra o dígito (de 2 a 32 en carnets y permisos, de 2 a 40 en equipos); el nombre, de 2 a 160 caracteres, y la descripción, hasta 500.',
  code_taken: 'Ese código ya existe (los del sistema también están reservados). Usa otro.',
  code_in_use: 'Está en uso: no se puede cambiar su código ni desactivarlo mientras una posición lo exige.',
  system_type_locked: 'Lo define el sistema: no se puede cambiar su código ni desactivarlo.',
  version_conflict: 'Otra persona lo cambió mientras editabas. Se actualizó la lista; revisa e inténtalo de nuevo.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Se actualizó la lista; inténtalo de nuevo.',
  not_found: 'El registro ya no existe.',
});

export const settingsMessage = (error, fallback) => problemMessage(error, SETTINGS_PROBLEM_MESSAGES, {
  fallback, forbidden: 'Tu acceso no permite gestionar la configuración de Gestión Humana.',
});

export const listPermitTypes = options => guarded(() => client().listHumanResourcesPermitTypes(options));

/** Creates a custom permit type (`permitTypeId` null) or updates one with its version. */
export const savePermitType = (permitTypeId, values, idempotencyKey) => guarded(() => (permitTypeId
  ? client().updateHumanResourcesPermitType(permitTypeId, values, idempotencyKey)
  : client().createHumanResourcesPermitType({ code: values.code, name: values.name, description: values.description },
    idempotencyKey)));

export const listEquipmentTypes = options => guarded(() => client().listHumanResourcesEquipmentTypes(options));

export const saveEquipmentType = (equipmentTypeId, values, idempotencyKey) => guarded(() => (equipmentTypeId
  ? client().updateHumanResourcesEquipmentType(equipmentTypeId, values, idempotencyKey)
  : client().createHumanResourcesEquipmentType({ code: values.code, name: values.name,
    requiresQualification: values.requiresQualification }, idempotencyKey)));

/**
 * The permit types a form offers and the names the lists show, from a catalog answer (`listPermitTypes`); without one
 * (no permission, an error) the system types.
 */
export function permitTypeCatalog(settings) {
  const names = { ...SYSTEM_PERMIT_TYPE_NAMES };
  if (!Array.isArray(settings?.permitTypes)) {
    return { names, types: Object.entries(SYSTEM_PERMIT_TYPE_NAMES)
      .map(([code, name]) => ({ code, name, isActive: true, isSystem: true })), fromCatalog: false };
  }
  settings.permitTypes.forEach(type => { names[type.code] = type.name; });
  return { names, types: settings.permitTypes, fromCatalog: true };
}
