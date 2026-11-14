import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { SIGNALS, STAND_STATES, STAND_STATE_KEYS, TAGS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { AIRCRAFT_SILHOUETTE_PATH } from '../aircraftSilhouette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { boundsCenter, presetTargets } from '../core/cameraPresets';
import OccMap from '../core/OccMap';
import { OCC_MAP_IDLE, OccMapContext } from '../core/OccMapContext';
import { standPaint } from '../stands/standLayers';
import { attachStandGeometry, withStandDisplay } from '../stands/standModel';
import { STAND_REFERENCE } from '../stands/standReference';
import { MAP_IMAGE_SHAPES } from '../style/mapImages';
import { createMapStands, createRampScenario, standPoint } from '../testing/mapFixtures';
import MapLegend from './MapLegend';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
// Synthetic states over the reference points: A1 occupied, A3 planned, B21 disabled and BN6 unverified, the rest free;
// only A1 to A3 were placed by OCC.
const STANDS = createMapStands();
const DRAWN = attachStandGeometry(STANDS, MDPC_LAYOUT);
const PAGE = '/admin-occ/positions-map?stationId=s-1';
const RAMP_ORDER = ['available', 'planned', 'occupied', 'disabled', 'unverified'];
// Synthetic flights (invented keys): one over A1, one without a position.
const FLIGHT_POINT = standPoint('A1');
const FLIGHTS = [
  { id: 'l:leg-1', heading: 90, latitude: FLIGHT_POINT[1], longitude: FLIGHT_POINT[0] },
  { id: 'p:prop-2', heading: null, latitude: null, longitude: null },
];
const FLIGHT_ENTRY = 'VueloApunta según su rumbo; al norte si no se conoce';
const UNOFFICIAL = `${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`;
const CHIP = 'Posiciones de una terminalOcupadas del total; acerca el mapa para ver cada una';
const CHIP_ARRIVING = 'Llega un vuelo a una posición de la terminal';
const ATTENTION = SIGNALS.attention.es;
const URGENT = SIGNALS.urgent.es;
const COMBINED = 'Enlace con la posición que la anula';
// 14:07 in Punta Cana: the ramp scenario read as the positions map reads it, with its signals.
const NOW = Date.parse('2026-11-13T18:07:00Z');
const REFERENCES = STAND_REFERENCE.map(stand => ({ id: stand.code, terminal: stand.terminal, lat: stand.latitude, lon: stand.longitude }));
function scenarioStands() {
  const { board, flightsByTurnaround } = createRampScenario(NOW);
  return withStandDisplay(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), { nowMs: NOW, flightsByTurnaround });
}

const legendItems = () => within(screen.getByRole('list', { name: /Leyenda|Legend/ })).getAllByRole('listitem')
  .map(item => item.textContent);
const stateSwatches = () => [...screen.getByTestId('map-legend').querySelectorAll('li[data-state] svg')];
const glyphsOf = svg => [...svg.querySelectorAll('[data-glyph]')].map(node => node.dataset.glyph).join('+');
// The pixel box of a drawn stand's polygon on the fake map.
const pixelBox = (map, code) => {
  const points = DRAWN.find(stand => stand.id === code).geometry.polygon.map(point => map.project(point));
  return {
    left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)),
  };
};

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  resetLanguageForTests('es');
  window.history.replaceState({}, '', '/');
});

