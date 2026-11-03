import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

export function translateFlightFeedError(error, action = 'read') {
  if (error?.name === 'AbortError') return error;
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = status === 403 ? 'Tu acceso no permite esta acción en la planificación de esta estación.'
    : status === 404 ? 'El vuelo propuesto ya no está disponible. Actualiza la lista.'
      : status === 409 && action === 'import'
        ? (String(error?.title ?? '').includes('airport')
          ? 'Aún no se conoce el aeropuerto de origen o destino de este vuelo.'
          : 'Esa llegada y esa salida no se pueden importar juntas: revisa la aerolínea, las horas o si ya se importaron.')
        : status === 409 ? 'El vuelo ya cambió. Actualiza la lista.'
          : error instanceof TypeError ? 'Elige una llegada y una salida distintas.'
            : 'No fue posible completar la acción. Intenta nuevamente.';
  return Object.assign(new Error(message), { status });
}

async function guarded(request, action) {
  try { return await request(); } catch (error) { throw translateFlightFeedError(error, action); }
}

/** Proposed flights and unit budget of the provider feed (ADR-0028); never calls the provider. */
export const loadOccFlightFeed = (stationId, date, { signal } = {}) =>
  guarded(() => client().getOccFlightFeed(stationId, date, { signal }), 'read');

/** «Actualizar ahora»: the server decides whether a provider call is allowed. */
export const refreshOccFlightFeed = stationId => guarded(() => client().refreshOccFlightFeed(stationId), 'refresh');

export const importOccFlight = (arrivalId, departureId) =>
  guarded(() => client().importOccFlight(arrivalId, departureId), 'import');

export const dismissOccFlightProposal = proposalId =>
  guarded(() => client().dismissOccFlightProposal(proposalId), 'dismiss');

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
