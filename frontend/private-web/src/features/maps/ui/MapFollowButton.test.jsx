import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { createRenderClock } from '../core/frameLoop';
import OccMap from '../core/OccMap';
import { OCC_MAP_IDLE, OccMapContext } from '../core/OccMapContext';
import {
  createAirPicture, createDemoBlock, createDemoFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { createMotionStore } from '../traffic/motionStore';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import MapDock from './MapDock';
import MapFollowButton from './MapFollowButton';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const NOON = Date.parse(TRAFFIC_NOON);
const PAGE = '/admin-occ/dashboard?stationId=s-1';
const query = () => new URLSearchParams(window.location.search);

// The button over a map context of its own: what OccMap shares of follow mode (core/OccMapContext.js).
function renderButton(follow = {}, { engineStatus = 'ready' } = {}) {
  const value = { ...OCC_MAP_IDLE, engineStatus,
    follow: { available: true, following: false, canFollow: true, toggle: vi.fn(), ...follow } };
  const view = render(
    <LanguageScope>
      <OccMapContext.Provider value={value}><MapFollowButton /></OccMapContext.Provider>
    </LanguageScope>,
  );
  return { ...view, follow: value.follow };
}

// The demo flight on final at noon, moved by a motion store on a render clock frozen there, as the lab draws it.
function demoTraffic() {
  const block = createDemoBlock({ appearAt: NOON - 144_000, imported: true });
  const response = createDemoFlights(block, { imported: true, standCode: 'A6' });
  const flights = toFlightsModel({ ...response, flights: response.flights.filter(row => row.isDemo) });
  const picture = toPictureModel(createAirPicture({ status: 'Disabled' }));
  const motion = createMotionStore({ clock: createRenderClock({ frozenAt: NOON }) });
  motion.ingest({ picture, flights });
  const situation = buildSituation({ picture, flights, nowMs: NOON, estimates: motion.estimatesAt(NOON) });
  return { aircraft: situation.aircraft, trails: { type: 'FeatureCollection', features: [] }, route: null, source: null, motion };
}

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('MapFollowButton', () => {
  it('follows the chosen aircraft and stops following, pressed while it follows, with the S key it shares', () => {
    const { follow, rerender } = renderButton();
    const button = screen.getByRole('button', { name: 'Seguir' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'S');
    expect(button).toBeEnabled();
    // The key before the word, as the view selector writes 1 to 4; the key is not part of its name.
    expect(button).toHaveTextContent(/^SSeguir$/);
    fireEvent.click(button);
    expect(follow.toggle).toHaveBeenCalledTimes(1);
    // Following: the same switch, pressed, with the cyan frame of a pressed view; pressed again it stops.
    rerender(
      <LanguageScope>
        <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, engineStatus: 'ready', follow: { ...follow, following: true } }}>
          <MapFollowButton />
        </OccMapContext.Provider>
      </LanguageScope>,
    );
    const stop = screen.getByRole('button', { name: 'Seguir' });
    expect(stop).toHaveAttribute('aria-pressed', 'true');
    expect(stop).toHaveClass('border-occ-accent', 'bg-occ-accent-soft');
    expect(stop).toHaveTextContent(/^SSeguir$/);
    fireEvent.click(stop);
    expect(follow.toggle).toHaveBeenCalledTimes(2);
  });

  it('waits, disabled, until the selection names an aircraft the map draws; following, it can always stop', () => {
    renderButton({ canFollow: false });
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeDisabled();
    cleanup();
    // The followed aircraft out of sight for a while (a demo fading out, a read late): still pressed, still able to stop.
    renderButton({ canFollow: false, following: true });
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeEnabled();
  });


  it('speaks English on an English screen', () => {
    act(() => resetLanguageForTests('en'));
    renderButton();
    expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-keyshortcuts', 'S');
    cleanup();
    renderButton({ following: true });
    expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is not there on a map that cannot follow, or that cannot draw', () => {
    const { container } = renderButton({ available: false });
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const { container: unavailable } = renderButton({}, { engineStatus: 'unavailable' });
    expect(unavailable).toBeEmptyDOMElement();
    cleanup();
    const { container: outside } = render(<LanguageScope><MapFollowButton /></LanguageScope>);
    expect(outside).toBeEmptyDOMElement();
  });

  it('in an OccMap\'s dock it writes follow=1 and takes it away, and S does the same; a drag lets go too', () => {
    const element = selection => (
      <OccMap defaultView="approach" basemap={false} traffic={demoTraffic()} selection={selection}>
        <MapDock><MapFollowButton /></MapDock>
      </OccMap>
    );
    const view = render(element(null));
    act(() => fake.state.emit(fake.state.liveMaps().at(-1), 'style.load'));
    const dock = () => within(screen.getByTestId('occ-map'));
    // Nothing chosen: nothing to follow yet.
    expect(dock().getByRole('button', { name: 'Seguir' })).toBeDisabled();
    view.rerender(element({ kind: 'flight', id: KEY.demoArrival }));
    fireEvent.click(dock().getByRole('button', { name: 'Seguir' }));
    expect(query().get('follow')).toBe('1');
    expect(query().get('stationId')).toBe('s-1');
    const stop = dock().getByRole('button', { name: 'Seguir' });
    expect(stop).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(stop);
    expect(query().get('follow')).toBeNull();
    expect(dock().getByRole('button', { name: 'Seguir' })).toHaveAttribute('aria-pressed', 'false');
    // Stopped through the switch, the map says nothing.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The S key on the map is the same switch.
    fireEvent.keyDown(screen.getByTestId('occ-map'), { key: 's' });
    expect(query().get('follow')).toBe('1');
    expect(dock().getByRole('button', { name: 'Seguir' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(screen.getByTestId('occ-map'), { key: 'S' });
    expect(query().get('follow')).toBeNull();
    // A person's drag ends it: the switch lets go, and the map says how to come back.
    fireEvent.keyDown(screen.getByTestId('occ-map'), { key: 's' });
    act(() => fake.state.emit(fake.state.liveMaps().at(-1), 'dragstart', { originalEvent: new MouseEvent('mousedown') }));
    expect(query().get('follow')).toBeNull();
    expect(dock().getByRole('button', { name: 'Seguir' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Dejaste de seguir a ZZ9001. Pulsa Seguir para volver.');
  });
});
