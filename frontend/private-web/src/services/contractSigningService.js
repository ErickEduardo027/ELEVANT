import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  const token = readSession()?.token;
  if (!token) throw Object.assign(new Error('La sesión expiró.'), { status: 401 });
  return createPrivateWebApiClient({ getAccessToken: () => token });
}

async function run(action) {
  try { return await action(client()); }
  catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export const listContractSigning = () => run(api => api.listManagedContractSigning({ cache: 'no-store' }));
export const listAviamSigners = () => run(api => api.listAviamContractSigners({ cache: 'no-store' }));
export const setContractSigner = (versionId, aviamSignerAccountId) => run(api =>
  api.setContractSigners(versionId, { aviamSignerAccountId }));
export const previewContractPdf = versionId => run(api => api.previewContractSigningPdf(versionId));
export const getContractDraftPdf = versionId => run(api => api.getManagedContractDraftPdf(versionId));
export const issueContract = versionId => run(api => api.issueContractSigning(versionId));
export const acceptAviamContract = (versionId, expectedDraftSha256, requestId) => run(api =>
  api.acceptAviamContract(versionId, { expectedDraftSha256, requestId }));
export const getSignedContractPdf = versionId => run(api => api.getManagedSignedContractPdf(versionId));
export const getContractAuditPdf = versionId => run(api => api.getManagedContractAuditPdf(versionId));
