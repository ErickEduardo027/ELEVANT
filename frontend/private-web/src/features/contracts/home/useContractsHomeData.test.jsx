import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContractsHomeSnapshot } from '../../../services/contractsHomeService';
import { useContractsHomeData } from './useContractsHomeData';

vi.mock('../../../services/contractsHomeService', () => ({ getContractsHomeSnapshot: vi.fn() }));

describe('useContractsHomeData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the last verified snapshot visible while a change notification is reconciled', async () => {
    const first = { kpis: { pendingRequests: 1 } };
    const second = { kpis: { pendingRequests: 2 } };
    getContractsHomeSnapshot.mockResolvedValueOnce(first);
    const { result, rerender } = renderHook(({ revision }) => useContractsHomeData(revision), {
      initialProps: { revision: 0 },
    });
    await waitFor(() => expect(result.current.status).toBe('success'));
    let resolveRefresh;
    getContractsHomeSnapshot.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));

    rerender({ revision: 1 });
    expect(result.current.status).toBe('refreshing');
    expect(result.current.data).toBe(first);

    await act(async () => { resolveRefresh(second); });
    expect(result.current.status).toBe('success');
    expect(result.current.data).toBe(second);
  });
});
