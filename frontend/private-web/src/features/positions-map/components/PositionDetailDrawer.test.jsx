import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { withStandDisplay } from '../../maps/stands/standModel';
import PositionDetailDrawer from './PositionDetailDrawer';

// A synthetic free stand of the positions board, without a flight.
const POSITION = {
  id: 'A5', terminal: 'A', status: 'available', standId: null, flightId: null, flightNumber: null,
  combinedConfiguration: null, linkedPositionId: null, updatedAt: '2026-11-12T15:00:00Z',
};

const press = key => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
};

afterEach(cleanup);

it('calls preventDefault when Escape closes the drawer', () => {
  const onClose = vi.fn();
  const { rerender } = render(<PositionDetailDrawer position={POSITION} onClose={onClose} onViewFlightInMonitoring={() => {}} />);
  expect(screen.getByTestId('position-detail-drawer')).toBeInTheDocument();

  expect(press('Enter').defaultPrevented).toBe(false);
  expect(onClose).not.toHaveBeenCalled();

  const escape = press('Escape');
  expect(onClose).toHaveBeenCalledOnce();
  expect(escape.defaultPrevented).toBe(true);

  // Closed, the drawer listens to nothing: the next Escape is free for the map.
  rerender(<PositionDetailDrawer position={null} onClose={onClose} onViewFlightInMonitoring={() => {}} />);
  expect(screen.queryByTestId('position-detail-drawer')).not.toBeInTheDocument();
  expect(press('Escape').defaultPrevented).toBe(false);
  expect(onClose).toHaveBeenCalledOnce();
});

it('shows the stand facts and keeps its test id and «Ubicar en el mapa»', async () => {
  // A free stand with a row, cancelled by its combined neighbour, limited to narrow-body aircraft and covered by an
  // invented agent, as the positions map reads it now.
  const [stand] = withStandDisplay([{
    ...POSITION, standId: 'stand-A10', id: 'A10', status: 'disabled', turnarounds: [], cancelledBy: 'A09',
    linkedPositionId: 'A9', combinedConfiguration: '9-Alfa', narrowbodyOnly: true, coveredBy: ['Ana Ruiz'],
    locationSource: 'reference', latitude: 18.56, longitude: -68.36,
  }]);
  const onStartPlacing = vi.fn();
  render(<PositionDetailDrawer position={stand} onClose={() => {}} onViewFlightInMonitoring={() => {}} canAssign
    onStartPlacing={onStartPlacing} operationDate="2026-11-13" />);
  const drawer = screen.getByTestId('position-detail-drawer');
  const facts = within(drawer).getByRole('list', { name: 'Estado en el mapa' });
  expect(within(facts).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'Inhabilitada', 'Cubre Ana Ruiz', 'Anulada por A9', 'Solo fuselaje estrecho', 'No oficialReferencia interna sin verificar',
  ]);
  // The existing explanation of the combined configuration stays, and so does the action that places the stand.
  expect(within(drawer).getByTestId('combined-position-banner')).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: 'Ubicar en el mapa' }));
  expect(onStartPlacing).toHaveBeenCalledExactlyOnceWith(stand);
});
