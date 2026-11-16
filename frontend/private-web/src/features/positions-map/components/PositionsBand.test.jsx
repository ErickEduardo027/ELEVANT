import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { withStandDisplay } from '../../maps/stands/standModel';
import { boardVisit } from '../../maps/testing/mapFixtures';
import PositionsBand from './PositionsBand';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

// 14:00 in Punta Cana; A5 waits for a synthetic arrival in 30 min, A1 is free.
const NOW = Date.parse('2026-11-13T18:00:00Z');
const STANDS = withStandDisplay([
  { id: 'A1', terminal: 'A', status: 'available', turnarounds: [] },
  { id: 'A5', terminal: 'A', status: 'planned', turnarounds: [boardVisit({ nowMs: NOW, flight: 'ZZ161', arrivalInMin: 30 })] },
], { nowMs: NOW });

it('folded, counts the stands by the state the map draws and hides the band', () => {
  const stands = [{ id: 'A1', displayStatus: 'available' }, { id: 'A2', displayStatus: 'available' },
    { id: 'A5', displayStatus: 'arriving' }];
  render(<PositionsBand stands={stands} nowMs={NOW} timeZone="America/Santo_Domingo" open={false} onToggle={() => {}} />);
  expect(screen.getByRole('button', { name: 'Banda de posiciones' })).toHaveAttribute('aria-expanded', 'false');
  const counts = screen.getByRole('list', { name: 'Posiciones por estado' });
  expect(counts).toHaveTextContent('Libre 2');
  expect(counts).toHaveTextContent('Llegando 1');
  expect(screen.queryByRole('group', { name: 'Posiciones en el tiempo' })).not.toBeInTheDocument();
});

it('open, draws each visit as a bar with the «ahora» line, and a bar chooses its stand', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onToggle = vi.fn();
  render(<PositionsBand stands={STANDS} nowMs={NOW} timeZone="America/Santo_Domingo" open onToggle={onToggle}
    onSelectStand={onSelect} selectedCode="A5" />);
  const band = screen.getByRole('group', { name: 'Posiciones en el tiempo' });
  const bar = within(band).getByRole('button', { name: /ZZ161/ });
  expect(bar).toHaveAttribute('aria-pressed', 'true');
  await user.click(bar);
  expect(onSelect).toHaveBeenCalledWith('A5');
  // «Con vuelos» leaves A1 out; «Todas» brings it back.
  expect(within(band).queryByText('A1')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Todas' }));
  expect(within(band).getByText('A1')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Banda de posiciones' }));
  expect(onToggle).toHaveBeenCalledOnce();
});
