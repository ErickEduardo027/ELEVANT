import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

function translate(error) {
  if (error?.name === 'AbortError') return error;
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = status === 403 ? 'Tu acceso no incluye los reportes de esta estación.'
    : status === 400 ? 'Revisa el período: la fecha final no puede ser anterior y el máximo es un año.'
      : 'No se pudo generar el reporte. Intenta nuevamente.';
  return Object.assign(new Error(message), { status });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translate(error); }
}

export const listOccReports = ({ signal } = {}) => guarded(() => client().listOccReports({ signal }));

export const getOccReport = (key, query, { signal } = {}) =>
  guarded(() => client().getOccReport(key, query, { signal }));

/** Downloads the server-generated file; the name carries report, station and period. */
export async function downloadOccReport(key, query, format, stationCode) {
  const blob = await guarded(() => client().exportOccReport(key, query, format));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `elevant-occ-${key}-${stationCode}-${query.from.replaceAll('-', '')}-${query.to.replaceAll('-', '')}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
