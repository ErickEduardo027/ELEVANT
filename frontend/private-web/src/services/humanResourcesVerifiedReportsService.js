import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';
import { HUMAN_RESOURCES_REPORT_PROBLEMS } from './reportProblems';

function sessionError(token) {
  return readSession()?.token === token ? null : Object.assign(
    new Error('La sesión cambió. Vuelve a consultar el reporte.'),
    { code: 'cancelled' }
  );
}

/**
 * The Spanish message of a failed report call by its Problem Details code (3-N13), keeping `status` and `code` for
 * the screen; the server title is never shown.
 */
function translate(error, token) {
  const changed = sessionError(token);
  if (changed) return changed;
  if (error?.name === 'AbortError') return error;
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const message = problemMessage(error, HUMAN_RESOURCES_REPORT_PROBLEMS, {
    forbidden: 'No tienes acceso a este reporte o estación.', fallback: 'No se pudo consultar el reporte.',
  });
  return Object.assign(new Error(message), { status, ...(code && { code }) });
}

function client(token) {
  return createPrivateWebApiClient({ getAccessToken: () => token });
}

export async function getHumanResourcesReport(kind, query, { signal } = {}) {
  const token = readSession()?.token;
  try {
    const page = await client(token).getHumanResourcesReport(kind, query, { signal });
    const changed = sessionError(token);
    if (changed) throw changed;
    return page;
  } catch (error) {
    throw translate(error, token);
  }
}
export async function exportHumanResourcesReport(kind, query, format, { signal } = {}) {
  const token = readSession()?.token;
  try {
    const file = await client(token).exportHumanResourcesReport(kind, query, format,
      { signal });
    const changed = sessionError(token);
    if (changed) throw changed;
    return file;
  } catch (error) {
    throw translate(error, token);
  }
}
