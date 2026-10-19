// Resalta la geometría aeroportuaria que ya traen los teselas vectoriales de OpenFreeMap
// (esquema OpenMapTiles, capa `aeroway`, datos de OpenStreetMap). Solo dibuja geometría y la
// referencia publicada (`ref`, p. ej. "08/26"); no infiere si una pista está operativa.
export const AEROWAY_SOURCE = 'openmaptiles';
export const RUNWAY_LAYER = 'elevant-aeroway-runway';
const RUNWAY_AREA_LAYER = 'elevant-aeroway-runway-area';
const RUNWAY_SELECTED_LAYER = 'elevant-aeroway-runway-selected';
const RUNWAY_LABEL_LAYER = 'elevant-aeroway-runway-label';
const TAXIWAY_LAYER = 'elevant-aeroway-taxiway';
const APRON_LAYER = 'elevant-aeroway-apron';

const PALETTE = {
  light: { runway: '#0B1F3F', taxiway: '#5B6B82', apron: 'rgba(20, 93, 196, 0.14)', label: '#0B1F3F', halo: '#FFFFFF', selected: '#145DC4' },
  dark: { runway: '#D3DEEE', taxiway: '#8FA2BF', apron: 'rgba(91, 155, 245, 0.16)', label: '#E8EEF7', halo: '#06101E', selected: '#6AA5F7' },
};

const isClass = value => ['==', ['get', 'class'], value];
const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isPolygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];

export function attachAerowayLayers(map, { theme = 'light', selectedRef = null } = {}) {
  if (!map.getSource(AEROWAY_SOURCE)) return false;
  const colors = PALETTE[theme] ?? PALETTE.light;
  const layers = [
    { id: APRON_LAYER, type: 'fill', filter: ['all', isPolygon, isClass('apron')],
      paint: { 'fill-color': colors.apron } },
    { id: RUNWAY_AREA_LAYER, type: 'fill', filter: ['all', isPolygon, isClass('runway')],
      paint: { 'fill-color': colors.runway, 'fill-opacity': 0.85 } },
    { id: TAXIWAY_LAYER, type: 'line', filter: ['all', isLine, isClass('taxiway')],
      paint: { 'line-color': colors.taxiway, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 6] } },
    { id: RUNWAY_LAYER, type: 'line', filter: ['all', isLine, isClass('runway')],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': colors.runway, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 3, 14, 14, 17, 90] } },
    { id: RUNWAY_SELECTED_LAYER, type: 'line', filter: ['all', isLine, isClass('runway'), ['==', ['get', 'ref'], selectedRef ?? '__none__']],
      paint: { 'line-color': colors.selected, 'line-opacity': 0.55,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 7, 14, 22, 17, 110] } },
    { id: RUNWAY_LABEL_LAYER, type: 'symbol', filter: ['all', isLine, isClass('runway'), ['has', 'ref']],
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'],
        'text-size': 12, 'text-letter-spacing': 0.1 },
      paint: { 'text-color': colors.label, 'text-halo-color': colors.halo, 'text-halo-width': 1.6 } },
  ];
  layers.forEach(layer => {
    if (!map.getLayer(layer.id)) map.addLayer({ ...layer, source: AEROWAY_SOURCE, 'source-layer': 'aeroway', minzoom: 11 });
  });
  return true;
}

export function setSelectedRunway(map, ref) {
  if (!map.getLayer(RUNWAY_SELECTED_LAYER)) return;
  map.setFilter(RUNWAY_SELECTED_LAYER, ['all', isLine, isClass('runway'), ['==', ['get', 'ref'], ref ?? '__none__']]);
}
