import { problemMessage } from '../../../services/problemMessages';

/**
 * Spanish explanation of each Problem Details code of the contract drafts (phase 1, block B): the
 * readiness causes that block «Enviar a Finanzas», the scope, the discard and the observations. Block C
 * adds a retired package, the unit codes and the amendment. The screens never show the server title.
 * Contratos addresses its users as tú (D-N36), the shared fallbacks included.
 */
export const DRAFT_PROBLEM_MESSAGES = Object.freeze({
  invalid_draft: 'Revisa las condiciones, la vigencia, la moneda y las tarifas del borrador.',
  draft_closed: 'El borrador ya no está en curso: fue aprobado, descartado o el contrato terminó. Actualiza la lista.',
  draft_in_finance_review: 'Finanzas está revisando el borrador: no se puede modificar hasta que lo devuelva.',
  portal_account_missing: 'La aerolínea todavía no tiene cuenta en el portal. Superadministración debe crearla antes del envío.',
  terms_missing: 'Escribe y guarda las condiciones del contrato.',
  services_missing: 'Agrega al menos un servicio al borrador.',
  rates_unconfirmed: 'Confirma y guarda todas las tarifas (0 = cortesía).',
  stations_missing: 'Asigna al menos una estación al borrador.',
  service_retired: 'Quita del alcance los servicios dados de baja del catálogo.',
  package_not_eligible: 'Un paquete vinculado no corresponde a la moneda o la vigencia del contrato. Cámbialo o quítalo primero.',
  package_retired: 'Finanzas retiró un paquete vinculado. Quítalo de los paquetes del contrato antes de enviarlo.',
  billing_unit_unknown: 'Elige para cada tarifa una unidad de cobro activa de la lista.',
  valid_from_not_after_current: 'La vigencia debe empezar después del inicio de la versión aprobada vigente.',
  finance_reviewer_missing: 'Nadie en Finanzas cubre todas las estaciones del borrador. Pide que asignen esas estaciones a un revisor.',
  service_not_found: 'Un servicio elegido ya no existe en el catálogo. Actualiza el alcance.',
  service_in_package: 'No puedes quitar un servicio que cubre un paquete vinculado. Quita primero el paquete.',
  scope_invalid: 'Elige entre 1 y 100 servicios y entre 1 y 30 estaciones.',
  stations_invalid: 'Elige entre 1 y 30 estaciones activas.',
  comment_required: 'Escribe la observación (hasta 2000 caracteres).',
  reason_required: 'Indica el motivo (entre 5 y 500 caracteres).',
  version_conflict: 'El borrador cambió mientras lo editabas. Se actualizó; revisa los datos e intenta de nuevo.',
  // 2-N15: nothing starts on or after the scheduled termination of the contract.
  termination_scheduled: 'El contrato termina antes del inicio de este borrador: cambia la vigencia o descártalo.',
});

/** The readiness checklist, in the order the server reports the causes. */
export const READINESS_CHECKS = Object.freeze([
  ['portal_account_missing', 'Cuenta del portal de la aerolínea'],
  ['terms_missing', 'Condiciones del contrato'],
  ['services_missing', 'Al menos un servicio'],
  ['rates_unconfirmed', 'Tarifas confirmadas'],
  ['stations_missing', 'Estaciones asignadas'],
  ['service_retired', 'Sin servicios dados de baja'],
  ['package_not_eligible', 'Paquetes en la moneda y la vigencia del contrato'],
  ['package_retired', 'Sin paquetes retirados por Finanzas'],
  ['valid_from_not_after_current', 'Vigencia posterior a la versión aprobada vigente'],
  ['finance_reviewer_missing', 'Un revisor de Finanzas cubre todas las estaciones'],
]);

export const PORTAL_ACCOUNT_LABELS = Object.freeze({
  Active: 'Cuenta del portal activa.',
  Invited: 'Cuenta del portal creada; la aerolínea aún no activó su invitación.',
  Missing: 'Sin cuenta del portal: Superadministración debe crearla. Recibirás un aviso cuando esté lista.',
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const draftProblemMessage = (error, options) =>
  problemMessage(error, DRAFT_PROBLEM_MESSAGES, { register: 'tu', ...options });

/** «Crear enmienda» from the contract (1-C): one message per cause the amendment cannot start. */
export const AMENDMENT_PROBLEM_MESSAGES = Object.freeze({
  valid_from_not_after_current: 'La enmienda debe empezar después del inicio de la versión aprobada vigente.',
  valid_from_after_current_end: 'La enmienda no puede empezar después del fin de la versión aprobada vigente; para un período nuevo usa «Renovar».',
  draft_in_progress: 'El contrato ya tiene un borrador en curso. Complétalo o descártalo en Borradores antes de crear otra enmienda.',
  contract_not_amendable: 'Solo se enmienda un contrato activo o suspendido. Un contrato vencido se renueva.',
  no_approved_version: 'El contrato no tiene una versión aprobada que enmendar.',
  invalid_amendment: 'Indica la fecha de inicio de la enmienda.',
  version_conflict: 'El contrato cambió de estado. Se volvió a cargar; revísalo e intenta de nuevo.',
  not_found: 'El contrato ya no existe o no pertenece a tus estaciones.',
  // Phase 2, block A: an approved version still waiting for both signatures, a terminated contract and one
  // whose scheduled termination falls on or before the start.
  version_awaiting_signatures: 'Una versión aprobada por Finanzas espera las firmas. Complétala o retírala antes de crear otra enmienda.',
  contract_terminated: 'El contrato está terminado: no admite enmiendas.',
  termination_scheduled: 'El contrato tiene una terminación programada en esa fecha o antes: la enmienda debe empezar antes.',
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const amendmentProblemMessage = (error, options) =>
  problemMessage(error, AMENDMENT_PROBLEM_MESSAGES, { register: 'tu', ...options });
