import { normalizedDemoFlightCreate } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/**
 * Spanish explanation of each Problem Details code of the demo flights (ADR-0041). The server title is never shown; a
 * code this map does not list falls back to the shared messages by status.
 */
export const DEMO_FLIGHT_MESSAGES = Object.freeze({
  demo_flights_unavailable: 'Los vuelos demo no están disponibles en este entorno.',
  invalid_demo_flight: 'Revise los datos: la llegada va de 2 a 30 minutos y el tiempo en tierra de 20 a 240.',
  station_unavailable: 'La estación ya no está activa. Se actualizó la lista.',
  airline_inactive: 'La aerolínea o su organización no están activas.',
  contract_not_in_force: 'La aerolínea no tiene contrato vigente hoy en la estación.',
  contract_ambiguous: 'La aerolínea tiene más de un contrato vigente ese día. Pida a Contratos que lo revise.',
  aircraft_type_unavailable: 'El tipo de avión ya no está disponible. Elija otro.',
  demo_origin_unknown: 'No se conoce ese aeropuerto. Elija uno de la lista.',
  stand_unavailable: 'La posición ya no está libre para esa escala. Elija otra o «Sin posición».',
  demo_flight_limit_reached: 'Ya hay demasiados vuelos demo activos en esta estación. Espere a que termine uno o cancélelo.',
  demo_flight_closed: 'Ese vuelo demo ya terminó o se canceló. Se actualizó la lista.',
  version_conflict: 'El vuelo demo cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.',
  not_found: 'La estación o el vuelo demo ya no existe. Se actualizó la lista.',
  forbidden: 'Solo el superadministrador dispara vuelos demo.',
});

/**
 * The message of a failed demo flight call, from its code; never the server title. Without a status (no answer, a
 * network failure) it is the connection fallback: the intent keeps its key for the retry.
 */
export function demoFlightMessage(error) {
  return problemMessage(error, DEMO_FLIGHT_MESSAGES, { forbidden: DEMO_FLIGHT_MESSAGES.forbidden,
    fallback: 'No se pudo completar la acción. Revise la conexión e intente de nuevo.' });
}

/** A request the server would refuse is explained as invalid data (400 with its code), never as a network failure. */
function validated(normalize, input) {
  try { normalize(input); } catch {
    throw Object.assign(new Error('invalid_demo_flight'), { status: 400, code: 'invalid_demo_flight' });
  }
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/**
 * What «Disparar vuelo demo» offers at a station (without one, the server's: Punta Cana, else the first by code), with
 * `enabled` and the server time. Superadministrator only.
 */
export const loadDemoFlightOptions = (stationId, { signal } = {}) =>
  guarded(() => client().getDemoFlightOptions(stationId ?? null, { signal, cache: 'no-store' }));

/** The demo flights of the last 24 hours at a station, newest first, with the server time their countdowns use. */
export const listDemoFlights = (stationId, { signal } = {}) =>
  guarded(() => client().listDemoFlights(stationId ?? null, { signal, cache: 'no-store' }));

/**
 * «Disparar vuelo demo» with the intent's Idempotency-Key. The request is checked first (2 to 30 minutes to the stand,
 * 20 to 240 on the ground, a stand only when one is chosen): a refusal never reaches the server.
 */
export const createDemoFlight = async (input, idempotencyKey) => {
  validated(normalizedDemoFlightCreate, input);
  return guarded(() => client().createDemoFlight(input, idempotencyKey));
};

/** «Cancelar vuelo» (`Cancel`, before touchdown) or «Terminar demo» (`Finish`, after it), with the intent's key. */
export const cancelDemoFlight = (demoFlightId, intent, idempotencyKey) =>
  guarded(() => client().cancelDemoFlight(demoFlightId, intent, idempotencyKey));
