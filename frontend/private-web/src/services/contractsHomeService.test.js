import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContractsHomeSnapshot } from './contractsHomeService';
import { getCommercialRequestInbox, getManagedDraftOverview, getManagedDrafts, getManagedServices } from './commercialGovernanceApi';

vi.mock('./commercialGovernanceApi', () => ({
  getCommercialRequestInbox: vi.fn(),
  getManagedDrafts: vi.fn(),
  getManagedDraftOverview: vi.fn(),
  getManagedServices: vi.fn(),
}));

describe('getContractsHomeSnapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('takes the request indicators from the inbox counters instead of a truncated list', async () => {
    getCommercialRequestInbox.mockResolvedValue({
      page: 1, limit: 5, total: 640, hasMore: true,
      counts: { pending: 3, inReview: 2, approved: 410, rejected: 220, cancelled: 5 },
      requests: [
        { id: 'one', reference: 'SOL-1', airline: 'Aerolinea A', status: 'Pending', submittedAt: '2026-09-27T10:00:00Z' },
        { id: 'two', reference: 'SOL-2', airline: 'Aerolinea B', status: 'Approved', submittedAt: '2026-09-26T10:00:00Z' },
      ],
    });
    getManagedDraftOverview.mockResolvedValue({ count: 1,
      recent: [{ id: 'draft', airline: 'Aerolinea B', contractCode: 'DRAFT-2' }] });
    const snapshot = await getContractsHomeSnapshot();

    expect(getCommercialRequestInbox).toHaveBeenCalledWith({ status: 'All', page: 1, limit: 5 });
    expect(snapshot.kpis).toEqual({ pendingRequests: 5, approvedRequests: 410, pendingDrafts: 1, rejectedRequests: 220 });
    expect(snapshot.recentRequests.map(item => item.reference)).toEqual(['SOL-1', 'SOL-2']);
    expect(snapshot.pendingDrafts.map(item => item.contractCode)).toEqual(['DRAFT-2']);
    expect(getManagedServices).not.toHaveBeenCalled();
    expect(getManagedDrafts).not.toHaveBeenCalled();
  });

  it('fails closed when one source is unavailable', async () => {
    getCommercialRequestInbox.mockResolvedValue({ page: 1, limit: 5, total: 0, hasMore: false,
      counts: { pending: 0, inReview: 0, approved: 0, rejected: 0, cancelled: 0 }, requests: [] });
    getManagedDraftOverview.mockRejectedValue(new Error('sin conexión'));
    await expect(getContractsHomeSnapshot()).rejects.toThrow('sin conexión');
  });
});
