import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { buildTaxiGraph, shortestPath } from '../airport/taxiGraph';
import { boundsCenter, unionBounds } from '../core/cameraPresets';
import { QA_SOURCE, qaStandRows, standFramePoints } from './layoutQa';
import LayoutQaScene from './LayoutQaScene';
import { findScene } from './scenes';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const SCENE = findScene('layout-qa');
const NOON = Date.parse('2026-11-13T15:00:00Z');
const FLAGGED = qaStandRows(MDPC_LAYOUT).filter(row => row.flagged).map(row => row.code);
const standOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code);
// A button of the list by its stand code (its name starts with the code; A1 is not A10).
const rowOf = code => within(screen.getByRole('list', { name: 'Posiciones del plano' }))
  .getByRole('button', { name: new RegExp(`^${code}(?!\\d)`, 'u') });

function open({ strict = false, frozenAt = null } = {}) {
  window.history.replaceState({}, '', '/map-lab?scene=layout-qa');
  const scene = <LayoutQaScene scene={SCENE} basemap="on" frozenAt={frozenAt} />;
  const view = render(strict ? <StrictMode>{scene}</StrictMode> : scene);
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  return { ...view, map };
}

const review = map => map.getSource(QA_SOURCE);
const featuresOf = (map, kind) => review(map).data.features.filter(feature => feature.properties.kind === kind);
// A click on the map where the layer `layer` draws a feature with `properties`.
function clickOn(map, layer, properties) {
  fake.state.setRenderedFeatures(map, () => [{ layer: { id: layer }, properties }]);
  act(() => fake.state.emit(map, 'click', { point: { x: 300, y: 300 }, lngLat: { lng: -68.364, lat: 18.565 } }));
}

