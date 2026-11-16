import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { REGION_CONTEXT } from '../airport/regionContext';
import { AIRFIELD_ATTRIBUTION, OURAIRPORTS_ATTRIBUTION } from '../core/attribution';
import { PUJ_ARP } from '../core/cameraPresets';
import { airfieldOverlay } from './airfieldLayers';
import { HOME_AIRPORT_IATA, OWN_AIRPORT_IATAS, basemapLayers } from './basemapLayers';
import { MAP_COLORS } from './mapColors';
import { MAP_IMAGE_IDS, MAP_IMAGE_SHAPES, isSdfImage } from './mapImages';
import { FONT_STACKS, THRESHOLD_NAMES, buildOccStyle } from './occStyle';
import { NAVAID_IMAGES, REFERENCE_IMAGE_SHAPES } from './referenceImages';
import {
  AIRPORTS_GROUP, NIGHT_SOURCE, OURAIRPORTS_SOURCE, REFERENCE_GROUPS, REFERENCE_LAYER_IDS, REFERENCE_SOURCE, airportKind,
  airportLabel, ourAirportsFeatures, referenceFeatures, referenceLayersShown, referenceOverlay,
} from './referenceLayers';
import { regionAirportFeatures } from '../traffic/referenceFeatures';

const layerOf = id => referenceOverlay().layers.find(layer => layer.id === id);
// Every colour a layer paints, from its paint values and the branches of their expressions.
function paintColours(layer) {
  const colours = [];
  const walk = value => {
    if (typeof value === 'string' && /^(#|rgb)/.test(value)) colours.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  Object.entries(layer.paint ?? {}).filter(([name]) => name.endsWith('color')).forEach(([, value]) => walk(value));
  return colours;
}
// The points a path of absolute M, L, H, V and Z commands passes through.
function pathPoints(path) {
  const points = [];
  let current = [0, 0];
  for (const [, command, args] of path.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const values = args.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (command === 'Z') continue;
    if (command === 'H') current = [values[0], current[1]];
    else if (command === 'V') current = [current[0], values[0]];
    else current = [values[0], values[1]];
    points.push(current);
  }
  return points;
}
// The dots of a path drawn as two half arcs each (style/referenceImages.js): their centre and radius.
const dotsOf = path => [...path.matchAll(/M(-?[\d.]+) (-?[\d.]+) A([\d.]+) [\d.]+ 0 1 1 (-?[\d.]+) -?[\d.]+/g)]
  .map(([, right, y, radius, left]) => ({ x: (Number(right) + Number(left)) / 2, y: Number(y), r: Number(radius) }));

describe('reference layers', () => {
  it('draw the ARP of PUJ with its label up to the codes threshold, in place of the airport marker', () => {
    const layer = layerOf('occ-reference-arp');
    expect(layer).toMatchObject({ slot: 'airfield', type: 'symbol', source: REFERENCE_SOURCE });
    expect(layer.layout).toMatchObject({ 'icon-image': 'airport-arp', 'text-font': [...FONT_STACKS.bold], 'text-field': ['get', 'label'] });
    // The label sits above the mark, clear of the stands south of the reference point.
    expect(layer.layout).toMatchObject({ 'text-anchor': 'bottom', 'text-offset': [0, -0.9], 'text-optional': true });
    expect(MAP_IMAGE_IDS).toContain(layer.layout['icon-image']);
    expect(layer.metadata).toEqual({ 'occ:group': 'reference', 'occ:maxThreshold': 'codes' });
    expect([layer.paint['icon-color'], layer.paint['text-color']]).toEqual([occColor('text'), occColor('text')]);
    // The first feature of the reference source, at the reference point of PUJ.
    expect(referenceFeatures().features[0]).toEqual({
      type: 'Feature', properties: { kind: 'arp', label: 'PUJ' }, geometry: { type: 'Point', coordinates: [...PUJ_ARP] },
    });
    expect(PUJ_ARP).toEqual([-68.3634, 18.5674]);
    const style = buildOccStyle({ overlays: [referenceOverlay()] });
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('draws the mark above the pavement and the base-map labels, so neither hides the airport', () => {
    const ids = buildOccStyle({ overlays: [referenceOverlay()] }).layers.map(layer => layer.id);
    const arp = ids.indexOf('occ-reference-arp');
    // MapLibre draws later layers on top and places their symbols first.
    for (const id of ['airfield-runway', 'airfield-taxiway', 'airfield-apron', 'airfield-runway-ref', 'base-label-city',
      'base-label-aerodrome']) {
      expect(arp, id).toBeGreaterThan(ids.indexOf(id));
    }
    expect(arp).toBeLessThan(ids.indexOf('slot-stands'));
  });

  it('leaves the tile labels of the home airport and of the region\'s airports out of the base map, so each is written once', () => {
    const aerodrome = basemapLayers().baseLabels.find(layer => layer.id === 'base-label-aerodrome');
    const shows = iata => featureFilter(aerodrome.filter, 'layers.base-label-aerodrome.filter')
      .filter({ zoom: 9 }, { type: 1, properties: iata === null ? {} : { iata } });
    expect(HOME_AIRPORT_IATA).toBe(referenceFeatures().features[0].properties.label);
    // PUJ, Santo Domingo, La Romana and San Juan are drawn by the references; Miami, outside the region, by the tiles.
    expect([shows('PUJ'), shows('SDQ'), shows('LRM'), shows('SJU'), shows('MIA'), shows(null)])
      .toEqual([false, false, false, false, true, false]);
    const regionIatas = REGION_CONTEXT.airports.map(airport => airport.iata).filter(Boolean);
    expect([...OWN_AIRPORT_IATAS].sort()).toEqual([...new Set([HOME_AIRPORT_IATA, ...regionIatas])].sort());
    expect(validateStyleMin(buildOccStyle())).toEqual([]);
  });

  it('draws each reference in its group with its derived thresholds, in the reference and shade slots', () => {
    const overlay = referenceOverlay();
    expect(Object.keys(overlay.sources)).toEqual([REFERENCE_SOURCE, OURAIRPORTS_SOURCE, NIGHT_SOURCE]);
    expect(Object.values(overlay.sources)).toEqual([{ type: 'geojson' }, { type: 'geojson', attribution: OURAIRPORTS_ATTRIBUTION },
      { type: 'geojson' }]);
    const summary = overlay.layers.map(layer => [layer.id, layer.slot, layer.type, layer.source, layer.metadata]);
    expect(summary).toEqual([
      ['occ-region-airports', 'airfield', 'circle', OURAIRPORTS_SOURCE, { 'occ:group': 'reference.airports', 'occ:maxThreshold': 'airfield' }],
      ['occ-region-airport-labels', 'airfield', 'symbol', OURAIRPORTS_SOURCE, { 'occ:group': 'reference.airports', 'occ:maxThreshold': 'airfield' }],
      ['occ-reference-arp', 'airfield', 'symbol', REFERENCE_SOURCE, { 'occ:group': 'reference', 'occ:maxThreshold': 'codes' }],
      ['occ-reference-rings-region', 'reference', 'line', REFERENCE_SOURCE, { 'occ:group': 'rings', 'occ:maxThreshold': 'approach' }],
      ['occ-reference-ring-labels-region', 'reference', 'symbol', REFERENCE_SOURCE, { 'occ:group': 'rings', 'occ:maxThreshold': 'approach' }],
      ['occ-reference-rings-approach', 'reference', 'line', REFERENCE_SOURCE,
        { 'occ:group': 'rings', 'occ:minThreshold': 'approach', 'occ:maxThreshold': 'airfield' }],
      ['occ-reference-ring-labels-approach', 'reference', 'symbol', REFERENCE_SOURCE,
        { 'occ:group': 'rings', 'occ:minThreshold': 'approach', 'occ:maxThreshold': 'airfield' }],
      ['occ-reference-centrelines', 'reference', 'line', OURAIRPORTS_SOURCE, { 'occ:group': 'centrelines' }],
      ['occ-reference-centreline-ticks', 'reference', 'line', OURAIRPORTS_SOURCE, { 'occ:group': 'centrelines', 'occ:minThreshold': 'approach' }],
      ['occ-reference-centreline-label', 'reference', 'symbol', OURAIRPORTS_SOURCE, { 'occ:group': 'centrelines' }],
      ['occ-reference-navaids', 'reference', 'symbol', OURAIRPORTS_SOURCE,
        { 'occ:group': 'navaids', 'occ:minThreshold': 'approach', 'occ:maxThreshold': 'polygons' }],
      ['occ-night', 'shade', 'fill', NIGHT_SOURCE, { 'occ:group': 'daynight', 'occ:maxThreshold': 'airfield' }],
      ['occ-night-edge', 'shade', 'line', NIGHT_SOURCE, { 'occ:group': 'daynight', 'occ:maxThreshold': 'airfield' }],
      ['occ-night-label', 'shade', 'symbol', NIGHT_SOURCE, { 'occ:group': 'daynight', 'occ:maxThreshold': 'airfield' }],
    ]);
    // Every group is a key of the layers menu, and every threshold is one the map derives.
    expect(Object.values(REFERENCE_GROUPS)).toEqual(['rings', 'centrelines', 'reference.airports', 'navaids', 'daynight']);
    for (const layer of overlay.layers) {
      for (const key of ['occ:minThreshold', 'occ:maxThreshold']) {
        if (layer.metadata[key]) expect(THRESHOLD_NAMES, layer.id).toContain(layer.metadata[key]);
      }
    }
    // The night lies right above the land and the sea, under every reference and the base-map labels.
    const ids = buildOccStyle({ overlays: [overlay] }).layers.map(layer => layer.id);
    expect(ids.indexOf('occ-night')).toBeGreaterThan(ids.indexOf('slot-shade'));
    expect(ids.indexOf('occ-night-edge')).toBeLessThan(ids.indexOf('slot-weather'));
    expect(ids.indexOf('occ-reference-rings-region')).toBeGreaterThan(ids.indexOf('slot-reference'));
    expect(ids.indexOf('occ-reference-navaids')).toBeLessThan(ids.indexOf('slot-baseLabels'));
    // The region's airports are placed after the base-map labels, under the mark of PUJ.
    expect(ids.indexOf('occ-region-airport-labels')).toBeGreaterThan(ids.indexOf('slot-airfield'));
    expect(ids.indexOf('occ-region-airport-labels')).toBeLessThan(ids.indexOf('occ-reference-arp'));
    // The runway in use is named on one line, and the navaids' words try the four sides of their mark.
    expect(layerOf('occ-reference-centreline-label').layout['text-max-width']).toBe(30);
    expect(layerOf('occ-reference-navaids').layout['text-variable-anchor']).toEqual(['left', 'right', 'top', 'bottom']);
    // The layers the legend reads back, without the labels, the edge line and the mark of PUJ.
    expect(REFERENCE_LAYER_IDS).toEqual(['occ-region-airports', 'occ-reference-rings-region', 'occ-reference-rings-approach',
      'occ-reference-centrelines', 'occ-reference-centreline-ticks', 'occ-reference-navaids', 'occ-night']);
    expect(referenceLayersShown({ rings: true, centrelines: false, 'reference.airports': true, navaids: false, daynight: false }))
      .toEqual(['occ-region-airports', 'occ-reference-rings-region', 'occ-reference-rings-approach']);
    expect(referenceLayersShown({})).toEqual(REFERENCE_LAYER_IDS);
  });

  it('credits OurAirports on the source of what is drawn from its data, so the credit shows only while that is drawn', () => {
    const overlay = referenceOverlay();
    // The source of the centrelines, the airports and the navaids carries the credit; the others carry none.
    expect(overlay.sources[OURAIRPORTS_SOURCE].attribution).toBe(OURAIRPORTS_ATTRIBUTION);
    expect(overlay.sources[REFERENCE_SOURCE].attribution).toBeUndefined();
    expect(overlay.sources[NIGHT_SOURCE].attribution).toBeUndefined();
    expect(OURAIRPORTS_ATTRIBUTION).toBe('<a href="https://ourairports.com/" target="_blank" rel="noopener noreferrer">OurAirports</a>');
    // The airfield credit ends with the same text: with both on screen, MapLibre drops the shorter one and shows it once.
    expect(AIRFIELD_ATTRIBUTION.endsWith(` · ${OURAIRPORTS_ATTRIBUTION}`)).toBe(true);
    // Every layer draws only data of its own source: what comes from OurAirports never from the reference source, and
    // the reference point and the rings never from the OurAirports one. Each draws something of its source.
    const data = { [REFERENCE_SOURCE]: referenceFeatures(), [OURAIRPORTS_SOURCE]: ourAirportsFeatures({ counterparts: ['SDQ'] }) };
    const drawnBy = (layer, collection) => collection.features.filter(item => featureFilter(layer.filter, `layers.${layer.id}.filter`)
      .filter({ zoom: 10 }, { type: item.geometry.type === 'Point' ? 1 : 2, properties: item.properties }));
    for (const layer of overlay.layers.filter(item => item.source !== NIGHT_SOURCE)) {
      const other = layer.source === REFERENCE_SOURCE ? OURAIRPORTS_SOURCE : REFERENCE_SOURCE;
      expect(drawnBy(layer, data[layer.source]).length, layer.id).toBeGreaterThan(0);
      expect(drawnBy(layer, data[other]), layer.id).toEqual([]);
    }
    expect(overlay.layers.filter(layer => layer.source === OURAIRPORTS_SOURCE).map(layer => layer.id)).toEqual([
      'occ-region-airports', 'occ-region-airport-labels', 'occ-reference-centrelines', 'occ-reference-centreline-ticks',
      'occ-reference-centreline-label', 'occ-reference-navaids',
    ]);
    // A style with the airfield and the references is valid, each source once.
    expect(validateStyleMin(buildOccStyle({ overlays: [airfieldOverlay(), overlay] }))).toEqual([]);
  });

  it('stays quiet: thin lines and dim words in the neutral tokens, the runway in use the one line drawn wider', () => {
    const neutral = new Set(['nav', 'line', 'line-strong', 'faint', 'muted', 'text'].map(token => occColor(token)));
    const hues = new Set(['accent', 'warn', 'danger'].map(token => occColor(token)));
    // The region's airports keep the colours by kind of style/mapColors.js (owner request): tested below.
    for (const layer of referenceOverlay().layers.filter(item => item.metadata['occ:group'] !== AIRPORTS_GROUP)) {
      for (const colour of paintColours(layer)) {
        expect(neutral.has(colour), `${layer.id} ${colour}`).toBe(true);
        expect(hues.has(colour), `${layer.id} ${colour}`).toBe(false);
        expect(Object.values(OCC_PALETTE), `${layer.id} ${colour}`).toContain(colour);
      }
      // No line is wider than 1.5 px.
      const width = layer.paint['line-width'];
      if (width !== undefined) {
        const widths = Array.isArray(width) ? width.filter(value => typeof value === 'number') : [width];
        expect(Math.max(...widths), layer.id).toBeLessThanOrEqual(1.5);
      }
    }
    // The runway in use is wider and in the text colour; every other end thin in line-strong.
    const centrelines = layerOf('occ-reference-centrelines');
    expect(centrelines.paint['line-color']).toEqual(['case', ['==', ['get', 'inUse'], true], occColor('text'), occColor('line-strong')]);
    expect(centrelines.paint['line-width']).toEqual(['case', ['==', ['get', 'inUse'], true], 1.5, 1]);
    // The night darkens the map a little and draws its edge as a thin line.
    expect(layerOf('occ-night').paint).toEqual({ 'fill-color': occColor('nav'), 'fill-opacity': 0.45 });
    expect(layerOf('occ-night-edge').paint).toEqual({ 'line-color': occColor('line'), 'line-width': 1 });
    // Over the sea the shade barely darkens the map: its word, on the night side of the edge, says where the night is.
    expect(layerOf('occ-night-label')).toMatchObject({ filter: ['match', ['get', 'kind'], ['nightLabel'], true, false],
      layout: { 'text-field': ['get', 'label'] }, paint: { 'text-color': occColor('faint') } });
    // Every word in the three stacks the glyph server has, at the 12 px floor of the OCC.
    for (const layer of referenceOverlay().layers.filter(item => item.layout?.['text-field'])) {
      expect(Object.values(FONT_STACKS).map(stack => stack.join())).toContain(layer.layout['text-font'].join());
      const size = layer.layout['text-size'];
      const sizes = Array.isArray(size) ? size.flat(Infinity).filter(Number.isFinite).filter(value => value > 1) : [size];
      expect(Math.min(...sizes), layer.id).toBeGreaterThanOrEqual(12);
    }
  });

  it('gives the navaids their chart symbols, SDF icons that keep 3 px clear of their border', () => {
    expect(NAVAID_IMAGES).toEqual({ 'VOR-DME': 'navaid-vor-dme', NDB: 'navaid-ndb' });
    const navaids = layerOf('occ-reference-navaids');
    expect(navaids.layout['icon-image']).toEqual(['match', ['get', 'type'], 'NDB', 'navaid-ndb', 'navaid-vor-dme']);
    // Their symbols are always drawn, under the mark of PUJ; their words only where there is room.
    expect(navaids.layout).toMatchObject({ 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'text-optional': true });
    for (const id of Object.values(NAVAID_IMAGES)) {
      expect(MAP_IMAGE_IDS, id).toContain(id);
      expect(isSdfImage(id), id).toBe(true);
      expect(MAP_IMAGE_SHAPES[id]).toBe(REFERENCE_IMAGE_SHAPES[id]);
      const { width, height, ops } = REFERENCE_IMAGE_SHAPES[id];
      for (const op of ops) {
        // A line keeps half its width clear; a dot its radius.
        if (op.stroke !== undefined) {
          for (const [x, y] of pathPoints(op.stroke)) {
            expect(Math.min(x, width - x) - op.lineWidth / 2, `${id} x ${x}`).toBeGreaterThanOrEqual(2.99);
            expect(Math.min(y, height - y) - op.lineWidth / 2, `${id} y ${y}`).toBeGreaterThanOrEqual(2.99);
          }
          continue;
        }
        const dots = dotsOf(op.fill);
        expect(dots.length, id).toBeGreaterThan(0);
        for (const { x, y, r } of dots) {
          expect(Math.min(x, width - x) - r, `${id} dot x ${x}`).toBeGreaterThanOrEqual(2.99);
          expect(Math.min(y, height - y) - r, `${id} dot y ${y}`).toBeGreaterThanOrEqual(2.99);
        }
      }
    }
    // The VOR-DME is a square, a hexagon and a dot; the NDB a ring of ten dots and one in the middle.
    expect(REFERENCE_IMAGE_SHAPES['navaid-vor-dme'].ops.map(op => (op.stroke ? 'stroke' : 'fill')))
      .toEqual(['stroke', 'stroke', 'fill']);
    expect(dotsOf(REFERENCE_IMAGE_SHAPES['navaid-ndb'].ops[0].fill)).toHaveLength(10);
  });

  it('the airports of the region: 32 dots coloured by kind with a yellow ICAO/IATA label, below the airfield threshold', () => {
    const airports = regionAirportFeatures();
    expect(airports).toHaveLength(32);
    expect(ourAirportsFeatures().features.filter(feature => feature.properties.kind === 'airport')).toHaveLength(32);
    const home = airports.filter(feature => feature.properties.airportKind === 'home');
    expect(home.map(feature => feature.properties.label)).toEqual(['MDPC']);
    const kinds = new Set(airports.map(feature => feature.properties.airportKind));
    expect([...kinds].sort()).toEqual(['home', 'international', 'other', 'regional']);
    expect(airportKind({ icao: 'MDLR', type: 'large_airport' })).toBe('international');
    expect(airportKind({ icao: 'TJBQ', iata: 'BQN', type: 'medium_airport', name: 'Rafael Hernández' })).toBe('regional');
    expect(airportKind({ ident: 'X1', type: 'small_airport', name: 'Pista' })).toBe('other');
    expect(airportLabel({ icao: 'MDSD', iata: 'SDQ', type: 'large_airport' })).toBe('MDSD/SDQ');
    expect(airportLabel({ icao: 'MDXX', iata: '' })).toBe('MDXX');

    const layers = referenceOverlay().layers.filter(layer => layer.metadata['occ:group'] === AIRPORTS_GROUP);
    expect(layers.map(layer => layer.id)).toEqual(['occ-region-airports', 'occ-region-airport-labels']);
    for (const layer of layers) expect(layer.metadata['occ:maxThreshold']).toBe('airfield');
    const [dots, labels] = layers;
    const { airports: colours } = MAP_COLORS.dark;
    expect(dots.paint['circle-color']).toEqual(['match', ['get', 'airportKind'], 'home', colours.home, 'international',
      colours.international, 'regional', colours.regional, colours.other]);
    // The airport of a flight of today (PR M8) is larger and ringed in the text colour: the ring tells it apart.
    const counterpart = ['==', ['get', 'counterpart'], true];
    expect(dots.paint['circle-stroke-color']).toEqual(['case', counterpart, occColor('text'), colours.halo]);
    expect(dots.paint['circle-radius'][2]).toEqual(['case', counterpart, 1.5, 0]);
    expect(regionAirportFeatures(undefined, { counterparts: ['SDQ'] }).filter(feature => feature.properties.counterpart)
      .map(feature => feature.properties.label)).toEqual(['MDSD/SDQ']);
    // The home airport is larger than every other.
    const radius = dots.paint['circle-radius'][1];
    expect(radius[3]).toBeGreaterThan(Math.max(...radius.slice(4).filter(Number.isFinite)));
    expect(labels.paint['text-color']).toBe(colours.label);
    expect(labels.layout['text-field']).toEqual(['get', 'label']);
    // Above the base-map labels, so the tile label of the same airport gives way.
    const ids = buildOccStyle({ overlays: [referenceOverlay()] }).layers.map(layer => layer.id);
    expect(ids.indexOf('occ-region-airport-labels')).toBeGreaterThan(ids.indexOf('base-label-aerodrome'));
    // A map without traffic draws the mark of PUJ alone.
    expect(referenceOverlay({ airports: false }).layers.map(layer => layer.id)
      .filter(id => id.includes('airport'))).toEqual([]);
  });
});
