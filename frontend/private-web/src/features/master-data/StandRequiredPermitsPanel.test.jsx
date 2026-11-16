import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StandRequiredPermitsPanel from './StandRequiredPermitsPanel';
import { applyOccStandRequiredPermits, setOccStandRequiredPermits } from '../../services/occMasterDataService';

vi.mock('../../services/occMasterDataService', async importOriginal => ({
  ...(await importOriginal()), setOccStandRequiredPermits: vi.fn(), applyOccStandRequiredPermits: vi.fn(),
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const permitTypes = [
  { code: 'AirportId', name: 'Carnet aeroportuario', isSystem: true },
  { code: 'ZONA-RESTRINGIDA', name: 'Carnet de zona restringida', isSystem: false },
];
const a5 = { id: 's-a5', code: 'A5', version: 'v-a5', requiredPermits: [] };
const a6 = { id: 's-a6', code: 'A6', version: 'v-a6',
  requiredPermits: [{ code: 'ZONA-RESTRINGIDA', name: 'Carnet de zona restringida' }] };

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows what each stand requires and sets one stand with its version and key', async () => {
  setOccStandRequiredPermits.mockResolvedValue({ ...a5, requiredPermits: [a6.requiredPermits[0]] });
  const onDone = vi.fn();
  render(<StandRequiredPermitsPanel stationId={stationId} stands={[a5, a6]} permitTypes={permitTypes} canUpdate
    onDone={onDone} onConflict={vi.fn()} />);
  expect(screen.getByText('Exige: Carnet de zona restringida')).toBeInTheDocument();
  expect(screen.getByText('Ninguno')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Editar carnets de A5' }));
  const group = screen.getByRole('group', { name: 'Carnets de A5' });
  fireEvent.click(within(group).getByLabelText('Carnet de zona restringida'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Carnets de A5 guardados.'));
  expect(setOccStandRequiredPermits).toHaveBeenCalledWith('s-a5',
    { documentTypeCodes: ['ZONA-RESTRINGIDA'], expectedVersion: 'v-a5' }, expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('applies the ticked permits to several stands and hands a conflict to the page', async () => {
  applyOccStandRequiredPermits.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409, code: 'version_conflict' }))
    .mockResolvedValue({ stands: [a5, a6] });
  const onDone = vi.fn();
  const onConflict = vi.fn();
  render(<StandRequiredPermitsPanel stationId={stationId} stands={[a5, a6]} permitTypes={permitTypes} canUpdate
    onDone={onDone} onConflict={onConflict} />);
  const form = screen.getByRole('form', { name: 'Aplicar a varias posiciones' });
  const stands = within(form).getByRole('group', { name: 'Posiciones' });
  fireEvent.click(within(stands).getByLabelText('A5'));
  fireEvent.click(within(stands).getByLabelText('A6'));
  fireEvent.click(within(within(form).getByRole('group', { name: 'Carnets' })).getByLabelText('Carnet de zona restringida'));
  fireEvent.click(within(form).getByRole('button', { name: 'Aplicar a 2 posiciones' }));
  await waitFor(() => expect(onConflict).toHaveBeenCalled());
  fireEvent.click(within(form).getByRole('button', { name: 'Aplicar a 2 posiciones' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Carnets aplicados a 2 posiciones.'));
  expect(applyOccStandRequiredPermits).toHaveBeenLastCalledWith({ stationId, standIds: ['s-a5', 's-a6'],
    documentTypeCodes: ['ZONA-RESTRINGIDA'] }, expect.any(String));
});

it('is read-only without the update permission and says when there are no permits to require', () => {
  const view = render(<StandRequiredPermitsPanel stationId={stationId} stands={[a5]} permitTypes={permitTypes}
    canUpdate={false} onDone={vi.fn()} onConflict={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Editar carnets de A5' })).not.toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Aplicar a varias posiciones' })).not.toBeInTheDocument();
  view.unmount();
  render(<StandRequiredPermitsPanel stationId={stationId} stands={[a5]} permitTypes={[]} canUpdate
    onDone={vi.fn()} onConflict={vi.fn()} />);
  expect(screen.getByText(/No hay carnets para exigir/)).toBeInTheDocument();
});
