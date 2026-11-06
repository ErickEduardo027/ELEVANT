/**
 * Spanish messages for failed API calls, built from the Problem Details `code` and the HTTP status.
 * The server title and any exception text are never shown: a screen passes the messages of its
 * area and this module resolves them in a fixed order.
 */

export const SESSION_EXPIRED_MESSAGE = 'La sesión expiró. Vuelva a iniciar sesión.';
export const FORBIDDEN_MESSAGE = 'No tiene permiso para esta acción.';
export const DEFAULT_FALLBACK_MESSAGE = 'No se pudo completar la acción. Revise la conexión e intente de nuevo.';

const STATUS_MESSAGES = {
  404: 'El registro ya no existe.',
  409: 'El registro cambió; actualice e intente de nuevo.',
  400: 'Revise los datos e intente de nuevo.',
};

/** Codes every command module shares (stale version, reused key, missing reason…). */
export const COMMON_PROBLEM_MESSAGES = Object.freeze({
  version_conflict: 'El registro cambió mientras lo revisaba; actualice e intente de nuevo.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos; actualice e intente de nuevo.',
  idempotency_key_required: 'No se pudo identificar el envío; intente de nuevo.',
  expected_version_required: 'Actualice el registro antes de guardar los cambios.',
  reason_required: 'Indique el motivo (entre 5 y 1000 caracteres).',
  not_found: 'El registro ya no existe.',
});

const own = (messages, code) => typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code);

/**
 * Message for `error`, in this order: an expired session (401); the code in the area's messages,
 * then in the shared ones; permission (403); missing record (404); conflict (409); invalid data
 * (400); and finally `fallback` (network or server failure).
 *
 * @param {unknown} error ElevantApiError or the error of a private-web adapter (`status`, `code`).
 * @param {Record<string, string>} [codeMessages]
 * @param {{ fallback?: string, forbidden?: string }} [options]
 * @returns {string}
 */
export function problemMessage(error, codeMessages = {}, { fallback = DEFAULT_FALLBACK_MESSAGE,
  forbidden = FORBIDDEN_MESSAGE } = {}) {
  const status = typeof error?.status === 'number' ? error.status : undefined;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (own(codeMessages, code)) return codeMessages[code];
  if (own(COMMON_PROBLEM_MESSAGES, code)) return COMMON_PROBLEM_MESSAGES[code];
  if (status === 403) return forbidden;
  if (status in STATUS_MESSAGES) return STATUS_MESSAGES[status];
  return fallback;
}

/** The server refused the caller (403): the view shows its unauthorized state, not an error. */
export const isForbidden = error => error?.status === 403;

/** The record changed or is in another state (409): the view re-reads before a new attempt. */
export const isConflict = error => error?.status === 409;
