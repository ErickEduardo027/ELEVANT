import { Color, createPropertyExpression, featureFilter, latest, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { MAP_IMAGE_IDS, MAP_IMAGE_SHAPES } from '../style/mapImages';
import { SLOT_ORDER, buildOccStyle } from '../style/occStyle';
import { selectionOverlay } from '../style/selectionLayers';
import { createAirPicture, createEstimates, createMapFlights, TRAFFIC_NOON } from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';
import { ROUTE_SOURCE, TRAFFIC_SOURCE, TRAILS_SOURCE, trafficFeatures } from './trafficFeatures';
import { TRAFFIC_GROUPS, TRAFFIC_LAYER_IDS, trafficOverlay } from './trafficLayers';

const NOON = Date.parse(TRAFFIC_NOON);

function evaluate(layer, kind, name, properties, zoom = 10) {
  const spec = latest[`${kind}_${layer.type}`][name];
  const parsed = createPropertyExpression(layer[kind][name], `layers.${layer.id}.${kind}.${name}`, spec);
  if (parsed.result !== 'success') throw new Error(`${layer.id} ${name}: ${JSON.stringify(parsed.value)}`);
  return parsed.value.evaluate({ zoom }, { type: 1, properties });
}

const accepts = (layer, properties) => featureFilter(layer.filter, `layers.${layer.id}.filter`)
  .filter({ zoom: 14 }, { type: 1, properties });
const layerOf = id => trafficOverlay().layers.find(layer => layer.id === id);
// One spelling for a colour, whether the style writes it (#rrggbb) or an expression answers it (a Color).
const hex = colour => (colour instanceof Color ? colour : Color.parse(colour)).toString();

// The features of the synthetic picture at noon (traffic/trafficFeatures.js), with the demo arrival estimated.
function noonFeatures(options) {
  const situation = buildSituation({ picture: toPictureModel(createAirPicture()), flights: toFlightsModel(createMapFlights()),
    nowMs: NOON, estimates: createEstimates() });
  return trafficFeatures(situation.aircraft, options).features.map(feature => feature.properties);
}

// Every image a layer names, from its icon-image and the images of its formatted text.
function imagesOf(layer) {
  const names = [];
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value[0] === 'image') {
      const name = value[1];
      if (typeof name === 'string') names.push(name);
      else if (Array.isArray(name) && name[0] === 'case') names.push(...name.filter(item => typeof item === 'string' && item.includes('-')));
    }
    value.forEach(visit);
  };
  const icon = layer.layout?.['icon-image'];
  if (typeof icon === 'string') names.push(icon);
  visit(layer.layout?.['text-field']);
  return names;
}

