import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { OCC_MAP_IDLE, OccMapContext } from '../core/OccMapContext';
import { createAirPicture, TRAFFIC_NOON, TRAFFIC_SOURCE } from '../testing/trafficFixtures';
import { toPictureModel } from '../traffic/situationModel';
import MapSourceStatus, { sourceChip } from './MapSourceStatus';

const NOON = Date.parse(TRAFFIC_NOON);
const picture = overrides => toPictureModel(createAirPicture(overrides));

function renderStatus(props, { source = null, english = false } = {}) {
  const status = (
    <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, engineStatus: 'ready', trafficSource: source }}>
      <MapSourceStatus {...props} />
    </OccMapContext.Provider>
  );
  return render(english ? <LanguageScope>{status}</LanguageScope> : status);
}

const chipText = () => within(screen.getByTestId('map-source-status')).getByRole('status').textContent;

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

describe('MapSourceStatus (design A7)', () => {
  it('says nothing while all is well or nothing is read', () => {
    renderStatus({ status: 'idle' });
    expect(screen.queryByTestId('map-source-status')).not.toBeInTheDocument();
    cleanup();
    renderStatus({ status: 'success', picture: picture() });
    expect(screen.queryByTestId('map-source-status')).not.toBeInTheDocument();
  });

  it('names each state of the air traffic in plain words', async () => {
    renderStatus({ status: 'loading' });
    expect(chipText()).toBe('Cargando tráfico…');
    cleanup();
    // The server warms up: the same words, it answers again in 2 s.
    renderStatus({ status: 'success', picture: picture({ status: 'Warming' }) });
    expect(chipText()).toBe('Cargando tráfico…');
    cleanup();
    renderStatus({ status: 'success', picture: picture({ aircraft: [] }) });
    expect(chipText()).toBe('No hay aviones en la zona');
    cleanup();
    renderStatus({ status: 'unauthorized' });
    expect(chipText()).toBe('Tu acceso no incluye el tráfico en vivo.');
    cleanup();
    // A station without live traffic (the air picture answers 404 while the flights answer): the words of an
    // environment without the source, with nothing to retry, never a missing access.
    renderStatus({ status: 'success', picture: null, sourceState: 'unconfigured', onRetry: vi.fn() });
    expect(chipText()).toBe('No hay tráfico en vivo en este momento.La fuente de tráfico no está configurada.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    cleanup();

    // A failed read offers to try again, with the shell's urgent signal.
    const onRetry = vi.fn();
    renderStatus({ status: 'error', onRetry });
    const chip = within(screen.getByTestId('map-source-status')).getByRole('status', { name: 'Estado del tráfico' });
    expect(chip).toHaveTextContent('No hay tráfico en vivo en este momento.');
    expect(chip.querySelector('[data-occ-glyph], svg')).not.toBeNull();
    await userEvent.click(within(chip).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
    cleanup();

    // The air picture failed while the flights answered: the map keeps them, and the chip says that the traffic is
    // unavailable and offers to try again.
    const onRetryPicture = vi.fn();
    renderStatus({ status: 'success', picture: null, sourceState: 'offline', onRetry: onRetryPicture });
    const offline = within(screen.getByTestId('map-source-status')).getByRole('status', { name: 'Estado del tráfico' });
    expect(offline).toHaveTextContent('No hay tráfico en vivo en este momento.');
    await userEvent.click(within(offline).getByRole('button', { name: 'Reintentar' }));
    expect(onRetryPicture).toHaveBeenCalledOnce();
    expect(sourceChip({ status: 'success', picture: null, sourceState: 'idle' })).toBeNull();
  });

  it('says why the air picture is unavailable in its own words, never the server text', () => {
    const onRetry = vi.fn();
    renderStatus({ status: 'success', picture: picture({ status: 'Unavailable', reason: 'rate_limited' }), onRetry });
    expect(chipText()).toBe('No hay tráfico en vivo en este momento.La fuente de tráfico pidió esperar antes de consultar de nuevo.Reintentar');
    cleanup();
    // Turned off in this environment: nothing to retry.
    renderStatus({ status: 'success', picture: picture({ status: 'Disabled' }), onRetry });
    expect(chipText()).toBe('No hay tráfico en vivo en este momento.La fuente de tráfico no está configurada.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.getByTestId('map-source-status').textContent).not.toMatch(/not_configured|rate_limited|provider/);
  });

  it('tells how late the traffic is, from the picture and from a refresh that failed', () => {
    renderStatus({ status: 'success', picture: picture({ status: 'Stale' }) });
    // The synthetic Stale picture's last data is 240 s old.
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 4 min.');
    expect(screen.getByRole('status').querySelector('svg')).not.toBeNull();
    cleanup();
    // A Live picture the last refresh could not replace grows older with the server's clock.
    renderStatus({ status: 'success', picture: picture(), refreshFailed: true, nowMs: NOON + 43_000 });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 45 s.');
    expect(sourceChip({ status: 'success', picture: picture(), refreshFailed: true, nowMs: NOON + 120_000 }))
      .toEqual({ kind: 'delayed', reason: null, ageS: 122, retry: false });
  });

  it('shows the credit of the aircraft data as a link while traffic is on screen', () => {
    renderStatus({ status: 'success', picture: picture() }, { source: TRAFFIC_SOURCE });
    const credit = screen.getByText((_, element) => element?.hasAttribute('data-map-credit'));
    expect(credit).toHaveTextContent('Datos de aeronaves: Red ADS-B de prueba (Datos sintéticos)');
    expect(within(credit).getByRole('link', { name: 'Red ADS-B de prueba' })).toHaveAttribute('href', 'https://example.org/adsb');
    // The licence has no https link: its name is plain text, never a made-up link.
    expect(within(credit).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    cleanup();

    // Only https links; anything else is written, not linked.
    renderStatus({ status: 'success', picture: picture() }, { source: { name: 'adsb.fi', homeUrl: 'javascript:alert(1)',
      licenseName: 'ODbL', licenseUrl: 'https://opendatacommons.org/licenses/odbl/' } });
    const unsafe = screen.getByText((_, element) => element?.hasAttribute('data-map-credit'));
    expect(within(unsafe).getAllByRole('link').map(link => link.getAttribute('href')))
      .toEqual(['https://opendatacommons.org/licenses/odbl/']);
    expect(unsafe).toHaveTextContent('Datos de aeronaves: adsb.fi (ODbL)');
  });

  it('speaks English on the OCC screens', () => {
    act(() => resetLanguageForTests('en'));
    renderStatus({ status: 'success', picture: picture({ status: 'Stale' }) }, { source: TRAFFIC_SOURCE, english: true });
    expect(chipText()).toBe('Traffic delayed: last data 4 min ago.');
    expect(screen.getByTestId('map-source-status')).toHaveTextContent('Aircraft data: Red ADS-B de prueba');
  });
});
