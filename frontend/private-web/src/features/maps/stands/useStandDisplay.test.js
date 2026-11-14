import { readFileSync } from 'node:fs';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { STAND_REFERENCE } from './standReference';
import { createRampScenario } from '../testing/mapFixtures';
import { useStandDisplay } from './useStandDisplay';

// 14:07 in Punta Cana (UTC−4); the scenario's visits are relative to it.
const NOW = Date.parse('2026-11-13T18:07:00Z');
const MINUTE = 60 * 1000;
const REFERENCES = STAND_REFERENCE.map(stand => ({ id: stand.code, terminal: stand.terminal, lat: stand.latitude, lon: stand.longitude }));
const { board, flightsByTurnaround } = createRampScenario(NOW);
const POSITIONS = mapOccupancyToRampPositions(REFERENCES, board, board.asOf);
const byId = (list, id) => list.find(position => position.id === id);

afterEach(() => {
  vi.useRealTimers();
});

describe('useStandDisplay', () => {
  it('adds displayStatus and signals and keeps the same array while the minute and the positions are the same', () => {
    const { result, rerender } = renderHook(({ list, nowMs }) => useStandDisplay(list, { nowMs }), {
      initialProps: { list: POSITIONS, nowMs: NOW },
    });
    const first = result.current;
    // The board says «Planificada» for A3; due in 10 minutes and covered by nobody, it reads «Llegando» with the
    // attention signal. The screen's own status stays for its list, summary and alerts.
    expect(byId(first, 'A3')).toMatchObject({
      status: 'planned', displayStatus: 'arriving', signals: [{ kind: 'attention', reason: 'uncovered' }],
    });
    expect(byId(first, 'A3').display).toMatchObject({ state: 'arriving', flightNumber: 'DM203', minutesToArrival: 10 });
    expect(byId(first, 'A4')).toMatchObject({ displayStatus: 'occupied', signals: [{ kind: 'urgent', reason: 'conflict' }] });
    expect(byId(first, 'A5')).toMatchObject({ status: 'occupied', displayStatus: 'releasing', signals: [] });
    expect(byId(first, 'A1')).toMatchObject({ status: 'available', displayStatus: 'available' });
    expect(byId(first, 'A10')).toMatchObject({ status: 'disabled', displayStatus: 'disabled' });
    expect(byId(first, 'A7')).toMatchObject({ status: 'unverified', displayStatus: 'unverified' });
    // Every position is still there, as a copy: the screen's list is never changed.
    expect(first).toHaveLength(POSITIONS.length);
    expect(byId(POSITIONS, 'A3')).not.toHaveProperty('displayStatus');

    // The same positions inside the same minute: the very same list.
    rerender({ list: POSITIONS, nowMs: NOW + 30 * 1000 });
    expect(result.current).toBe(first);
    // A new minute or a new read of the positions: a new list.
    rerender({ list: POSITIONS, nowMs: NOW + MINUTE });
    expect(result.current).not.toBe(first);
    expect(byId(result.current, 'A3').display.minutesToArrival).toBe(9);
    const second = result.current;
    rerender({ list: [...POSITIONS], nowMs: NOW + MINUTE });
    expect(result.current).not.toBe(second);
  });

  it('runs on the minute clock without a fixed instant and takes the optional inputs of the state rule', () => {
    vi.useFakeTimers({ now: NOW + 10 * 1000 });
    const { result } = renderHook(() => useStandDisplay(POSITIONS, { flightsByTurnaround }));
    // With the map flights the demo flight on A6 has landed but is not on its stand yet: «Llegando».
    expect(byId(result.current, 'A6')).toMatchObject({ status: 'occupied', displayStatus: 'arriving' });
    const first = result.current;
    act(() => vi.advanceTimersByTime(49 * 1000));
    expect(result.current).toBe(first);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).not.toBe(first);
    expect(byId(result.current, 'A3').display.minutesToArrival).toBe(9);
  });

  it('never imports the dataset (source text guard)', () => {
    expect(readFileSync('src/features/maps/stands/useStandDisplay.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
