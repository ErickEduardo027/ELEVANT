import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useMdpcWeather } from './useMdpcWeather';
import { loadCurrentObservation } from '../../services/weatherService';

vi.mock('../../services/weatherService', () => ({ loadCurrentObservation: vi.fn() }));

const observation = { station: 'MDPC', observedAt: '2026-10-11T19:00:00Z', metar: { raw: 'MDPC 111900Z' } };

beforeEach(() => vi.mocked(loadCurrentObservation).mockReset());

it('does not request weather until the PUJ scope is available', () => {
  renderHook(() => useMdpcWeather({ enabled: false }));
  expect(loadCurrentObservation).not.toHaveBeenCalled();
});

it('keeps the last observation and flags a failed refresh instead of inventing data', async () => {
  vi.mocked(loadCurrentObservation).mockResolvedValueOnce(observation);
  const { result } = renderHook(() => useMdpcWeather());
  await waitFor(() => expect(result.current.status).toBe('success'));
  expect(result.current.data).toBe(observation);

  vi.mocked(loadCurrentObservation).mockRejectedValueOnce(new Error('network'));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.refreshFailed).toBe(true));
  expect(result.current.data).toBe(observation);
  expect(result.current.status).toBe('success');
});

it('reports an error when there is no previous observation', async () => {
  vi.mocked(loadCurrentObservation).mockRejectedValueOnce(new Error('network'));
  const { result } = renderHook(() => useMdpcWeather());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.data).toBeNull();
});
