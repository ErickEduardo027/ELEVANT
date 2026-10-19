import { commercialApi } from './commercialGovernanceApi';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

const base = '/finance/fiscal-documents';
const post = body => ({ method: 'POST', body: JSON.stringify(body) });
export const getFiscalStatus = () => commercialApi(base + '/status');
export const listFiscalDocuments = (filters = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  return commercialApi(base + (query.size ? '?' + query.toString() : ''));
};
export const getFiscalDocument = id => commercialApi(base + '/' + encodeURIComponent(id));
export const createFiscalDocument = input => commercialApi(base, post(input));
export const simulateFiscalDocument = (id, input) => commercialApi(base + '/' + encodeURIComponent(id) + '/simulate', post(input));

/** Retains the exact command across transport failures; server RequestId remains authoritative. */
export function createFiscalCommand() {
  const pending = new Map();
  return async (operation, payload, send) => {
    const key = operation + ':' + JSON.stringify(payload);
    let input = pending.get(key);
    if (!input) { input = { ...payload, requestId: globalThis.crypto.randomUUID() }; pending.set(key, input); }
    const result = await send(input);
    pending.delete(key);
    return result;
  };
}
export function fiscalError(error) {
  if (error?.status === 401) return 'La sesión expiró. Vuelva a iniciar sesión.';
  if (error?.status === 403) return 'No tiene permiso para consultar o simular documentos fiscales.';
  if (error?.status === 404) return 'El documento o su archivo no está disponible en su estación.';
  if (error?.code === 'Disabled') return 'El modo fiscal está Off. No se creó ningún trabajo.';
  if (error?.code === 'ProviderNotConfigured') return 'El proveedor sandbox está pendiente de configuración.';
  if (error?.status === 409) return 'El documento cambió o ya fue enviado. Use Actualizar estado antes de continuar.';
  if (error?.status === 503) return 'El archivo privado está incompleto o no está disponible. Actualice el estado antes de reintentar.';
  if (error?.status === 400) return 'Revise la factura y los datos de simulación.';
  return 'No se pudo completar la operación. Actualice el estado para comprobar el resultado antes de continuar.';
}
export async function downloadFiscalArtifact(documentId, artifact) {
  const origin = String(process.env.NEXT_PUBLIC_ELEVANT_API_URL || '').replace(/\/$/, '');
  const token = readSession()?.token;
  if (!origin || !token) throw Object.assign(new Error('Sesión requerida'), { status: 401 });
  const response = await fetch(origin + '/api/v1' + base + '/' + encodeURIComponent(documentId) + '/artifacts/' + encodeURIComponent(artifact.id), {
    headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
  });
  handleUnauthorizedResponse(response);
  if (!response.ok) throw Object.assign(new Error('Archivo no disponible'), { status: response.status });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = artifact.fileName; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
