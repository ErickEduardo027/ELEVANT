import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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