describe('MapLegend', () => {
  it('shows the Spanish and English labels from statusVocabulary and folds through its own button', () => {
    const { unmount } = render(<MapLegend stands={STANDS} />);
    const legend = screen.getByTestId('map-legend');
    // The words of the vocabulary, in its order, and the «No oficial» plate with what it means.
    expect(legendItems()).toEqual([...RAMP_ORDER.map(state => STAND_STATES[state].es), UNOFFICIAL]);
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar']);
    // Each state is drawn as the map draws it: its outline token and its dash, the slab of «Ocupada», the hatch of
    // «Inhabilitada» and the aircraft of a stand with an aircraft on it.
    const outlines = stateSwatches().map(svg => svg.querySelector('rect'));
    expect(outlines.map(rect => rect.style.stroke)).toEqual([
      'var(--occ-line-strong)', 'var(--occ-muted)', 'var(--occ-text)', 'var(--occ-line-strong)', 'var(--occ-faint)',
    ]);
    expect(outlines.map(rect => rect.style.strokeDasharray)).toEqual(['none', '4 3', 'none', '2 2', '1 3']);
    expect(outlines[2].style.fill).toBe('var(--occ-panel-raised)');
    expect(stateSwatches().map(glyphsOf)).toEqual(['', '', 'aircraft', 'hatch', '']);
    expect(legend.querySelector('[data-glyph="aircraft"]').style.fill).toBe('var(--occ-text)');

    // One button folds it; its name stays «Leyenda» and aria-expanded says whether it is open.
    const toggle = within(legend).getByRole('button', { name: 'Leyenda' });
    const list = screen.getByRole('list', { name: 'Leyenda' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', list.parentElement.id);
    expect(toggle).toHaveAttribute('title', 'Ocultar leyenda');
    expect(toggle).toHaveClass('min-h-11');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('title', 'Mostrar leyenda');
    expect(list).not.toBeVisible();
    fireEvent.click(toggle);
    expect(list).toBeVisible();
    unmount();

    // English, from the same vocabulary; it can start folded.
    resetLanguageForTests('en');
    render(<LanguageScope><MapLegend stands={STANDS} defaultOpen={false} /></LanguageScope>);
    const english = screen.getByRole('button', { name: 'Legend' });
    expect(english).toHaveAttribute('aria-expanded', 'false');
    expect(english).toHaveAttribute('title', 'Show legend');
    fireEvent.click(english);
    expect(legendItems()).toEqual([...RAMP_ORDER.map(state => STAND_STATES[state].en), `${TAGS.unofficial.en}Internal reference location, not verified`]);
    expect(legendItems().at(0)).toBe('Free');
  });

  it('every state swatch differs from every other without colour and uses the STAND_STATES word', () => {
    // One stand of each state, as a screen derived it.
    const stands = STAND_STATE_KEYS.map((state, index) => ({ ...DRAWN[index], displayStatus: state, locationSource: 'occ' }));
    const view = render(<MapLegend stands={stands} />);
    expect(legendItems()).toEqual(STAND_STATE_KEYS.map(state => STAND_STATES[state].es));
    // What each swatch shows without colour: its fill kind, its outline's width and dash, and its marks.
    const swatches = Object.fromEntries(stateSwatches().map(svg => [svg.closest('li').dataset.state, svg]));
    const channels = state => {
      const svg = swatches[state];
      const outline = svg.querySelector('rect');
      return JSON.stringify([svg.dataset.fill, outline.style.strokeWidth, outline.style.strokeDasharray, glyphsOf(svg)]);
    };
    for (const state of STAND_STATE_KEYS) {
      const { fill, outline, dash } = STAND_STATES[state];
      const svg = swatches[state];
      // The vocabulary's fill kind, outline width and dash, as the map's layers draw them (standPaint).
      expect(svg.dataset.fill, state).toBe(fill.kind);
      expect(Number(svg.querySelector('rect').style.strokeWidth), state).toBe(outline.width);
      expect(svg.querySelector('rect').style.strokeDasharray, state).toBe(dash ? dash.join(' ') : 'none');
      expect(svg.querySelector('rect').style.stroke, state).toBe(`var(${standPaint(state).outline.token})`);
    }
    // The marks: the aircraft on «Ocupada» and «Por liberar», the clock of «Por liberar», the lead-in of «Llegando»
    // and the hatch of «Inhabilitada».
    expect(Object.fromEntries(STAND_STATE_KEYS.map(state => [state, glyphsOf(swatches[state])]))).toEqual({
      available: '', planned: '', arriving: 'leadin', occupied: 'aircraft', releasing: 'aircraft+clock',
      disabled: 'hatch', unverified: '',
    });
    for (const [index, first] of STAND_STATE_KEYS.entries()) {
      for (const second of STAND_STATE_KEYS.slice(index + 1)) {
        expect(channels(first), `${first} and ${second} differ only in colour`).not.toBe(channels(second));
      }
    }
    expect(swatches.occupied.querySelector('[data-glyph="aircraft"]').getAttribute('d')).toBe(AIRCRAFT_SILHOUETTE_PATH);
    view.unmount();

    resetLanguageForTests('en');
    render(<LanguageScope><MapLegend stands={stands} /></LanguageScope>);
    expect(legendItems()).toEqual(STAND_STATE_KEYS.map(state => STAND_STATES[state].en));
  });

  it('lists the flights drawn on screen first, with the aircraft the map draws for them', () => {
    const screenWith = (props = {}) => (
      <OccMap flights={FLIGHTS} defaultView="region" {...props}>
        <MapLegend />
      </OccMap>
    );
    const { rerender } = render(screenWith());
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // The region view holds the flight with a position: its entry is the whole legend, behind one «Leyenda».
    expect(legendItems()).toEqual([FLIGHT_ENTRY]);
    expect(screen.getAllByRole('button', { name: 'Leyenda' })).toHaveLength(1);
    // The solid silhouette, nose up, in the text colour with the nav halo, as traffic/flightLayers.js paints it.
    const aircraft = screen.getByTestId('map-legend').querySelector('li svg [data-glyph="flight"]');
    expect(aircraft.getAttribute('d')).toBe(AIRCRAFT_SILHOUETTE_PATH);
    expect([aircraft.style.fill, aircraft.style.stroke]).toEqual(['var(--occ-text)', 'var(--occ-nav)']);

    // Far from the flight, or with a panel over it, there is nothing to explain; it comes back with the flight.
    act(() => map.jumpTo({ center: [-70.55, 19.45], zoom: 12 }));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    act(() => map.jumpTo({ center: FLIGHT_POINT, zoom: 12 }));
    expect(legendItems()).toEqual([FLIGHT_ENTRY]);
    rerender(screenWith({ insets: { left: 760 } }));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    // With the stands of a screen: the flight first, then the stand states and their tag.
    render(
      <OccMap stands={STANDS} flights={FLIGHTS}>
        <MapLegend />
      </OccMap>,
    );
    act(() => fake.state.emit(fake.state.liveMaps().at(-1), 'style.load'));
    expect(legendItems()).toEqual([FLIGHT_ENTRY, ...RAMP_ORDER.map(state => STAND_STATES[state].es), UNOFFICIAL]);
    cleanup();

    // In English.
    resetLanguageForTests('en');
    render(<LanguageScope><OccMap flights={FLIGHTS} defaultView="region"><MapLegend /></OccMap></LanguageScope>);
    act(() => fake.state.emit(fake.state.liveMaps().at(-1), 'style.load'));
    expect(legendItems()).toEqual(['FlightPoints along its heading; north when unknown']);
  });

  it('lists only the stands on the screen of its map', () => {
    window.history.replaceState({}, '', `${PAGE}&view=ramp&terminal=FBO`);
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // The FBO view: free stands and BN6 without a database row, all at their reference location.
    expect(legendItems()).toEqual(['Libre', 'Sin verificar', UNOFFICIAL]);

    fireEvent.keyDown(map.getCanvas(), { key: '4' });
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar']);

    // Up close on A1 to A3, the stands OCC placed: their states and no «No oficial».
    act(() => map.jumpTo({ center: standPoint('A2'), zoom: 19.4 }));
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada']);
  });

  it('leaves out what the panels over its map hide', () => {
    const screenWith = insets => (
      <OccMap stands={STANDS} insets={insets}>
        <MapLegend />
      </OccMap>
    );
    const { rerender } = render(screenWith(undefined));
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // Up close on A2: A1 (occupied) on its right, A3 (planned) on its left, then A4 and A5 at their reference location,
    // and the tails of the remote stands AN1 to AN4 along the top edge.
    act(() => map.jumpTo({ center: standPoint('A2'), zoom: 18 }));
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada', UNOFFICIAL]);

    // A panel over the right of the map that covers A1, the only occupied stand: «Ocupada» leaves the legend.
    const right = Math.ceil(1440 - pixelBox(map, 'A1').left) + 4;
    rerender(screenWith({ top: 0, right, bottom: 0, left: 0 }));
    expect(legendItems()).toEqual(['Libre', 'Planificada', UNOFFICIAL]);
    // Panels over the left and the top that cover A4, A5 and the remote stands, the stands at their reference location:
    // «No oficial» goes with them.
    const left = Math.ceil(Math.max(pixelBox(map, 'A4').right, pixelBox(map, 'A5').right)) + 4;
    const top = Math.ceil(Math.max(...['AN1', 'AN2', 'AN3', 'AN4'].map(code => pixelBox(map, code).bottom))) + 4;
    expect(left).toBeLessThan(pixelBox(map, 'A3').left);
    rerender(screenWith({ left, top }));
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada']);
    // Folded, the whole map is back.
    rerender(screenWith(undefined));
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada', UNOFFICIAL]);
  });

  it('lists the terminal chip and the signals only when they are on screen', () => {
    render(
      <OccMap stands={scenarioStands()} frozenAt={NOW}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // The ramp view: the seven states, the attention signal (A3 covered by nobody, B21 past its departure) and the
    // urgent one (A4, another flight arriving), the link of A10 to A9 and the tag.
    expect(legendItems()).toEqual([
      ...STAND_STATE_KEYS.map(state => STAND_STATES[state].es), ATTENTION, URGENT, COMBINED, UNOFFICIAL,
    ]);
    const shapes = [...screen.getByTestId('map-legend').querySelectorAll('svg[data-swatch="signal"]')];
    expect(shapes.map(svg => svg.dataset.shape)).toEqual(['triangle', 'octagon']);
    // Each in its colour, with the shape of the map's image and a dark «!».
    const [triangle, octagon] = shapes.map(svg => svg.querySelector('path'));
    expect([triangle.style.fill, octagon.style.fill]).toEqual(['var(--occ-warn)', 'var(--occ-danger)']);
    expect(triangle.getAttribute('d')).toBe(MAP_IMAGE_SHAPES['signal-attention'].ops[0].fill);
    expect(shapes[1].querySelector('[data-glyph="exclamation"]').style.fill).toBe('var(--occ-nav)');
    expect(screen.queryByText('Posiciones de una terminal')).not.toBeInTheDocument();

    // The FBO, where nothing carries a signal: no signal entry.
    act(() => map.jumpTo({ center: standPoint('BN9'), zoom: 18 }));
    expect(legendItems().some(item => item.startsWith(SIGNALS.attention.es) || item.startsWith(SIGNALS.urgent.es))).toBe(false);

    // Below the polygon threshold the chips stand for the stands: the chip is explained, and right after it the arrow
    // over terminal A's, where A3 and A6 read «Llegando».
    const { airfield } = presetTargets({ stands: STANDS, layout: MDPC_LAYOUT });
    act(() => map.jumpTo({ center: boundsCenter(airfield.bounds), zoom: 12.5 }));
    expect(legendItems()).toEqual([CHIP, CHIP_ARRIVING]);
    const chip = screen.getByTestId('map-legend').querySelector('svg[data-swatch="chip"] rect');
    expect([chip.style.fill, chip.style.stroke]).toEqual(['var(--occ-panel-raised)', 'var(--occ-line-strong)']);
    // The arrow as the map draws it (style/mapImages.js: glyph-arriving), in --occ-text, pointing down at a chip.
    const arriving = screen.getByTestId('map-legend').querySelector('svg[data-swatch="chipArriving"]');
    const [shaft, head] = MAP_IMAGE_SHAPES['glyph-arriving'].ops;
    const arrow = [...arriving.querySelectorAll('[data-glyph="arriving"] path')];
    expect(arrow.map(path => path.getAttribute('d'))).toEqual([shaft.stroke, head.fill]);
    expect([arrow[0].style.stroke, arrow[1].style.fill]).toEqual(['var(--occ-text)', 'var(--occ-text)']);
    expect(arriving.querySelector('rect').style.fill).toBe('var(--occ-panel-raised)');

    // The camera moved west until the right edge falls between the chips of A and B (terminal A lies east of B and the
    // FBO): the chips of B and the FBO stay in sight without an arrow, so only the chip is explained.
    const chipPixel = terminal => map.project(map.getSource('occ-stand-groups').data.features
      .find(item => item.id === terminal).geometry.coordinates);
    const [a, b] = [chipPixel('A'), chipPixel('B')];
    expect(a.x).toBeGreaterThan(b.x + 20);
    act(() => map.jumpTo({ center: map.unproject([(a.x + b.x) / 2 - 720, 450]).toArray() }));
    expect(chipPixel('B').x).toBeLessThan(1440);
    expect(legendItems()).toEqual([CHIP]);
    cleanup();

    // In English.
    resetLanguageForTests('en');
    render(<LanguageScope><OccMap stands={scenarioStands()} frozenAt={NOW}><MapLegend /></OccMap></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(english, 'style.load'));
    act(() => english.jumpTo({ center: boundsCenter(airfield.bounds), zoom: 12.5 }));
    expect(legendItems()).toEqual(['Stands of a terminalOccupied of the total; zoom in to see each one', 'A flight is arriving at a stand of the terminal']);
  });

  it('explains only the signal the map draws on each stand: a stand with an urgent and an attention signal brings «Urgente»', () => {
    // A1 has an aircraft on it while another flight arrives, and nobody covers it; no other stand carries a signal.
    const stands = createMapStands({
      A1: { signals: [{ kind: 'attention', reason: 'uncovered' }, { kind: 'urgent', reason: 'conflict' }] },
    });
    const view = render(
      <OccMap stands={stands}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // The map draws only the red octagon on A1, and the legend explains that one alone.
    expect(map.getSource('occ-stand-labels').data.features.find(item => item.id === 'A1').properties.signal).toBe('urgent');
    expect(legendItems()).toEqual([...RAMP_ORDER.map(state => STAND_STATES[state].es), URGENT, UNOFFICIAL]);
    expect(screen.getByTestId('map-legend').querySelectorAll('svg[data-swatch="signal"]')).toHaveLength(1);
    // A re-read where A1 keeps only the attention signal: the map draws the triangle, and the legend follows it.
    const withSignals = signals => createMapStands({ A1: { signals } });
    view.rerender(<OccMap stands={withSignals([{ kind: 'attention', reason: 'uncovered' }])}><MapLegend /></OccMap>);
    expect(map.getSource('occ-stand-labels').data.features.find(item => item.id === 'A1').properties.signal).toBe('attention');
    expect(legendItems()).toEqual([...RAMP_ORDER.map(state => STAND_STATES[state].es), ATTENTION, UNOFFICIAL]);
    // The urgent one comes back on top of it: «Urgente» replaces «Atención».
    view.rerender(<OccMap stands={withSignals([{ kind: 'attention', reason: 'uncovered' }, { kind: 'urgent', reason: 'conflict' }])}><MapLegend /></OccMap>);
    expect(legendItems()).toEqual([...RAMP_ORDER.map(state => STAND_STATES[state].es), URGENT, UNOFFICIAL]);
    view.unmount();

    // A legend given its own stands reads them the same way.
    render(<MapLegend stands={stands} />);
    expect(legendItems()).toContain(URGENT);
    expect(legendItems()).not.toContain(ATTENTION);
  });

  it('shows «Pista», «Calle de rodaje» and «Punto de espera» only when on screen, in Spanish and English', () => {
    const drawn = (layer, kind) => ({ layer: { id: layer }, properties: { kind, id: `${kind}-1` } });
    const AIRFIELD = [
      drawn('occ-airfield-terminal', 'terminal'), drawn('occ-airfield-hold', 'holdBar'), drawn('occ-airfield-runway', 'runway'),
      drawn('occ-airfield-taxiway', 'taxiway'), drawn('occ-airfield-apron', 'apron'),
    ];
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    let airfield = [];
    fake.state.setRenderedFeatures(map, (_geometry, options) => airfield.filter(feature => options.layers.includes(feature.layer.id)));
    act(() => fake.state.emit(map, 'style.load'));
    // Nothing of the airfield drawn in sight: the stands only.
    expect(legendItems()).toEqual([...RAMP_ORDER.map(state => STAND_STATES[state].es), UNOFFICIAL]);

    // The map draws a runway, a taxiway with a holding point, an apron and a terminal there: they follow the stands,
    // set apart, each with a crop of the map as its swatch.
    airfield = AIRFIELD;
    act(() => fake.state.emit(map, 'idle'));
    expect(legendItems()).toEqual([
      ...RAMP_ORDER.map(state => STAND_STATES[state].es), UNOFFICIAL,
      'Pista', 'Calle de rodaje', 'Punto de espera', 'Plataforma', 'Terminal',
    ]);
    const legend = screen.getByTestId('map-legend');
    expect([...legend.querySelectorAll('li svg[data-swatch]')].map(svg => svg.dataset.swatch).filter(kind => kind !== 'state'))
      .toEqual(['runway', 'taxiway', 'holdBar', 'apron', 'terminal']);
    // A rule across the legend sets the airfield apart; it is not an entry of the list.
    const rule = legend.querySelector('[data-legend-rule]');
    expect(rule).toHaveClass('col-span-2', 'border-t');
    expect(rule).toHaveAttribute('aria-hidden', 'true');
    expect(rule.nextElementSibling).toHaveTextContent('Pista');
    // The short entries sit two to a row; the plate of «No oficial» takes the whole row.
    expect(screen.getByRole('list', { name: 'Leyenda' })).toHaveClass('grid-cols-2');
    const rows = within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem');
    expect(rows.filter(row => row.classList.contains('col-span-2')).map(row => row.textContent)).toEqual([UNOFFICIAL]);
    // The swatches paint what the map paints: the runway's centreline in --occ-text, the terminal's outline in
    // --occ-line-strong.
    expect(legend.querySelector('svg[data-swatch="runway"] path[style*="stroke-dasharray"]').style.stroke).toBe('var(--occ-text)');
    expect(legend.querySelector('svg[data-swatch="terminal"] rect:last-child').style.stroke).toBe('var(--occ-line-strong)');

    // Only what is drawn: with the runway alone, only «Pista».
    airfield = [AIRFIELD[2]];
    act(() => fake.state.emit(map, 'idle'));
    expect(legendItems().slice(-2)).toEqual([UNOFFICIAL, 'Pista']);
    // Away from the stands the airfield is the whole legend, and nothing sets it apart.
    airfield = AIRFIELD;
    act(() => map.jumpTo({ center: [-68.37, 18.59], zoom: 16 }));
    expect(legendItems()).toEqual(['Pista', 'Calle de rodaje', 'Punto de espera', 'Plataforma', 'Terminal']);
    expect(screen.getByTestId('map-legend').querySelector('[data-legend-rule]')).toBeNull();
    // The region view draws no airfield: nothing to explain.
    fireEvent.keyDown(map.getCanvas(), { key: '1' });
    act(() => fake.state.emit(map, 'idle'));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    // In English, back on the ramp view.
    window.history.replaceState({}, '', PAGE);
    resetLanguageForTests('en');
    render(<LanguageScope><OccMap stands={STANDS}><MapLegend /></OccMap></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    fake.state.setRenderedFeatures(english, (_geometry, options) => AIRFIELD.slice(1, 4)
      .filter(feature => options.layers.includes(feature.layer.id)));
    act(() => fake.state.emit(english, 'style.load'));
    act(() => fake.state.emit(english, 'idle'));
    expect(legendItems().slice(-3)).toEqual(['Runway', 'Taxiway', 'Holding point']);
    cleanup();

    // A legend given its own stands, outside a map, lists no airfield.
    resetLanguageForTests('es');
    render(<MapLegend stands={STANDS} />);
    expect(legendItems()).not.toContain('Pista');
  });

  it('explains the ring of the stands the selected one\'s agent covers and the boxes of a stand being placed', () => {
    const stands = scenarioStands();
    const view = render(
      <OccMap stands={stands} frozenAt={NOW} selection={{ kind: 'stand', id: 'A4' }}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // A4 is Luis's, who covers A5 and B22 too: their ring is explained, under the stand marks.
    const SAME_AGENT = 'Mismo agente que la posición elegida';
    expect(legendItems()).toContain(SAME_AGENT);
    expect(legendItems().indexOf(SAME_AGENT)).toBeGreaterThan(legendItems().indexOf(COMBINED));
    expect(legendItems().indexOf(SAME_AGENT)).toBeLessThan(legendItems().indexOf(UNOFFICIAL));
    const ring = screen.getByTestId('map-legend').querySelector('svg[data-swatch="sameAgent"]');
    expect([...ring.querySelectorAll('rect')].map(rect => rect.style.stroke)).toEqual(['var(--occ-line-strong)', 'var(--occ-muted)']);

    // Placing A1 with a pending location: the box at true size, solid over a wash, with its centre; the selection's
    // ring is still explained. Without the pointer over the map there is no box at the pointer to explain.
    const pending = { latitude: standPoint('A1')[1], longitude: standPoint('A1')[0] };
    view.rerender(
      <OccMap stands={stands} frozenAt={NOW} selection={{ kind: 'stand', id: 'A4' }} placingStand={{ code: 'A1', sizeHint: null }}
        pendingLocation={pending} onMapClick={() => {}}>
        <MapLegend />
      </OccMap>,
    );
    expect(legendItems()).toEqual(expect.arrayContaining([SAME_AGENT, 'Ubicación sin guardar']));
    expect(legendItems()).not.toContain('Posición que estás ubicandoA tamaño real; se ajusta al plano a menos de 15 m');
    const box = screen.getByTestId('map-legend').querySelector('svg[data-swatch="pending"] rect');
    expect([box.style.stroke, box.style.strokeWidth, box.style.fillOpacity]).toEqual(['var(--occ-accent)', '2.5', '0.2']);

    // In English.
    cleanup();
    resetLanguageForTests('en');
    render(
      <LanguageScope>
        <OccMap stands={stands} frozenAt={NOW} selection={{ kind: 'stand', id: 'A4' }}>
          <MapLegend />
        </OccMap>
      </LanguageScope>,
    );
    act(() => fake.state.emit(fake.state.liveMaps().at(-1), 'style.load'));
    expect(legendItems()).toContain('Same agent as the selected stand');
  });

  it('names the same-agent ring after the stand it follows, with the one swatch the map draws for both', () => {
    // The marks as OccMap shares them: the ring of the selected stand's agent, or of the agent of the one under the
    // pointer (OccMap.test.jsx checks that they follow what the map draws).
    const onScreen = marks => ({ ...OCC_MAP_IDLE, standMarksOnScreen: marks });
    const ringOf = mark => [...screen.getByTestId('map-legend').querySelectorAll(`svg[data-swatch="${mark}"] rect`)]
      .map(rect => [rect.getAttribute('x'), rect.style.stroke, rect.style.strokeWidth]);
    const { rerender } = render(<OccMapContext.Provider value={onScreen(['sameAgent'])}><MapLegend /></OccMapContext.Provider>);
    expect(legendItems()).toEqual(['Mismo agente que la posición elegida']);
    const selectedRing = ringOf('sameAgent');
    expect(selectedRing).toEqual([['5.5', 'var(--occ-line-strong)', '1'], ['2.5', 'var(--occ-muted)', '1']]);

    rerender(<OccMapContext.Provider value={onScreen(['sameAgentHover'])}><MapLegend /></OccMapContext.Provider>);
    expect(legendItems()).toEqual(['Mismo agente que la posición bajo el puntero']);
    expect(ringOf('sameAgentHover')).toEqual(selectedRing);
    // No ring drawn, nothing to explain.
    rerender(<OccMapContext.Provider value={onScreen([])}><MapLegend /></OccMapContext.Provider>);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    resetLanguageForTests('en');
    render(<LanguageScope><OccMapContext.Provider value={onScreen(['sameAgentHover'])}><MapLegend /></OccMapContext.Provider></LanguageScope>);
    expect(legendItems()).toEqual(['Same agent as the stand under the pointer']);
  });

  it('renders nothing when no stand is on screen', async () => {
    // Nothing to explain: no stands, or none with a place on the map.
    const { rerender } = render(<MapLegend stands={[]} />);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    rerender(<MapLegend stands={[{ id: 'X1', latitude: null, longitude: null, status: 'planned' }]} />);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    // Stands outside the bounds the caller gives are not on screen either.
    rerender(<MapLegend stands={STANDS} bounds={[[-70.6, 19.4], [-70.5, 19.5]]} />);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    // Inside a map: the legend goes when the camera leaves the stands and comes back with them.
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
    act(() => map.jumpTo({ center: [-70.55, 19.45], zoom: 14 }));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    act(() => map.jumpTo({ center: standPoint('A5'), zoom: 15 }));
    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
    cleanup();

    // A map that cannot draw has nothing on screen: its fallback list stands in for the legend.
    fake.state.reset({ constructorError: new GPUInitializationError() });
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    expect(await screen.findByTestId('map-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
  });

  it('lists the traffic on screen first, each kind, tag and trail drawn as the map draws it', () => {
    const onScreen = { kinds: ['aviamArrival', 'aviamDeparture', 'other', 'otherGround'], tags: ['demo', 'estimated', 'stale'],
      trails: ['live', 'estimated'] };
    const withTraffic = (trafficOnScreen, element = <MapLegend />) => (
      <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, flightsOnScreen: FLIGHTS.slice(0, 1), trafficOnScreen }}>
        {element}
      </OccMapContext.Provider>
    );
    const { rerender } = render(withTraffic(onScreen));
    const legend = screen.getByTestId('map-legend');
    expect(legendItems()).toEqual([
      'Vuelo de AVIAM que llega', 'Vuelo de AVIAM que sale', 'Otro tráfico', 'Otro tráfico en tierra',
      `${TAGS.demo.es}Vuelo simulado`, `${TAGS.estimated.es}Calculada con el horario`,
      `${TAGS.stale.short.es}Atenuado, con la hora de su última posición`, 'Estela', 'Estela estimada',
      FLIGHT_ENTRY,
    ]);
    // Short over the map: the two trails share a line, everything else of the traffic takes one each.
    const spans = [...legend.querySelectorAll('[data-legend-traffic]')].map(item => item.classList.contains('col-span-2'));
    expect(spans).toEqual([true, true, true, true, true, true, true, false, false]);
    // The arrival solid, the departure hollow, other traffic muted; the plate striped; the estimated trail dashed.
    const swatch = kind => legend.querySelector(`[data-traffic-swatch="${kind}"] path`);
    expect(swatch('aviamArrival').style.fill).toBe('var(--occ-text)');
    expect(swatch('aviamDeparture').style.fill).toBe('none');
    expect(swatch('aviamDeparture').style.stroke).toBe('var(--occ-text)');
    expect(swatch('other').style.fill).toBe('var(--occ-faint)');
    expect(legend.querySelector('[data-traffic-swatch="estimated"] circle').style.strokeDasharray).toBe('2.2 1.6');
    expect(swatch('stale').style.opacity).toBe('0.5');
    expect(legend.querySelector('[data-legend-traffic="demo"] [data-tag="demo"]')).not.toBeNull();
    expect(swatch('trailEstimated').style.strokeDasharray).toBe('3 3');

    // Only what is on screen: other traffic alone, and nothing at all without traffic or flights.
    rerender(withTraffic({ kinds: ['other'], tags: [], trails: [] }));
    expect(legendItems()).toEqual(['Otro tráfico', FLIGHT_ENTRY]);
    rerender(
      <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, trafficOnScreen: { kinds: [], tags: [], trails: [] } }}>
        <MapLegend />
      </OccMapContext.Provider>,
    );
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    // Traffic alone is something to explain: the legend shows for it.
    rerender(
      <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, trafficOnScreen: { kinds: ['aviamArrival'], tags: [], trails: [] } }}>
        <MapLegend />
      </OccMapContext.Provider>,
    );
    expect(legendItems()).toEqual(['Vuelo de AVIAM que llega']);
  });
  it('lists each reference only while it is on screen, set apart with the airfield, each drawn as the map draws it', () => {
    const ALL = { kinds: ['rings', 'centrelines', 'runwayInUse', 'airports', 'counterparts', 'vor', 'ndb', 'night'],
      runway: { arrival: '08', source: 'wind' } };
    const withReferences = (referencesOnScreen, extra = {}) => (
      <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, referencesOnScreen, ...extra }}>
        <MapLegend />
      </OccMapContext.Provider>
    );
    const { rerender } = render(withReferences(ALL));
    expect(legendItems()).toEqual(['Anillos de distancia', 'Eje de pista extendido (marca cada NM)',
      'Pista 08 (estimada por el viento)', 'Aeropuerto de la región', 'Origen o destino de un vuelo de hoy',
      'Radioayuda VOR-DME', 'Radioayuda NDB', 'Noche (tras el crepúsculo civil)']);
    const legend = screen.getByTestId('map-legend');
    // Each takes the whole row, with the swatch of what the map draws: the runway in use wider and lighter than the
    // other centrelines, a counterpart filled and any other airport a ring, the chart symbols of the navaids.
    const items = [...legend.querySelectorAll('[data-legend-reference]')];
    expect(items.map(item => item.dataset.legendReference)).toEqual(ALL.kinds);
    expect(items.every(item => item.classList.contains('col-span-2'))).toBe(true);
    const swatch = kind => legend.querySelector('[data-reference-swatch="' + kind + '"]');
    expect(swatch('runwayInUse').querySelector('g').style.stroke).toBe('var(--occ-text)');
    expect(swatch('runwayInUse').querySelector('g').style.strokeWidth).toBe('1.5');
    expect(swatch('centrelines').querySelector('g').style.stroke).toBe('var(--occ-line-strong)');
    expect(swatch('rings').querySelectorAll('circle')).toHaveLength(2);
    expect(swatch('airports').querySelector('circle').style.fill).toBe('var(--occ-nav)');
    expect(swatch('counterparts').querySelector('circle').style.fill).toBe('var(--occ-text)');
    expect(swatch('vor').querySelectorAll('path')).toHaveLength(3);
    expect(swatch('ndb').querySelectorAll('path')).toHaveLength(2);
    expect(swatch('night').querySelector('path').style.fillOpacity).toBe('0.45');
    expect([...legend.querySelectorAll('[data-reference-swatch]')].every(svg => svg.getAttribute('aria-hidden') === 'true')).toBe(true);
    // Alone, nothing sets them apart.
    expect(legend.querySelector('[data-legend-rule]')).toBeNull();

    // With traffic and the airfield: the traffic first, then the rule, the references and the airfield.
    rerender(withReferences({ kinds: ['rings', 'vor'], runway: null },
      { trafficOnScreen: { kinds: ['other'], tags: [], trails: [] }, airfieldOnScreen: ['runway'] }));
    expect(legendItems()).toEqual(['Otro tráfico', 'Anillos de distancia', 'Radioayuda VOR-DME', 'Pista']);
    expect(screen.getByTestId('map-legend').querySelector('[data-legend-rule]').nextElementSibling)
      .toHaveTextContent('Anillos de distancia');
    // The runway in use is listed only with its runway; nothing of them on screen, no legend.
    rerender(withReferences({ kinds: ['centrelines', 'runwayInUse'], runway: null }));
    expect(legendItems()).toEqual(['Eje de pista extendido (marca cada NM)']);
    rerender(withReferences({ kinds: [], runway: null }));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    // In English.
    resetLanguageForTests('en');
    render(<LanguageScope>{withReferences(ALL)}</LanguageScope>);
    expect(legendItems().slice(0, 3)).toEqual(['Range rings', 'Extended runway centreline (a tick per NM)',
      'Runway 08 (estimated from the wind)']);
  });
});
