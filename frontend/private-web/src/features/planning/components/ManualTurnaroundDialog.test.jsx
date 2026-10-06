import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManualTurnaroundDialog from './ManualTurnaroundDialog';
import { createManualTurnaround, getManualTurnaroundOptions } from '../../../services/planningService';

vi.mock('../../../services/planningService', () => ({
  getManualTurnaroundOptions: vi.fn(),
  createManualTurnaround: vi.fn(),
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const airlineId = '20000000-0000-7000-8000-000000000010';
const options = {
  station: { id: stationId, code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
  date: '2026-09-26',
  stationAirport: { id: '20000000-0000-7000-8000-000000000001', iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana' },
  airlines: [{ id: airlineId, iataCode: 'EV', name: 'Elevant Demo' }],
  airports: [{ id: '20000000-0000-7000-8000-000000000002', iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami' }],
  stands: [{ id: '20000000-0000-7000-8000-000000000005', code: 'A01', terminal: { id: '20000000-0000-7000-8000-000000000004', code: 'A', name: 'Terminal A' } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getManualTurnaroundOptions).mockResolvedValue(options);
  vi.mocked(createManualTurnaround).mockResolvedValue({ turnaroundId: '70000000-0000-4000-8000-000000000001', operationCode: 'MAN-TEST', replayed: false });
});

function renderDialog(props = {}) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(<ManualTurnaroundDialog stationId={stationId} initialDate="2026-09-26"
    onCreated={onCreated} onClose={onClose} {...props} />);
  return { onCreated, onClose };
}

async function fillForm() {
  await screen.findByRole('option', { name: /Elevant Demo/ });
  await userEvent.selectOptions(screen.getByLabelText('Aerolínea contratada'), airlineId);
  await userEvent.selectOptions(screen.getByLabelText('Posición de estacionamiento'), options.stands[0].id);
  await userEvent.selectOptions(screen.getByLabelText('Origen de llegada'), 'MIA');
  await userEvent.selectOptions(screen.getByLabelText('Destino de salida'), 'MIA');
  await userEvent.type(screen.getByLabelText('Vuelo de llegada'), 'EV 311');
  await userEvent.type(screen.getByLabelText('Vuelo de salida'), 'EV 312');
  fireEvent.change(screen.getByLabelText('Llegada programada (UTC)'), { target: { value: '2026-09-26T13:00' } });
  fireEvent.change(screen.getByLabelText('Salida programada (UTC)'), { target: { value: '2026-09-26T15:00' } });
}

describe('ManualTurnaroundDialog', () => {
  it('creates a contract-covered flight and reports its operation date', async () => {
    const { onCreated } = renderDialog();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));

    await waitFor(() => expect(createManualTurnaround).toHaveBeenCalledTimes(1));
    expect(createManualTurnaround).toHaveBeenCalledWith(expect.objectContaining({
      stationId, airlineId, standId: options.stands[0].id, operationDate: '2026-09-26',
      arrivalScheduledAt: '2026-09-26T13:00:00.000Z',
      departureScheduledAt: '2026-09-26T15:00:00.000Z',
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('2026-09-26', 'MAN-TEST'));
  });

  it('retries an uncertain write with the same UUID and changes it after an edit', async () => {
    vi.mocked(createManualTurnaround).mockRejectedValue(new Error('network unavailable'));
    renderDialog();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));
    await waitFor(() => expect(createManualTurnaround).toHaveBeenCalledTimes(2));
    const first = vi.mocked(createManualTurnaround).mock.calls[0][0].turnaroundId;
    expect(vi.mocked(createManualTurnaround).mock.calls[1][0].turnaroundId).toBe(first);

    await userEvent.type(screen.getByLabelText('Vuelo de salida'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));
    await waitFor(() => expect(createManualTurnaround).toHaveBeenCalledTimes(3));
    expect(vi.mocked(createManualTurnaround).mock.calls[2][0].turnaroundId).not.toBe(first);
  });

  it('shows a real empty state when no airline has a valid station contract', async () => {
    vi.mocked(getManualTurnaroundOptions).mockResolvedValue({ ...options, airlines: [] });
    renderDialog();

    expect(await screen.findByText('No hay aerolíneas con contrato vigente para esta fecha y estación.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear vuelo' })).toBeDisabled();
  });
});