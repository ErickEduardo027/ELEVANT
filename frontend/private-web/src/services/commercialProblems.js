import { problemMessage } from './problemMessages';

/**
 * Spanish explanation of each Problem Details code of the commercial requests (Contratos) and of
 * the provisioning and airline catalog screens of Superadministración. The screens never show the
 * server title; codes they do not list fall back to the shared messages by status.
 */
export const COMMERCIAL_REQUEST_MESSAGES = Object.freeze({
  request_closed: 'La solicitud ya fue decidida o cancelada. Actualice la bandeja.',
  airline_unverified: 'Verifique la identidad de la aerolínea con una fuente oficial antes de aprobar.',
  representative_unconfirmed: 'Registre la confirmación del representante antes de aprobar.',
  representative_already_confirmed: 'La confirmación del representante ya estaba registrada. Actualice la solicitud.',
  airline_already_contracted: 'La aerolínea ya tiene un contrato vigente o en curso. Amplíe los servicios con una enmienda o una renovación de ese contrato.',
  airline_has_portal_account: 'La aerolínea ya tiene cuentas activas en el portal. Amplíe los servicios con una enmienda o una renovación de su contrato.',
  airline_code_in_use: 'El código IATA o ICAO ya pertenece a otra aerolínea que opera con AVIAM. Si es la misma, enmiende o renueve su contrato.',
  airline_profile_conflict: 'Otra ficha verificada ya usa ese código IATA o ICAO. Vincule la solicitud a esa ficha.',
  airline_identity_locked: 'La identidad de esta aerolínea ya está en contratos y facturas: no puede cambiarse desde aquí.',
  airline_already_linked: 'La solicitud ya está vinculada a una ficha de aerolínea. Actualice la solicitud.',
  profile_not_found: 'La ficha elegida ya no existe. Actualice el listado de aerolíneas.',
  invalid_airline: 'Revise la razón social, el país, los códigos (ICAO obligatorio; IATA solo si la aerolínea lo tiene) y la fuente HTTPS.',
  stations_invalid: 'Elija entre 1 y 30 estaciones activas.',
  confirmation_note_required: 'Describa cómo confirmó al representante (entre 5 y 1000 caracteres).',
  reason_required: 'Indique el motivo (entre 5 y 1000 caracteres).',
  invalid_commercial_request: 'Revise los datos de la decisión e intente de nuevo.',
  invalid_inbox_query: 'El filtro de la bandeja no es válido.',
  version_conflict: 'La solicitud cambió mientras la revisaba. Se actualizó; revise los datos e intente de nuevo.',
});

export const COMMERCIAL_GOVERNANCE_MESSAGES = Object.freeze({
  request_unavailable: 'La solicitud ya no espera su cuenta del portal: ya tiene una o su contrato se descartó. Actualice la lista.',
  email_in_use: 'Ese correo ya está registrado en ELEVANT y no es una cuenta del portal. Use otro correo.',
  invalid_provisioning: 'Revise el correo de acceso.',
  invitations_unavailable: 'Las invitaciones por correo no están configuradas. Entregue una contraseña temporal.',
  invitation_already_accepted: 'La cuenta ya aceptó la invitación.',
  password_policy: 'La contraseña temporal no cumple la política de seguridad.',
  // 1-N13: an email that already has an account, linkable or not.
  email_has_account: 'Ese correo ya tiene una cuenta del portal. Puede vincularla a esta solicitud sin cambiar su contraseña.',
  email_in_use_other_airline: 'Ese correo es la cuenta del portal de otra aerolínea. Use el correo del representante de esta aerolínea.',
  email_in_use_internal: 'Ese correo es una cuenta interna de AVIAM. Use el correo del representante de la aerolínea.',
  account_disabled: 'La cuenta de ese correo está desactivada. Reactívela desde Clientes y vuelva a intentarlo.',
  account_not_found: 'Ningún usuario usa ese correo. Revise la dirección o cree la cuenta.',
  invalid_client_user: 'Revise el nombre, el apellido y el correo del usuario.',
  invalid_email_outbox_query: 'El filtro de la bandeja de correos no es válido.',
  registry_check_required: 'Para publicarla, verifica la aerolínea en el registro público (check verde) o marca la verificación manual con su fuente.',
  invalid_airline: 'Revise los datos de la ficha: nombres, región, país, códigos y fuentes.',
  airline_profile_conflict: 'Otra ficha ya usa ese nombre de origen o ese código verificado.',
  airline_identity_locked: 'La aerolínea ya opera con AVIAM: su razón social, sus códigos y su verificación no pueden cambiar.',
  version_conflict: 'El registro cambió mientras lo editaba. Actualice e intente de nuevo.',
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const commercialRequestMessage = (error, options) =>
  problemMessage(error, COMMERCIAL_REQUEST_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const commercialGovernanceMessage = (error, options) =>
  problemMessage(error, COMMERCIAL_GOVERNANCE_MESSAGES, options);
