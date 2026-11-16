import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import StandDetailFacts from './StandDetailFacts';

afterEach(() => cleanup());

const board = requiredPermits => ({
  asOf: '2026-11-16T18:00:00Z',
  positions: [{ standId: 's-a5', code: 'A5', terminalCode: 'A', status: 'available', turnarounds: [], latitude: null,
    longitude: null, hasBoardingBridge: false, isRemote: false, maxAircraftSize: null, cancelledBy: null,
    narrowbodyOnly: false, coveredBy: [], ...(requiredPermits ? { requiredPermits } : {}) }],
});
const position = data => mapOccupancyToRampPositions([{ id: 'A5', terminal: 'A', lat: 18.56, lon: -68.36 }], data)[0];

// ADR-0045: the characteristics of a stand say which permits it requires.
it('says «Exige: …» with the permits the positions board names', () => {
  render(<StandDetailFacts position={position(board(['Carnet de zona restringida']))} />);
  expect(screen.getByTestId('stand-characteristics')).toHaveTextContent('Exige: Carnet de zona restringida');
});

it('says nothing of permits for a stand that requires none or an older board', () => {
  render(<StandDetailFacts position={position(board(null))} />);
  expect(screen.getByTestId('stand-characteristics')).not.toHaveTextContent('Exige');
});
