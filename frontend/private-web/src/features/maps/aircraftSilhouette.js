// Silueta de aeronave de ELEVANT vista desde arriba, con el morro hacia el
// norte (arriba) para que una rotación igual al rumbo la oriente bien. Dibujo
// propio en una caja de 64×64 centrada en (32, 32); la comparten los mapas de
// posiciones (canvas → map.addImage) y de tráfico (marcador DOM).
export const AIRCRAFT_SILHOUETTE_VIEWBOX = 64;

export const AIRCRAFT_SILHOUETTE_PATH = [
  'M32 3', 'Q35 4 35 10', 'L35 23', 'L58 35', 'L59 39', 'L35 33', 'L35 47',
  'L44 54', 'L44 57.5', 'L34 55', 'L32.8 61', 'L31.2 61', 'L30 55', 'L20 57.5',
  'L20 54', 'L29 47', 'L29 33', 'L5 39', 'L6 35', 'L29 23', 'L29 10', 'Q29 4 32 3', 'Z',
].join(' ');

export function aircraftSilhouetteSvg({ fill, stroke = 'none', size = 24, strokeWidth = 2 }) {
  return `<svg viewBox="0 0 ${AIRCRAFT_SILHOUETTE_VIEWBOX} ${AIRCRAFT_SILHOUETTE_VIEWBOX}" width="${size}" height="${size}" aria-hidden="true">`
    + `<path d="${AIRCRAFT_SILHOUETTE_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" /></svg>`;
}

// Pinta la silueta en un contexto 2D, centrada en (cx, cy) con el lado `size`.
// `lineWidth` se expresa en píxeles del canvas, no en unidades del viewBox.
export function paintAircraftSilhouette(ctx, {
  cx, cy, size, rotationDeg = 0, fill, stroke, lineWidth = 1, dash,
}) {
  const scale = size / AIRCRAFT_SILHOUETTE_VIEWBOX;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.translate(-AIRCRAFT_SILHOUETTE_VIEWBOX / 2, -AIRCRAFT_SILHOUETTE_VIEWBOX / 2);
  const path = new Path2D(AIRCRAFT_SILHOUETTE_PATH);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  if (stroke) {
    ctx.lineWidth = lineWidth / scale;
    ctx.strokeStyle = stroke;
    if (dash) ctx.setLineDash(dash.map(value => value / scale));
    ctx.stroke(path);
  }
  ctx.restore();
}
