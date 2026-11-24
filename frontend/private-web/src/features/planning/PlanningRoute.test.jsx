import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import PlanningRoute from './PlanningRoute';
import { usePlanningData } from './usePlanningData';
import { useAuth } from '../auth/AuthContext';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { createPlanningSnapshot, STATION_ID, STATION_SCOPES } from './testing/planningFixtures';
import { OCC_READ_TIMEOUT_MS, OCC_SAFETY_POLL_MS } from '../admin-occ/live/occCadence';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';

const pageCapture = vi.hoisted(() => ({ props: null }));
const observerCapture = vi.hoisted(() => ({ onChanges: null, stop: vi.fn() }));

vi.mock('./PlanningPage', () => ({
  default: props => {
    pageCapture.props = props;
    return <div data-testid="planning-page-proxy" />;
  },
}));
vi.mock('./usePlanningData', () => ({ usePlanningData: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../admin-occ/AdminOccPreviewContext', () => ({ useAdminOccPreview: vi.fn() }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: onChanges => {
    observerCapture.onChanges = onChanges;
    return { start: async () => {}, stop: observerCapture.stop };
  },
}));

const SECOND_STATION = {
  stationId: '20000000-0000-0000-0000-000000000002',
  stationCode: 'SDQ',
};
const SNAPSHOT = createPlanningSnapshot();

function setSession(stationScopes) {
  vi.mocked(useAuth).mockReturnValue({ session: { stationScopes } });
}

beforeEach(() => {
  pageCapture.props = null;
  observerCapture.onChanges = null;
  observerCapture.stop.mockReset();
  vi.mocked(usePlanningData).mockReset();
  vi.mocked(useAuth).mockReset();
  vi.mocked(useAdminOccPreview).mockReset();
  setSession(STATION_SCOPES);
  vi.mocked(usePlanningData).mockReturnValue({ status: 'success', data: SNAPSHOT, error: null });
  vi.mocked(useAdminOccPreview).mockReturnValue({ forceState: 'default' });
});

describe('PlanningRoute', () => {
  it('derives the initial station from the authenticated scope and lets the API choose the default date', () => {
    render(<PlanningRoute />);

    expect(vi.mocked(usePlanningData)).toHaveBeenLastCalledWith({
      stationId: STATION_ID,
      date: undefined,
      refreshToken: 0,
      enabled: true,
    });
    expect(pageCapture.props.stationScopes).toEqual(STATION_SCOPES);
    expect(pageCapture.props.selectedStationId).toBe(STATION_ID);
    expect(pageCapture.props.selectedDate).toBe('2026-08-19');
    expect(pageCapture.props.filterScopeKey).toBe(`${STATION_ID}|2026-08-19`);
    expect(pageCapture.props.hasStationScope).toBe(true);
  });

  it('filters malformed session scopes and disables data loading when none remain', () => {
    setSession([
      { stationId: STATION_ID, stationCode: '' },
      { stationId: '', stationCode: 'PUJ' },
      null,
    ]);
    render(<PlanningRoute />);

    expect(vi.mocked(usePlanningData)).toHaveBeenLastCalledWith({
      stationId: undefined,
      date: undefined,
      refreshToken: 0,
      enabled: false,
    });
    expect(pageCapture.props.stationScopes).toEqual([]);
    expect(pageCapture.props.hasStationScope).toBe(false);
  });

  it('only exposes the PUJ scope, even when it is not the first authorized station', () => {
    setSession([SECOND_STATION, ...STATION_SCOPES]);
    render(<PlanningRoute />);

    expect(pageCapture.props.stationScopes).toEqual(STATION_SCOPES);
    expect(pageCapture.props.selectedStationId).toBe(STATION_ID);
    expect(pageCapture.props).not.toHaveProperty('onStationChange');
    act(() => pageCapture.props.onDateChange('2026-08-20'));
    expect(vi.mocked(usePlanningData)).toHaveBeenLastCalledWith(expect.objectContaining({
      stationId: STATION_ID,
      date: '2026-08-20',
    }));
  });

  it('stops reading and clears the date scope when the session loses PUJ', async () => {
    const { rerender } = render(<PlanningRoute />);
    act(() => pageCapture.props.onDateChange('2026-08-20'));

    setSession([SECOND_STATION]);
    rerender(<PlanningRoute />);

    await waitFor(() => {
      expect(pageCapture.props.hasStationScope).toBe(false);
      expect(vi.mocked(usePlanningData)).toHaveBeenLastCalledWith(expect.objectContaining({
        stationId: undefined,
        date: undefined,
        enabled: false,
      }));
    });
  });

  it('increments the retry token without changing station or date scope', () => {
    render(<PlanningRoute />);

    act(() => pageCapture.props.onRetry());
    expect(vi.mocked(usePlanningData)).toHaveBeenLastCalledWith({
      stationId: STATION_ID,
      date: undefined,
      refreshToken: 1,
      enabled: true,
    });
  });

  it('refreshes station planning and assignment options when the shell announces a planning change', () => {
    vi.useFakeTimers();
    try {
      const shell = createOccShellValue();
      const { unmount } = render(<OccShellTestProvider value={shell}><PlanningRoute /></OccShellTestProvider>);
      expect(pageCapture.props.dataRevision).toBe(0);
      // The route opens no observer of its own (OCC_SCREEN_REFRESH).
      expect(observerCapture.onChanges).toBeNull();
      expect(shell.subscriptions()).toEqual(['occ_planning']);
      // The mount's read, which this stand-in never reports as running, counts until the read timeout.
      act(() => vi.advanceTimersByTime(OCC_READ_TIMEOUT_MS));

      act(() => shell.announce(['hr_absences']));
      expect(pageCapture.props.dataRevision).toBe(0);
      act(() => shell.announce(['occ_planning']));
      expect(vi.mocked(usePlanningData)).toHaveBeenLastCalledWith(expect.objectContaining({
        stationId: STATION_ID,
        refreshToken: 1,
      }));
      expect(pageCapture.props.dataRevision).toBe(1);
      unmount();
      expect(shell.subscriptions()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-read on focus nor on a 25 s timer of its own: only on its 60 s safety poll', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<PlanningRoute />);
      act(() => vi.advanceTimersByTime(OCC_READ_TIMEOUT_MS));
      act(() => window.dispatchEvent(new Event('focus')));
      act(() => vi.advanceTimersByTime(25_000));
      expect(pageCapture.props.dataRevision).toBe(0);
      act(() => vi.advanceTimersByTime(OCC_SAFETY_POLL_MS));
      expect(pageCapture.props.dataRevision).toBe(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the resolved API date stable while a manual refresh is loading', () => {
    render(<PlanningRoute />);
    expect(pageCapture.props.filterScopeKey).toBe(`${STATION_ID}|2026-08-19`);

    vi.mocked(usePlanningData).mockReturnValue({ status: 'loading', data: null, error: null });
    act(() => pageCapture.props.onRetry());

    expect(pageCapture.props.selectedDate).toBe('2026-08-19');
    expect(pageCapture.props.filterScopeKey).toBe(`${STATION_ID}|2026-08-19`);
  });

  it('forwards deterministic Admin/OCC preview state', () => {
    vi.mocked(useAdminOccPreview).mockReturnValue({ forceState: 'planningEmpty' });
    render(<PlanningRoute />);

    expect(pageCapture.props.forceState).toBe('planningEmpty');
  });
});