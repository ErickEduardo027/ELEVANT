import { occColor } from '../../occ-ui/occPalette';
import { destinationPoint, roundCoord } from '../airport/geo';
import { STAND_BOX } from '../airport/standGeometry';
import { buildTaxiGraph, edgeLine, reachableFrom, shortestPath } from '../airport/taxiGraph';
import { padBounds, unionBounds } from '../core/cameraPresets';
import { FONT_STACKS } from '../style/occStyle';

// The review scene of the MDPC airport layout (map lab, development only; design C3, PR M3): what a person needs to
// judge the generated stands against OpenStreetMap before the dataset is signed off. Every stand polygon with its code
// and an arrow along its heading (where the parked aircraft's nose points), the internal ELEVANT points, the OSM gates
// and stand lines, a line from a point to the centroid of its matched OSM stand where they lie more than 15 m apart,
// the taxi graph coloured by reachability, the holding points and apron holds, and the route probe: two graph nodes
// and the shortest taxi route between them. One GeoJSON source in the `stands` and `standLabels` slots. Pure:
// LayoutQaScene.jsx gives the map this overlay and these features, and the side list these rows.
//
// Reachability follows what an aircraft can taxi: the graph without its runway edges (taxiways cross a runway at their
// exits, nobody taxis along it). Its largest connected part is `main`, drawn in the text colour; anything else is
// `cut`, amber and wider, so a taxiway joined to the rest only through a runway stands out. Runway edges, and the
// runway nodes only they touch, are `runway`. Normal things carry no hue («cabina oscura»): amber is what needs a
// person (flagged stands, cut edges), cyan what the person chose (the stand in review, the probe).

export const QA_SOURCE = 'occ-lab-qa';
export const QA_GROUP = 'lab-qa';

/** A point drawn farther than this from the centroid of its OSM stand gets a line to it. */
export const MISMATCH_M = 15;

/** The flags that need a person. `narrowed` and `headingAssumed` only explain how the box was drawn. */
export const QA_ATTENTION_FLAGS = Object.freeze([
  'unmatched', 'ambiguous', 'far', 'overlap', 'crossesTaxiway', 'leadInCrosses', 'offNetwork', 'noLeadIn',
]);

/** Every flag of the generator (QA_FLAGS of scripts/maps/lib/buildLayout.mjs) in plain Spanish, in its order. */
export const QA_FLAG_LABELS = Object.freeze({
  unmatched: 'Sin geometría OSM',
  ambiguous: 'Dos candidatas en OSM',
  far: 'A más de 50 m de OSM',
  overlap: 'Se solapa con otra posición',
  crossesTaxiway: 'Una calle de rodaje pasa por la caja',
  leadInCrosses: 'Su entrada cruza otra posición',
  narrowed: 'Caja recortada por la fila',
  headingAssumed: 'Rumbo supuesto por la fila',
  offNetwork: 'Lejos de la red de rodaje',
  noLeadIn: 'Sin línea de entrada',
});

/** The edges an aircraft taxis on. */
export const TAXI_EDGE_KINDS = Object.freeze(['taxiway', 'taxilane', 'leadin']);

/** The probe before its first node. */
export const EMPTY_PROBE = Object.freeze({ from: null, to: null, route: null });

// The heading arrow runs from the stand point towards the nose for 35 % of the box's depth, with a head of 10 %; the
// code sits on the tail side, 30 % of the depth behind the point, clear of the arrow.
const ARROW_SHARE = 0.35;
const HEAD_SHARE = 0.1;
const HEAD_ANGLE = 150;
const CODE_BACK_SHARE = 0.3;
const LABEL_SIZE = 12;

const STAND_ORDER = new Intl.Collator('es', { numeric: true });
const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const copy = point => [point[0], point[1]];
const pointGeometry = p => ({ type: 'Point', coordinates: copy(p) });
const lineGeometry = coordinates => ({ type: 'LineString', coordinates: coordinates.map(copy) });
const polygonGeometry = ring => ({ type: 'Polygon', coordinates: [ring.map(copy)] });
const feature = (properties, geometry) => ({ type: 'Feature', properties, geometry });
const towards = (from, bearing, metres) => roundCoord(destinationPoint(from, bearing, metres));
const isPoint = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

/** Whether a stand has a flag that needs a person (QA_ATTENTION_FLAGS). */
export function isFlagged(stand) {
  return (stand?.qa?.flags ?? []).some(flag => QA_ATTENTION_FLAGS.includes(flag));
}

