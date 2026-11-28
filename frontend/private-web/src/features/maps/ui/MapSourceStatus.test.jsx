import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { OCC_MAP_IDLE, OccMapContext } from '../core/OccMapContext';
import { createAirPicture, TRAFFIC_NOON, TRAFFIC_SOURCE } from '../testing/trafficFixtures';
import { toPictureModel } from '../traffic/situationModel';
import MapSourceStatus, { CREDIT_HEIGHT_PROPERTY, pictureAgeSeconds, sourceChip } from './MapSourceStatus';

const NOON = Date.parse(TRAFFIC_NOON);
const picture = overrides => toPictureModel(createAirPicture(overrides));
const TRAFFIC = 'Estado del tráfico';
const FLIGHTS = 'Estado de los vuelos de AVIAM';

function renderStatus(props, { source = null, english = false } = {}) {
  const status = (
    <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, engineStatus: 'ready', trafficSource: source }}>
      <MapSourceStatus {...props} />
    </OccMapContext.Provider>
  );
  return render(english ? <LanguageScope>{status}</LanguageScope> : status);
}

const chipText = () => within(screen.getByTestId('map-source-status')).getByRole('status').textContent;
const statusNamed = name => screen.queryByRole('status', { name });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.visibilityState;
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
    // The account may not read the map: the shell's list of sources says so, and so does the chip.
    renderStatus({ status: 'unauthorized', sourceState: 'forbidden' });
    expect(chipText()).toBe('Tu acceso no incluye el tráfico en vivo.');
    cleanup();
    // A station without live traffic (the air picture answers 404 while the flights answer): the words of an
    // environment without the source, with nothing to retry, never a missing access.
    renderStatus({ status: 'success', picture: null, sourceState: 'unconfigured', onRetry: vi.fn() });
    expect(chipText()).toBe('No hay tráfico en vivo en este momento.La fuente de tráfico no está configurada.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    cleanup();

    // The air picture failed while the flights answered: the map keeps them, and the chip says that the traffic is
    // unavailable and offers to try again, with the shell's urgent signal.
    const onRetry = vi.fn();
    renderStatus({ status: 'success', picture: null, sourceState: 'offline', onRetry });
    const offline = within(screen.getByTestId('map-source-status')).getByRole('status', { name: TRAFFIC });
    expect(offline).toHaveTextContent('No hay tráfico en vivo en este momento.');
    expect(offline.querySelector('[data-occ-glyph="urgent"]')).not.toBeNull();
    await userEvent.click(within(offline).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(sourceChip({ status: 'success', picture: null, sourceState: 'idle' })).toBeNull();
  });

  it('speaks of the air picture alone: a failed read of the AVIAM flights has its own notice', async () => {
    // The flights failed on their first read (useMapSituation's `error`) while the picture is Live and its source ok:
    // the chip has nothing to say of the traffic, and a failed refresh of the flights is not the traffic's either.
    const live = picture();
    expect(sourceChip({ status: 'error', picture: live, sourceState: 'ok' })).toBeNull();
    expect(sourceChip({ status: 'success', picture: live, sourceState: 'ok', nowMs: NOON + 43_000 })).toBeNull();

    const onRetry = vi.fn();
    renderStatus({ status: 'error', picture: live, sourceState: 'ok', onRetry }, { source: TRAFFIC_SOURCE });
    const status = screen.getByTestId('map-source-status');
    expect(statusNamed(TRAFFIC)).not.toBeInTheDocument();
    expect(status).not.toHaveTextContent(/No hay tráfico en vivo|Tráfico con retraso/);
    // The AVIAM flights say it apart, with the urgent signal and «Reintentar»; the credit of the traffic stays.
    const notice = within(status).getByRole('status', { name: FLIGHTS });
    expect(notice).toHaveTextContent('No se pudieron cargar los vuelos de AVIAM.');
    expect(notice.querySelector('[data-occ-glyph="urgent"]')).not.toBeNull();
    await userEvent.click(within(notice).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(within(status).getByRole('link', { name: 'Red ADS-B de prueba' })).toBeInTheDocument();
    cleanup();

    // While the picture is still on its way, the chip says that the traffic loads, above the notice of the flights.
    renderStatus({ status: 'error', picture: null, sourceState: 'idle', onRetry });
    expect(within(screen.getByTestId('map-source-status')).getAllByRole('status').map(item => item.getAttribute('aria-label')))
      .toEqual([TRAFFIC, FLIGHTS]);
    expect(statusNamed(TRAFFIC)).toHaveTextContent('Cargando tráfico…');
    cleanup();

    // Both reads failed: each says its own, each with its «Reintentar».
    renderStatus({ status: 'error', picture: null, sourceState: 'offline', onRetry });
    expect(statusNamed(TRAFFIC)).toHaveTextContent('No hay tráfico en vivo en este momento.');
    expect(within(statusNamed(FLIGHTS)).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(statusNamed(TRAFFIC)).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('tells how late the traffic is, from the picture and from a refresh of the picture that failed', () => {
    renderStatus({ status: 'success', picture: picture({ status: 'Stale' }) });
    // The synthetic Stale picture's last data is 240 s old.
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 4 min.');
    expect(screen.getByRole('status').querySelector('svg')).not.toBeNull();
    cleanup();
    // A Live picture whose last refresh failed (its source is `delayed`) grows older with the server's time.
    renderStatus({ status: 'success', picture: picture(), sourceState: 'delayed', nowMs: NOON + 43_000 });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 45 s.');
    expect(sourceChip({ status: 'success', picture: picture(), sourceState: 'delayed', nowMs: NOON + 120_000 }))
      .toEqual({ kind: 'delayed', reason: null, ageS: 122, retry: false });
    // 2 s old when the server answered at noon.
    expect([pictureAgeSeconds(picture()), pictureAgeSeconds(picture(), NOON + 8_000), pictureAgeSeconds(picture(), NOON - 5_000)])
      .toEqual([2, 10, 2]);
  });

  it('counts the age of a late picture up on the server clock, second by second, only while it is late', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // The server runs 3 s ahead of this browser: on its clock it is 10 s past the noon picture.
    vi.setSystemTime(NOON + 7_000);
    const clock = { now: () => Date.now() + 3_000 };
    const idleTimers = vi.getTimerCount();
    renderStatus({ status: 'success', picture: picture(), sourceState: 'delayed', clock });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 12 s.');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 17 s.');
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 1 min.');
    cleanup();
    expect(vi.getTimerCount()).toBe(idleTimers);

    // On time, the chip says nothing and nothing ticks.
    renderStatus({ status: 'success', picture: picture(), sourceState: 'ok', clock }, { source: TRAFFIC_SOURCE });
    expect(statusNamed(TRAFFIC)).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(idleTimers);
  });

  it('stops counting while the tab is hidden and reads the clock again as it shows', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOON + 10_000);
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const clock = { now: () => Date.now() };
    const idleTimers = vi.getTimerCount();
    renderStatus({ status: 'success', picture: picture(), sourceState: 'delayed', clock });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 12 s.');

    visibility = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(vi.getTimerCount()).toBe(idleTimers);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 12 s.');

    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 42 s.');
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(chipText()).toBe('Tráfico con retraso: último dato hace 43 s.');
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

  it('writes the height of the credit on its map, so the altitude scale over it clears a wrapped credit (INT)', () => {
    const observers = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
    });
    const heights = [24, 56];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: heights[0] }));
    const root = document.createElement('div');
    root.className = 'occ-map';
    document.body.append(root);
    const view = render(
      <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, engineStatus: 'ready', trafficSource: TRAFFIC_SOURCE }}>
        <MapSourceStatus status="success" picture={picture()} />
      </OccMapContext.Provider>, { container: root });
    expect(root.style.getPropertyValue(CREDIT_HEIGHT_PROPERTY)).toBe('24px');
    // A narrow area in sight wraps the credit on more lines: the map is told its new height.
    heights.shift();
    act(() => observers[0].callback([]));
    expect(root.style.getPropertyValue(CREDIT_HEIGHT_PROPERTY)).toBe('56px');
    view.unmount();
    expect(root.style.getPropertyValue(CREDIT_HEIGHT_PROPERTY)).toBe('');
    expect(observers[0].disconnect).toHaveBeenCalled();
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('speaks English on the OCC screens', () => {
    act(() => resetLanguageForTests('en'));
    renderStatus({ status: 'success', picture: picture({ status: 'Stale' }) }, { source: TRAFFIC_SOURCE, english: true });
    expect(chipText()).toBe('Traffic delayed: last data 4 min ago.');
    expect(screen.getByTestId('map-source-status')).toHaveTextContent('Aircraft data: Red ADS-B de prueba');
    cleanup();
    renderStatus({ status: 'error', picture: picture(), sourceState: 'ok', onRetry: vi.fn() }, { english: true });
    expect(screen.getByRole('status', { name: 'AVIAM flights status' }))
      .toHaveTextContent('The AVIAM flights could not be loaded.Retry');
  });
});
