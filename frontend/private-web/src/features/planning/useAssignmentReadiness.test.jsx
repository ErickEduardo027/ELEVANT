import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAssignmentReadiness } from './useAssignmentReadiness';
import { withAssignmentReadiness } from './planningMappers';
import { getAssignmentReadiness } from '../../services/planningService';

vi.mock('../../services/planningService', () => ({ getAssignmentReadiness: vi.fn() }));

const stationId = '20000000-0000-0000-0000-000000000001';
const marks = { stationId, date: '2026-08-19', assignments: [{ assignmentId: 'A-1', turnaroundId: 't-1',
  agentId: 'agent-1', reasons: ['ramp_driver_license_not_current'] }] };

afterEach(() => vi.resetAllMocks());

describe('useAssignmentReadiness (2-N25)', () => {
  it('reads the marks of the board scope and stays idle without one', async () => {
    getAssignmentReadiness.mockResolvedValue(marks);
    const { result, rerender } = renderHook(props => useAssignmentReadiness(props),
      { initialProps: { stationId, date: '2026-08-19', enabled: false } });
    expect(result.current.status).toBe('idle');
    expect(getAssignmentReadiness).not.toHaveBeenCalled();
    rerender({ stationId, date: '2026-08-19', enabled: true });
    await waitFor(() => expect(result.current).toMatchObject({ status: 'success', marks }));
    expect(getAssignmentReadiness).toHaveBeenCalledWith({ stationId, date: '2026-08-19',
      signal: expect.any(AbortSignal) });
  });

  it('reports a failure without throwing and reads again on a new token', async () => {
    getAssignmentReadiness.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(marks);
    const { result, rerender } = renderHook(props => useAssignmentReadiness(props),
      { initialProps: { stationId, date: '2026-08-19', refreshToken: 0 } });
    await waitFor(() => expect(result.current.status).toBe('error'));
    rerender({ stationId, date: '2026-08-19', refreshToken: 1 });
    await waitFor(() => expect(result.current.status).toBe('success'));
  });
});

describe('withAssignmentReadiness', () => {
  const flight = { id: 'f-1', assignedAgents: [{ assignmentId: 'a-1', displayName: 'Riley' },
    { assignmentId: 'a-2', displayName: 'Mateo' }] };

  it('marks the unfit agents of a flight and counts them', () => {
    const [marked, untouched] = withAssignmentReadiness([flight, { id: 'f-2', assignedAgents: [] }], marks);
    expect(marked.unfitAgentCount).toBe(1);
    expect(marked.assignedAgents[0]).toMatchObject({ displayName: 'Riley',
      unfitReasons: ['ramp_driver_license_not_current'] });
    expect(marked.assignedAgents[1]).toBe(flight.assignedAgents[1]);
    expect(untouched).toEqual({ id: 'f-2', assignedAgents: [] });
  });

  it('keeps the flights as they are without marks', () => {
    const flights = [flight];
    expect(withAssignmentReadiness(flights, null)).toBe(flights);
    expect(withAssignmentReadiness(flights, { ...marks, assignments: [] })).toBe(flights);
  });
});
