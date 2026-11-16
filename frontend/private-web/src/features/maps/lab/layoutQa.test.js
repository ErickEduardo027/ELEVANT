import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTE } from '../../occ-ui/occPalette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM, initialBearing } from '../airport/geo';
import { buildTaxiGraph, shortestPath } from '../airport/taxiGraph';
import { createMapEngine } from '../core/mapEngine';
import { FONT_STACKS, buildOccStyle } from '../style/occStyle';
import { createQaLayout, qaPoint } from '../testing/mapFixtures';
import { QA_FLAGS } from '../../../../scripts/maps/lib/buildLayout.mjs';
import {
  EMPTY_PROBE, FRAME_MARGIN_M, MISMATCH_M, QA_ATTENTION_FLAGS, QA_FLAG_LABELS, QA_LAYER_IDS, QA_SOURCE, graphReach,
  isFlagged, nextProbe, nodeLabel, probeRoute, probeSummary, qaFeatures, qaOverlay, qaStandRows, routeLine, standFrame,
  standFramePoints,
} from './layoutQa';

const ofKind = (collection, kind) => collection.features.filter(item => item.properties.kind === kind);
const byCode = (features, code) => features.filter(item => item.properties.code === code);
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const engines = [];
afterEach(() => {
  engines.splice(0).forEach(engine => engine.destroy());
  document.body.replaceChildren();
});

