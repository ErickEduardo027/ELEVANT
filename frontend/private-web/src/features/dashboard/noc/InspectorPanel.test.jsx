import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { OCC_MAP_IDLE, OccMapContext } from '../../maps/core/OccMapContext';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_NOON,
} from '../../maps/testing/trafficFixtures';
import { buildSituation, selectionTarget, toFlightsModel, toPictureModel } from '../../maps/traffic/situationModel';
import { createTelemetryStore } from '../../maps/traffic/telemetryStore';
import InspectorPanel from './InspectorPanel';

// Panorama's inspector inside its map (M4): the flight's data block offers «Seguir» and «Seguir en 3D» as the other
// screens do, and a stand whose parked aircraft the traffic draws offers «Seguir en 3D» on that aircraft.
const NOON = Date.parse(TRAFFIC_NOON);

function noonSituation() {
  const raw = createMapFlights();
  return buildSituation({ picture: toPictureModel(createAirPicture()), flights: toFlightsModel(raw), nowMs: NOON,
    estimates: createEstimates() });
}

function mapContext({ follow = {}, three = {} } = {}) {
  return { ...OCC_MAP_IDLE, engineStatus: 'ready',
    follow: { available: true, following: false, canFollow: true, toggle: vi.fn(),
      three: { on: false, start: vi.fn(), stop: vi.fn(), startOn: vi.fn(() => true), parkedAt: vi.fn(() => null), ...three },
      ...follow } };
}

function renderInspector(props, value = mapContext()) {
  const view = render(
    <LanguageScope>
      <OccMapContext.Provider value={value}>
        <InspectorPanel mapFlights={[]} onClear={vi.fn()} nowMs={NOON} timeZone="America/Santo_Domingo" {...props} />
      </OccMapContext.Provider>
    </LanguageScope>,
  );
  return { ...view, value };
}

function flightProps() {
  const situation = noonSituation();
  const selection = { kind: 'flight', id: KEY.arrival };
  const telemetry = createTelemetryStore({ clock: { now: () => NOON } });
  telemetry.set(situation);
  return { selection, target: selectionTarget(selection, situation), telemetry };
}

const STAND = Object.freeze({ id: 'A6', code: 'A6', status: 'occupied', latitude: 18.57, longitude: -68.36 });

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

describe('InspectorPanel «Seguir» and «Seguir en 3D» (M4)', () => {
  it('gives the flight\'s data block «Seguir» (the map\'s switch) and «Seguir en 3D» inside the map', () => {
    const { value } = renderInspector(flightProps());
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(value.follow.toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Seguir en 3D' }));
    expect(value.follow.three.start).toHaveBeenCalledTimes(1);
  });

  it('shows «Seguir» pressed while the map follows', () => {
    renderInspector(flightProps(), mapContext({ follow: { following: true } }));
    expect(screen.getByRole('button', { name: 'Seguir' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('outside a map that can follow (the grid layout) it offers neither', () => {
    renderInspector(flightProps(), OCC_MAP_IDLE);
    expect(screen.queryByRole('button', { name: 'Seguir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seguir en 3D' })).not.toBeInTheDocument();
  });

  it('on a stand whose parked aircraft the traffic draws, «Seguir en 3D» follows that aircraft', () => {
    const parked = Object.freeze({ kind: 'flight', id: KEY.arrival });
    const value = mapContext({ three: { parkedAt: vi.fn(code => (code === 'A6' ? parked : null)) } });
    renderInspector({ selection: { kind: 'stand', id: 'A6' }, stand: STAND }, value);
    expect(value.follow.three.parkedAt).toHaveBeenCalledWith('A6');
    const button = screen.getByRole('button', { name: 'Seguir en 3D' });
    expect(button).toHaveAttribute('title', 'Seguir en 3D el avión elegido. También con doble clic sobre un avión.');
    fireEvent.click(button);
    expect(value.follow.three.startOn).toHaveBeenCalledExactlyOnceWith(parked);
  });

  it('a stand without such an aircraft, or outside a map, has no «Seguir en 3D»', () => {
    renderInspector({ selection: { kind: 'stand', id: 'A6' }, stand: STAND });
    expect(screen.queryByRole('button', { name: 'Seguir en 3D' })).not.toBeInTheDocument();
    cleanup();
    renderInspector({ selection: { kind: 'stand', id: 'A6' }, stand: STAND }, OCC_MAP_IDLE);
    expect(screen.queryByRole('button', { name: 'Seguir en 3D' })).not.toBeInTheDocument();
  });
});