/**
 * The reachability of a taxi graph (taxiGraph.buildTaxiGraph): `{ main: Set(node ids), nodeReach(id),
 * edgeReach(edge) }`, each reach `main`, `cut` or `runway` as the header explains. Ties between parts of the same size
 * go to the part with the smallest node id, so the answer is the same on every run.
 */
export function graphReach(graph) {
  const seen = new Set();
  let main = new Set();
  for (const id of [...graph.nodes.keys()].sort(compareIds)) {
    if (seen.has(id)) continue;
    const part = reachableFrom(graph, id, { kinds: TAXI_EDGE_KINDS });
    part.forEach(member => seen.add(member));
    if (part.size > main.size) main = part;
  }
  const nodeReach = id => {
    if (main.has(id)) return 'main';
    return graph.nodes.get(id)?.kind === 'runway' ? 'runway' : 'cut';
  };
  const edgeReach = edge => {
    if (edge.kind === 'runway') return 'runway';
    return main.has(edge.a) && main.has(edge.b) ? 'main' : 'cut';
  };
  return { main, nodeReach, edgeReach };
}

/**
 * The line of a route of graph nodes (shortestPath's `nodeIds`, found with the same `avoidKinds`): the pavement of each
 * edge in the direction travelled, the shortest edge where two join the same nodes (the one shortestPath takes).
 */
export function routeLine(graph, nodeIds, { avoidKinds = [] } = {}) {
  const line = [];
  for (let at = 0; at < (nodeIds?.length ?? 0) - 1; at += 1) {
    const from = nodeIds[at];
    const to = nodeIds[at + 1];
    const edge = (graph.adjacency.get(from) ?? [])
      .filter(entry => entry.to === to && !avoidKinds.includes(entry.edge.kind))
      .map(entry => entry.edge)
      .sort((x, y) => x.m - y.m)[0];
    if (!edge) return [];
    const path = edgeLine(graph, edge);
    const oriented = edge.a === from ? path : [...path].reverse();
    line.push(...(line.length === 0 ? oriented : oriented.slice(1)));
  }
  return line;
}

// The probe measures what an aircraft taxis: never along a runway.
const PROBE_AVOIDS = Object.freeze(['runway']);

/** The shortest taxi route between two nodes, never along a runway: `{ nodeIds, lengthM }`, or `null`. */
export function probeRoute(graph, fromId, toId) {
  return shortestPath(graph, fromId, toId, { avoidKinds: PROBE_AVOIDS });
}

/**
 * The probe after a click on node `nodeId`: the first click sets the origin, the second the destination and the route,
 * a third starts again from the node clicked. A click on the origin again, or on a node the graph lacks, changes
 * nothing.
 */
export function nextProbe(probe, nodeId, graph) {
  const id = nodeId == null ? null : String(nodeId);
  if (id === null || !graph.nodes.has(id)) return probe;
  if (probe.from === null || probe.to !== null) return { from: id, to: null, route: null };
  if (id === probe.from) return probe;
  return { from: probe.from, to: id, route: probeRoute(graph, probe.from, id) };
}

/** What a node is, in words that fit inside a sentence: «posición A5», «espera de plataforma A», «nodo n123». */
export function nodeLabel(layout, nodeId) {
  const stand = (layout?.stands ?? []).find(item => item.node === nodeId);
  if (stand) return `posición ${stand.code}`;
  const hold = (layout?.holdingPoints ?? []).find(item => item.node === nodeId);
  if (hold) return `punto de espera ${hold.taxiwayRef ?? 'sin nombre'} de la pista ${hold.runway}`;
  const apron = (layout?.apronHolds ?? []).find(item => item.node === nodeId);
  if (apron) return `espera de plataforma ${apron.terminals.join(' y ')}`;
  const node = (layout?.taxiGraph?.nodes ?? []).find(item => item.id === nodeId);
  return node?.kind === 'exit' ? `salida de pista ${nodeId}` : `nodo ${nodeId}`;
}

const METRES = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });

/**
 * What the probe panel says: `{ title, detail }`, `title` null until both ends are chosen. The route's length is in
 * whole metres: «Ruta: 1234 m».
 */
