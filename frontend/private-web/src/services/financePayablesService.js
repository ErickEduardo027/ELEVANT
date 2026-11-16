import { commercialApi } from './commercialGovernanceApi';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

const json = (method, body) => ({ method, body: JSON.stringify(body) });
const query = values => {
  const params = new URLSearchParams();
  Object.entries(values ?? {}).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)); });
  return params.size ? '?' + params.toString() : '';
};
const idPath = id => encodeURIComponent(id);
const read = path => commercialApi(path, { cache: 'no-store' });
export const listSuppliers = filters => read('/finance/suppliers' + query(filters));
export const getSupplier = id => read('/finance/suppliers/' + idPath(id));
export const saveSupplier = (id, body) => commercialApi('/finance/suppliers' + (id ? '/' + idPath(id) : ''), json(id ? 'PUT' : 'POST', body));
export const retireSupplier = (id, body) => commercialApi('/finance/suppliers/' + idPath(id), json('DELETE', body));
export const listPayables = filters => read('/finance/payables' + query(filters));
export const getPayable = id => read('/finance/payables/' + idPath(id));
export const savePayable = (id, body) => commercialApi('/finance/payables' + (id ? '/' + idPath(id) : ''), json(id ? 'PUT' : 'POST', body));
export const decidePayable = (id, body) => commercialApi('/finance/payables/' + idPath(id) + '/decisions', json('POST', body));
export const listPayablePayments = filters => read('/finance/payable-payments' + query(filters));
export const getPayablePayment = id => read('/finance/payable-payments/' + idPath(id));
export const recordPayablePayment = body => commercialApi('/finance/payable-payments', json('POST', body));
export const applyPayablePayment = (id, body) => commercialApi('/finance/payable-payments/' + idPath(id) + '/applications', json('POST', body));
/**
 * 4-N04: reverses one application of the payment (`applicationId`) or, without it, voids the whole payment once nothing
 * of it is applied. `{ requestId, expectedVersion, reason, applicationId? }`; the reversal is a linked row, never a delete.
 */
export const reversePayablePayment = (id, body) => commercialApi('/finance/payable-payments/' + idPath(id) + '/reversals', json('POST', body));
export const listEmployeeExpenses = filters => read('/finance/expenses' + query(filters));
export const getEmployeeExpense = id => read('/finance/expenses/' + idPath(id));
export const saveEmployeeExpense = (id, body) => commercialApi('/finance/expenses' + (id ? '/' + idPath(id) : ''), json(id ? 'PUT' : 'POST', body));
export const decideEmployeeExpense = (id, body) => commercialApi('/finance/expenses/' + idPath(id) + '/decisions', json('POST', body));
export const reimburseEmployeeExpense = (id, body) => commercialApi('/finance/expenses/' + idPath(id) + '/reimbursements', json('POST', body));
function kindPath(kind) { if (!['suppliers', 'payables', 'expenses'].includes(kind)) throw new Error('Tipo de documento inválido.'); return '/finance/' + kind; }
export const payablesOptions = (kind, scopeStationId) => read(kindPath(kind) + '/options' + query({ scopeStationId }));
/**
 * 4-N13: removes a receipt from a draft expense or supplier invoice (`{ requestId, expectedVersion }`). It stops being
 * shown and counted; its bytes are erased only when no submission ever included it.
 */
export function removePayablesAttachment(kind, id, attachmentId, body) {
  if (kind === 'suppliers') throw new Error('Tipo de documento inválido.');
  return commercialApi(kindPath(kind) + '/' + idPath(id) + '/attachments/' + idPath(attachmentId) + '/removals', json('POST', body));
}

async function privateFileRequest(path, options = {}) {
  const base = String(process.env.NEXT_PUBLIC_ELEVANT_API_URL || '');
  const origin = base.endsWith('/') ? base.slice(0, -1) : base;
  const token = readSession()?.token;
  if (!origin || !token) throw Object.assign(new Error('Sesión no disponible.'), { status: 401 });
  const response = await fetch(origin + '/api/v1' + path, { ...options, cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
  handleUnauthorizedResponse(response);
  if (!response.ok) {
    // 4-N27: the code of the Problem Details explains the refusal (a full receipt list, a file that is not a receipt…).
    const problem = await response.json().catch(() => ({}));
    throw Object.assign(new Error('No se pudo completar la operación del adjunto privado.'),
      { status: response.status, code: typeof problem?.code === 'string' ? problem.code : undefined });
  }
  return response;
}
export async function uploadPayablesAttachment(kind, id, { requestId, expectedVersion, file }) {
  const body = new FormData(); body.append('requestId', requestId); body.append('expectedVersion', expectedVersion); body.append('file', file);
  return (await privateFileRequest(kindPath(kind) + '/' + idPath(id) + '/attachments', { method: 'POST', body })).json();
}
export async function downloadPayablesAttachment(kind, id, attachmentId) {
  const response = await privateFileRequest(kindPath(kind) + '/' + idPath(id) + '/attachments/' + idPath(attachmentId));
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'comprobante.' + ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type] ?? 'bin');
  document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
