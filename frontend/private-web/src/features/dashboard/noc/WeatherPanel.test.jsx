import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { toWeatherReading } from '../../../services/weatherService';
import { createAerodromeWeather, WEATHER_NOON, weatherInstant } from '../../maps/testing/weatherFixtures';
import { resetPanelFoldsForTests } from '../../occ-ui/occPanelMemory';
import WeatherPanel from './WeatherPanel';

// The panel reads nothing: the IEM history of the pill's detail is never asked from here.
vi.mock('../../../services/weatherService', async importOriginal => ({
  ...(await importOriginal()),
  loadRecentMetars: vi.fn(() => { throw new Error('the panel never reads the IEM history'); }),
}));

const NOON = Date.parse(WEATHER_NOON);

afterEach(() => {
  cleanup();
  resetLanguageForTests();
  resetPanelFoldsForTests();
});

/** useMdpcWeather's view of an answer of GET occ/weather (synthetic, at the lab's noon). */
function viewOf(options = {}, status) {
  const reading = toWeatherReading(createAerodromeWeather(options), { receivedAt: NOON });
  return {
    status: status ?? (reading.observation ? 'success' : 'empty'),
    data: reading.observation, apiStatus: reading.apiStatus, taf: reading.taf, source: reading.source,
    fetchedAt: reading.receivedAt, refreshing: false, refreshFailed: false, refresh: vi.fn(),
  };
}

function renderPanel(props, language = 'es') {
  resetLanguageForTests(language);
  render(<LanguageScope><WeatherPanel nowMs={NOON} {...props} /></LanguageScope>);
  return screen.getByRole('region', { name: language === 'es' ? 'Meteorología PUJ' : 'PUJ weather' });
}

