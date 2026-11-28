import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { loadRecentMetars, toWeatherReading } from '../../../services/weatherService';
import { createAerodromeWeather, weatherInstant } from '../../maps/testing/weatherFixtures';
import WeatherPill from './WeatherPill';

// The six hours of reports of the detail, answered here: the pill never goes to the network in a test.
vi.mock('../../../services/weatherService', async importOriginal => ({
  ...(await importOriginal()),
  loadRecentMetars: vi.fn(() => Promise.resolve([])),
}));

afterEach(() => {
  cleanup();
  resetLanguageForTests();
  vi.useRealTimers();
});

/** useMdpcWeather's view of an answer written for now (the pill counts ages from the device's clock). */
function viewOf(options = {}, status) {
  const now = Date.now();
  const reading = toWeatherReading(createAerodromeWeather({ serverTime: new Date(now).toISOString(), ...options }),
    { receivedAt: now });
  return {
    status: status ?? (reading.observation ? 'success' : 'empty'),
    data: reading.observation, apiStatus: reading.apiStatus, taf: reading.taf, source: reading.source,
    fetchedAt: reading.receivedAt, refreshing: false, refreshFailed: false, refresh: vi.fn(),
  };
}

const minutesAgo = minutes => new Date(Date.now() - minutes * 60_000).toISOString();

function renderPill(weather) {
  render(<LanguageScope><WeatherPill weather={weather} /></LanguageScope>);
  return screen.getByRole('button');
}

describe('WeatherPill (M7 fixes)', () => {
  it('says every state without an observation instead of «Consultando…» for ever', () => {
    expect(renderPill({ status: 'loading', data: null })).toHaveTextContent('Consultando la observación de MDPC…');
    cleanup();
    expect(renderPill(viewOf({ status: 'Disabled' }))).toHaveTextContent('El clima de MDPC no está activado en este entorno.');
    cleanup();
    expect(renderPill(viewOf({ status: 'Unavailable' }))).toHaveTextContent('Sin METAR de MDPC en este momento.');
    cleanup();
    expect(renderPill({ status: 'unauthorized', data: null })).toHaveTextContent('Tu acceso no incluye el clima de MDPC.');
    cleanup();
    expect(renderPill({ status: 'error', data: null })).toHaveTextContent('La observación meteorológica no está disponible.');
  });

  it('counts a Stale METAR as stale at any age, and a Live one only past 90 minutes', () => {
    expect(renderPill(viewOf({ status: 'Stale', observedAt: minutesAgo(20) }))).toHaveTextContent('Desactualizado');
    cleanup();
    const live = renderPill(viewOf({ status: 'Live', observedAt: minutesAgo(80) }));
    expect(live).toHaveTextContent('hace 80 min');
    expect(live).not.toHaveTextContent('Desactualizado');
    cleanup();
    expect(renderPill(viewOf({ status: 'Live', observedAt: minutesAgo(95) }))).toHaveTextContent('Desactualizado');
  });

  it('opens a detail without a second map, crediting NOAA AWC and keeping the last reports', async () => {
    fireEvent.click(renderPill(viewOf({ status: 'Stale', observedAt: minutesAgo(20) })));
    const dialog = await screen.findByRole('dialog', { name: 'Meteorología · Punta Cana (MDPC)' });
    expect(dialog.querySelector('.maplibregl-map, canvas')).toBeNull();
    expect(screen.queryByText('Capa meteorológica')).toBeNull();
    const credit = screen.getByRole('link', { name: 'METAR MDPC de NOAA Aviation Weather Center (no oficial, sin garantía).' });
    expect(credit).toHaveAttribute('href', 'https://aviationweather.gov');
    expect(screen.queryByText(/IEM|Iowa|Mesonet/u)).toBeNull();
    expect(screen.getByText(/más de 90 minutos/u)).toBeInTheDocument();
    expect(await screen.findByText('No hay reportes recientes.')).toBeInTheDocument();
    expect(loadRecentMetars).toHaveBeenCalledWith(expect.objectContaining({ hours: 6 }));
  });

  it('credits NOAA AWC also when the answer has no METAR', async () => {
    fireEvent.click(renderPill(viewOf({ status: 'Unavailable', observedAt: weatherInstant(0) })));
    await screen.findByRole('dialog');
    expect(screen.getAllByText('Sin METAR de MDPC en este momento.').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /NOAA Aviation Weather Center/u })).toBeInTheDocument();
  });
});
