import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/** AVIAM forms of an operation as OCC reviews them (ADR-0032). */
export const DOCUMENT_TITLES = {
  ServiceOrder: 'Orden de Servicio en Rampa',
  FlightReport: 'Reporte de Vuelo',
  BridgeChecklist: 'Check-List y Reporte Diario del Puente',
};

export const SIGNER_ROLES = {
  AirlineRepresentative: 'Representante de la aerolínea',
  AviamAgent: 'AVIAM · Responsable',
  Coordinator: 'Coordinador',
  BridgeOperator: 'Operador del puente',
};

function translate(error) {
  if (error?.name === 'AbortError') return error;
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = status === 403 ? 'Tu acceso no incluye los formularios de esta operación.'
    : status === 404 ? 'La operación no tiene formularios o no es de tu estación.'
      : status === 503 ? 'Las fotos del walk-around no están disponibles ahora. Intenta en unos minutos.'
        : 'No se pudieron cargar los formularios. Intenta nuevamente.';
  return Object.assign(new Error(message), { status });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translate(error); }
}

export const getOccOperationDocuments = (operationId, { signal } = {}) =>
  guarded(() => client().getOccOperationDocuments(operationId, { signal }));

/** Downloads the PDF generated from the operation's record, with its signatures and fingerprint. */
export async function downloadOccOperationDocument(operationId, document) {
  const blob = await guarded(() => client().downloadOccOperationDocument(operationId, document.kind));
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${document.kind === 'ServiceOrder' ? 'orden-de-servicio' : document.kind === 'FlightReport'
    ? 'reporte-de-vuelo' : 'checklist-puente'}-${document.number}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
