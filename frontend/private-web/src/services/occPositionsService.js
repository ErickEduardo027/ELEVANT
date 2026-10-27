import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

function translate(error) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof TypeError) return new Error('Revisa la matrícula: usa solo letras, números o guion (por ejemplo HI1055).');
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = status === 403 ? 'Tu acceso no permite registrar llegadas ni asignar posiciones.'
    : status === 404 ? 'La operación o la posición ya no está disponible.'
      : status === 409 ? 'La posición está ocupada o reservada en ese horario. Elige otra o libérala primero.'
        : status === 400 ? 'Revisa los datos: la hora de llegada no puede ser futura y la matrícula debe ser válida.'
          : 'No fue posible actualizar la posición. Intenta de nuevo.';
  return Object.assign(new Error(message), { status });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translate(error); }
}

export const loadOccPositions = (stationId, date, { signal } = {}) =>
  guarded(() => client().getOccPositions(stationId, date, { signal }));

export const recordOccArrival = (turnaroundId, aircraftRegistration, arrivedAt = null) =>
  guarded(() => client().recordOccArrival(turnaroundId, { aircraftRegistration, arrivedAt }));

export const assignOccStand = (turnaroundId, standId, reason = null) =>
  guarded(() => client().assignOccStand(turnaroundId, { standId, reason }));

export const releaseOccStand = turnaroundId => guarded(() => client().releaseOccStand(turnaroundId));
