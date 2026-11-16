import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlanningTurnaround } from './usePlanningTurnaround';
import * as planningService from '../../services/planningService';

const turnaroundId = '91000000-0000-0000-0000-000000000002';

function detail(version, overrides = {}) {
  return {
    turnaround: {
      station: { id: 'station-id', code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
      turnaround: { id: turnaroundId, operationCode: 'PUJ-20261105-001', status: 'Confirmed' },
      version,
      isCharter: false,
      allowedActions: ['reschedule', 'cancel', 'divert'],
      ...overrides,
    },
    etag: `"${version}"`,
  };
}

const reschedule = {
  arrivalFlightNumber: 'EV311', arrivalOriginIata: 'MIA', arrivalScheduledAt: '2026-11-05T17:00:00.000Z',
  departureFlightNumber: 'EV312', departureDestinationIata: 'MIA', departureScheduledAt: '2026-11-05T18:30:00.000Z',
  standId: null, aircraftTypeId: null, reason: 'La aerolínea adelantó el vuelo.',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePlanningTurnaround (3-A)', () => {
  it('reads the flight with its ETag and the changes its state allows', async () => {
    const read = vi.spyOn(planningService, 'getTurnaround').mockResolvedValue(detail('v1'));
    const { result } = renderHook(() => usePlanningTurnaround(turnaroundId));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(read).toHaveBeenCalledWith(turnaroundId, { signal: expect.any(AbortSignal) });
    expect(result.current.etag).toBe('"v1"');
    expect(result.current.allowedActions).toEqual(['reschedule', 'cancel', 'divert']);
  });

  it('explains an unreadable flight by its state: session, permission, missing or retryable', async () => {
    for (const [status, expected] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [503, 'error']]) {
      vi.spyOn(planningService, 'getTurnaround').mockRejectedValueOnce(Object.assign(new Error('x'), { status }));
      const { result, unmount } = renderHook(() => usePlanningTurnaround(turnaroundId));
      await waitFor(() => expect(result.current.status).toBe(expected));
      unmount();
    }
  });

  it('sends «Editar vuelo» with the ETag on screen and keeps the answer as the new version', async () => {
    vi.spyOn(planningService, 'getTurnaround').mockResolvedValue(detail('v1'));
    const send = vi.spyOn(planningService, 'rescheduleTurnaround').mockResolvedValue(detail('v2'));
    const { result } = renderHook(() => usePlanningTurnaround(turnaroundId));
    await waitFor(() => expect(result.current.status).toBe('success'));

    let outcome;
    await act(async () => { outcome = await result.current.submit('reschedule', reschedule); });

    expect(outcome.ok).toBe(true);
    expect(send).toHaveBeenCalledWith(turnaroundId, reschedule,
      { ifMatch: '"v1"', idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(result.current.etag).toBe('"v2"');
  });

  it('cancels and diverts with the outcome by name and the reason', async () => {
    vi.spyOn(planningService, 'getTurnaround').mockResolvedValue(detail('v1'));
    const send = vi.spyOn(planningService, 'changeTurnaroundStatus')
      .mockResolvedValueOnce(detail('v2', { allowedActions: [] }))
      .mockResolvedValueOnce(detail('v3', { allowedActions: [] }));
    const { result } = renderHook(() => usePlanningTurnaround(turnaroundId));
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => { await result.current.submit('cancel', { reason: 'La aerolínea canceló el vuelo.' }); });
    await act(async () => { await result.current.submit('divert', { reason: 'El vuelo se desvió a SDQ.' }); });

    expect(send.mock.calls[0].slice(0, 2)).toEqual([turnaroundId,
      { outcome: 'Cancelled', reason: 'La aerolínea canceló el vuelo.' }]);
    expect(send.mock.calls[0][2].ifMatch).toBe('"v1"');
    expect(send.mock.calls[1].slice(0, 2)).toEqual([turnaroundId,
      { outcome: 'Diverted', reason: 'El vuelo se desvió a SDQ.' }]);
    expect(send.mock.calls[1][2].ifMatch).toBe('"v2"');
    expect(result.current.allowedActions).toEqual([]);
  });

  it('retries an uncertain result with the same key and ETag, and re-reads the flight after a stale answer', async () => {
    const read = vi.spyOn(planningService, 'getTurnaround')
      .mockResolvedValueOnce(detail('v1'))
      .mockResolvedValueOnce(detail('v2'));
    const send = vi.spyOn(planningService, 'rescheduleTurnaround')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 412, code: 'version_conflict' }))
      .mockResolvedValueOnce(detail('v3'));
    const { result } = renderHook(() => usePlanningTurnaround(turnaroundId));
    await waitFor(() => expect(result.current.status).toBe('success'));

    let outcome;
    await act(async () => { outcome = await result.current.submit('reschedule', reschedule); });
    expect(outcome).toMatchObject({ ok: false, refreshed: false });
    await act(async () => { outcome = await result.current.submit('reschedule', reschedule); });
    expect(outcome).toMatchObject({ ok: false, refreshed: true });
    expect(send.mock.calls[1][2]).toEqual(send.mock.calls[0][2]);

    await waitFor(() => expect(result.current.etag).toBe('"v2"'));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => { outcome = await result.current.submit('reschedule', reschedule); });
    expect(outcome.ok).toBe(true);
    expect(send.mock.calls[2][2].ifMatch).toBe('"v2"');
    expect(send.mock.calls[2][2].idempotencyKey).not.toBe(send.mock.calls[0][2].idempotencyKey);
  });

  it('sends nothing before the flight is read', async () => {
    vi.spyOn(planningService, 'getTurnaround').mockReturnValue(new Promise(() => {}));
    const send = vi.spyOn(planningService, 'changeTurnaroundStatus');
    const { result } = renderHook(() => usePlanningTurnaround(turnaroundId));

    let outcome;
    await act(async () => { outcome = await result.current.submit('cancel', { reason: 'Motivo suficiente.' }); });

    expect(outcome.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
