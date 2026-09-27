import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContractsHomeSnapshot } from './contractsHomeService';
import { getCommercialRequests, getManagedDrafts, getManagedServices } from './commercialGovernanceApi';

vi.mock('./commercialGovernanceApi', () => ({
  getCommercialRequests: vi.fn(),
  getManagedDrafts: vi.fn(),
  getManagedServices: vi.fn(),
}));

describe('getContractsHomeSnapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives the commercial overview from the API instead of prototype fixtures', async () => {
    getCommercialRequests.mockResolvedValue([
      { id: 'one', reference: 'SOL-1', airline: 'Aerolinea A', status: 'Pending', submittedAt: '2026-09-27T10:00:00Z' },
      { id: 'two', reference: 'SOL-2', airline: 'Aerolinea B', status: 'Approved', submittedAt: '2026-09-26T10:00:00Z' },
      { id: 'three', reference: 'SOL-3', airline: 'Aerolinea C', status: 'InReview', submittedAt: '2026-09-25T10:00:00Z' },
    ]);
    getManagedDrafts.mockResolvedValue([{ id: 'draft', airline: 'Aerolinea B', contractCode: 'DRAFT-2', comments: [], rates: [] }]);
    getManagedServices.mockResolvedValue([
      { id: 'public', isPublic: true, isActive: true },
      { id: 'internal', isPublic: false, isActive: true },
    ]);

    const snapshot = await getContractsHomeSnapshot();

    expect(snapshot.kpis).toEqual({ pendingRequests: 2, approvedRequests: 1, pendingDrafts: 1, publishedServices: 1 });
    expect(snapshot.recentRequests.map(item => item.reference)).toEqual(['SOL-1', 'SOL-2', 'SOL-3']);
    expect(snapshot.pendingDrafts.map(item => item.contractCode)).toEqual(['DRAFT-2']);
  });

  it('fails closed when one source is unavailable', async () => {
    getCommercialRequests.mockResolvedValue([]);
    getManagedDrafts.mockRejectedValue(new Error('sin conexión'));
    getManagedServices.mockResolvedValue([]);
    await expect(getContractsHomeSnapshot()).rejects.toThrow('sin conexión');
  });
});
