import { useState } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import PositionDetailDrawer from '../../positions-map/components/PositionDetailDrawer';
import { createMapStands } from '../testing/mapFixtures';
import OccMap from './OccMap';
import { useMapSelection } from './useMapSelection';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const STANDS = createMapStands();
const PAGE = '/admin-occ/positions-map?stationId=s-1';

// A positions screen in miniature: the selection lives in the URL and the drawer has its own open state, so closing
// it does not clear the selection (contracts 2.2: Esc closes an open drawer first, then clears the selection).
function PositionsScreen() {
  const { selection, selectStand, clear } = useMapSelection();
  const [drawerOpen, setDrawerOpen] = useState(true);
  const position = selection?.kind === 'stand' ? STANDS.find(stand => stand.id === selection.id) ?? null : null;
  return (
    <>
      <div className="relative h-96">
        <OccMap stands={STANDS} selection={selection} onSelect={next => (next ? selectStand(next.id) : clear())}
          testId="position-map-container" />
      </div>
      <PositionDetailDrawer position={drawerOpen ? position : null} onClose={() => setDrawerOpen(false)}
        onViewFlightInMonitoring={() => {}} />
    </>
  );
}

const pressEscape = target => {
  const event = createEvent.keyDown(target, { key: 'Escape' });
  fireEvent(target, event);
  return event;
};

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', `${PAGE}&stand=A5`);
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

it('one Esc closes only the open PositionDetailDrawer and a second Esc clears the map selection', () => {
  render(<PositionsScreen />);
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  expect(screen.getByTestId('position-detail-drawer')).toBeInTheDocument();
  expect(map.getSource('occ-selection').data.features).toHaveLength(1);
  // The key is pressed on the map, where the map keys listen.
  const canvas = map.getCanvas();

  const first = pressEscape(canvas);
  expect(first.defaultPrevented).toBe(true);
  expect(screen.queryByTestId('position-detail-drawer')).not.toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('stand')).toBe('A5');
  expect(map.getSource('occ-selection').data.features).toHaveLength(1);

  const second = pressEscape(canvas);
  expect(second.defaultPrevented).toBe(true);
  expect(window.location.search).toBe('?stationId=s-1');
  expect(map.getSource('occ-selection').data.features).toEqual([]);

  // A third Esc has nothing left to close or clear, and is left to the page.
  expect(pressEscape(canvas).defaultPrevented).toBe(false);
});
