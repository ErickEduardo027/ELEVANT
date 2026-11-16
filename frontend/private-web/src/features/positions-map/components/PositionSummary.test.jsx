import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import PositionLegend from './PositionLegend';
import PositionSummary from './PositionSummary';

afterEach(cleanup);

const positions = statuses => statuses.map((status, index) => ({ id: `P${index}`, status }));

it('counts every live status, the unverified and planned positions included, so the rows add up (2-N34)', () => {
  const live = positions(['available', 'occupied', 'planned', ...Array(40).fill('unverified')]);
  const { container } = render(<PositionSummary positions={live} source="occupancy" />);
  expect(screen.getByText('43')).toBeInTheDocument();
  const rows = within(container.querySelector('ul')).getAllByRole('listitem');
  const count = label => rows.find(row => row.textContent.startsWith(label))?.textContent.slice(label.length);
  expect(count('Libre')).toBe('1');
  expect(count('Ocupada')).toBe('1');
  expect(count('Planificada')).toBe('1');
  expect(count('Sin ocupación verificada')).toBe('40');
  expect(rows.map(row => Number(row.textContent.match(/\d+$/)[0])).reduce((sum, value) => sum + value, 0)).toBe(43);
});

it('keeps the two planning rows when the map shows the planned layout', () => {
  const { container } = render(<PositionSummary positions={positions(['planned', 'unverified'])} source="planning" />);
  expect(within(container.querySelector('ul')).getAllByRole('listitem').map(row => row.textContent))
    .toEqual(['Planificada1', 'Sin ocupación verificada1']);
});

it('explains the unverified and planned markers in the live legend too', () => {
  render(<PositionLegend source="occupancy" />);
  for (const label of ['Libre', 'Ocupada', 'Inhabilitada', 'Próxima a liberarse', 'Planificada', 'Sin ocupación verificada'])
    expect(screen.getByText(label)).toBeInTheDocument();
  cleanup();
  render(<PositionLegend source="planning" />);
  expect(screen.queryByText('Libre')).not.toBeInTheDocument();
  expect(screen.getByText('Sin ocupación verificada')).toBeInTheDocument();
});
