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
  // Phase 2, block E: representatives and signers of the portal (2-N20) and governance codes (2-N39).
  last_representative: 'Es el último representante activo de la aerolínea: designe a otro usuario antes de quitarle el rol.',
  protected_user: 'Esa cuenta está protegida: no puede modificarla desde aquí.',
  invalid_governance_data: 'Revise los datos e intente de nuevo.',
  governance_conflict: 'Los datos cambiaron mientras los editaba. Actualice e intente de nuevo.',
});

/**
 * Manual lifecycle of a contract (ADR-0024, phase 2 block A): suspend, reactivate, renew, terminate with the
 * signed notice or an immediate cause, and cancel a scheduled termination (2-N14, 2-N15, 2-N01).
 */
export const CONTRACT_LIFECYCLE_MESSAGES = Object.freeze({
  permit_required: 'La aerolínea no tiene un permiso de operación verificado y vigente.',
  no_version_in_force: 'No hay una versión firmada por ambas partes vigente; renueva el contrato.',
  draft_in_progress: 'Ya hay un borrador en curso para este contrato.',
  renewal_dates_invalid: 'La nueva vigencia debe empezar después de la versión actual y terminar después de empezar.',
  status_changed: 'El contrato cambió de estado; se volvió a cargar.',
  transition_not_allowed: 'Esa acción no aplica al estado actual del contrato.',
  reason_required: 'Escribe el motivo (5 a 500 caracteres).',
  no_approved_version: 'El contrato no tiene una versión firmada por ambas partes que renovar.',
  invalid_lifecycle_action: 'Revisa la acción y la nueva vigencia e intenta de nuevo.',
  version_awaiting_signatures: 'Una versión aprobada por Finanzas espera las firmas. Complétala o retírala antes de renovar o enmendar.',
  termination_scheduled: 'El contrato tiene una terminación programada: cancélala antes de renovarlo o de fijar otra fecha.',
  termination_not_scheduled: 'El contrato ya no tiene una terminación programada; se volvió a cargar.',
  termination_date_required: 'Indica la fecha efectiva de la terminación o una causa inmediata.',
  termination_notice_not_met: 'La fecha efectiva debe respetar el preaviso firmado; se volvió a cargar la fecha mínima.',
  immediate_cause_invalid: 'Elige como causa inmediata el incumplimiento o el mutuo acuerdo.',
  contract_terminated: 'El contrato ya terminó.',
});

/**
 * The document of a version, its signatures and the withdrawal of a version both parties have not signed
 * (ADR-0025, 2-N10, 2-N28).
 */
export const CONTRACT_DOCUMENT_MESSAGES = Object.freeze({
  airline_signature_pending: 'AVIAM contrafirma después de que firme la aerolínea.',
  validity_pending: 'Primero confirma la vigencia y la renovación.',
  content_changed: 'El contrato cambió mientras lo revisabas; se volvió a cargar. Revísalo antes de continuar.',
  already_signed: 'Esta parte ya firmó la versión; se volvió a cargar.',
  airline_signed_other_content: 'La aerolínea firmó un contenido distinto al actual: retira la versión para corregirla.',
  not_approved: 'La versión ya no está aprobada; se volvió a cargar.',
  version_signed: 'La versión ya rige el contrato: no se puede retirar.',
  contract_terminated: 'El contrato está terminado: esta versión ya no se firma.',
  termination_scheduled: 'La versión empieza en la fecha de terminación programada o después: ya no se firma.',
  signature_invalid: 'Escribe tu nombre completo y cargo y confirma que aceptas el contrato.',
  signature_image_invalid: 'Dibuja tu firma de nuevo: la imagen no es válida.',
  reason_required: 'Escribe el motivo (5 a 500 caracteres).',
  not_found: 'Esta versión ya no tiene documento disponible.',
});

/** The validity step Contratos completes after Finance and before the signatures (ADR-0025). */
export const CONTRACT_VALIDITY_MESSAGES = Object.freeze({
  renewal_mode_invalid: 'Elige si la renovación es manual o automática.',
  valid_to_required: 'Indica la fecha de fin de la vigencia.',
  dates_invalid: 'La fecha de fin debe ser posterior a la de inicio.',
  valid_from_past: 'La vigencia no puede empezar en el pasado (salvo una renovación posterior a la versión anterior).',
  valid_from_not_after_current: 'La vigencia debe empezar después del inicio de la versión vigente.',
  renewal_term_required: 'La renovación automática necesita el plazo de cada renovación.',
  renewal_term_invalid: 'El plazo de renovación va de 1 a 60 meses.',
  renewal_notice_invalid: 'El aviso de renovación va de 0 a 180 días y debe ser menor que la vigencia.',
  termination_notice_invalid: 'El preaviso de terminación va de 0 a 180 días y debe ser menor que la vigencia.',
  termination_terms_too_long: 'Las condiciones de terminación admiten hasta 4.000 caracteres.',
  packages_out_of_range: 'Los paquetes que aprobó Finanzas no cubren esas fechas; ajusta la vigencia o pide una nueva revisión.',
  content_changed: 'El contrato cambió mientras lo revisabas; se volvió a cargar.',
  already_signed: 'La versión ya tiene firmas: su vigencia no cambia. Se volvió a cargar.',
  not_approved: 'La versión ya no está aprobada; se volvió a cargar.',
  contract_terminated: 'El contrato está terminado: su vigencia ya no cambia.',
  termination_scheduled: 'La vigencia no puede empezar en la fecha de terminación programada o después.',
});

/**
 * The airline permit dossier (phase 2, block B): only a submitted permit is reviewed, only a verified one is
 * revoked, and both the rejection note and the revocation reason reach the airline (2-N09).
 */
export const AIRLINE_PERMIT_MESSAGES = Object.freeze({
  review_closed: 'Ese permiso ya fue revisado; se volvió a cargar la lista.',
  permit_not_verified: 'Solo se revoca un permiso verificado; se volvió a cargar la lista.',
  review_note_required: 'Escribe el motivo del rechazo (entre 5 y 500 caracteres); la aerolínea lo verá.',
  reason_required: 'Escribe el motivo de la revocación (entre 5 y 500 caracteres); la aerolínea lo verá.',
  permit_expired: 'No se puede verificar un permiso vencido.',
  version_conflict: 'El permiso cambió mientras lo revisabas; se volvió a cargar la lista.',
  not_found: 'El permiso ya no existe; se volvió a cargar la lista.',
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const airlinePermitMessage = (error, options) =>
  problemMessage(error, AIRLINE_PERMIT_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const contractLifecycleMessage = (error, options) =>
  problemMessage(error, CONTRACT_LIFECYCLE_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const contractDocumentMessage = (error, options) =>
  problemMessage(error, CONTRACT_DOCUMENT_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const contractValidityMessage = (error, options) =>
  problemMessage(error, CONTRACT_VALIDITY_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const commercialRequestMessage = (error, options) =>
  problemMessage(error, COMMERCIAL_REQUEST_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const commercialGovernanceMessage = (error, options) =>
  problemMessage(error, COMMERCIAL_GOVERNANCE_MESSAGES, options);