export function probeSummary(probe, layout) {
  if (!probe || probe.from === null) {
    return { title: null, detail: 'Haz clic en dos nodos del grafo para medir la ruta por las calles de rodaje.' };
  }
  const from = nodeLabel(layout, probe.from);
  if (probe.to === null) return { title: null, detail: `Origen: ${from}. Haz clic en el nodo de destino.` };
  const to = nodeLabel(layout, probe.to);
  if (probe.route === null) {
    return { title: 'Sin ruta', detail: `No hay ruta por las calles de rodaje entre ${from} y ${to}.` };
  }
  const legs = probe.route.nodeIds.length - 1;
  return {
    title: `Ruta: ${METRES.format(probe.route.lengthM)} m`,
    detail: `Desde ${from} hasta ${to}, en ${legs} ${legs === 1 ? 'tramo' : 'tramos'}.`,
  };
}

function standFeatures(stand, focus) {
  const code = stand.code;
  const retired = stand.retired === true;
  const base = { code, flagged: isFlagged(stand), retired, focused: code === focus };
  const depth = (STAND_BOX[stand.sizeLetter] ?? STAND_BOX.D).depthM;
  const features = [];
  if (Array.isArray(stand.polygon) && stand.polygon.length >= 4) {
    features.push(feature({ kind: 'standArea', ...base }, polygonGeometry(stand.polygon)));
  }
  if (!isPoint(stand.center)) return features;
  const heading = Number.isFinite(stand.headingTrue) ? stand.headingTrue : null;
  const labelAt = heading === null ? stand.center : towards(stand.center, heading + 180, depth * CODE_BACK_SHARE);
  const label = retired ? `${code} · retirada` : code;
  features.push(feature({ kind: 'standCode', ...base, label }, pointGeometry(labelAt)));
  // A retired stand keeps its outline and code, so a person sees what it would collide with, but points nowhere.
  if (!retired && heading !== null) {
    const tip = towards(stand.center, heading, depth * ARROW_SHARE);
    const barb = side => towards(tip, heading + side * HEAD_ANGLE, depth * HEAD_SHARE);
    features.push(feature({ kind: 'standArrow', ...base }, lineGeometry([stand.center, tip])));
    features.push(feature({ kind: 'standArrow', ...base }, lineGeometry([barb(1), tip, barb(-1)])));
  }
  features.push(feature(
    { kind: 'elevantPoint', ...base, ...(stand.node ? { node: stand.node } : {}) }, pointGeometry(stand.center),
  ));
  const centroid = stand.qa?.osmCentroid;
  const distanceM = stand.qa?.centroidDistanceM;
  if (isPoint(centroid) && Number.isFinite(distanceM) && distanceM > MISMATCH_M) {
    features.push(feature({ kind: 'mismatch', code, distanceM }, lineGeometry([stand.center, centroid])));
  }
  return features;
}

function graphFeatures(layout, graph, reach) {
  // Stands, holding points and apron holds are graph nodes drawn by their own marks, which carry their node id.
  const marked = new Set([
    ...(layout.stands ?? []).map(stand => stand.node),
    ...(layout.holdingPoints ?? []).map(hold => hold.node),
    ...(layout.apronHolds ?? []).map(hold => hold.node),
  ].filter(Boolean));
  const features = graph.edges.map(edge => feature(
    { kind: 'edge', edgeKind: edge.kind, reach: reach.edgeReach(edge) }, lineGeometry(edgeLine(graph, edge)),
  ));
  for (const node of graph.nodes.values()) {
    if (marked.has(node.id) || !isPoint(node.p)) continue;
    const properties = { kind: 'node', id: node.id, nodeKind: node.kind, reach: reach.nodeReach(node.id) };
    features.push(feature(properties, pointGeometry(node.p)));
  }
  for (const hold of layout.holdingPoints ?? []) {
    features.push(feature({
      kind: 'hold', id: hold.id, node: hold.node, runway: hold.runway, source: hold.source,
      reach: reach.nodeReach(hold.node),
    }, pointGeometry(hold.p)));
  }
  for (const hold of layout.apronHolds ?? []) {
    features.push(feature({
      kind: 'apronHold', id: hold.id, node: hold.node, label: `Espera ${hold.terminals.join(' y ')}`,
      reach: reach.nodeReach(hold.node),
    }, pointGeometry(hold.p)));
  }
  return features;
}

