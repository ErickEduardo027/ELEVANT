import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import PositionsTable, { standAgentOf } from './PositionsTable';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

// Synthetic stands as the page gives them: the board's fields and the state the map draws (`displayStatus`).
const STANDS = Object.freeze([
  { id: 'A1', terminal: 'A', status: 'available', displayStatus: 'available', coveredBy: ['Ana Ruiz'] },
  { id: 'A5', terminal: 'A', status: 'occupied', displayStatus: 'arriving', flightNumber: 'ZZ9001', isDemo: true,
    assignedAgent: 'J. Ramírez' },
  { id: 'C7', terminal: 'B', status: 'available', displayStatus: 'available', locationSource: 'none' },
]);

it('lists each stand with its code, terminal, state in words, flight and agent, one test id per row', () => {
  render(<PositionsTable positions={STANDS} onSelectPosition={() => {}} />);
  const table = screen.getByRole('table', { name: 'Lista de posiciones' });
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
    .toEqual(['Posición', 'Terminal', 'Estado', 'Vuelo', 'Agente']);
  const rows = screen.getAllByTestId('position-list-item');
  expect(rows).toHaveLength(3);
  expect(rows[1]).toHaveTextContent('Llegando');
  expect(within(rows[1]).getByText('Demo')).toBeInTheDocument();
  expect(rows[0]).toHaveTextContent('Libre');
  expect(rows[0]).toHaveTextContent('Ana Ruiz');
  expect(rows[2]).toHaveTextContent('Sin ubicar');
  expect(rows[2]).toHaveTextContent('Sin asignar');
});

it('chooses a stand with a click or Enter and marks the chosen one', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<PositionsTable positions={STANDS} selectedPositionId="A5" onSelectPosition={onSelect} />);
  const rows = screen.getAllByTestId('position-list-item');
  expect(rows[1]).toHaveAttribute('aria-selected', 'true');
  await user.click(within(rows[2]).getByText('C7'));
  expect(onSelect).toHaveBeenLastCalledWith('C7');
  rows[0].focus();
  await user.keyboard('{Enter}');
  expect(onSelect).toHaveBeenLastCalledWith('A1');
});

it('says why it is empty, and speaks English on the English screens', () => {
  const { unmount } = render(<PositionsTable positions={[]} emptyReason="no-results" />);
  expect(screen.getByText('Ninguna posición coincide con los filtros aplicados.')).toBeInTheDocument();
  unmount();
  act(() => resetLanguageForTests('en'));
  render(<LanguageScope><PositionsTable positions={STANDS} /></LanguageScope>);
  expect(screen.getByRole('table', { name: 'Stand list' })).toBeInTheDocument();
  expect(screen.getAllByTestId('position-list-item')[1]).toHaveTextContent('Arriving');
});

it('names who covers a stand: the coverage first, else the flight\'s agent', () => {
  expect(standAgentOf(STANDS[0])).toBe('Ana Ruiz');
  expect(standAgentOf(STANDS[1])).toBe('J. Ramírez');
  expect(standAgentOf(STANDS[2])).toBeNull();
});

it('names who covers the stand now when the board brought its coverage windows (N26)', () => {
  const live = now => ({ live: true, now, visit: null, ended: [], upcoming: [], windows: [] });
  // The names of the day list Elena Soto, whose coverage ended: nobody covers it now, never the day's names.
  const ended = { ...STANDS[0], coveredBy: ['Elena Soto'], assignedAgent: 'Elena Soto', display: { coverage: live([]) } };
  expect(standAgentOf(ended)).toBeNull();
  expect(standAgentOf({ ...ended, display: { coverage: live([{ name: 'Luis Peña', isReinforcement: false }]) } }))
    .toBe('Luis Peña');
  // Another date: the names of the day.
  expect(standAgentOf({ ...ended, display: { coverage: { ...live([]), live: false } } })).toBe('Elena Soto');
});
