// Silueta de aeronave de ELEVANT vista desde arriba, con el morro hacia el
// norte (arriba) para que una rotación igual al rumbo la oriente bien. Dibujo
// propio en una caja de 64×64 centrada en (32, 32); la comparten los íconos SDF
// del mapa (style/mapImages.js) y el ícono de las leyendas y listas
// (AircraftSilhouetteIcon.jsx).
export const AIRCRAFT_SILHOUETTE_VIEWBOX = 64;

export const AIRCRAFT_SILHOUETTE_PATH = [
  'M32 3', 'Q35 4 35 10', 'L35 23', 'L58 35', 'L59 39', 'L35 33', 'L35 47',
  'L44 54', 'L44 57.5', 'L34 55', 'L32.8 61', 'L31.2 61', 'L30 55', 'L20 57.5',
  'L20 54', 'L29 47', 'L29 33', 'L5 39', 'L6 35', 'L29 23', 'L29 10', 'Q29 4 32 3', 'Z',
].join(' ');