describe('layout review overlay', () => {
  it('draws each stand polygon with its code and a heading arrow, the ELEVANT point, the OSM gates and a mismatch line only beyond 15 m', () => {
    const layout = createQaLayout();
    const data = qaFeatures(layout, { focus: 'A2' });

    const areas = ofKind(data, 'standArea');
    expect(areas.map(item => item.properties.code)).toEqual(['A10', 'A2', 'B31', 'AN1', 'B33']);
    for (const area of areas) {
      const stand = layout.stands.find(item => item.code === area.properties.code);
      expect(area.geometry).toEqual({ type: 'Polygon', coordinates: [stand.polygon] });
    }
    // Flagged means a flag that needs a person: B31 has no OSM geometry, AN1 is far from it. A10 is only narrowed and
    // B33 has only an assumed heading: they explain how the box was drawn.
    expect(areas.filter(item => item.properties.flagged).map(item => item.properties.code)).toEqual(['B31', 'AN1']);
    expect(areas.filter(item => item.properties.retired).map(item => item.properties.code)).toEqual(['B33']);
    expect(areas.filter(item => item.properties.focused).map(item => item.properties.code)).toEqual(['A2']);

    // The code sits on the tail side, clear of the arrow; the retired stand says so.
    const codes = ofKind(data, 'standCode');
    expect(codes.map(item => item.properties.label)).toEqual(['A10', 'A2', 'B31', 'AN1', 'B33 · retirada']);
    const a2 = layout.stands.find(item => item.code === 'A2');
    const a2Code = byCode(codes, 'A2')[0].geometry.coordinates;
    expect(haversineM(a2.center, a2Code)).toBeCloseTo(0.3 * 66, 0);
    expect(angle(initialBearing(a2.center, a2Code), 0)).toBeLessThan(1);

    // The arrow: a shaft from the point towards the nose, 35 % of the depth, and a head at its tip. None for B33.
    const arrows = ofKind(data, 'standArrow');
    expect(arrows).toHaveLength(8);
    expect(byCode(arrows, 'B33')).toEqual([]);
    const an1 = layout.stands.find(item => item.code === 'AN1');
    const [shaft, head] = byCode(arrows, 'AN1');
    expect(shaft.geometry.coordinates[0]).toEqual(an1.center);
    const tip = shaft.geometry.coordinates[1];
    expect(haversineM(an1.center, tip)).toBeCloseTo(0.35 * 66, 0);
    expect(angle(initialBearing(an1.center, tip), an1.headingTrue)).toBeLessThan(1);
    expect(head.geometry.coordinates[1]).toEqual(tip);
    expect(head.geometry.coordinates).toHaveLength(3);

    // The ELEVANT points answer the stand's graph node (the retired stand has none).
    const points = ofKind(data, 'elevantPoint');
    expect(points.map(item => [item.properties.code, item.properties.node ?? null])).toEqual([
      ['A10', 'st-A10'], ['A2', 'st-A2'], ['B31', 'st-B31'], ['AN1', 'st-AN1'], ['B33', null],
    ]);
    expect(points.map(item => item.geometry.coordinates)).toEqual(layout.stands.map(item => item.center));

    expect(ofKind(data, 'gate').map(item => [item.properties.ref, item.geometry.coordinates]))
      .toEqual([['2', qaPoint(-160, 0)], ['B31', qaPoint(60, 0)]]);
    // The stand lines OSM maps, with the gate at their end when they have one.
    expect(ofKind(data, 'osmStandLine').map(item => [item.properties.way, item.properties.gate, item.geometry.coordinates]))
      .toEqual([[1, '2', [qaPoint(-160, 0), qaPoint(-160, 100)]], [2, '', [qaPoint(-260, 0), qaPoint(-260, 100)]]]);

    // A line to the OSM centroid only where it lies more than 15 m away: A10 (32 m) and AN1 (55 m), not A2 (12 m).
    expect(MISMATCH_M).toBe(15);
    const mismatches = ofKind(data, 'mismatch');
    expect(mismatches.map(item => [item.properties.code, item.properties.distanceM])).toEqual([['A10', 32], ['AN1', 55]]);
    expect(mismatches[0].geometry.coordinates).toEqual([layout.stands[0].center, layout.stands[0].qa.osmCentroid]);

    // Without a focus nothing is in review; without a layout there is nothing to draw.
    expect(ofKind(qaFeatures(layout), 'standArea').some(item => item.properties.focused)).toBe(false);
    expect(qaFeatures(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('colours the graph by reachability and marks holding points and apron holds', () => {
    const layout = createQaLayout();
    const data = qaFeatures(layout);

    // Taxiway X reaches the rest only along the runway: it is cut off. Runway edges are runway; the rest is main.
    const edges = ofKind(data, 'edge');
    expect(edges).toHaveLength(layout.taxiGraph.edges.length);
    const reachOf = (a, b) => edges.find(item => {
      const ends = [item.geometry.coordinates[0], item.geometry.coordinates.at(-1)];
      const nodes = [a, b].map(id => layout.taxiGraph.nodes.find(node => node.id === id).p);
      return JSON.stringify(ends) === JSON.stringify(nodes);
    }).properties.reach;
    expect([reachOf('n8', 'n9'), reachOf('n9', 'n10')]).toEqual(['cut', 'cut']);
    expect([reachOf('n2', 'n3'), reachOf('n3', 'n8')]).toEqual(['runway', 'runway']);
    expect([reachOf('n2', 'hp-A-09-27'), reachOf('ah-a', 'n4'), reachOf('ls-A2', 'st-A2')]).toEqual(['main', 'main', 'main']);
    expect(edges.filter(item => item.properties.edgeKind === 'leadin')).toHaveLength(4);

    // The plain nodes, picked by their id; stands, holding points and apron holds are drawn by their own marks.
    const nodes = Object.fromEntries(ofKind(data, 'node').map(item => [item.properties.id, item.properties]));
    expect(Object.keys(nodes).sort()).toEqual(['ls-A10', 'ls-A2', 'ls-AN1', 'ls-B31', 'n1', 'n10', 'n2', 'n3', 'n4', 'n8', 'n9']);
    expect([nodes.n8.reach, nodes.n9.reach, nodes.n10.reach]).toEqual(['cut', 'cut', 'cut']);
    expect([nodes.n3.reach, nodes.n3.nodeKind]).toEqual(['runway', 'runway']);
    expect([nodes.n1.reach, nodes.n2.reach, nodes.n2.nodeKind]).toEqual(['main', 'main', 'exit']);

    expect(ofKind(data, 'hold').map(item => item.properties)).toEqual([{
      kind: 'hold', id: 'hp-A-09-27', node: 'hp-A-09-27', runway: '09/27', source: 'derived', reach: 'main',
    }]);
    expect(ofKind(data, 'apronHold').map(item => item.properties)).toEqual([{
      kind: 'apronHold', id: 'ah-a', node: 'ah-a', label: 'Espera A', reach: 'main',
    }]);
    expect(ofKind(data, 'apronHold')[0].geometry.coordinates).toEqual(layout.apronHolds[0].p);

    // MDPC: every taxi edge and node is in the main network; only the runway's own edges and ends are not.
    const reach = graphReach(buildTaxiGraph(MDPC_LAYOUT.taxiGraph));
    expect(MDPC_LAYOUT.taxiGraph.edges.filter(item => reach.edgeReach(item) === 'cut')).toEqual([]);
    const off = MDPC_LAYOUT.taxiGraph.nodes.filter(item => reach.nodeReach(item.id) !== 'main');
    expect(off.map(item => item.kind)).toEqual(off.map(() => 'runway'));
    expect(reach.main.size).toBe(MDPC_LAYOUT.taxiGraph.nodes.length - off.length);
  });

  it('qaStandRows puts flagged stands first, then natural code order (A2 before A10)', () => {
    const rows = qaStandRows(createQaLayout());
    expect(rows.map(row => row.code)).toEqual(['AN1', 'B31', 'A2', 'A10', 'B33']);
    expect(rows[1]).toEqual({
      code: 'B31', terminal: 'B', kind: 'contact', sizeLetter: 'D', retired: false, flagged: true,
      flags: ['unmatched', 'narrowed'], headingTrue: 180, headingSource: 'osm', osmWay: null, centroidDistanceM: null,
      gate: { ref: 'B31', distanceM: 40 }, reviewed: false,
    });
    expect(rows.at(-1)).toMatchObject({ code: 'B33', retired: true, flagged: false });

    // The MDPC layout: the flagged stands first, each part in natural order.
    const mdpc = qaStandRows(MDPC_LAYOUT);
    expect(mdpc).toHaveLength(42);
    const flagged = mdpc.filter(row => row.flagged);
    expect(mdpc.slice(0, flagged.length)).toEqual(flagged);
    expect(flagged.every(row => isFlagged(MDPC_LAYOUT.stands.find(stand => stand.code === row.code)))).toBe(true);
    const rest = mdpc.slice(flagged.length).map(row => row.code);
    expect(rest.indexOf('A2')).toBeLessThan(rest.indexOf('A10'));
    expect(rest.indexOf('A11')).toBeLessThan(rest.indexOf('AN1'));
    expect(rest).toEqual([...rest].sort(new Intl.Collator('es', { numeric: true }).compare));

    // Every flag of the generator has its words, in its order; only the informative ones are left out of «flagged».
    expect(Object.keys(QA_FLAG_LABELS)).toEqual([...QA_FLAGS]);
    expect(Object.keys(QA_FLAG_LABELS).filter(flag => !QA_ATTENTION_FLAGS.includes(flag))).toEqual(['narrowed', 'headingAssumed']);
    expect(QA_ATTENTION_FLAGS.every(flag => QA_FLAGS.includes(flag))).toBe(true);
  });

  it('the probe measures the shortest taxi route between two nodes, never along a runway, and starts again on a third click', () => {
    const layout = createQaLayout();
    const graph = buildTaxiGraph(layout.taxiGraph);

    const first = nextProbe(EMPTY_PROBE, 'st-A2', graph);
    expect(first).toEqual({ from: 'st-A2', to: null, route: null });
    expect(probeSummary(first, layout)).toEqual({ title: null, detail: 'Origen: posición A2. Haz clic en el nodo de destino.' });
    // The origin again, or a node the graph lacks, changes nothing.
    expect(nextProbe(first, 'st-A2', graph)).toBe(first);
    expect(nextProbe(first, 'nope', graph)).toBe(first);

    const second = nextProbe(first, 'hp-A-09-27', graph);
    const expected = shortestPath(graph, 'st-A2', 'hp-A-09-27', { avoidKinds: ['runway'] });
    expect(second.route).toEqual(expected);
    expect(second.route.nodeIds).toEqual(['st-A2', 'ls-A2', 'n4', 'ah-a', 'n1', 'hp-A-09-27']);
    expect(probeSummary(second, layout)).toEqual({
      title: `Ruta: ${Math.round(expected.lengthM)} m`,
      detail: 'Desde posición A2 hasta punto de espera A de la pista 09/27, en 5 tramos.',
    });
    // Its line runs along the edges travelled, from the first node to the second.
    const line = routeLine(graph, second.route.nodeIds);
    expect(line[0]).toEqual(graph.nodes.get('st-A2').p);
    expect(line.at(-1)).toEqual(graph.nodes.get('hp-A-09-27').p);
    const drawn = qaFeatures(layout, { probe: second, graph });
    expect(ofKind(drawn, 'route').map(item => item.properties.lengthM)).toEqual([expected.lengthM]);
    expect(ofKind(drawn, 'route')[0].geometry.coordinates).toEqual(line);
    expect(ofKind(drawn, 'probeEnd').map(item => item.properties.role)).toEqual(['from', 'to']);

    // Taxiway X can only be reached along the runway: no taxi route, and nothing drawn but the two ends.
    expect(probeRoute(graph, 'st-A2', 'n9')).toBeNull();
    const cut = nextProbe(first, 'n9', graph);
    expect(probeSummary(cut, layout)).toEqual({
      title: 'Sin ruta', detail: 'No hay ruta por las calles de rodaje entre posición A2 y nodo n9.',
    });
    expect(ofKind(qaFeatures(layout, { probe: cut }), 'route')).toEqual([]);

    // A third click starts a new probe from the node clicked.
    expect(nextProbe(second, 'n2', graph)).toEqual({ from: 'n2', to: null, route: null });
    expect(nodeLabel(layout, 'n2')).toBe('salida de pista n2');
    expect(nodeLabel(layout, 'ah-a')).toBe('espera de plataforma A');
    expect(probeSummary(EMPTY_PROBE, layout).detail).toBe('Haz clic en dos nodos del grafo para medir la ruta por las calles de rodaje.');
  });

  it('frames a stand with its box, its lead-in, its gate and its OSM centroid, and 50 m of apron around them', () => {
    const a2 = createQaLayout().stands.find(item => item.code === 'A2');
    const evidence = [...a2.polygon, ...a2.leadIn, a2.qa.gate.p, a2.qa.osmCentroid];
    expect(standFramePoints(a2)).toEqual(evidence);
    const b33 = createQaLayout().stands.find(item => item.code === 'B33');
    expect(standFramePoints(b33)).toEqual(b33.polygon);
    expect(standFramePoints(null)).toEqual([]);

    expect(FRAME_MARGIN_M).toBe(50);
    const [[west, south], [east, north]] = standFrame(a2);
    const lngs = evidence.map(point => point[0]);
    const lats = evidence.map(point => point[1]);
    // 50 m beyond the evidence on every side, east and west measured along the parallel.
    expect(haversineM([west, south], [Math.min(...lngs), south])).toBeCloseTo(50, 0);
    expect(haversineM([east, north], [Math.max(...lngs), north])).toBeCloseTo(50, 0);
    expect(haversineM([west, south], [west, Math.min(...lats)])).toBeCloseTo(50, 0);
    expect(haversineM([east, north], [east, Math.max(...lats)])).toBeCloseTo(50, 0);
    expect(standFrame(null)).toBeNull();
  });

  it('is a valid overlay in the stands and standLabels slots whose nodes, holds and points answer their graph node', () => {
    for (const basemap of [true, false]) {
      expect(validateStyleMin(buildOccStyle({ basemap, overlays: [qaOverlay()] })), String(basemap)).toEqual([]);
    }
    const overlay = qaOverlay();
    expect(Object.keys(overlay.sources)).toEqual([QA_SOURCE]);
    expect(overlay.layers.map(layer => layer.id)).toEqual([...QA_LAYER_IDS]);
    for (const layer of overlay.layers) {
      expect(['stands', 'standLabels'], layer.id).toContain(layer.slot);
      expect(layer.source, layer.id).toBe(QA_SOURCE);
      expect(layer.metadata['occ:group'], layer.id).toBe('lab-qa');
      // The review is the lab's: no threshold hides any of it.
      expect(layer.metadata['occ:minThreshold'], layer.id).toBeUndefined();
      if (layer.type === 'symbol') {
        expect(Object.values(FONT_STACKS).map(stack => stack.join())).toContain(layer.layout['text-font'].join());
        expect(layer.layout['text-size'], layer.id).toBeGreaterThanOrEqual(12);
      }
    }
    // Only OCC tokens paint it.
    const palette = new Set(Object.values(OCC_PALETTE));
    const colours = JSON.stringify(overlay.layers.map(layer => layer.paint)).match(/#[0-9a-f]{6}|rgb\([^)]*\)/gi);
    expect(colours.filter(colour => !palette.has(colour))).toEqual([]);
    const picks = Object.fromEntries(overlay.layers.filter(layer => layer.metadata['occ:pick'])
      .map(layer => [layer.id, [layer.metadata['occ:pick'], layer.metadata['occ:pickId']]]));
    expect(picks).toEqual({
      'occ-lab-qa-node': ['node', 'id'],
      'occ-lab-qa-hold': ['node', 'node'],
      'occ-lab-qa-apron-hold': ['node', 'node'],
      'occ-lab-qa-point': ['node', 'node'],
    });

    // The engine picks a node by the id the layer names.
    const fake = createFakeMapLibre();
    const host = document.createElement('div');
    document.body.append(host);
    const engine = createMapEngine({ maplibre: fake.module, host, style: buildOccStyle({ basemap: false, overlays: [overlay] }) });
    engines.push(engine);
    const map = fake.state.maps.at(-1);
    fake.state.emit(map, 'style.load');
    fake.state.setRenderedFeatures(map, () => [{ layer: { id: 'occ-lab-qa-point' }, properties: { code: 'A5', node: 'st-A5' } }]);
    expect(engine.pickAt({ x: 10, y: 10 })).toMatchObject({ kind: 'node', id: 'st-A5' });
    fake.state.setRenderedFeatures(map, () => [{ layer: { id: 'occ-lab-qa-node' }, properties: { id: 'n12' } }]);
    expect(engine.pickAt({ x: 10, y: 10 })).toMatchObject({ kind: 'node', id: 'n12' });
  });

  it('draws the whole MDPC layout: 42 stands, 41 arrows, every gate and OSM stand line, and the graph', () => {
    const data = qaFeatures(MDPC_LAYOUT);
    expect(ofKind(data, 'standArea')).toHaveLength(42);
    expect(ofKind(data, 'standArrow')).toHaveLength(41 * 2);
    expect(ofKind(data, 'gate')).toHaveLength(MDPC_LAYOUT.qa.gates.length);
    // The 30 stand lines of the extract; the gate at the end of B29's and B30's lines is not the line their point is on.
    const lines = ofKind(data, 'osmStandLine');
    expect(lines).toHaveLength(30);
    const b29 = MDPC_LAYOUT.stands.find(stand => stand.code === 'B29');
    expect(lines.find(item => item.properties.way === b29.qa.osmWay).properties.gate).toBe('');
    expect(lines.filter(item => item.properties.gate === 'B29')).toHaveLength(1);
    expect(ofKind(data, 'edge')).toHaveLength(MDPC_LAYOUT.taxiGraph.edges.length);
    expect(ofKind(data, 'hold')).toHaveLength(MDPC_LAYOUT.holdingPoints.length);
    expect(ofKind(data, 'apronHold').map(item => item.properties.label)).toEqual(['Espera A', 'Espera B', 'Espera FBO']);
    const far = MDPC_LAYOUT.stands.filter(stand => stand.qa.centroidDistanceM > MISMATCH_M).map(stand => stand.code);
    expect(ofKind(data, 'mismatch').map(item => item.properties.code)).toEqual(far);
    // Nothing frozen of the dataset reaches the map: every coordinate is a copy.
    expect(Object.isFrozen(ofKind(data, 'elevantPoint')[0].geometry.coordinates)).toBe(false);
  });
});
