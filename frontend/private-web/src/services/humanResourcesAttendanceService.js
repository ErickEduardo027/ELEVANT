import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

export class HumanResourcesAttendanceError extends Error {
  constructor(message, { status = null, code = 'request-failed' } = {}) {
    super(message);
    this.name = 'HumanResourcesAttendanceError';
    this.status = status;
    this.code = code;
  }
}

function currentSessionError(token) {
  return readSession()?.token === token ? null : new HumanResourcesAttendanceError(
    'La sesión cambió. Actualiza la vista antes de continuar.', { code: 'cancelled' }
  );
}

function safeError(error, writing, token) {
  const cancelled = currentSessionError(token);
  if (cancelled) return cancelled;
  if (error?.name === 'AbortError' && !writing) return error;
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (status === 401) {
    handleUnauthorizedResponse({ status: 401 });
    return new HumanResourcesAttendanceError('La sesión expiró. Inicia sesión nuevamente.',
      { status, code: 'unauthorized' });
  }
  if (status === 403) return new HumanResourcesAttendanceError(
    'No tienes acceso a la revisión de asistencia de esta estación.',
    { status, code: 'forbidden' });
  if (status === 404) return new HumanResourcesAttendanceError(
    'La asignación ya no está disponible en esta estación.',
    { status, code: 'not-found' });
  if (status === 409) return new HumanResourcesAttendanceError(
    'Los aportes cambiaron. Revisa las versiones actuales antes de validar.',
    { status, code: 'stale-revision' });
  if (writing && (status === null || status >= 500)) return new HumanResourcesAttendanceError(
    'No se confirmó el resultado. Reintenta la misma validación.',
    { status, code: 'unknown-outcome' });
  return new HumanResourcesAttendanceError(
    writing ? 'No se pudo validar la asistencia.' : 'No se pudo consultar la asistencia.',
    { status });
}

function client(token) {
  return createPrivateWebApiClient({ getAccessToken: () => token });
}

export async function getHumanResourcesAttendance(query, { signal } = {}) {
  const token = readSession()?.token;
  try {
    const result = await client(token).getHumanResourcesAttendance(query, { signal });
    const cancelled = currentSessionError(token);
    if (cancelled) throw cancelled;
    return result;
  } catch (error) {
    throw safeError(error, false, token);
  }
}

export async function validateHumanResourcesAttendance(
  assignmentId, stationId, request, key, { signal } = {}
) {
  const token = readSession()?.token;
  try {
    const result = await client(token).validateHumanResourcesAttendance(
      assignmentId, stationId, request, key, { signal }
    );
    const cancelled = currentSessionError(token);
    if (cancelled) throw cancelled;
    return result;
  } catch (error) {
    throw safeError(error, true, token);
  }
}
