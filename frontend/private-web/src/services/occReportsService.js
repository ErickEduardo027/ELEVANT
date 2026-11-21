import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';
import { OCC_REPORT_PROBLEMS } from './reportProblems';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/**
 * The Spanish message of a failed report call by its Problem Details code (3-N13), keeping `status` and `code` for
 * the screen; the server title is never shown.
 */
function translate(error) {
  if (error?.name === 'AbortError') return error;
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const message = problemMessage(error, OCC_REPORT_PROBLEMS, {
    forbidden: 'Tu acceso no incluye los reportes de esta estación.',
    fallback: 'No se pudo generar el reporte. Intenta nuevamente.',
  });
  return Object.assign(new Error(message), { status, ...(code && { code }) });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translate(error); }
}

export const listOccReports = ({ signal } = {}) => guarded(() => client().listOccReports({ signal }));

export const getOccReport = (key, query, { signal } = {}) =>
  guarded(() => client().getOccReport(key, query, { signal }));

/**
 * The server-generated file of the whole period, with the same filters as the page: over its row limit the server
 * refuses it (`report_too_large`) and nothing is downloaded. The screen saves it with `occReportFileName`.
 */
export const exportOccReport = (key, query, format) => guarded(() => client().exportOccReport(key, query, format));

/** «elevant-occ-operations-PUJ-20261101-20261121.pdf»: report, station and period. */
export const occReportFileName = (key, query, format, stationCode) =>
  `elevant-occ-${key}-${stationCode}-${query.from.replaceAll('-', '')}-${query.to.replaceAll('-', '')}.${format}`;
