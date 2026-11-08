import { normalizedPrepayment, normalizedPrepaymentReopening } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/**
 * The Problem Details codes of Finance's charters (ADR-0033, 3-N24) in Spanish; the screen never shows the server's
 * title.
 */
export const CHARTER_PROBLEM_MESSAGES = Object.freeze({
  charter_prepayment_not_confirmed: 'El prepago ya no está confirmado. Se actualizó la lista.',
  charter_prepayment_confirmed: 'El prepago ya está confirmado: reabra la cotización para agregar servicios.',
  version_conflict: 'El charter cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.',
  expected_version_required: 'Actualice la lista antes de reabrir la cotización.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Se actualizó la lista; intente de nuevo.',
  reason_required: 'Indique el motivo de la reapertura (entre 8 y 500 caracteres).',
  not_found: 'El charter ya no existe o no es de sus estaciones.',
});

const FORBIDDEN = 'Su acceso no incluye los charters de Finanzas.';
const INVALID = {
  confirm: 'Revise el monto y la referencia del prepago.',
  reopen: 'Indique el motivo de la reapertura (entre 8 y 500 caracteres).',
};
const FALLBACK = {
  read: 'No se pudieron cargar los charters. Intente nuevamente.',
  confirm: 'No se pudo confirmar el prepago. Actualice la lista antes de intentarlo de nuevo.',
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
      : problemMessage({ status: status ?? undefined, code: code ?? STATUS_CODES[status] }, CHARTER_PROBLEM_MESSAGES,
        { forbidden: FORBIDDEN, fallback: FALLBACK[action] });
  return Object.assign(new Error(message), { status, code });
}

async function guarded(request, action) {
  try { return await request(); } catch (error) { throw translate(error, action); }
}

const invalid = action => Object.assign(new Error(INVALID[action]), { status: 400, code: 'invalid' });

/** Charters without contract of Finance's stations (ADR-0033). */
export const listFinanceCharters = ({ signal } = {}) =>
  guarded(async () => (await client().getFinanceCharters({ signal })).charters, 'read');

export async function confirmCharterPrepayment(charterId, amount, reference) {
  if (!normalizedPrepayment({ amount, reference })) throw invalid('confirm');
  return guarded(() => client().confirmFinanceCharterPrepayment(charterId, { amount, reference }), 'confirm');
}

/**
 * 3-N24: Finance reopens a confirmed prepayment as a new quotation, with its reason and the version it saw, so the agent
 * can add services again; the amount and the reference stay until the next confirmation.
 */
export async function reopenCharterPrepayment(charterId, { reason, version }, idempotencyKey) {
  if (!normalizedPrepaymentReopening({ reason, version })) throw invalid('reopen');
  return guarded(() => client().reopenFinanceCharterPrepayment(charterId, { reason, version }, idempotencyKey), 'reopen');
}
