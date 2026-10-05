import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function sessionError(token) {
  return readSession()?.token === token ? null : Object.assign(
    new Error('La sesión cambió. Vuelve a consultar el reporte.'),
    { code: 'cancelled' }
  );
}

function translate(error, token) {
  const changed = sessionError(token);
  if (changed) return changed;
  if (error?.name === 'AbortError') return error;
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  return Object.assign(new Error(status === 422
    ? 'El reporte excede 5 000 filas. Acota el intervalo antes de exportar.'
    : 'No se pudo consultar el reporte.'), { status });
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
