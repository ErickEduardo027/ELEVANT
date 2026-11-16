import {
  normalizedAircraftTypeCreate, normalizedAircraftTypeUpdate, normalizedStandCreate, normalizedStandUpdate,
  normalizedTerminalCreate, normalizedTerminalUpdate,
} from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/** Largest aircraft a stand admits and the size of an aircraft type; empty means any size or unknown. */
export const AIRCRAFT_SIZES = Object.freeze({ Narrowbody: 'Fuselaje estrecho', Widebody: 'Fuselaje ancho' });

/**
 * Spanish explanation of each Problem Details code of OCC master data (phase 2, block C, 2-A). The server title is
 * never shown; a code this map does not list falls back to the shared messages by status.
 */
export const MASTER_DATA_MESSAGES = Object.freeze({
  forbidden: 'Tu acceso no permite gestionar los datos maestros de esta estación.',
  not_found: 'El registro ya no existe o no está en tu estación. Se actualizó la lista.',
  invalid_master_data: 'Revisa los datos e intenta de nuevo.',
  invalid_terminal: 'El código de la terminal lleva de 1 a 16 letras, números o guiones, y el nombre de 2 a 120 caracteres.',
  invalid_stand: 'El código de la posición lleva de 1 a 24 letras, números o guiones; elige una terminal de la estación.',
  invalid_aircraft_type: 'El tipo de avión necesita el designador OACI de 4 caracteres (por ejemplo B738), el fabricante y el modelo; el código IATA, si lo tiene, es de 3.',
  terminal_code_taken: 'Ya existe una terminal con ese código en la estación.',
  stand_code_taken: 'Ya existe una posición con ese código en la estación.',
  aircraft_type_code_taken: 'Ya existe un tipo de avión con ese designador OACI.',
  terminal_code_locked: 'La terminal ya tiene turnos, coberturas o posiciones usadas: su código no cambia.',
  stand_code_locked: 'La posición ya tiene vuelos o coberturas: su código y su terminal no cambian.',
  terminal_in_use: 'La terminal tiene posiciones activas, coberturas abiertas o turnos programados: desactívalos antes.',
  stand_in_use: 'La posición tiene vuelos sin terminar o coberturas abiertas: no se puede desactivar.',
  aircraft_type_in_use: 'Hay vuelos sin terminar con ese tipo de avión: no se puede desactivar.',
  terminal_inactive: 'La terminal está desactivada: reactívala antes de crear o reactivar sus posiciones.',
  version_conflict: 'El registro cambió mientras lo editabas. Se actualizó la lista; revisa e intenta de nuevo.',
});

/**
 * The message of a failed master-data call, from its code; never the server title. Without a status (no answer, a
 * network failure) it is the connection fallback: the intent keeps its key for the retry.
 */
export function masterDataMessage(error) {
  return problemMessage(error, MASTER_DATA_MESSAGES, { forbidden: MASTER_DATA_MESSAGES.forbidden,
    fallback: 'No fue posible completar la acción. Revisa la conexión e intenta de nuevo.' });
}

/**
 * Checks the input with the shared client's rules before sending it, so a value the server would refuse is explained
 * as invalid data (400 with the server's code) and never confused with a network failure.
 */
function validated(normalize, input, code) {
  try { normalize(input); } catch {
    throw Object.assign(new Error(code), { status: 400, code });
  }
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** Terminals, stands and aircraft types of the station, active or not (`operations.master_data.read`). */
export const loadOccMasterData = (stationId, { signal } = {}) =>
  guarded(() => client().getOccMasterData(stationId, { signal }));

export const createOccTerminal = async (input, idempotencyKey) => {
  validated(normalizedTerminalCreate, input, 'invalid_terminal');
  return guarded(() => client().createOccTerminal(input, idempotencyKey));
};

export const updateOccTerminal = async (terminalId, input, idempotencyKey) => {
  validated(normalizedTerminalUpdate, input, 'invalid_terminal');
  return guarded(() => client().updateOccTerminal(terminalId, input, idempotencyKey));
};

export const createOccStand = async (input, idempotencyKey) => {
  validated(normalizedStandCreate, input, 'invalid_stand');
  return guarded(() => client().createOccStand(input, idempotencyKey));
};

export const updateOccStand = async (standId, input, idempotencyKey) => {
  validated(normalizedStandUpdate, input, 'invalid_stand');
  return guarded(() => client().updateOccStand(standId, input, idempotencyKey));
};

export const createOccAircraftType = async (input, idempotencyKey) => {
  validated(normalizedAircraftTypeCreate, input, 'invalid_aircraft_type');
  return guarded(() => client().createOccAircraftType(input, idempotencyKey));
};

export const updateOccAircraftType = async (aircraftTypeId, input, idempotencyKey) => {
  validated(normalizedAircraftTypeUpdate, input, 'invalid_aircraft_type');
  return guarded(() => client().updateOccAircraftType(aircraftTypeId, input, idempotencyKey));
};
