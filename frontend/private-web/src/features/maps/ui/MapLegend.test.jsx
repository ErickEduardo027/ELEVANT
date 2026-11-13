import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { STAND_STATES, STAND_STATE_KEYS, TAGS } from '../../occ-ui/statusVocabulary';
import { AIRCRAFT_SILHOUETTE_PATH } from '../aircraftSilhouette';
import OccMap from '../core/OccMap';
import { standAppearance } from '../stands/standLayers';
import { MAP_IMAGE_SHAPES } from '../style/mapImages';
import { createMapStands, standPoint } from '../testing/mapFixtures';
import MapLegend from './MapLegend';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
// Synthetic states over the reference points: A1 occupied, A3 planned, B21 disabled and BN6 unverified, the rest free;
// only A1 to A3 were placed by OCC.
const STANDS = createMapStands();
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

const legendItems = () => within(screen.getByRole('list', { name: /Leyenda|Legend/ })).getAllByRole('listitem')
  .map(item => item.textContent);

// What MapLibre draws of the stands while it gathers them, as queryRenderedFeatures answers it: a cluster, and the
// stands `alone` on their own.
function drawStands(map, alone) {
  const features = [
    { id: 1, layer: { id: 'occ-stands-clusters' }, properties: { cluster: true, cluster_id: 1, point_count: 40 } },
    ...alone.map(code => ({ id: code, layer: { id: 'occ-stands-frame' }, properties: { code } })),
  ];
  fake.state.setRenderedFeatures(map, (_geometry, options) => features.filter(feature => options.layers.includes(feature.layer.id)));
}

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
    expect(legendItems()).toEqual([
      ...RAMP_ORDER.map(state => STAND_STATES[state].es),
      `${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`,
    ]);
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar']);
    // Each state is drawn as the map draws it: its outline token and its dash.
    const swatches = [...legend.querySelectorAll('li svg rect')];
    expect(swatches.map(rect => rect.style.stroke)).toEqual([
      'var(--occ-line-strong)', 'var(--occ-muted)', 'var(--occ-text)', 'var(--occ-line-strong)', 'var(--occ-faint)',
    ]);
    expect(swatches.map(rect => rect.style.strokeDasharray)).toEqual(['none', '4 3', 'none', '2 2', '1 3']);
    expect(swatches[2].style.fill).toBe('var(--occ-panel-raised)');
    // The glyph inside each stand, as the map draws it: the axis of an empty stand, the aircraft of a held one; the
    // only other path is the hatch of «Inhabilitada».
    const glyphs = () => [...screen.getByTestId('map-legend').querySelectorAll('li svg')]
      .map(svg => [...svg.querySelectorAll('[data-glyph]')].map(node => node.dataset.glyph).join('+'));
    expect(glyphs()).toEqual(['axis', 'aircraft', 'aircraft', '', 'axis']);
    expect(legend.querySelectorAll('li svg path:not([data-glyph])')).toHaveLength(1);
    expect(legend.querySelector('[data-glyph="aircraft"]').style.fill).toBe('var(--occ-muted)');

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

    // «Llegando» has no aircraft yet and «Por liberar» carries the clock on its corner: neither depends on colour.
    const view = render(<MapLegend stands={createMapStands({ A2: { status: 'releasing' }, A4: { status: 'arriving' } })} />);
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Llegando', 'Ocupada', 'Por liberar']);
    expect(glyphs().slice(0, 5)).toEqual(['axis', 'aircraft', '', 'aircraft', 'aircraft+clock']);
    view.unmount();

    // English, from the same vocabulary; it can start folded.
    resetLanguageForTests('en');
    render(<LanguageScope><MapLegend stands={STANDS} defaultOpen={false} /></LanguageScope>);
    const english = screen.getByRole('button', { name: 'Legend' });
    expect(english).toHaveAttribute('aria-expanded', 'false');
    expect(english).toHaveAttribute('title', 'Show legend');
    fireEvent.click(english);
    expect(legendItems()).toEqual([
      ...RAMP_ORDER.map(state => STAND_STATES[state].en),
      `${TAGS.unofficial.en}Internal reference location, not verified`,
    ]);
    expect(legendItems().at(0)).toBe('Free');
  });

  it('outlines each state as wide and as dashed as the frame the map draws for it', () => {
    for (const state of STAND_STATE_KEYS) {
      const view = render(<MapLegend stands={[{ id: 'A1', latitude: FLIGHT_POINT[1], longitude: FLIGHT_POINT[0], status: state, locationSource: 'occ' }]} />);
      const outline = screen.getByTestId('map-legend').querySelector('li svg rect');
      // The one line of the frame image the map's frame layer draws for this state (stands/standLayers.js).
      const [line] = MAP_IMAGE_SHAPES[standAppearance(state).frame.image].ops;
      expect(Number(outline.style.strokeWidth), state).toBe(line.lineWidth);
      expect(outline.style.strokeDasharray, state).toBe(line.dash ? line.dash.join(' ') : 'none');
      view.unmount();
    }
    // The four widths of the vocabulary are all there: 1 px, 1.5 px, 2 px and 2.5 px.
    const widths = STAND_STATE_KEYS.map(state => MAP_IMAGE_SHAPES[standAppearance(state).frame.image].ops[0].lineWidth);
    expect([...new Set(widths)].sort((first, second) => first - second)).toEqual([1, 1.5, 2, 2.5]);
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
    expect(legendItems()).toEqual(['Libre', 'Sin verificar', `${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`]);

    fireEvent.keyDown(map.getCanvas(), { key: '4' });
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar']);

    // Up close on A1 to A3, the stands OCC placed: their states and no «No oficial».
    act(() => map.jumpTo({ center: [-68.360889, 18.56418], zoom: 19.4 }));
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
    // Up close on A2: A1 (occupied) on its right, A3 (planned) and A4 (at its reference location) on its left.
    act(() => map.jumpTo({ center: standPoint('A2'), zoom: 18 }));
    const unofficial = `${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`;
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada', unofficial]);

    // A panel over the right of the map hides A1, the only occupied stand: «Ocupada» leaves the legend.
    rerender(screenWith({ top: 0, right: 540, bottom: 0, left: 0 }));
    expect(legendItems()).toEqual(['Libre', 'Planificada', unofficial]);
    // One over the left hides A4, the only stand at its reference location: «No oficial» goes with it.
    rerender(screenWith({ left: 300 }));
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada']);
    // Folded, the whole map is back.
    rerender(screenWith(undefined));
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada', unofficial]);
  });

  it('explains clusters in the airfield view with the stands it still draws on their own, and has nothing to explain where no stand is drawn', () => {
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // The ramp view draws every stand on its own: the legend does not ask the map what it draws.
    drawStands(map, ['BN6']);
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar']);

    // The airfield view gathers the stands into clusters, which carry no state: the legend says what a cluster is, and
    // explains BN6, with no neighbour close enough to join a cluster, which the map still draws on its own.
    fireEvent.keyDown(map.getCanvas(), { key: '3' });
    expect(legendItems()).toEqual([
      'Grupo de posicionesAcerca el mapa para ver cada una', 'Sin verificar', `${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`,
    ]);
    const circle = screen.getByTestId('map-legend').querySelector('li svg circle');
    expect([circle.style.fill, circle.style.stroke]).toEqual(['var(--occ-panel-raised)', 'var(--occ-line-strong)']);
    // When every stand in sight is in a cluster, as the map tells once it settles, only the cluster is explained.
    drawStands(map, []);
    act(() => fake.state.emit(map, 'idle'));
    expect(legendItems()).toEqual(['Grupo de posicionesAcerca el mapa para ver cada una']);

    // Region and approach draw no stand at all.
    fireEvent.keyDown(map.getCanvas(), { key: '1' });
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    fireEvent.keyDown(map.getCanvas(), { key: '2' });
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    fireEvent.keyDown(map.getCanvas(), { key: '4' });
    expect(legendItems().at(-1)).toBe(`${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`);
    cleanup();

    resetLanguageForTests('en');
    window.history.replaceState({}, '', `${PAGE}&view=airfield`);
    render(<LanguageScope><OccMap stands={STANDS}><MapLegend /></OccMap></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    drawStands(english, []);
    act(() => fake.state.emit(english, 'style.load'));
    // Opened on a grouped view, the map has drawn nothing of the stands until it settles: its first idle frame tells.
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    act(() => fake.state.emit(english, 'idle'));
    expect(legendItems()).toEqual(['Group of standsZoom in to see each one']);
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
    act(() => map.jumpTo({ center: [-68.3634, 18.5674], zoom: 15 }));
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
});
