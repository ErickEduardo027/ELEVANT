import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../tests/fakeMapLibre';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { standPoint } from '../maps/testing/mapFixtures';
import PositionsMapPage from './PositionsMapPage';

// Mapa de posiciones with its real map (PositionMap over OccMap, on the shared fake MapLibre): the page has one
// legend, the map's, with the states of the stands on screen. The other page tests stub the map.
vi.mock('maplibre-gl', async () => (await import('../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const PAGE = '/admin-occ/positions-map?stationId=s-1';
const UNOFFICIAL = 'No oficialUbicación de referencia interna, sin verificar';

// Synthetic stands of the page at their reference points (invented flight and states); OCC placed all but A5.
function position(id, overrides = {}) {
  const [longitude, latitude] = standPoint(id);
  return {
    id,
    terminal: 'A',
    latitude,
    longitude,
    locationSource: 'occ',
    status: 'available',
    flightId: null,
    flightNumber: null,
    airline: null,
    aircraftRegistration: null,
    aircraftType: null,
    assignedAgent: null,
    estimatedReleaseTime: null,
    updatedAt: '2026-08-06T10:00:00-04:00',
    combinedConfiguration: null,
    linkedPositionId: null,
    ...overrides,
  };
}

const SNAPSHOT = {
  station: { code: 'PUJ' },
  positions: [
    position('A1'),
    position('A5', {
      status: 'occupied', locationSource: 'reference', flightId: 6, flightNumber: 'ZZ187', airline: 'Aerolínea de prueba',
      aircraftType: 'A320',
    }),
    position('A10', { status: 'disabled', combinedConfiguration: '9-Alfa', linkedPositionId: 'A9' }),
  ],
};

function renderPage(data, { english = false } = {}) {
  const page = <PositionsMapPage status="success" data={data} error={null} connection="connected" onRetry={() => {}} />;
  const view = render(english ? <LanguageScope>{page}</LanguageScope> : page);
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  return { ...view, map };
}

const legendItems = () => within(screen.getByTestId('map-legend')).getAllByRole('listitem').map(item => item.textContent);

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  window.history.replaceState({}, '', '/');
});

describe('PositionsMapPage with its map', () => {
  it('shows one legend, the map\'s, with the states on screen and no drawing the map does not make', () => {
    renderPage(SNAPSHOT);
    expect(fake.state.liveMaps()).toHaveLength(1);
    // One «Leyenda», inside the map: the page no longer adds its own coloured squares.
    const [button, ...others] = screen.getAllByRole('button', { name: 'Leyenda' });
    expect(others).toEqual([]);
    expect(screen.getByTestId('occ-map')).toContainElement(button);
    expect(legendItems()).toEqual(['Libre', 'Ocupada', 'Inhabilitada', UNOFFICIAL]);
    // The page's drawing of a combined configuration, with a link line the map does not draw, is gone; the
    // cancelled stand reads as «Inhabilitada» and its drawer explains the configuration.
    expect(screen.queryByText('Configuración combinada')).not.toBeInTheDocument();
  });

  it('lists the planned and unverified stands of the planning layout, as the page legend did before', () => {
    renderPage({
      station: { code: 'PUJ' },
      source: 'planning',
      positions: [position('A1', { status: 'planned' }), position('A3', { status: 'unverified', locationSource: 'reference' })],
    });
    expect(screen.getAllByRole('button', { name: 'Leyenda' })).toHaveLength(1);
    expect(legendItems()).toEqual(['Planificada', 'Sin verificar', UNOFFICIAL]);
  });

  it('shows the map\'s legend in English', () => {
    act(() => resetLanguageForTests('en'));
    renderPage(SNAPSHOT, { english: true });
    expect(screen.getAllByRole('button', { name: 'Legend' })).toHaveLength(1);
    expect(legendItems()).toEqual(['Free', 'Occupied', 'Disabled', 'UnofficialInternal reference location, not verified']);
    expect(screen.queryByText('Combined configuration')).not.toBeInTheDocument();
  });
});
