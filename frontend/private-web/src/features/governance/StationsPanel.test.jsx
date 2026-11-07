import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StationsPanel from './StationsPanel';
import { createStation, listStations, updateStation } from '../../services/stationCatalogService';

vi.mock('../../services/stationCatalogService', async importOriginal => ({
  ...(await importOriginal()),
  listStations: vi.fn(), createStation: vi.fn(), updateStation: vi.fn(),
}));

const airport = id => ({ id, iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana International Airport', city: 'Punta Cana',
  countryCode: 'DO' });
const puj = { id: 'st-puj', code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo', isActive: true, hasHistory: true,
  airport: airport('ap-puj'), version: 'v-puj' };
const sdq = { id: 'st-sdq', code: 'SDQ', name: 'AVIAM Santo Domingo', ianaTimeZone: 'America/Santo_Domingo', isActive: true,
  hasHistory: false, airport: { ...airport('ap-sdq'), iataCode: 'SDQ', icaoCode: 'MDSD', name: 'Las Américas', city: 'Santo Domingo' },
  version: 'v-sdq' };
const miami = { id: 'ap-mia', iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International Airport', city: 'Miami', countryCode: 'US' };
const failure = (status, code) => Object.assign(new Error('The station is in use.'), { status, code, title: 'The station is in use.' });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('creates a station on a new airport, and on a known one without typing its data again', async () => {
  listStations.mockResolvedValue({ stations: [puj], availableAirports: [miami] });
  createStation.mockResolvedValueOnce(sdq).mockResolvedValueOnce({ ...sdq, id: 'st-mia', code: 'MIA' });
  render(<StationsPanel />);
  const form = await screen.findByRole('form', { name: 'Nueva estación' });
  fireEvent.change(within(form).getByLabelText('Código IATA'), { target: { value: 'sdq' } });
  fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'AVIAM Santo Domingo' } });
  fireEvent.change(within(form).getByLabelText('Código OACI'), { target: { value: 'mdsd' } });
  fireEvent.change(within(form).getByLabelText('Nombre del aeropuerto'), { target: { value: 'Las Américas' } });
  fireEvent.change(within(form).getByLabelText('Ciudad'), { target: { value: 'Santo Domingo' } });
  fireEvent.change(within(form).getByLabelText('País (ISO, 2 letras)'), { target: { value: 'do' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Crear estación' }));
  expect(await screen.findByText(/Estación SDQ creada/)).toBeInTheDocument();
  expect(createStation).toHaveBeenCalledWith({ code: 'SDQ', name: 'AVIAM Santo Domingo', ianaTimeZone: 'America/Santo_Domingo',
    airportIcaoCode: 'MDSD', airportName: 'Las Américas', airportCity: 'Santo Domingo', airportCountryCode: 'DO' },
  expect.stringMatching(/^[0-9a-f-]{36}$/));

  fireEvent.change(within(form).getByLabelText('Código IATA'), { target: { value: 'MIA' } });
  expect(within(form).getByText(/Aeropuerto registrado: Miami International Airport \(KMIA\)/)).toBeInTheDocument();
  expect(within(form).queryByLabelText('Código OACI')).not.toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'AVIAM Miami' } });
  fireEvent.change(within(form).getByLabelText('Zona horaria (IANA)'), { target: { value: 'America/New_York' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Crear estación' }));
  await waitFor(() => expect(createStation).toHaveBeenCalledTimes(2));
  expect(createStation.mock.calls[1][0]).toEqual({ code: 'MIA', name: 'AVIAM Miami', ianaTimeZone: 'America/New_York' });
});

it('keeps the time zone of a station with history and explains why a station in use stays active', async () => {
  listStations.mockResolvedValue({ stations: [puj, sdq], availableAirports: [] });
  updateStation.mockRejectedValueOnce(failure(409, 'station_in_use')).mockResolvedValueOnce({ ...sdq, isActive: false });
  render(<StationsPanel />);
  const list = await screen.findByRole('region', { name: 'Estaciones registradas' });
  expect(within(list).getByLabelText('Zona horaria de PUJ')).toBeDisabled();
  expect(within(list).getByLabelText('Zona horaria de SDQ')).toBeEnabled();

  fireEvent.click(within(list).getByLabelText('Estación PUJ activa'));
  fireEvent.click(within(list).getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText(/vuelos sin terminar, turnos programados o coberturas abiertas/)).toBeInTheDocument();
  expect(screen.queryByText('The station is in use.')).not.toBeInTheDocument();
  expect(updateStation).toHaveBeenCalledWith('st-puj', { name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo', isActive: false,
    expectedVersion: 'v-puj' }, expect.any(String));
  await waitFor(() => expect(listStations).toHaveBeenCalledTimes(2));

  fireEvent.click(within(await screen.findByRole('region', { name: 'Estaciones registradas' })).getByLabelText('Estación SDQ activa'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('Estación SDQ desactivada.')).toBeInTheDocument();
});

it('shows the loading, empty, unauthorized and recoverable error states', async () => {
  listStations.mockResolvedValueOnce({ stations: [], availableAirports: [] });
  render(<StationsPanel />);
  expect(screen.getByRole('status')).toHaveTextContent('Cargando estaciones…');
  expect(await screen.findByText(/Aún no hay estaciones/)).toBeInTheDocument();
  cleanup();

  listStations.mockRejectedValueOnce(failure(403, 'forbidden'));
  render(<StationsPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Solo el superadministrador gestiona las estaciones.');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  cleanup();

  listStations.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ stations: [puj], availableAirports: [] });
  render(<StationsPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Revise la conexión');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('region', { name: 'Estaciones registradas' })).toHaveTextContent('PUJ');
});
