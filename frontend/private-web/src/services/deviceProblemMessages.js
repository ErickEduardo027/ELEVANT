import { problemMessage } from './problemMessages';

/**
 * Spanish explanation of each Problem Details code of the shared tablets (phase 2, block E, 2-N02). The server title
 * is never shown; a code this map does not list falls back to the shared messages by status.
 */
export const DEVICE_PROBLEM_MESSAGES = Object.freeze({
  forbidden: 'Tu acceso no permite gestionar las tablets de esta estación.',
  not_found: 'La tablet ya no está en tu estación. Se actualizó la lista.',
  device_not_bound: 'La tablet ya estaba libre: el agente cerró sesión, otro agente la tomó u OCC la liberó.',
  device_revoked: 'La tablet está revocada: ya no puede vincularse con ningún agente.',
  device_in_use_by_active_agent: 'Un agente usa la tablet en una operación en curso.',
  reason_required: 'Indica el motivo (entre 5 y 500 caracteres).',
  invalid_mobile_device: 'Revisa los datos e intenta de nuevo.',
  version_conflict: 'La tablet cambió de manos mientras la revisabas. Se actualizó la lista; revisa e intenta de nuevo.',
});

/**
 * The message of a failed tablet call, from its code; never the server title. Without a status (no answer, a network
 * failure) it is the connection fallback: the intent keeps its key for the retry.
 */
export function deviceProblemMessage(error) {
  return problemMessage(error, DEVICE_PROBLEM_MESSAGES, { forbidden: DEVICE_PROBLEM_MESSAGES.forbidden,
    fallback: 'No fue posible completar la acción. Revisa la conexión e intenta de nuevo.' });
}