beforeEach(() => {
  fake.state.reset();
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('LayoutQaScene', () => {
  it('draws the review over the airfield of the layout, once, and lists every stand with the flagged ones first', () => {
    const { map } = open({ strict: true, frozenAt: NOON });
    expect(fake.state.liveMaps()).toEqual([map]);
    expect(screen.getByRole('heading', { level: 1, name: 'Revisión del plano de MDPC' })).toBeInTheDocument();
    // Nothing is signed off yet: the plate says so. The clock is frozen as in the other scenes.
    expect(screen.getByText('Plano sin revisar')).toBeInTheDocument();
    expect(screen.getByText('Reloj fijo: 2026-11-13 15:00 UTC')).toBeInTheDocument();
    expect(map.options.fadeDuration).toBe(0);

    // The airfield of the layout and the review overlay, written once each.
    expect(map.getSource('occ-airfield').setDataCalls).toHaveLength(1);
    expect(review(map).setDataCalls).toHaveLength(1);
    expect(featuresOf(map, 'standArea')).toHaveLength(42);
    const ids = map.layerIds();
    expect(ids.indexOf('occ-lab-qa-area')).toBeGreaterThan(ids.indexOf('slot-stands'));
    expect(ids.indexOf('occ-lab-qa-code')).toBeGreaterThan(ids.indexOf('slot-standLabels'));

    // The list: every stand, flagged first, each with its flags in words and its distances.
    const buttons = within(screen.getByRole('list', { name: 'Posiciones del plano' })).getAllByRole('button');
    expect(buttons).toHaveLength(42);
    expect(FLAGGED.length).toBeGreaterThan(0);
    FLAGGED.forEach((code, index) => expect(buttons[index].textContent.startsWith(code), code).toBe(true));
    expect(screen.getByText(`${FLAGGED.length} de 42 con marcas que piden revisión. Haz clic en una para encuadrarla.`))
      .toBeInTheDocument();
    expect(rowOf('B31')).toHaveTextContent(/Sin geometría OSM/u);
    expect(rowOf('B31')).toHaveTextContent(/puerta B31 a 46,1 m/u);
    expect(rowOf('A1')).toHaveTextContent('Rumbo de OSM; centroide OSM a 24,7 m.');
    expect(rowOf('B33')).toHaveTextContent('Retirada: no se dibuja en el OCC.');
    // The key explains every mark of the review.
    expect(within(screen.getByRole('list', { name: 'Qué muestra el mapa' })).getAllByRole('listitem')).toHaveLength(14);
  });

  it('clicking a stand in the list frames its polygon', () => {
    const { map } = open();
    fireEvent.click(rowOf('A5'));
    // The box, its lead-in, its gate and its OSM centroid are in the middle of the map, which came close to them.
    const frame = unionBounds(...standFramePoints(standOf('A5')).map(point => [point, point]));
    const [lng, lat] = map.getCenter().toArray();
    expect(lng).toBeCloseTo(boundsCenter(frame)[0], 9);
    expect(lat).toBeCloseTo(boundsCenter(frame)[1], 9);
    expect(map.getZoom()).toBeGreaterThan(17);
    expect(rowOf('A5')).toHaveAttribute('aria-current', 'true');
    // The stand in review carries the cyan casing; one write for the change.
    expect(featuresOf(map, 'standArea').filter(area => area.properties.focused).map(area => area.properties.code)).toEqual(['A5']);
    expect(review(map).setDataCalls).toHaveLength(2);

    // The suite does the same through the lab handle, and the casing is on the map when it returns.
    const lab = window.__occMapLab;
    expect(lab.scene).toBe('layout-qa');
    expect(lab.qaFlagged()).toEqual(FLAGGED);
    expect(lab.liveMaps()).toBe(1);
    const writes = review(map).setDataCalls.length;
    let framed = null;
    act(() => {
      framed = lab.flyToStandBox(FLAGGED[0]);
      // Already written before the handle returns, inside the same call.
      expect(review(map).setDataCalls).toHaveLength(writes + 1);
    });
    expect(framed).toBe(true);
    expect(featuresOf(map, 'standArea').filter(area => area.properties.focused).map(area => area.properties.code))
      .toEqual([FLAGGED[0]]);
    expect(rowOf(FLAGGED[0])).toHaveAttribute('aria-current', 'true');
    expect(rowOf('A5')).not.toHaveAttribute('aria-current');
    act(() => {
      framed = lab.flyToStandBox('Z9');
    });
    expect(framed).toBe(false);
    // project() takes a stand code, a graph node or a point.
    act(() => map.jumpTo({ center: standOf('A5').center }));
    expect(lab.project('A5')).toEqual({ x: 720, y: 450 });
    expect(lab.project(standOf('A5').node)).toEqual({ x: 720, y: 450 });
    expect(lab.project('nope')).toBeNull();
  });

  it('clicking two graph nodes draws the shortest path and shows its length in metres', () => {
    const { map } = open();
    const apron = MDPC_LAYOUT.apronHolds.find(hold => hold.id === 'ah-a');
    expect(screen.getByText('Haz clic en dos nodos del grafo para medir la ruta por las calles de rodaje.')).toBeInTheDocument();

    clickOn(map, 'occ-lab-qa-point', { kind: 'elevantPoint', code: 'A5', node: 'st-A5' });
    expect(screen.getByText('Origen: posición A5. Haz clic en el nodo de destino.')).toBeInTheDocument();
    expect(featuresOf(map, 'probeEnd').map(end => end.properties.role)).toEqual(['from']);

    clickOn(map, 'occ-lab-qa-apron-hold', { kind: 'apronHold', id: apron.id, node: apron.node });
    const expected = shortestPath(buildTaxiGraph(MDPC_LAYOUT.taxiGraph), 'st-A5', apron.node, { avoidKinds: ['runway'] });
    expect(expected).not.toBeNull();
    expect(screen.getByText(`Ruta: ${Math.round(expected.lengthM)} m`)).toBeInTheDocument();
    expect(screen.getByText(/^Desde posición A5 hasta espera de plataforma A, en \d+ tramos\.$/u)).toBeInTheDocument();
    const [route] = featuresOf(map, 'route');
    expect(route.properties.lengthM).toBe(expected.lengthM);
    expect(route.geometry.coordinates[0]).toEqual(standOf('A5').center);
    expect(route.geometry.coordinates.at(-1)).toEqual(apron.p);

    // A third click starts again from the node clicked; «Borrar ruta» empties the probe.
    const exit = MDPC_LAYOUT.taxiGraph.nodes.find(node => node.kind === 'exit');
    clickOn(map, 'occ-lab-qa-node', { kind: 'node', id: exit.id, nodeKind: 'exit' });
    expect(featuresOf(map, 'route')).toEqual([]);
    expect(screen.getByText(`Origen: salida de pista ${exit.id}. Haz clic en el nodo de destino.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Borrar ruta' }));
    expect(featuresOf(map, 'probeEnd')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Borrar ruta' })).toBeNull();

    // Nothing else the map picks moves the probe: a runway shows its card, a point without a node does nothing.
    clickOn(map, 'occ-airfield-runway', { kind: 'runway', id: '08/26', ref: '08/26', lengthM: 3100, widthM: 45 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pista 08/26');
    clickOn(map, 'occ-lab-qa-point', { kind: 'elevantPoint', code: 'B33' });
    expect(featuresOf(map, 'probeEnd')).toEqual([]);
  });
});
