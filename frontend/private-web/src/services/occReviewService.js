import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { REVIEW_PROBLEM_MESSAGES } from '../features/review/reviewMessages';
import { problemMessage } from './problemMessages';

export class OccReviewServiceError extends Error {
  constructor(message, { status = null, code = 'request-failed' } = {}) {
    super(message);
    this.name = 'OccReviewServiceError';
    this.status = status;
    this.code = code;
  }
}

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

const FORBIDDEN = 'No tiene permiso para revisar esta operación.';
const FALLBACKS = {
  read: 'No fue posible cargar la revisión. Comprueba la conexión e intenta nuevamente.',
  decision: 'No fue posible confirmar el resultado. Actualiza la cola y el detalle antes de intentarlo de nuevo.',
  adjust: 'No fue posible guardar el ajuste. Actualiza el detalle antes de intentarlo de nuevo.',
  reopen: 'No fue posible confirmar la reapertura. Actualiza el detalle antes de intentarlo de nuevo.',
};
const REASON_MESSAGES = {
  decision: 'Escriba las correcciones necesarias (8 a 2000 caracteres).',
  adjust: 'El motivo debe tener entre 8 y 500 caracteres.',
  reopen: 'El motivo de la reapertura debe tener entre 8 y 2000 caracteres.',
};
// A reopening refused for its Service Order (3-H with 3-N02): the approval stays as it is, it is not sent to the ramp.
const ACTION_MESSAGES = {
  reopen: {
    service_order_unsigned: 'La Orden de Servicio de esta aprobación no está firmada: no se puede reabrir. Después de facturar, corrija con una nota de crédito.',
    service_order_stale: 'La Orden de Servicio cambió después de la firma: esta aprobación no se puede reabrir. Después de facturar, corrija con una nota de crédito.',
  },
};
// A refusal without a Problem Details code (an older server) is explained by its status.
const STATUS_CODES = { 404: 'not_found', 409: 'version_conflict', 412: 'version_conflict', 428: 'expected_version_required' };

// The adapter's own code when the server sent none, which the screens and the older tests read.
function legacyCode(status, action) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409 || status === 412) return 'stale';
  if (action !== 'read' && (status === null || status >= 500 || status < 400)) return 'unknown-outcome';
  return 'request-failed';
}

/**
 * The failure in Spanish by its Problem Details code (3-H, 3-N02, 3-N11, 3-N29), keeping the status and the code the
 * screen reacts to. A write without an answer (network, 5xx, unreadable body) is an unknown outcome: the screen re-reads
 * the detail, and a retry of the same intent reuses its Idempotency-Key.
 */
function safeError(error, action) {
  if (error?.name === 'AbortError') return error;
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (status === 401) handleUnauthorizedResponse({ status: 401 });
  const serverCode = typeof error?.code === 'string' ? error.code : null;
  const message = problemMessage({ status: status ?? undefined, code: serverCode ?? STATUS_CODES[status] },
    { ...REVIEW_PROBLEM_MESSAGES, ...ACTION_MESSAGES[action],
      reason_required: REASON_MESSAGES[action] ?? REASON_MESSAGES.adjust },
    { forbidden: FORBIDDEN, fallback: FALLBACKS[action] });
  return new OccReviewServiceError(message, { status, code: serverCode ?? legacyCode(status, action) });
}

const validReason = (value, maximum) =>
  typeof value === 'string' && value.trim().length >= 8 && value.trim().length <= maximum;

function invalidReason(action) {
  return new OccReviewServiceError(REASON_MESSAGES[action], { status: 400, code: 'reason_required' });
}

const keyed = (options, idempotencyKey) => (idempotencyKey ? { ...options, idempotencyKey } : options);

async function guarded(request, action) {
  try {
    return await request();
  } catch (error) {
    throw safeError(error, action);
  }
}

export const loadOccReviewQueue = (stationId, { signal } = {}) =>
  guarded(() => client().getOccReviewQueue(stationId, { signal }), 'read');

export const loadOccReviewDetail = (operationId, { signal } = {}) =>
  guarded(() => client().getOccReviewDetail(operationId, { signal }), 'read');

export const loadOccReviewSubmissionHistory = (operationId, { signal } = {}) =>
  guarded(() => client().getOccReviewSubmissionHistory(operationId, { signal }), 'read');

export const loadOccReviewSubmissionDetail = (operationId, submissionId, { signal } = {}) =>
  guarded(() => client().getOccReviewSubmissionDetail(operationId, submissionId, { signal }), 'read');

/**
 * OCC adds a charge to a service while reviewing (ADR-0034); resolves with the new review version. The intent's
 * Idempotency-Key replays a change whose answer was lost.
 */
export async function addOccReviewCharge(operationId, command, etag, { signal, idempotencyKey } = {}) {
  if (!validReason(command?.reason, 500)) throw invalidReason('adjust');
  return guarded(() => client().addOccReviewCharge(operationId, command, etag, keyed({ signal }, idempotencyKey)),
    'adjust');
}

export async function removeOccReviewCharge(operationId, markId, command, etag, { signal, idempotencyKey } = {}) {
  if (!validReason(command?.reason, 500)) throw invalidReason('adjust');
  return guarded(() => client().removeOccReviewCharge(operationId, markId, command, etag,
    keyed({ signal }, idempotencyKey)), 'adjust');
}

/** 3-N11: OCC excludes a service in Exception from billing, or bills it again, with a reason and its key. */
export async function setOccReviewBillingExclusion(operationId, serviceId, command, etag, idempotencyKey) {
  if (!validReason(command?.reason, 500)) throw invalidReason('adjust');
  return guarded(() => client().setOccReviewServiceBillingExclusion(operationId, serviceId, command, etag,
    idempotencyKey), 'adjust');
}

/** 3-H: OCC reopens an approval nothing was invoiced from; resolves with the new revision and its version. */
export async function reopenOccReview(operationId, command, etag, idempotencyKey) {
  if (!validReason(command?.reason, 2000)) throw invalidReason('reopen');
  return guarded(() => client().reopenOccReview(operationId, command, etag, idempotencyKey), 'reopen');
}

export async function decideOccReview(operationId, request, etag, { signal, idempotencyKey } = {}) {
  if (request?.outcome === 'Returned' && !validReason(request.reason, 2000)) throw invalidReason('decision');
  return guarded(() => client().decideOccReview(operationId, request, etag, keyed({ signal }, idempotencyKey)),
    'decision');
}
