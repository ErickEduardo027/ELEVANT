import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useRegionalTraffic } from './useRegionalTraffic';
import { loadRegionalTraffic } from '../../services/trafficService';

vi.mock('../../services/trafficService', () => ({ loadRegionalTraffic: vi.fn() }));

const stationId = '20000000-0000-7000-8000-000000000003';
const traffic = { source: 'OpenSky Network', providerTime: '2026-10-17T20:00:00Z',
  retrievedAt: '2026-10-17T20:00:05Z', stale: false,
  aircraft: [{ icao24: 'a1b2c3', latitude: 18.56, longitude: -68.36 }] };

beforeEach(() => vi.mocked(loadRegionalTraffic).mockReset());

it('does not query traffic before a station is available', () => {
  renderHook(() => useRegionalTraffic({ enabled: false, stationId }));
  expect(loadRegionalTraffic).not.toHaveBeenCalled();
});

it('shows a response and clears its positions after a failed refresh', async () => {
  vi.mocked(loadRegionalTraffic).mockResolvedValueOnce(traffic)
    .mockRejectedValueOnce(new Error('unavailable'));
  const { result } = renderHook(() => useRegionalTraffic({ stationId }));
  await waitFor(() => expect(result.current.status).toBe('success'));
  expect(result.current.data.aircraft).toHaveLength(1);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.data).toBeNull();
});

it.each(['forbidden', 'unauthorized'])('keeps %s distinct from provider failure', async code => {
  vi.mocked(loadRegionalTraffic).mockRejectedValueOnce({ code });
  const { result } = renderHook(() => useRegionalTraffic({ stationId }));
  await waitFor(() => expect(result.current.status).toBe(code));
  expect(result.current.data).toBeNull();
});
