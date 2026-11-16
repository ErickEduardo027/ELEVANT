// Mapa base OpenStreetMap vía OpenFreeMap (sin clave) del único mapa que aún tiene su propio ciclo de vida, GoesCloudMap,
// el satélite del detalle del clima de la consola, hasta que M8 lo pase a una capa del mapa único; el PR U3 retiró
// RegionalTrafficMap con el dashboard anterior. El estilo ya no se configura por entorno: los demás mapas del OCC usan
// el estilo NOC construido en código (style/occStyle.js). El estilo "dark" no incluye edificios 3D.
const DEFAULT_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

export const BASEMAP_STYLE_URLS = Object.freeze({
  light: DEFAULT_STYLE_LIGHT,
  dark: DEFAULT_STYLE_DARK,
});

export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors · © OpenFreeMap · © OpenMapTiles';

export function basemapStyleUrl(theme) {
  return BASEMAP_STYLE_URLS[theme] ?? BASEMAP_STYLE_URLS.light;
}

// OpenFreeMap's dark style references two IDs absent from its published sprite:
// circle-11 is named circle_11 there, and wood-pattern has no sprite entry.
// Resolve only those known gaps; leave other missing assets visible as errors.
export function resolveOpenFreeMapSpriteGaps(map) {
  map.setMissingStyleImageResolver(id => {
    if (id === 'circle-11' && map.hasImage('circle_11')) {
      const image = map.getImage('circle_11');
      map.addImage(id, image.data, { pixelRatio: image.pixelRatio, sdf: image.sdf });
    } else if (id === 'wood-pattern') {
      // Match the style's existing landcover_wood fill color without fabricating detail.
      map.addImage(id, { width: 1, height: 1, data: new Uint8Array([32, 32, 32, 255]) });
    }
  });
}