function probeFeatures(probe, graph) {
  if (!probe || probe.from === null) return [];
  const features = [];
  for (const [role, id] of [['from', probe.from], ['to', probe.to]]) {
    const node = id === null ? null : graph.nodes.get(id);
    if (node) features.push(feature({ kind: 'probeEnd', role, node: id }, pointGeometry(node.p)));
  }
  const line = probe.route ? routeLine(graph, probe.route.nodeIds, { avoidKinds: PROBE_AVOIDS }) : [];
  if (line.length >= 2) features.unshift(feature({ kind: 'route', lengthM: probe.route.lengthM }, lineGeometry(line)));
  return features;
}

/**
 * The features of the review overlay for `layout`: the OSM stand lines, the graph (edges and the nodes no other mark
 * draws), the holding points and apron holds, the OSM gates, every stand (area, code, heading arrow, ELEVANT point and,
 * beyond MISMATCH_M, the line to its OSM centroid) and the probe (its ends and its route). `focus` is the code of the
 * stand in review, `probe` as nextProbe answers it and `graph` the layout's taxi graph when the caller has built it.
 */
export function qaFeatures(layout, { probe = null, focus = null, graph = null } = {}) {
  if (!layout) return { type: 'FeatureCollection', features: [] };
  const taxiGraph = graph ?? buildTaxiGraph(layout.taxiGraph ?? {});
  const reach = graphReach(taxiGraph);
  const gates = (layout.qa?.gates ?? []).filter(gate => isPoint(gate.p))
    .map(gate => feature({ kind: 'gate', ref: String(gate.ref) }, pointGeometry(gate.p)));
  // The stand lines OSM maps (a nose-in mark from the gate to the taxilane), matched or not.
  const standLines = (layout.qa?.standLines ?? []).filter(item => (item.line ?? []).filter(isPoint).length >= 2)
    .map(item => feature({ kind: 'osmStandLine', way: item.way, gate: item.gate ?? '' }, lineGeometry(item.line)));
  return {
    type: 'FeatureCollection',
    features: [
      ...standLines,
      ...graphFeatures(layout, taxiGraph, reach),
      ...gates,
      ...(layout.stands ?? []).flatMap(stand => standFeatures(stand, focus)),
      ...probeFeatures(probe, taxiGraph),
    ],
  };
}

/**
 * The rows of the side list: one per stand of the layout with its flags and distances, the flagged stands first and
 * then in natural code order (A2 before A10), as the import dialog sorts stands.
 */
export function qaStandRows(layout) {
  return (layout?.stands ?? []).map(stand => ({
    code: stand.code,
    terminal: stand.terminal,
    kind: stand.kind,
    sizeLetter: stand.sizeLetter,
    retired: stand.retired === true,
    flagged: isFlagged(stand),
    flags: [...(stand.qa?.flags ?? [])],
    headingTrue: Number.isFinite(stand.headingTrue) ? stand.headingTrue : null,
    headingSource: stand.provenance?.heading ?? null,
    osmWay: stand.qa?.osmWay ?? null,
    centroidDistanceM: stand.qa?.centroidDistanceM ?? null,
    gate: stand.qa?.gate ? { ref: stand.qa.gate.ref, distanceM: stand.qa.gate.distanceM } : null,
    reviewed: stand.provenance?.qa === 'reviewed',
  })).sort((a, b) => Number(b.flagged) - Number(a.flagged) || STAND_ORDER.compare(a.code, b.code));
}

/** The evidence of a stand in review: its box, its lead-in from the taxi network, its OSM gate and its OSM centroid. */
export function standFramePoints(stand) {
  return [
    ...(stand?.polygon ?? []),
    ...(stand?.leadIn ?? []),
    ...(isPoint(stand?.qa?.gate?.p) ? [stand.qa.gate.p] : []),
    ...(isPoint(stand?.qa?.osmCentroid) ? [stand.qa.osmCentroid] : []),
  ].filter(isPoint).map(copy);
}

/** How much of the apron around a stand in review stays in the frame, so its neighbours show. */
export const FRAME_MARGIN_M = 50;

/**
 * What frames a stand in review: the box around its evidence (standFramePoints) plus FRAME_MARGIN_M on every side, as
 * `[[west, south], [east, north]]`, or `null` for a stand with nothing to frame.
 */
export function standFrame(stand) {
  return padBounds(unionBounds(...standFramePoints(stand).map(point => [point, point])), FRAME_MARGIN_M);
}