describe('traffic layers (design E1 and E3)', () => {
  it('every layer names its slot and group and the style validates with validateStyleMin', () => {
    const overlay = trafficOverlay();
    expect(overlay.sources).toEqual({
      [TRAFFIC_SOURCE]: { type: 'geojson', promoteId: 'id' },
      [TRAILS_SOURCE]: { type: 'geojson', lineMetrics: true },
      [ROUTE_SOURCE]: { type: 'geojson' },
    });
    for (const layer of overlay.layers) {
      expect(SLOT_ORDER, layer.id).toContain(layer.slot);
      expect(typeof layer.metadata['occ:group'], layer.id).toBe('string');
      expect([TRAFFIC_SOURCE, TRAILS_SOURCE, ROUTE_SOURCE], layer.id).toContain(layer.source);
    }
    for (const basemap of [false, true]) {
      const style = buildOccStyle({ basemap, overlays: [overlay] });
      expect(validateStyleMin(style), String(basemap)).toEqual([]);
      // The route under the stands' labels, the traffic above every other slot but the selection.
      const ids = style.layers.map(layer => layer.id);
      const slotOf = id => style.layers.find(layer => layer.id === id).metadata['occ:slot'];
      expect(TRAFFIC_LAYER_IDS.map(slotOf)).toEqual([
        'routes', 'routes', 'traffic', 'traffic', 'traffic', 'traffic', 'traffic', 'traffic', 'traffic', 'traffic',
        'traffic', 'traffic', 'selection', 'selection',
      ]);
      // MapLibre places from the top layer down: the plate, the ELEVANT tags (above every aircraft), the ELEVANT icons,
      // the optional tags of all other traffic (before their own icons, which they must never meet in the collision
      // index), then other traffic, whose icon and forced tag share a symbol.
      const order = id => ids.indexOf(id);
      expect(order('occ-traffic-other-ground')).toBeLessThan(order('occ-traffic-other'));
      expect(order('occ-traffic-other')).toBeLessThan(order('occ-traffic-tags-other'));
      expect(order('occ-traffic-tags-other')).toBeLessThan(order('occ-traffic-aviam'));
      expect(order('occ-traffic-aviam')).toBeLessThan(order('occ-traffic-tags'));
      expect(order('occ-traffic-tags')).toBeLessThan(order('occ-traffic-demo-plate'));
      expect(order('occ-trails-live')).toBeLessThan(order('occ-traffic-other-ground'));
      for (const id of ['occ-traffic-other', 'occ-traffic-other-ground']) {
        const { layout } = style.layers.find(layer => layer.id === id);
        expect(layout, id).toMatchObject({ 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'text-allow-overlap': true });
        expect(layout['text-field'], id).toBeDefined();
      }
      // The ELEVANT icons alone (MapLibre does not draw icons beside text with images), their tags apart.
      expect(style.layers.find(layer => layer.id === 'occ-traffic-aviam').layout['text-field']).toBeUndefined();
      expect(style.layers.find(layer => layer.id === 'occ-traffic-tags').layout['icon-image']).toBeUndefined();
    }
    // The groups of the layers menu, and what starts hidden: the labels and trails of all the traffic.
    const groupOf = id => layerOf(id).metadata['occ:group'];
    expect(['occ-traffic-aviam', 'occ-traffic-tags', 'occ-trails-live', 'occ-trails-estimated', 'occ-traffic-estimated-ring',
      'occ-traffic-demo-plate'].map(groupOf)).toEqual(Array(6).fill(TRAFFIC_GROUPS.aviam));
    expect(['occ-traffic-other', 'occ-traffic-other-ground'].map(groupOf)).toEqual([TRAFFIC_GROUPS.other, TRAFFIC_GROUPS.other]);
    expect([groupOf('occ-traffic-tags-other'), groupOf('occ-trails-other'), groupOf('occ-route-next')])
      .toEqual(['traffic.labels', 'traffic.trails', 'route']);
    expect(overlay.layers.filter(layer => layer.layout?.visibility === 'none').map(layer => layer.id))
      .toEqual(['occ-trails-other', 'occ-traffic-tags-other']);
    // What a click picks: an ELEVANT flight by its key, any other aircraft by its address.
    expect(layerOf('occ-traffic-aviam').metadata).toMatchObject({ 'occ:pick': 'flight', 'occ:pickId': 'flightKey' });
    expect(layerOf('occ-traffic-other').metadata).toMatchObject({ 'occ:pick': 'aircraft', 'occ:pickId': 'hex' });
    // Other traffic on the ground from the airfield threshold up (contracts 2.3: derived, not fixed).
    expect(layerOf('occ-traffic-other-ground').metadata['occ:minThreshold']).toBe('airfield');
    // The trail fades toward its tail on the line's own metrics; the estimated one is dashed.
    expect(layerOf('occ-trails-live').paint['line-gradient'][2]).toEqual(['line-progress']);
    expect(layerOf('occ-trails-estimated').paint['line-dasharray']).toEqual([2, 2]);
    // Every image the layers name is drawn by style/mapImages.js.
    const images = overlay.layers.flatMap(imagesOf);
    expect(images).toEqual(expect.arrayContaining(['traffic-ring-est', 'plate-demo', 'glyph-arrival', 'glyph-departure',
      'glyph-arrow-right']));
    for (const image of images) expect(MAP_IMAGE_IDS, image).toContain(image);
    // The images inside a tag are plain: MapLibre draws them as they are.
    for (const glyph of ['glyph-arrival', 'glyph-departure', 'glyph-arrow-right']) expect(MAP_IMAGE_SHAPES[glyph].sdf).toBe(false);
  });

  it('only the selected aircraft is cyan', () => {
    const accent = hex(occColor('accent'));
    const features = noonFeatures({ selection: { kind: 'aircraft', id: 'f0a002' } });
    // The SDF icons take the colour of their layer; the «Demo» plate is a plain image in its own two greys.
    const iconLayers = trafficOverlay().layers.filter(layer => layer.paint?.['icon-color'] !== undefined);
    const colours = new Map();
    for (const properties of features) {
      for (const layer of iconLayers) {
        if (!accepts(layer, properties)) continue;
        const colour = hex(evaluate(layer, 'paint', 'icon-color', properties));
        colours.set(`${properties.id} ${layer.id}`, colour);
        if (colour === accent) expect(properties.selected, `${properties.id} in ${layer.id}`).toBe(true);
      }
    }
    // The chosen aircraft is drawn in cyan, on top, at 1.4×; nothing else is.
    const cyan = [...colours].filter(([, colour]) => colour === accent).map(([key]) => key);
    expect(cyan).toEqual(['h:f0a002 occ-traffic-selected']);
    expect(evaluate(layerOf('occ-traffic-selected'), 'layout', 'icon-size', features.find(item => item.selected))).toBe(1.4);
    // Its ring is the selection's own (style/selectionLayers.js), around the chosen aircraft alone and under its cyan
    // silhouette, read from the aircraft's feature: it moves in the same write. Drawn, never picked.
    const ring = layerOf('occ-traffic-selected-ring');
    expect(ring).toMatchObject({ slot: 'selection', type: 'circle', source: TRAFFIC_SOURCE, metadata: { 'occ:group': 'selection' } });
    expect(ring.paint).toEqual(selectionOverlay().layers.find(layer => layer.id === 'occ-selection-ring').paint);
    expect(features.filter(properties => accepts(ring, properties)).map(properties => properties.id)).toEqual(['h:f0a002']);
    expect(noonFeatures().filter(properties => accepts(ring, properties))).toEqual([]);
    expect(TRAFFIC_LAYER_IDS.slice(-2)).toEqual(['occ-traffic-selected-ring', 'occ-traffic-selected']);
    expect(ring.metadata['occ:pick']).toBeUndefined();
    // Without a selection there is no cyan at all: normal traffic carries no hue.
    for (const properties of noonFeatures()) {
      for (const layer of iconLayers) {
        if (accepts(layer, properties)) expect(hex(evaluate(layer, 'paint', 'icon-color', properties)), layer.id).not.toBe(accent);
      }
    }
    // ELEVANT flights in the text colour, the rest faint; tags the same, never amber or red.
    expect(hex(layerOf('occ-traffic-aviam').paint['icon-color'])).toBe(hex(occColor('text')));
    expect(hex(layerOf('occ-traffic-other').paint['icon-color'])).toBe(hex(occColor('faint')));
    const paints = JSON.stringify(trafficOverlay().layers.filter(layer => !layer.id.startsWith('occ-route')
      && !['occ-traffic-selected', 'occ-traffic-selected-ring'].includes(layer.id)).map(layer => layer.paint));
    for (const token of ['accent', 'warn', 'danger']) expect(paints, token).not.toContain(occColor(token));
  });

  it('dims a stale position, rings an estimated one and plates a demo flight, from the feature flags', () => {
    const features = noonFeatures();
    const of = id => features.find(item => item.id === id);
    const stale = features.find(item => item.stale);
    const demo = features.find(item => item.demo);
    const live = features.find(item => item.kind === 'aviam' && item.quality === 'live');
    expect(evaluate(layerOf('occ-traffic-other'), 'paint', 'icon-opacity', stale)).toBe(0.5);
    expect(evaluate(layerOf('occ-traffic-aviam'), 'paint', 'icon-opacity', live)).toBe(1);
    expect(evaluate(layerOf('occ-traffic-other'), 'paint', 'text-opacity', { ...stale, forceTag: true })).toBe(0.5);
    expect(accepts(layerOf('occ-traffic-estimated-ring'), demo)).toBe(true);
    expect(accepts(layerOf('occ-traffic-estimated-ring'), live)).toBe(false);
    expect(accepts(layerOf('occ-traffic-demo-plate'), demo)).toBe(true);
    expect(accepts(layerOf('occ-traffic-demo-plate'), live)).toBe(false);
    expect(layerOf('occ-traffic-demo-plate').layout['text-field']).toBe('Demo');
    // The plate sits below the silhouette, further for a larger one; its word is centred on it.
    const plateAt = radius => evaluate(layerOf('occ-traffic-demo-plate'), 'layout', 'icon-offset', { ...demo, radius });
    expect(plateAt(10)[1]).toBeLessThan(plateAt(17.5)[1]);
    expect(plateAt(10)[1]).toBeGreaterThan(10 + 8);
    const word = evaluate(layerOf('occ-traffic-demo-plate'), 'layout', 'text-offset', demo);
    expect(word[1] * 11).toBeCloseTo(evaluate(layerOf('occ-traffic-demo-plate'), 'layout', 'icon-offset', demo)[1], 1);
    // The tags: an ELEVANT arrival with its stand, a departure without, other traffic only when forced (chosen or under
    // the pointer), or in the layer of all the labels while that is on.
    const aviam = layerOf('occ-traffic-tags');
    const other = layerOf('occ-traffic-other');
    expect(accepts(aviam, of(live.id))).toBe(true);
    expect(accepts(other, stale)).toBe(true);
    expect(accepts(layerOf('occ-traffic-tags-other'), stale)).toBe(true);
    expect(accepts(layerOf('occ-traffic-tags-other'), { ...stale, forceTag: true })).toBe(false);
    const sections = (layer, properties) => evaluate(layer, 'layout', 'text-field', properties).sections
      .map(section => section.image?.name ?? section.text);
    expect(sections(aviam, live)).toEqual(['glyph-arrival', ' ', 'ZZ161', '', '\n', 'B38M 026 150', '  ', 'glyph-arrow-right', ' ',
      'A5']);
    expect(sections(aviam, { ...live, dir: 'dep', tagStand: '' })).toEqual(['glyph-departure', ' ', 'ZZ161', '', '\n',
      'B38M 026 150']);
    expect(sections(aviam, demo)).toEqual(['glyph-arrival', ' ', 'ZZ9001', ' est.', '\n', 'A320 019 140']);
    expect(sections(other, { ...stale, forceTag: true })).toEqual(['ZZZ612', ' Sin actualizar desde las 10:59', '\n',
      'AT76 050 210']);
    expect(sections(other, stale)).toEqual(['']);
    // The forced tag of other traffic is placed after the rest of its layer, and so drawn above it.
    expect(evaluate(other, 'layout', 'symbol-sort-key', { ...stale, forceTag: true }))
      .toBeGreaterThan(evaluate(other, 'layout', 'symbol-sort-key', stale));
  });
});
