import { problemMessage } from '../../../services/problemMessages';

const IN_ACTIVE_CONTRACT = 'No se puede dar de baja: un contrato vigente o en aprobación incluye este servicio, como tarifa o dentro de un paquete.';

/**
 * Spanish explanation of each Problem Details code of the catalog of services (phase 1, block D): the publication
 * rules, «Ocultar del catálogo público» versus «Dar de baja» (1-N03) and a service an approved closure keeps hidden
 * (1-N11). The screens never show the server title; codes not listed fall back to the shared messages.
 */
export const CATALOG_PROBLEM_MESSAGES = Object.freeze({
  service_in_active_contract: `${IN_ACTIVE_CONTRACT} Si no quiere ofrecerlo a nuevas aerolíneas, ocúltelo del catálogo público: los contratos y la operación lo conservan.`,
  retirement_command_required: 'El formulario no da de baja un servicio. Use «Dar de baja» para retirarlo, o desmarque «Visible al público» para ocultarlo.',
  closure_requires_reopen: 'Una clausura aprobada mantiene oculto este servicio. Republíquelo desde «Solicitudes de clausura» indicando el motivo.',
  service_retired: 'El servicio está dado de baja. Reactívelo antes de publicarlo.',
  service_code_exists: 'Ya existe un servicio con ese código. Actualice el catálogo y edite el existente.',
  image_required: 'Para publicarlo agregue una foto real del servicio, o guárdelo oculto.',
  description_too_short: 'Para publicarlo la descripción debe tener al menos 20 caracteres.',
  placeholder_name: 'Un servicio con nombre o código de prueba no puede publicarse.',
  billing_unit_unknown: 'La unidad de cobro ya no está activa. Elija otra de la lista.',
  media_invalid: 'La foto o el video ya no se pueden vincular. Vuelva a cargarlos e intente de nuevo.',
  invalid_service: 'El sistema rechazó los datos del servicio. Revise los campos e intente de nuevo.',
  reason_required: 'Indique el motivo de la baja (entre 10 y 1000 caracteres).',
  version_conflict: 'El servicio cambió mientras lo revisaba. Se actualizó el catálogo: vuelva a abrirlo e intente de nuevo.',
  not_found: 'El servicio ya no existe. Actualice el catálogo.',
});

/** Message when the server refuses the caller (403) on the catalog commands. */
export const CATALOG_FORBIDDEN_MESSAGE = 'No tiene permiso para gestionar el catálogo de servicios.';

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const catalogProblemMessage = (error, options) => problemMessage(error, CATALOG_PROBLEM_MESSAGES,
  { forbidden: CATALOG_FORBIDDEN_MESSAGE, ...options });

/**
 * The same messages for a service that is already hidden: a contract that keeps it still refuses «Dar de baja», but
 * there is nothing left to hide, and its dialog does not offer «Ocultar del catálogo».
 */
const HIDDEN_SERVICE_PROBLEM_MESSAGES = Object.freeze({
  ...CATALOG_PROBLEM_MESSAGES,
  service_in_active_contract: `${IN_ACTIVE_CONTRACT} Ya está oculto del catálogo público; podrá darlo de baja cuando ningún contrato lo incluya.`,
});

/**
 * Message of a failed command on one service of the catalog, by its availability. Without a service (the form) it
 * is {@link catalogProblemMessage}.
 *
 * @param {unknown} error @param {{ isPublic?: boolean } | null} [service]
 */
export const serviceProblemMessage = (error, service) => problemMessage(error,
  service?.isPublic === false ? HIDDEN_SERVICE_PROBLEM_MESSAGES : CATALOG_PROBLEM_MESSAGES,
  { forbidden: CATALOG_FORBIDDEN_MESSAGE });