const KIND = ['get', 'kind'];
const kindIs = kind => ['==', KIND, kind];
const is = property => ['==', ['get', property], true];
const isNot = property => ['!=', ['get', property], true];
const reachColour = normal => ['match', ['get', 'reach'], 'cut', occColor('warn'), 'runway', occColor('faint'), normal];
const edgeOf = (...kinds) => ['all', kindIs('edge'), ['match', ['get', 'edgeKind'], kinds, true, false]];
const fonts = stack => [...FONT_STACKS[stack]];

function qaLayer(slot, id, type, filter, { layout, paint, pickId } = {}) {
  return {
    slot,
    id,
    type,
    source: QA_SOURCE,
    filter,
    ...(layout ? { layout } : {}),
    paint,
    metadata: { 'occ:group': QA_GROUP, ...(pickId ? { 'occ:pick': 'node', 'occ:pickId': pickId } : {}) },
  };
}

const ROUND = Object.freeze({ 'line-join': 'round', 'line-cap': 'round' });
const labelPaint = colour => ({ 'text-color': colour, 'text-halo-color': occColor('nav'), 'text-halo-width': 1.5 });

/**
 * The overlay of the review scene for buildOccStyle: the source `occ-lab-qa` and its layers, from the bottom of the
 * `stands` slot: the stand areas, the OSM stand lines, the taxi edges (lead-ins dashed, runway edges dashed and faint),
 * the stand outlines (amber and dashed when flagged, dotted when retired, a cyan casing for the stand in review), the
 * mismatch lines, the heading arrows, the probe route, the gates, the graph nodes, the holding points, the apron holds,
 * the ELEVANT points and the probe ends; then in `standLabels` the apron hold names, the gate refs and the stand codes,
 * the flagged ones placed first. The nodes, the holding points, the apron holds and the ELEVANT points are pick targets
 * of kind `node` that answer their graph node.
 */
