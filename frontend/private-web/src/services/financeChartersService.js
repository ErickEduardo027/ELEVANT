import { normalizedPrepayment, normalizedPrepaymentReopening } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/**
 * The Problem Details codes of Finance's charters (ADR-0033, 3-N24, 4-N22) in Spanish; the screen never shows the
 * server's title.
 */
export const CHARTER_PROBLEM_MESSAGES = Object.freeze({
  // 4-N22: applied to the invoice, the prepayment is reversed in «Cobros» before it is reopened or corrected.
  charter_prepayment_applied: 'El prepago ya se aplicó a la factura del charter. Revierta el cobro en «Cobros» y reabra el prepago para corregirlo.',
  // 4-N22: another receipt of the airline was posted at the same moment; nothing was saved.
  charter_prepayment_receipt_conflict: 'Otro cobro de la aerolínea se registró al mismo tiempo y el prepago no se guardó. Se actualizó la lista; confírmelo de nuevo.',
  invalid_charter_request: 'Revise el monto y la referencia del prepago.',
  charter_prepayment_not_confirmed: 'El prepago ya no está confirmado. Se actualizó la lista.',
  charter_prepayment_confirmed: 'El prepago ya está confirmado: reabra la cotización para agregar servicios.',
  version_conflict: 'El charter cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.',
  expected_version_required: 'Actualice la lista antes de reabrir la cotización.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Se actualizó la lista; intente de nuevo.',
  reason_required: 'Indique el motivo de la reapertura (entre 8 y 500 caracteres).',
  not_found: 'El charter ya no existe o no es de sus estaciones.',
});

/** 4-N22: what the confirmation and its correction say in place of the reopening's texts. */
const ACTION_MESSAGES = {
  confirm: { expected_version_required: 'Actualice la lista antes de confirmar el prepago.' },
  correct: {
    expected_version_required: 'Actualice la lista antes de corregir el prepago.',
    reason_required: 'Indique el motivo de la corrección (entre 5 y 500 caracteres).',
  },
};

const FORBIDDEN = 'Su acceso no incluye los charters de Finanzas.';
const INVALID = {
  confirm: 'Revise el monto y la referencia del prepago.',
  correct: 'Revise el monto y la referencia del prepago.',
  reopen: 'Indique el motivo de la reapertura (entre 8 y 500 caracteres).',
};
const FALLBACK = {
  read: 'No se pudieron cargar los charters. Intente nuevamente.',
  confirm: 'No se pudo confirmar el prepago. Actualice la lista antes de intentarlo de nuevo.',
  correct: 'No se pudo confirmar la corrección del prepago. Actualice la lista antes de intentarlo de nuevo.',
  reopen: 'No se pudo confirmar la reapertura. Actualice la lista antes de intentarlo de nuevo.',
};
// A refusal without a code (the confirmation, or a server before phase 3, block D) is explained by its status.
const STATUS_CODES = { 404: 'not_found' };
const CONFIRMED_ELSEWHERE = 'Este charter ya tiene otro prepago confirmado. Se actualizó la lista.';

/**
 * The failure in Spanish by its Problem Details code, keeping the status and the code the screen reacts to: 403 shows
 * the unauthorized state and 409 re-reads the list before a new intent. The commands check their data before sending,
 * so a failure of the call itself (no answer) is an unknown outcome: the screen re-reads and a retry of the same intent
 * reuses its Idempotency-Key.
 */
function translate(error, action) {
  if (error?.name === 'AbortError') return error;
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (status === 401) handleUnauthorizedResponse({ status: 401 });
  const code = typeof error?.code === 'string' ? error.code : null;
  const message = action === 'confirm' && status === 409 && !code ? CONFIRMED_ELSEWHERE
    : status === 400 && !code ? INVALID[action] ?? FALLBACK[action]
      : problemMessage({ status: status ?? undefined, code: code ?? STATUS_CODES[status] },
        { ...CHARTER_PROBLEM_MESSAGES, ...ACTION_MESSAGES[action] }, { forbidden: FORBIDDEN, fallback: FALLBACK[action] });
  return Object.assign(new Error(message), { status, code });
}

async function guarded(request, action) {
  try { return await request(); } catch (error) { throw translate(error, action); }
}

const invalid = action => Object.assign(new Error(INVALID[action]), { status: 400, code: 'invalid' });

/** Charters without contract of Finance's stations (ADR-0033). */
export const listFinanceCharters = ({ signal } = {}) =>
  guarded(async () => (await client().getFinanceCharters({ signal })).charters, 'read');

const validCorrectionReason = reason => reason.trim().length >= 5 && reason.trim().length <= 500;

/**
 * 4-N22: Finance confirms the prepayment with the version it saw and the intent's Idempotency-Key; confirmed after the
 * invoice, it settles it. With a reason (5 to 500 characters) another amount or reference corrects a confirmed
 * prepayment that was never applied.
 */
export async function confirmCharterPrepayment(charterId, { amount, reference, version, reason }, idempotencyKey) {
  const action = reason === undefined || reason === null ? 'confirm' : 'correct';
  if (action === 'correct' && !validCorrectionReason(reason))
    throw Object.assign(new Error(ACTION_MESSAGES.correct.reason_required), { status: 400, code: 'reason_required' });
  const command = action === 'correct' ? { amount, reference, version, reason } : { amount, reference, version };
  if (!normalizedPrepayment(command)) throw invalid(action);
  return guarded(() => client().confirmFinanceCharterPrepayment(charterId, command, idempotencyKey), action);
}

/**
 * 3-N24: Finance reopens a confirmed prepayment as a new quotation, with its reason and the version it saw, so the agent
 * can add services again; the amount and the reference stay until the next confirmation.
 */
export async function reopenCharterPrepayment(charterId, { reason, version }, idempotencyKey) {
  if (!normalizedPrepaymentReopening({ reason, version })) throw invalid('reopen');
  return guarded(() => client().reopenFinanceCharterPrepayment(charterId, { reason, version }, idempotencyKey), 'reopen');
}