describe('WeatherPanel «Meteorología PUJ» (M7)', () => {
  it('shows the decoded METAR with the server flight category as a word and its aviation colour, marked «No oficial»', () => {
    const panel = renderPanel({ weather: viewOf({ wind: { gustKt: 25 } }) });
    expect(panel).toHaveAttribute('data-occ-floating-panel', 'pan-weather');
    expect(panel).toHaveAttribute('data-layout', 'float');
    expect(within(panel).getByText('No oficial')).toBeInTheDocument();
    const category = panel.querySelector('[data-flight-category]');
    expect(category).toHaveAttribute('data-flight-category', 'VFR');
    expect(within(category).getByText('VFR · visual')).toBeInTheDocument();
    expect(category.querySelector('[data-category-chip]').style.backgroundColor).toBe('rgb(47, 191, 74)');
    expect(within(panel).getByText('100° · 13 kt · ráfagas 25 kt')).toBeInTheDocument();
    expect(within(panel).getByText(/^MDPC 131450Z 10013G25KT/u)).toBeInTheDocument();
    expect(within(panel).getByText('Observado 14:50 UTC')).toBeInTheDocument();
    expect(within(panel).queryByText('Desactualizado')).toBeNull();
    const credit = within(panel).getByRole('link', { name: 'Datos: NOAA Aviation Weather Center' });
    expect(credit).toHaveAttribute('href', 'https://aviationweather.gov');
  });

  it('lists the head or tail and cross wind of each runway end, its gust, and the runway in use with its reason', () => {
    const panel = renderPanel({ weather: viewOf({ wind: { gustKt: 25 } }) });
    const table = within(panel).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Pista', 'A lo largo', 'Cruzado', 'Con ráfaga']);
    const r08 = panel.querySelector('[data-runway="08"]');
    expect(r08).toHaveAttribute('data-in-use', 'true');
    expect(within(r08).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['12 kt de frente', '6 kt de la derecha', '22 kt de frente · 11 kt de la derecha']);
    expect(within(panel.querySelector('[data-runway="26"]')).getAllByRole('cell')[0]).toHaveTextContent('12 kt de cola');
    expect(within(panel).getByText('En uso: Pista 08 (estimada por el viento)')).toBeInTheDocument();
    cleanup();
    // The map's runway, with the arrivals it saw, wins over the weather's; without a gust there is no gust column.
    const again = renderPanel({ weather: viewOf(), runway: { arrival: '26', departure: '26', source: 'live' } });
    expect(again.querySelector('[data-runway="26"]')).toHaveAttribute('data-in-use', 'true');
    expect(within(again).getByText('En uso: Pista 26 (según las llegadas)')).toBeInTheDocument();
    expect(within(within(again).getByRole('table')).getAllByRole('columnheader')).toHaveLength(3);
  });

  it('draws the TAF as a band of time with what holds now and next, in station time', () => {
    const panel = renderPanel({ weather: viewOf() });
    const band = within(panel).getByRole('group', { name: 'Periodos del TAF en el tiempo' });
    expect(within(band).getByRole('button', { name: '08:00–18:00 · 090° 12 kt · 10 km · FEW020 SCT040, ahora' }))
      .toHaveTextContent('090° 12 kt · 10 km · FEW020 SCT040');
    expect(within(band).getByRole('button', { name: /^Temporal 12:00–16:00/u })).toHaveAttribute('data-state', 'planned');
    expect([...band.querySelectorAll('[data-occ-plate]')].map(plate => plate.textContent)).toEqual(['base', 'TEMPO', 'PROB']);
    const readout = panel.querySelector('[data-taf-readout]');
    expect(readout).toHaveAttribute('data-taf-readout', 'current');
    expect(within(readout).getByText('Ahora: 08:00–18:00 · 090° 12 kt · 10 km · FEW020 SCT040')).toBeInTheDocument();
    expect(within(readout).getByText('Después: Temporal 12:00–16:00 · 100° 15 kt G25 · 4 km · SHRA · BKN015'))
      .toBeInTheDocument();
    expect(within(panel).getByText('Válido de las 08:00 a las 08:00, hora local')).toBeInTheDocument();
    expect(within(panel).getByText('Emitido a las 07:00')).toBeInTheDocument();
  });

  it('gives the civil dawn, sunrise, sunset and dusk at PUJ in local time', () => {
    const panel = renderPanel({ weather: viewOf() });
    const times = ['dawn', 'sunrise', 'sunset', 'dusk'].map(key => panel.querySelector(`[data-sun="${key}"] dd`).textContent);
    for (const time of times) expect(time).toMatch(/^\d{2}:\d{2}$/u);
    expect(times).toEqual([...times].sort());
    expect(times[1] > '06:00' && times[1] < '07:00').toBe(true);
    expect(times[2] > '17:30' && times[2] < '18:30').toBe(true);
    expect(within(panel).getByText('Calculado; hora local de Punta Cana.')).toBeInTheDocument();
  });

  it('says why there is no METAR: disabled, unavailable, refused or failed, never «Consultando…» once answered', () => {
    let panel = renderPanel({ weather: viewOf({ status: 'Disabled' }) });
    expect(within(panel).getByText('El clima de MDPC no está activado en este entorno.')).toBeInTheDocument();
    expect(within(panel).getByText('Sin METAR, no hay viento por pista.')).toBeInTheDocument();
    expect(within(panel).getByText('Sin TAF de MDPC.')).toBeInTheDocument();
    cleanup();
    panel = renderPanel({ weather: viewOf({ status: 'Unavailable' }) });
    expect(within(panel).getByText('Sin METAR de MDPC en este momento.')).toBeInTheDocument();
    // The TAF still comes with an Unavailable answer.
    expect(within(panel).getByRole('group', { name: 'Periodos del TAF en el tiempo' })).toBeInTheDocument();
    cleanup();
    panel = renderPanel({ weather: { status: 'unauthorized', data: null, apiStatus: null, taf: null, source: null } });
    expect(within(panel).getByText('Tu acceso no incluye el clima de MDPC.')).toBeInTheDocument();
    expect(within(panel).queryByText(/Consultando/u)).toBeNull();
    cleanup();
    const refresh = vi.fn();
    panel = renderPanel({ weather: { status: 'error', data: null, apiStatus: null, taf: null, source: null, refresh } });
    fireEvent.click(within(within(panel).getByRole('alert')).getByRole('button', { name: 'Reintentar' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('marks a METAR the API keeps after a failure as stale, however recent', () => {
    const panel = renderPanel({ weather: viewOf({ status: 'Stale', observedAt: weatherInstant(-20) }) });
    expect(within(panel).getByText('Desactualizado')).toBeInTheDocument();
    expect(within(panel).getByText(/más de 90 minutos/u)).toBeInTheDocument();
  });

  it('folds to its title and speaks English', () => {
    const panel = renderPanel({ weather: viewOf() }, 'en');
    const title = within(panel).getByRole('button', { name: 'PUJ weather' });
    expect(title).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByText('Wind per runway')).toBeInTheDocument();
    expect(within(panel).getByText('In use: Runway 08 (estimated from the wind)')).toBeInTheDocument();
    fireEvent.click(title);
    expect(panel).toHaveAttribute('data-folded', 'true');
  });
});
