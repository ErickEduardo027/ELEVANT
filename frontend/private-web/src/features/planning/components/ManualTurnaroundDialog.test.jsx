import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManualTurnaroundDialog from './ManualTurnaroundDialog';
import { createCharterAirline, createManualTurnaround, getManualTurnaroundOptions } from '../../../services/planningService';

vi.mock('../../../services/planningService', () => ({
  getManualTurnaroundOptions: vi.fn(),
  createManualTurnaround: vi.fn(),
  createCharterAirline: vi.fn(),
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
  fireEvent.change(screen.getByLabelText('Llegada programada (hora local de PUJ)'), { target: { value: '2026-09-26T13:00' } });
  fireEvent.change(screen.getByLabelText('Salida programada (hora local de PUJ)'), { target: { value: '2026-09-26T15:00' } });
}

describe('ManualTurnaroundDialog', () => {
  it('creates a contract-covered flight from the station local time and reports its operation date (3-N19)', async () => {
    const { onCreated } = renderDialog();
    await fillForm();
    expect(screen.getByText(/hora local de PUJ \(America\/Santo_Domingo\); se guardan en UTC/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));

    await waitFor(() => expect(createManualTurnaround).toHaveBeenCalledTimes(1));
    // 13:00 and 15:00 in Punta Cana (UTC-4) are 17:00 and 19:00 UTC.
    expect(createManualTurnaround).toHaveBeenCalledWith(expect.objectContaining({
      stationId, airlineId, standId: options.stands[0].id, operationDate: '2026-09-26',
      arrivalScheduledAt: '2026-09-26T17:00:00.000Z',
      departureScheduledAt: '2026-09-26T19:00:00.000Z',
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('2026-09-26', 'MAN-TEST'));
  });

  it('explains a flight already planned that day instead of a generic conflict (3-A)', async () => {
    vi.mocked(createManualTurnaround).mockRejectedValueOnce(Object.assign(new Error('conflict'),
      { status: 409, code: 'manual-conflict', problemCode: 'flight_already_planned' }));
    renderDialog();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese vuelo ya está planificado ese día.');
  });

  it('registers the minimal carrier of a charter and selects it (3-N21)', async () => {
    const charterId = '20000000-0000-7000-8000-000000000030';
    const charterOptions = { ...options, charterAirlines: [] };
    vi.mocked(getManualTurnaroundOptions)
      .mockResolvedValueOnce(charterOptions)
      .mockResolvedValue({ ...charterOptions, charterAirlines: [{ id: charterId, iataCode: '9Z', name: 'Sky High Charter' }] });
    vi.mocked(createCharterAirline).mockResolvedValue({ id: charterId, icaoCode: 'SHC', iataCode: '9Z', name: 'Sky High Charter' });
    renderDialog();
    await screen.findByRole('option', { name: /Elevant Demo/ });

    await userEvent.click(screen.getByLabelText('Vuelo charter (aerolínea sin contrato)'));
    expect(screen.getByText(/dé de alta la aerolínea aquí mismo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '¿No está la aerolínea? Darla de alta' }));
    const form = screen.getByRole('group', { name: 'Alta mínima de aerolínea charter' });
    await userEvent.type(within(form).getByLabelText('Nombre de la aerolínea'), 'Sky High Charter');
    await userEvent.type(within(form).getByLabelText('Código OACI (3 letras)'), 'shc');
    await userEvent.type(within(form).getByLabelText('Código IATA (opcional)'), '9z');
    await userEvent.click(within(form).getByRole('button', { name: 'Dar de alta' }));

    await waitFor(() => expect(createCharterAirline).toHaveBeenCalledWith(
      { name: 'Sky High Charter', icaoCode: 'SHC', iataCode: '9Z' }, expect.stringMatching(/^[0-9a-f-]{36}$/)));
    expect(await screen.findByText('Aerolínea Sky High Charter dada de alta y seleccionada.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Aerolínea charter')).toHaveValue(charterId));
    expect(createManualTurnaround).not.toHaveBeenCalled();
  });

  it('selects a charter carrier already registered with that code instead of duplicating it (3-N21)', async () => {
    const charterId = '20000000-0000-7000-8000-000000000031';
    vi.mocked(getManualTurnaroundOptions).mockResolvedValue({ ...options,
      charterAirlines: [{ id: charterId, iataCode: '9Z', name: 'Sky High Charter' }] });
    vi.mocked(createCharterAirline).mockRejectedValue(Object.assign(new Error('in use'), { status: 409, code: 'airline_code_in_use' }));
    renderDialog();
    await screen.findByRole('option', { name: /Elevant Demo/ });

    await userEvent.click(screen.getByLabelText('Vuelo charter (aerolínea sin contrato)'));
    await userEvent.click(screen.getByRole('button', { name: '¿No está la aerolínea? Darla de alta' }));
    const form = screen.getByRole('group', { name: 'Alta mínima de aerolínea charter' });
    await userEvent.type(within(form).getByLabelText('Nombre de la aerolínea'), 'Otra Charter');
    await userEvent.type(within(form).getByLabelText('Código OACI (3 letras)'), 'SHC');
    await userEvent.type(within(form).getByLabelText('Código IATA (opcional)'), '9Z');
    await userEvent.click(within(form).getByRole('button', { name: 'Dar de alta' }));

    expect(await screen.findByText('Esa aerolínea ya estaba registrada: se seleccionó.')).toBeInTheDocument();
    expect(screen.getByLabelText('Aerolínea charter')).toHaveValue(charterId);
  });

  it('explains an invalid charter carrier by its code', async () => {
    vi.mocked(getManualTurnaroundOptions).mockResolvedValue({ ...options, charterAirlines: [] });
    vi.mocked(createCharterAirline).mockRejectedValue(Object.assign(new Error('invalid'), { status: 400, code: 'invalid_charter_airline' }));
    renderDialog();
    await screen.findByRole('option', { name: /Elevant Demo/ });

    await userEvent.click(screen.getByLabelText('Vuelo charter (aerolínea sin contrato)'));
    await userEvent.click(screen.getByRole('button', { name: '¿No está la aerolínea? Darla de alta' }));
    const form = screen.getByRole('group', { name: 'Alta mínima de aerolínea charter' });
    await userEvent.type(within(form).getByLabelText('Código OACI (3 letras)'), 'S1{Enter}');

    expect(await within(form).findByRole('alert')).toHaveTextContent('el código OACI de 3 letras');
    expect(createManualTurnaround).not.toHaveBeenCalled();
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

  it('gives the flight its aircraft type once and explains a type that is no longer available (2-A)', async () => {
    const typeId = '20000000-0000-7000-8000-000000000020';
    vi.mocked(getManualTurnaroundOptions).mockResolvedValue({ ...options, aircraftTypes: [{ id: typeId, icaoCode: 'B738',
      iataCode: '73H', manufacturer: 'Boeing', model: '737-800', sizeCategory: 'Narrowbody' }] });
    vi.mocked(createManualTurnaround).mockRejectedValueOnce(Object.assign(new Error('El vuelo o su contrato cambiaron.'),
      { status: 409, code: 'manual-conflict', problemCode: 'aircraft_type_unavailable' }));
    renderDialog();
    await fillForm();
    expect(screen.getByLabelText('Tipo de avión')).toHaveValue('');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de avión'), typeId);
    expect(screen.getByRole('option', { name: 'Boeing 737-800 · B738' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El tipo de avión ya no está disponible.');
    expect(createManualTurnaround).toHaveBeenCalledWith(expect.objectContaining({ aircraftTypeId: typeId }), expect.anything());

    // Without a type the request says so explicitly; the shared client then leaves the field out.
    await userEvent.selectOptions(screen.getByLabelText('Tipo de avión'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));
    await waitFor(() => expect(createManualTurnaround).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createManualTurnaround).mock.calls[1][0]).toMatchObject({ aircraftTypeId: null });
  });

  it('explains that a narrow-body stand does not take the wide-body type chosen (ADR-0030)', async () => {
    const typeId = '20000000-0000-7000-8000-000000000021';
    vi.mocked(getManualTurnaroundOptions).mockResolvedValue({ ...options, aircraftTypes: [{ id: typeId, icaoCode: 'A333',
      iataCode: '333', manufacturer: 'Airbus', model: 'A330-300', sizeCategory: 'Widebody' }] });
    vi.mocked(createManualTurnaround).mockRejectedValueOnce(Object.assign(new Error('El vuelo o su contrato cambiaron.'),
      { status: 409, code: 'manual-conflict', problemCode: 'stand_unavailable' }));
    renderDialog();
    await fillForm();
    await userEvent.selectOptions(screen.getByLabelText('Tipo de avión'), typeId);
    await userEvent.click(screen.getByRole('button', { name: 'Crear vuelo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La posición solo admite aviones de fuselaje estrecho.');
  });

  it('shows a real empty state when no airline has a valid station contract', async () => {
    vi.mocked(getManualTurnaroundOptions).mockResolvedValue({ ...options, airlines: [] });
    renderDialog();

    expect(await screen.findByText('No hay aerolíneas con contrato vigente para esta fecha y estación.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear vuelo' })).toBeDisabled();
  });
});