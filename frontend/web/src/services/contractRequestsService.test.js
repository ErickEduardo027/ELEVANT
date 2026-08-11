import { afterEach, describe, expect, it } from 'vitest';
import { __resetContractRequestsStoreForTests, getContractRequests, markRequestInReview, resolveContractRequest } from './contractRequestsService';

afterEach(() => __resetContractRequestsStoreForTests());

describe('contractRequestsService', () => {
  it('moves a pending request into review', async () => {
    const updated = await markRequestInReview('SOL-108');
    expect(updated.status).toBe('inReview');
  });

  it('records the decision and notification', async () => {
    const updated = await resolveContractRequest('SOL-107', { status: 'approved', decisionNote: 'Solicitud aprobada.' });
    expect(updated.status).toBe('approved');
    expect(updated.notifiedAt).toBeTruthy();
    expect((await getContractRequests()).find(request => request.id === 'SOL-107').decisionNote).toBe('Solicitud aprobada.');
  });
});
