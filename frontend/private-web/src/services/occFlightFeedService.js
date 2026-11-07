import { normalizedFlightImport } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { describeReasons } from './occCoverageService';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/** The views of the review (2-B, 2-N16, 2-N36): contracted airlines, charter candidates and dismissed proposals. */
export const FLIGHT_FEED_VIEWS = Object.freeze([
  Object.freeze({ id: 'Contracted', label: 'Con contrato' }),
  Object.freeze({ id: 'Charter', label: 'Charter sin contrato' }),
  Object.freeze({ id: 'Dismissed', label: 'Descartadas' }),
]);

/**
 * Spanish explanation of each Problem Details code of the flight feed review (phase 2, block C). The server title
 * is never shown; a code this map does not list falls back to the shared messages by status.
 */
export const FLIGHT_FEED_MESSAGES = Object.freeze({
  forbidden: 'Tu acceso no permite esta acción en la planificación de esta estación.',
  not_found: 'El vuelo propuesto ya no está disponible. Actualiza la lista.',
  invalid_flight_feed_query: 'La estación o la vista de vuelos propuestos no es válida.',
  invalid_flight_import: 'Elige una llegada y una salida distintas, y un tipo de avión y una posición válidos.',
  flight_proposals_not_pairable: 'Esa llegada y esa salida no se pueden importar juntas: deben ser de la misma aerolínea y salir después de llegar, en menos de 24 horas.',
  flight_proposal_closed: 'Ese vuelo ya se importó o se descartó. Se actualizó la lista.',
  flight_counterpart_unknown: 'Aún no se conoce el aeropuerto de origen o destino de este vuelo.',
  contract_not_in_force: 'El contrato de esa aerolínea en la estación está suspendido o vencido: no se pueden importar sus vuelos hasta que vuelva a estar vigente.',
  contract_ambiguous: 'La aerolínea tiene más de un contrato vigente en la estación ese día. Pide a Contratos que lo revise.',
  charter_has_contract: 'La aerolínea tiene contrato vigente: su vuelo se importa con contrato, no como charter.',
  charter_required: 'La aerolínea no tiene contrato vigente: solo puede importarse como charter sin contrato.',
  airline_inactive: 'La aerolínea o su organización no están activas.',
  aircraft_type_unavailable: 'El tipo de avión ya no está disponible. Elige otro.',
  stand_unavailable: 'La posición no está disponible para ese horario.',
  flight_proposal_not_dismissed: 'Esa propuesta ya no está descartada. Se actualizó la lista.',
  flight_proposal_passed: 'Ese vuelo ya pasó: no se puede restaurar.',
  version_conflict: 'El vuelo propuesto cambió mientras lo revisabas. Se actualizó la lista; revisa e intenta de nuevo.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Se actualizó la lista; intenta de nuevo.',
});

/** What the stand of an imported flight breaks (ADR-0030): another flight in the window or a combined-stand rule. */
const PLACEMENT_REASON_MESSAGES = Object.freeze({
  stand_taken: 'Otro vuelo ocupa esa posición en ese horario.',
});

/**
 * The message of a failed flight feed call, from its code; never the server title. Without a status (no answer, a
 * network failure) it is the retry fallback: the intent keeps its key.
 */
export function flightFeedMessage(error) {
  return problemMessage(error, FLIGHT_FEED_MESSAGES, { forbidden: FLIGHT_FEED_MESSAGES.forbidden,
    fallback: 'No fue posible completar la acción. Intenta nuevamente.' });
}

/** The stand rules a refused import breaks, in Spanish (`stand_unavailable`). */
export function placementReasons(error) {
  const reasons = Array.isArray(error?.reasons) ? error.reasons : [];
  return [...new Set(reasons.map(reason => PLACEMENT_REASON_MESSAGES[reason] ?? describeReasons([reason])[0])
    .filter(Boolean))];
}

/**
 * Why the provider reads are paused (2-N29). The server keeps the provider's raw code (`quota_exceeded`,
 * `unauthorized`, `rate_limited`, `failed_<status>`): the screen explains it, never prints it.
 */
export function pauseReasonText(reason) {
  if (reason === 'quota_exceeded') return 'se agotó la cuota del plan del proveedor';
  if (reason === 'unauthorized') return 'el proveedor rechazó la credencial configurada';
  if (reason === 'rate_limited') return 'el proveedor pidió esperar entre consultas';
  if (reason === 'failed_network') return 'no hubo conexión con el proveedor';
  const status = /^failed_(\d{3})$/.exec(String(reason ?? ''));
  if (status) return `el proveedor respondió con un error (${status[1]})`;
  return 'error del proveedor';
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** Proposed flights of one view and the unit budget (ADR-0028); never calls the provider. */
export const loadOccFlightFeed = (stationId, date, { signal, view } = {}) =>
  guarded(() => client().getOccFlightFeed(stationId, date, view ? { signal, view } : { signal }));

/** «Actualizar ahora»: the server decides whether a provider call is allowed. */
export const refreshOccFlightFeed = stationId => guarded(() => client().refreshOccFlightFeed(stationId));

/**
 * «Importar escala» (2-B): the pair with the versions on screen and, optionally, the aircraft type, the stand and the
 * charter mode, under the intent's Idempotency-Key.
 */
export const importOccFlightProposals = async (command, idempotencyKey) => {
  // A pair the server would refuse is explained as invalid data, never confused with a network failure.
  try { normalizedFlightImport(command); } catch {
    throw Object.assign(new Error('invalid_flight_import'), { status: 400, code: 'invalid_flight_import' });
  }
  return guarded(() => client().importOccFlightProposals(command, idempotencyKey));
};

export const dismissOccFlightProposal = proposalId =>
  guarded(() => client().dismissOccFlightProposal(proposalId));

/** Brings a dismissed proposal back while its flight has not passed (2-N36). */
export const restoreOccFlightProposal = (proposalId, expectedVersion, idempotencyKey) =>
  guarded(() => client().restoreOccFlightProposal(proposalId, expectedVersion, idempotencyKey));

export const REFRESH_MESSAGES = {
  Refreshed: 'Lista actualizada con el proveedor.',
  Reused: 'La última lectura tiene menos de 5 minutos: se usó sin gastar unidades.',
  Throttled: 'Ya se actualizó hace poco. Podrás volver a hacerlo en unos minutos.',
  BudgetExhausted: 'Se alcanzó el límite de unidades. Las lecturas se reanudan con el nuevo período.',
  Paused: 'El proveedor está en pausa tras un error. Se reintentará automáticamente.',
  NotConfigured: 'El proveedor no está configurado en este entorno: no se hace ninguna llamada.',
  NoContracts: 'Ninguna aerolínea tiene contrato vigente hoy en esta estación.',
  Busy: 'Se está sincronizando en este momento. Intenta en un minuto.',
  Failed: 'El proveedor no respondió. Se reintentará automáticamente.',
};