export function qaOverlay() {
  const stands = 'stands';
  const labels = 'standLabels';
  return {
    sources: { [QA_SOURCE]: { type: 'geojson' } },
    layers: [
      qaLayer(stands, 'occ-lab-qa-area', 'fill', kindIs('standArea'), {
        paint: { 'fill-color': occColor('line-strong'), 'fill-opacity': ['case', is('retired'), 0, 0.12] },
      }),
      qaLayer(stands, 'occ-lab-qa-osm-line', 'line', kindIs('osmStandLine'), {
        layout: ROUND,
        paint: { 'line-color': occColor('faint'), 'line-width': 2.5 },
      }),
      qaLayer(stands, 'occ-lab-qa-edge', 'line', edgeOf('taxiway', 'taxilane'), {
        layout: ROUND,
        paint: { 'line-color': reachColour(occColor('text')), 'line-width': ['match', ['get', 'reach'], 'cut', 3, 1.25] },
      }),
      qaLayer(stands, 'occ-lab-qa-edge-leadin', 'line', edgeOf('leadin'), {
        paint: {
          'line-color': reachColour(occColor('text')),
          'line-width': ['match', ['get', 'reach'], 'cut', 2.5, 1],
          'line-dasharray': [3, 2],
        },
      }),
      qaLayer(stands, 'occ-lab-qa-edge-runway', 'line', edgeOf('runway'), {
        paint: { 'line-color': occColor('faint'), 'line-width': 1, 'line-dasharray': [4, 3] },
      }),
      qaLayer(stands, 'occ-lab-qa-outline', 'line', ['all', kindIs('standArea'), isNot('flagged'), isNot('retired')], {
        layout: ROUND,
        paint: { 'line-color': occColor('text'), 'line-width': 1.5 },
      }),
      qaLayer(stands, 'occ-lab-qa-outline-flagged', 'line', ['all', kindIs('standArea'), is('flagged')], {
        paint: { 'line-color': occColor('warn'), 'line-width': 2, 'line-dasharray': [3, 2] },
      }),
      qaLayer(stands, 'occ-lab-qa-outline-retired', 'line', ['all', kindIs('standArea'), is('retired')], {
        paint: { 'line-color': occColor('faint'), 'line-width': 1, 'line-dasharray': [1, 2] },
      }),
      qaLayer(stands, 'occ-lab-qa-outline-focus', 'line', ['all', kindIs('standArea'), is('focused')], {
        layout: ROUND,
        paint: { 'line-color': occColor('accent'), 'line-width': 3 },
      }),
      qaLayer(stands, 'occ-lab-qa-mismatch', 'line', kindIs('mismatch'), {
        paint: { 'line-color': occColor('muted'), 'line-width': 1.5, 'line-dasharray': [2, 2] },
      }),
      qaLayer(stands, 'occ-lab-qa-arrow', 'line', kindIs('standArrow'), {
        layout: ROUND,
        paint: { 'line-color': ['case', is('flagged'), occColor('warn'), occColor('text')], 'line-width': 2 },
      }),
      qaLayer(stands, 'occ-lab-qa-route', 'line', kindIs('route'), {
        layout: ROUND,
        paint: { 'line-color': occColor('accent'), 'line-width': 4 },
      }),
      qaLayer(stands, 'occ-lab-qa-gate', 'circle', kindIs('gate'), {
        paint: {
          'circle-radius': 4,
          'circle-opacity': 0,
          'circle-stroke-color': occColor('muted'),
          'circle-stroke-width': 1.5,
        },
      }),
      qaLayer(stands, 'occ-lab-qa-node', 'circle', kindIs('node'), {
        paint: {
          'circle-radius': ['match', ['get', 'reach'], 'cut', 4.5, ['match', ['get', 'nodeKind'], 'exit', 3.5, 2.5]],
          'circle-color': reachColour(['match', ['get', 'nodeKind'], 'exit', occColor('text'), occColor('line-strong')]),
          'circle-stroke-color': occColor('nav'),
          'circle-stroke-width': 1,
        },
        pickId: 'id',
      }),
      qaLayer(stands, 'occ-lab-qa-hold', 'circle', kindIs('hold'), {
        paint: {
          'circle-radius': 5.5,
          'circle-color': occColor('nav'),
          'circle-stroke-color': reachColour(occColor('text')),
          'circle-stroke-width': 2,
        },
        pickId: 'node',
      }),
      qaLayer(stands, 'occ-lab-qa-apron-hold', 'circle', kindIs('apronHold'), {
        paint: {
          'circle-radius': 8,
          'circle-color': occColor('nav'),
          'circle-stroke-color': reachColour(occColor('text')),
          'circle-stroke-width': 2.5,
        },
        pickId: 'node',
      }),
      qaLayer(stands, 'occ-lab-qa-point', 'circle', kindIs('elevantPoint'), {
        paint: {
          'circle-radius': ['case', is('retired'), 3, 4.5],
          'circle-color': ['case', is('retired'), occColor('faint'), is('flagged'), occColor('warn'), occColor('text')],
          'circle-stroke-color': occColor('nav'),
          'circle-stroke-width': 1.5,
        },
        pickId: 'node',
      }),
      qaLayer(stands, 'occ-lab-qa-probe', 'circle', kindIs('probeEnd'), {
        paint: {
          'circle-radius': 9,
          'circle-opacity': 0,
          'circle-stroke-color': occColor('accent'),
          'circle-stroke-width': 2.5,
        },
      }),
      // MapLibre places the labels of the upper layers first: the apron holds give way to the gates and the gates to the
      // stand codes; among the codes a flagged one goes first, since it is the one a person has to find. Up close every
      // code has room; over the whole airfield the ones that would cover another give way.
      qaLayer(labels, 'occ-lab-qa-apron-hold-label', 'symbol', kindIs('apronHold'), {
        layout: {
          'text-field': ['get', 'label'],
          'text-font': fonts('regular'),
          'text-size': LABEL_SIZE,
          'text-anchor': 'top',
          'text-offset': [0, 1],
        },
        paint: labelPaint(occColor('muted')),
      }),
      qaLayer(labels, 'occ-lab-qa-gate-ref', 'symbol', kindIs('gate'), {
        layout: {
          'text-field': ['get', 'ref'],
          'text-font': fonts('regular'),
          'text-size': LABEL_SIZE,
          'text-anchor': 'left',
          'text-offset': [0.7, 0],
        },
        paint: labelPaint(occColor('faint')),
      }),
      qaLayer(labels, 'occ-lab-qa-code', 'symbol', kindIs('standCode'), {
        layout: {
          'text-field': ['get', 'label'],
          'text-font': fonts('bold'),
          'text-size': 13,
          'symbol-sort-key': ['case', is('flagged'), 0, 1],
        },
        paint: labelPaint(['case', is('retired'), occColor('faint'), is('flagged'), occColor('warn'), occColor('text')]),
      }),
    ],
  };
}

/** The ids of the review layers, in drawing order. */
export const QA_LAYER_IDS = Object.freeze(qaOverlay().layers.map(layer => layer.id));
