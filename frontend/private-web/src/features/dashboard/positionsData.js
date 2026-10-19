// Original internal PUJ planning coordinates. Their survey provenance has not
// been verified against AIP; do not present them as official stand locations.
export const RAMP_POSITIONS = [
  { id: 'A1', terminal: 'A', lat: 18.564194, lon: -68.36025 },
  { id: 'A2', terminal: 'A', lat: 18.564194, lon: -68.360861 },
  { id: 'A3', terminal: 'A', lat: 18.564167, lon: -68.361528 },
  { id: 'A4', terminal: 'A', lat: 18.564111, lon: -68.362222 },
  { id: 'A5', terminal: 'A', lat: 18.564028, lon: -68.362833 },
  { id: 'A6', terminal: 'A', lat: 18.563944, lon: -68.363389 },
  { id: 'A7', terminal: 'A', lat: 18.563917, lon: -68.363944 },
  { id: 'A8', terminal: 'A', lat: 18.563889, lon: -68.364472 },
  { id: 'A9', terminal: 'A', lat: 18.563861, lon: -68.365111 },
  { id: 'A10', terminal: 'A', lat: 18.563833, lon: -68.365528 },
  { id: 'A11', terminal: 'A', lat: 18.563778, lon: -68.366028 },
  { id: 'AN1', terminal: 'A', lat: 18.565583, lon: -68.361556 },
  { id: 'AN2', terminal: 'A', lat: 18.5655, lon: -68.362 },
  { id: 'AN3', terminal: 'A', lat: 18.565472, lon: -68.362472 },
  { id: 'AN4', terminal: 'A', lat: 18.565472, lon: -68.362917 },
  { id: 'AN5', terminal: 'A', lat: 18.565417, lon: -68.363306 },

  { id: 'B20', terminal: 'B', lat: 18.563333, lon: -68.367972 },
  { id: 'B21', terminal: 'B', lat: 18.563139, lon: -68.369194 },
  { id: 'B22', terminal: 'B', lat: 18.563667, lon: -68.367972 },
  { id: 'B23', terminal: 'B', lat: 18.563667, lon: -68.369194 },
  { id: 'B24', terminal: 'B', lat: 18.564028, lon: -68.368028 },
  { id: 'B25', terminal: 'B', lat: 18.564333, lon: -68.369278 },
  { id: 'B26', terminal: 'B', lat: 18.564444, lon: -68.368028 },
  { id: 'B27', terminal: 'B', lat: 18.562556, lon: -68.370806 },
  { id: 'B28', terminal: 'B', lat: 18.563, lon: -68.370833 },
  { id: 'B29', terminal: 'B', lat: 18.563528, lon: -68.370833 },
  { id: 'B30', terminal: 'B', lat: 18.564167, lon: -68.370944 },
  { id: 'B31', terminal: 'B', lat: 18.564306, lon: -68.37175 },
  { id: 'B32', terminal: 'B', lat: 18.564278, lon: -68.372167 },
  { id: 'B33', terminal: 'B', lat: 18.564167, lon: -68.372611 },
  { id: 'B34', terminal: 'B', lat: 18.564111, lon: -68.373222 },
  { id: 'B35', terminal: 'B', lat: 18.563722, lon: -68.373222 },
  { id: 'B36', terminal: 'B', lat: 18.563333, lon: -68.373139 },
  { id: 'B37', terminal: 'B', lat: 18.562917, lon: -68.373111 },

  { id: 'BN6', terminal: 'FBO', lat: 18.563917, lon: -68.374806 },
  { id: 'BN7', terminal: 'FBO', lat: 18.563889, lon: -68.375222 },
  { id: 'BN8', terminal: 'FBO', lat: 18.563889, lon: -68.375694 },
  { id: 'BN9', terminal: 'FBO', lat: 18.563806, lon: -68.376111 },
  { id: 'BN10', terminal: 'FBO', lat: 18.563778, lon: -68.376583 },
  { id: 'BN11', terminal: 'FBO', lat: 18.563778, lon: -68.377 },
  { id: 'BN12', terminal: 'FBO', lat: 18.563611, lon: -68.378417 },
  { id: 'BN13', terminal: 'FBO', lat: 18.563583, lon: -68.378861 },
];

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

function toLocalMeters(lat, lon, refLat, refLon) {
  const x = (lon - refLon) * Math.cos(refLat * DEG_TO_RAD) * DEG_TO_RAD * EARTH_RADIUS_M;
  const y = (lat - refLat) * DEG_TO_RAD * EARTH_RADIUS_M;
  return { x, y };
}

// Projects real-world coordinates onto a flat schematic (not georeferenced).
// The ramp is a very long, narrow strip (~2km east-west, ~300m north-south),
// so each axis is normalized independently to fill the drawing area: relative
// distances *within* an axis stay proportional, but the two axes don't share
// one global scale. This keeps the diagram a legible, evenly spaced schematic
// rather than one near-flat line, matching a stylized (not georeferenced) map.
export function projectRampPositions(positions, { width, height, padding = 12 } = {}) {
  if (positions.length === 0) return [];

  const refLat = positions[0].lat;
  const refLon = positions[0].lon;
  const meters = positions.map(p => ({ id: p.id, terminal: p.terminal, ...toLocalMeters(p.lat, p.lon, refLat, refLon) }));

  const xs = meters.map(p => p.x);
  const ys = meters.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  return meters.map(p => ({
    id: p.id,
    terminal: p.terminal,
    x: padding + ((p.x - minX) / spanX) * innerWidth,
    y: padding + ((maxY - p.y) / spanY) * innerHeight,
  }));
}
