import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

export function translateReadyContractsError(error) {
  if (error?.name === 'AbortError') return error;
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = status === 403 ? 'Tu acceso no incluye la planificación de esta estación.'
    : status === 400 || error instanceof TypeError ? 'Elige una fecha válida.'
      : 'No se pudieron cargar los contratos listos. Intenta nuevamente.';
  return Object.assign(new Error(message), { status });
}

/** Contracts OCC can plan flights for at a station on a date (ADR-0027). */
export async function listOccReadyContracts(stationId, date, { signal } = {}) {
  try {
    return await client().listOccReadyContracts(stationId, date, { signal });
  } catch (error) {
    throw translateReadyContractsError(error);
  }
}
