import { normalizedStationCreate, normalizedStationUpdate } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/** IANA zones offered first; any other IANA zone the server knows can be typed. */
export const COMMON_TIME_ZONES = Object.freeze(['America/Santo_Domingo', 'America/Puerto_Rico', 'America/New_York',
  'America/Bogota', 'America/Panama', 'America/Mexico_City', 'Europe/Madrid', 'UTC']);

/**
 * Spanish explanation of each Problem Details code of the station catalog (phase 2, block C, 2-A). The server title
 * is never shown; a code this map does not list falls back to the shared messages by status.
 */
export const STATION_MESSAGES = Object.freeze({
  forbidden: 'Solo el superadministrador gestiona las estaciones.',
  not_found: 'La estación ya no existe. Se actualizó la lista.',
  invalid_station: 'El código es el IATA de 3 letras del aeropuerto y el nombre lleva de 2 a 120 caracteres. Para un aeropuerto nuevo indique su OACI (4 letras), nombre, ciudad y país (2 letras).',
  invalid_time_zone: 'Indique una zona horaria IANA válida, por ejemplo America/Santo_Domingo.',
  airport_required: 'Ese aeropuerto aún no está registrado: indique su código OACI, su nombre, su ciudad y su país.',
  airport_icao_taken: 'Otro aeropuerto ya usa ese código OACI.',
  airport_has_station: 'Ese aeropuerto ya tiene una estación.',
  station_code_taken: 'Ya existe una estación con ese código.',
  time_zone_locked: 'La estación ya tiene vuelos, turnos, coberturas o contratos: su zona horaria no cambia.',
  station_in_use: 'La estación tiene contratos vigentes, vuelos sin terminar, turnos programados o coberturas abiertas: no se puede desactivar.',
  version_conflict: 'La estación cambió mientras la editaba. Se actualizó la lista; revise e intente de nuevo.',
});

/**
 * The message of a failed station call, from its code; never the server title. Without a status (no answer, a network
 * failure) it is the connection fallback: the intent keeps its key for the retry.
 */
export function stationMessage(error) {
  return problemMessage(error, STATION_MESSAGES, { forbidden: STATION_MESSAGES.forbidden,
    fallback: 'No se pudo completar la acción. Revise la conexión e intente de nuevo.' });
}

/** A value the server would refuse is explained as invalid data (400 with its code), never as a network failure. */
function validated(normalize, input) {
  try { normalize(input); } catch {
    throw Object.assign(new Error('invalid_station'), { status: 400, code: 'invalid_station' });
  }
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** Every station, active or not, and the known airports without one (superadministrator only). */
export const listStations = ({ signal } = {}) => guarded(() => client().listGovernanceStations({ signal, cache: 'no-store' }));

/** A new station with the IATA code of its airport; an unknown airport needs its ICAO code, name, city and country. */
export const createStation = async (input, idempotencyKey) => {
  validated(normalizedStationCreate, input);
  return guarded(() => client().createGovernanceStation(input, idempotencyKey));
};

/** Renames, changes the time zone while it has no history, deactivates or reactivates a station. */
export const updateStation = async (stationId, input, idempotencyKey) => {
  validated(normalizedStationUpdate, input);
  return guarded(() => client().updateGovernanceStation(stationId, input, idempotencyKey));
};
