import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../../i18n/languageStore';
import { createSourceHealthStore, summarizeSources } from '../../live/sourceHealth';
import OccSourcesButton from './OccSourcesButton';

// 18:31:30 UTC is 14:31:30 in Punta Cana.
const NOW = Date.parse('2026-11-12T18:31:30Z');
const FAKE_TIMERS = { toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] };

// The shell's `sources` for some reports, through the same store and summary the shell uses.
function sourcesOf(reports) {
  const store = createSourceHealthStore();
  for (const [id, report] of reports) store.report(id, report);
  const items = store.getSnapshot();
  return { items, summary: summarizeSources(items) };
}

function button(sources) {
  return <LanguageScope><OccSourcesButton sources={sources} /></LanguageScope>;
}

const tintsOf = element => element.className.split(/\s+/).filter(name => /^bg-occ-(?:warn|danger)-soft$/.test(name));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetLanguageForTests();
});

describe('OccSourcesButton', () => {
  it('summarizes sources as up to date, one delayed, several delayed and disconnected', () => {
    const elevant = ['elevant', { state: 'ok', at: NOW }];
    const cases = [
      [[elevant, ['realtime', { state: 'ok', at: NOW, detail: 'live' }]], 'Fuentes al día', null, []],
      [[elevant, ['realtime', { state: 'delayed', at: NOW, detail: 'polling' }]], '1 fuente con retraso', 'triangle',
        ['bg-occ-warn-soft']],
      [[elevant, ['realtime', { state: 'delayed', at: NOW, detail: 'reconnecting' }],
        ['airTraffic', { state: 'delayed', at: NOW }], ['weather', { state: 'offline', at: NOW }]],
      '3 fuentes con retraso', 'triangle', ['bg-occ-warn-soft']],
      [[['elevant', { state: 'offline', at: NOW }], ['realtime', { state: 'offline', at: NOW, detail: 'offline' }]],
        'Sin conexión con ELEVANT', 'octagon', ['bg-occ-danger-soft']],
    ];
    for (const [reports, word, shape, tints] of cases) {
      const view = render(button(sourcesOf(reports)));
      const trigger = screen.getByRole('button', { name: word });
      const glyph = trigger.querySelector('[data-occ-glyph]');
      if (shape) expect(glyph, word).toHaveAttribute('data-shape', shape);
      else expect(glyph, word).toBeNull();
      expect(tintsOf(trigger), word).toEqual(tints);
      view.unmount();
    }

    resetLanguageForTests('en');
    render(button(sourcesOf([elevant, ['realtime', { state: 'delayed', at: NOW, detail: 'polling' }]])));
    expect(screen.getByRole('button', { name: '1 source delayed' })).toBeInTheDocument();
  });

  it('lists every source with its state word, age and tags', () => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(NOW);
    const sources = sourcesOf([
      ['basemap', { state: 'unconfigured' }],
      ['elevant', { state: 'ok', at: NOW - 8_000 }],
      ['realtime', { state: 'delayed', at: NOW - 150_000, detail: 'polling' }],
      ['providerFlights', { state: 'offline', at: Date.parse('2026-11-12T18:20:00Z'), tags: ['stale'] }],
      ['airTraffic', { state: 'idle' }],
      ['weather', { state: 'ok', at: Date.parse('2026-11-12T18:00:00Z'), tags: ['unofficial'] }],
      ['satellite', { state: 'forbidden' }],
    ]);
    render(button(sources));
    fireEvent.click(screen.getByRole('button', { name: '2 fuentes con retraso' }));
    const dialog = screen.getByRole('dialog', { name: 'Fuentes de datos' });

    // Every source, in the order of the catalogue, with its name, its state and how old its data is.
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows.map(row => row.dataset.source)).toEqual([
      'elevant', 'realtime', 'providerFlights', 'airTraffic', 'weather', 'satellite', 'basemap',
    ]);
    expect(rows[0]).toHaveTextContent('Operación ELEVANTAl día, hace 8 s');
    // Real time names its state with the live link's own words.
    expect(rows[1]).toHaveTextContent('Tiempo realSin tiempo real, 14:29');
    expect(rows[2]).toHaveTextContent('Vuelos del proveedorSin conexión, 14:20Sin actualizar');
    expect(rows[3]).toHaveTextContent('Tráfico aéreoSin consultar en esta pantalla');
    expect(rows[4]).toHaveTextContent('Clima MDPCAl día, 14:00No oficial');
    expect(rows[5]).toHaveTextContent('SatéliteSin permiso');
    expect(rows[6]).toHaveTextContent('Mapa baseSin configurar');
    // A source without data of its own has no age to give.
    for (const row of [rows[3], rows[5], rows[6]]) expect(row.textContent).not.toContain(',');

    // Tags are words in their own outline; a late or unreachable source also shows its signal.
    expect(within(rows[4]).getByText('No oficial')).toHaveAttribute('data-tag', 'unofficial');
    expect(within(rows[2]).getByText('Sin actualizar')).toHaveAttribute('data-tag', 'stale');
    expect(rows[1].querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
    expect(rows[2].querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'octagon');
    expect(rows[0].querySelector('[data-occ-glyph]')).toBeNull();

    // The ages run while the list is open.
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(rows[0]).toHaveTextContent('Al día, hace 9 s');
    act(() => { vi.advanceTimersByTime(52_000); });
    expect(rows[0]).toHaveTextContent('Al día, 14:31');
  });

  it('draws each tag with its texture, as the legend does', () => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(NOW);
    render(button(sourcesOf([
      ['elevant', { state: 'ok', at: NOW - 2_000 }],
      ['airTraffic', { state: 'ok', at: NOW - 4_000, tags: ['demo', 'estimated', 'not_a_tag', 'constructor'] }],
    ])));
    fireEvent.click(screen.getByRole('button', { name: 'Fuentes al día' }));
    const row = screen.getByRole('dialog').querySelector('[data-source="airTraffic"]');
    // A tag the vocabulary does not know is left out rather than drawn wrong.
    expect([...row.querySelectorAll('[data-tag]:not(svg)')].map(tag => tag.textContent)).toEqual(['Demo', 'est.']);
    const demo = within(row).getByText('Demo');
    // «Demo» keeps its 45° stripes, an SVG pattern and never a CSS texture; «est.» its dashed outline.
    expect(demo.querySelector('svg pattern')).toHaveAttribute('patternTransform', 'rotate(45)');
    expect(demo.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(row).getByText('est.').querySelector('[data-part="stand"]').style.strokeDasharray).not.toBe('');
  });

  it('says so when the screen reads no source, in English too', () => {
    resetLanguageForTests('en');
    render(button({ items: [], summary: summarizeSources([]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Sources up to date' }));
    expect(screen.getByRole('dialog', { name: 'Data sources' })).toHaveTextContent('This screen reads no source.');
  });
});
