import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  assignmentReadiness, planningSnapshot, positionsBoard, reviewQueue,
} from '../../../../tests/visual/occ/fixtures/consoleApi.mjs';
import { OCC_ACCESS } from '../../../../tests/visual/occ/fixtures/occApi.mjs';
import { loadOccPositions } from '../../../services/occPositionsService';
import { loadOccReviewQueue } from '../../../services/occReviewService';
import { getAssignmentReadiness, getPlanningSnapshot } from '../../../services/planningService';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { OccBootContext } from '../../admin-occ/boot/occBootContext';
import { OccShellTestProvider } from '../../admin-occ/shell/testing/occShellFixtures';
import { resetPanelFoldsForTests } from '../../occ-ui/occPanelMemory';
import ConsoleRoute from './ConsoleRoute';
// The console's view, loaded before the tests as the app's chunk would be: the route's dynamic import finds it ready.
import './ConsolePage';

// The route of Panorama with its default adapters (the private web's services, here counted stand-ins at the module
// boundary): what it reads for which station, and when it tells the boot screen the console is ready (contratos 2.6).
// The reads answer the synthetic day of the visual suite; nothing leaves the test.

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);
const auth = vi.hoisted(() => ({ session: null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));
vi.mock('../../weather/useMdpcWeather', async () => ({
  ...(await vi.importActual('../../weather/useMdpcWeather')),
  useMdpcWeather: () => ({ status: 'loading', data: null, fetchedAt: null, refreshFailed: false, refresh: () => {} }),
}));
// next/dynamic as React.lazy, so the console's view (its own chunk in the app) loads, each mount on its own and held
// while a test says so; the weather's satellite map is never opened here.
const viewLoads = vi.hoisted(() => ({ hold: false, pending: [] }));
vi.mock('next/dynamic', async () => {
  const { createElement, lazy, Suspense, useState } = await import('react');
  return {
    default: (load, { loading: Loading = null } = {}) => function Dynamic(props) {
      const [View] = useState(() => lazy(async () => {
        if (viewLoads.hold) await new Promise(resolve => { viewLoads.pending.push(resolve); });
        return { default: (await load()).default };
      }));
      return createElement(Suspense, { fallback: Loading ? createElement(Loading) : null }, createElement(View, props));
    },
  };
});
vi.mock('../../../services/planningService', async () => ({
  ...(await vi.importActual('../../../services/planningService')),
  getPlanningSnapshot: vi.fn(), getAssignmentReadiness: vi.fn(),
}));
vi.mock('../../../services/occPositionsService', async () => ({
  ...(await vi.importActual('../../../services/occPositionsService')), loadOccPositions: vi.fn(),
}));
vi.mock('../../../services/occReviewService', async () => ({
  ...(await vi.importActual('../../../services/occReviewService')), loadOccReviewQueue: vi.fn(),
}));
// The map's reads: the simulated adapter over the same day, its flights read held until a test lets it go.
const mapReads = vi.hoisted(() => ({ hold: false, pending: [], flights: [], answered: 0 }));
vi.mock('../../../services/occMapService', async () => {
  const actual = await vi.importActual('../../../services/occMapService');
  const fixtures = await import('../../../../tests/visual/occ/fixtures/consoleApi.mjs');
  const simulated = actual.createSimulatedOccMapAdapter({ scenario: {
    picture: ({ nowMs, stationId, trails }) => fixtures.airPicture({ now: nowMs, stationId, trails }),
    flights: ({ nowMs, stationId }) => fixtures.mapFlights({ now: nowMs, stationId }),
  } });
  const getMapFlights = async input => {
    mapReads.flights.push(input.stationId);
    if (mapReads.hold) await new Promise(resolve => { mapReads.pending.push(resolve); });
    const answer = await simulated.getMapFlights(input);
    mapReads.answered += 1;
    return answer;
  };
  return { ...actual, occMapService: { ...simulated, getMapFlights } };
});

const PUJ = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const SDQ = '20000000-0000-7000-8000-000000000004';
const scope = (stationId, stationCode) => ({ stationId, stationCode });

function renderRoute(markReady = vi.fn()) {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  render(
    <DepartmentAccessProvider initialAccess={OCC_ACCESS} load={vi.fn().mockResolvedValue(OCC_ACCESS)} observe={false}>
      <OccShellTestProvider>
        <OccBootContext.Provider value={{ markReady }}>
          <ConsoleRoute />
        </OccBootContext.Provider>
      </OccShellTestProvider>
    </DepartmentAccessProvider>,
  );
  return markReady;
}

beforeEach(() => {
  auth.session = { accountId: 'occ-account', stationScopes: [scope(PUJ, 'PUJ')] };
  Object.assign(mapReads, { hold: false, pending: [], flights: [], answered: 0 });
  Object.assign(viewLoads, { hold: false, pending: [] });
  vi.mocked(getPlanningSnapshot).mockReset().mockImplementation(async ({ stationId }) =>
    planningSnapshot({ now: Date.now(), stationId }));
  vi.mocked(getAssignmentReadiness).mockReset().mockImplementation(async ({ stationId, date }) =>
    assignmentReadiness({ stationId, date }));
  vi.mocked(loadOccPositions).mockReset().mockImplementation(async (stationId, date) =>
    positionsBoard({ now: Date.now(), stationId, date }));
  vi.mocked(loadOccReviewQueue).mockReset().mockImplementation(async stationId =>
    reviewQueue({ now: Date.now(), stationId }));
});

afterEach(() => {
  cleanup();
  resetPanelFoldsForTests();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

it('delegates the current station day instead of sending the UTC browser date', async () => {
  // 22:00 at the station: the UTC day (and this device's) is already tomorrow.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T02:00:00Z'));
  renderRoute();
  // The planning snapshot names no date: the server decides the station's day.
  await waitFor(() => expect(getPlanningSnapshot).toHaveBeenCalled());
  const [planningArgs] = vi.mocked(getPlanningSnapshot).mock.calls[0];
  expect(Object.keys(planningArgs).sort()).toEqual(['signal', 'stationId']);
  expect(planningArgs.stationId).toBe(PUJ);
  // The positions board asks for the station's day on the server's clock: the 1st, not the UTC 2nd.
  await waitFor(() => expect(loadOccPositions).toHaveBeenCalledWith(PUJ, '2026-10-01', expect.anything()));
  // The readiness marks follow the day the planning answered.
  await waitFor(() => expect(getAssignmentReadiness).toHaveBeenCalledWith(expect.objectContaining({ stationId: PUJ,
    date: planningSnapshot({ now: Date.now() }).date })));
});

it('always reads the PUJ scope even when it is not the first authorized station', async () => {
  auth.session = { accountId: 'occ-account', stationScopes: [scope(SDQ, 'SDQ'), scope(PUJ, 'PUJ')] };
  renderRoute();
  expect(await screen.findByRole('region', { name: 'Tablero', exact: true })).toBeInTheDocument();
  await waitFor(() => expect(getPlanningSnapshot).toHaveBeenCalled());
  await waitFor(() => expect(mapReads.flights).not.toHaveLength(0));
  for (const [args] of vi.mocked(getPlanningSnapshot).mock.calls) expect(args.stationId).toBe(PUJ);
  expect(mapReads.flights.every(stationId => stationId === PUJ)).toBe(true);
  expect(vi.mocked(loadOccReviewQueue).mock.calls.every(([stationId]) => stationId === PUJ)).toBe(true);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('does not read any station when the account has no PUJ scope', () => {
  auth.session = { accountId: 'occ-account', stationScopes: [scope(SDQ, 'SDQ')] };
  renderRoute();
  expect(screen.getByRole('alert')).toHaveTextContent('estación PUJ');
  expect(getPlanningSnapshot).not.toHaveBeenCalled();
  expect(loadOccPositions).not.toHaveBeenCalled();
  expect(loadOccReviewQueue).not.toHaveBeenCalled();
  expect(mapReads.flights).toEqual([]);
  expect(screen.queryByTestId('occ-map')).not.toBeInTheDocument();
});

it('tells the boot screen the console is ready once its first data is on screen', async () => {
  mapReads.hold = true;
  const markReady = renderRoute();
  // While the map flights are on their way the console has nothing to show: the boot screen keeps waiting, and the
  // map it hosts does not end the wait on its own (its engine may be ready long before the data).
  await waitFor(() => expect(mapReads.pending).toHaveLength(1));
  expect(markReady).not.toHaveBeenCalled();

  await act(async () => { mapReads.pending.forEach(resolve => resolve()); });
  await screen.findByRole('tablist', { name: 'Vista del tablero' });
  expect(markReady).toHaveBeenCalledTimes(1);
  expect(markReady).toHaveBeenCalledWith('console');
});

it('tells the boot screen only once the console is on screen, when its data come before its view', async () => {
  viewLoads.hold = true;
  const markReady = renderRoute();
  // The view's code is on its way while the console's reads already run: the map flights answer first.
  expect(await screen.findByText('Cargando panorama operativo…')).toBeInTheDocument();
  await waitFor(() => expect(mapReads.answered).toBeGreaterThan(0));
  await waitFor(() => expect(getPlanningSnapshot).toHaveBeenCalled());
  await act(async () => {});
  expect(markReady).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Tablero', exact: true })).not.toBeInTheDocument();

  await act(async () => { viewLoads.pending.forEach(resolve => resolve()); });
  await screen.findByRole('tablist', { name: 'Vista del tablero' });
  expect(markReady).toHaveBeenCalledTimes(1);
  expect(markReady).toHaveBeenCalledWith('console');
});

it('does not keep the boot screen over a console that cannot read its station', () => {
  auth.session = { accountId: 'occ-account', stationScopes: [scope(SDQ, 'SDQ')] };
  const markReady = renderRoute();
  // The notice that needs the user is on screen at once, so the boot screen leaves instead of covering it for 6 s.
  expect(screen.getByRole('alert')).toHaveTextContent('estación PUJ');
  expect(markReady).toHaveBeenCalledTimes(1);
  expect(markReady).toHaveBeenCalledWith('console');
});
