// Genera los íconos de posición (rectángulo redondeado tipo "stand") como bitmaps de canvas y los
// registra en la instancia de MapLibre vía map.addImage. Nunca se usan pines genéricos: cada
// estado tiene su propio color de token existente y, en el caso de "disabled", un borde
// discontinuo horneado directamente en el bitmap — así la diferencia nunca depende solo del color.
const STATUS_COLORS = {
  planned: '#145DC4',
  unverified: '#D9A441',
  available: '#1E9E6B',
  occupied: '#145DC4',
  disabled: '#C4453C',
  releasing: '#D9A441',
};

const ICON_SIZE = 24;
const SELECTION_RING_COLOR = '#145DC4';

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.substring(0, 2), 16),
    g: parseInt(value.substring(2, 4), 16),
    b: parseInt(value.substring(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function devicePixelRatioCapped() {
  return Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
}

// map.addImage() only accepts HTMLImageElement | ImageBitmap | ImageData | {width,height,data} —
// a raw HTMLCanvasElement has no `.data`, so MapLibre would build a 0-length pixel buffer from it
// and throw "mismatched image size" while dispatching style.load, aborting that handler (and the
// map's own tile-loading kickoff right after it) before any layer ever got added. Reading the
// pixels back out as ImageData keeps everything the addImage() contract actually promises.
function canvasToImageData(canvas) {
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawStandIcon(status) {
  const ratio = devicePixelRatioCapped();
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE * ratio;
  canvas.height = ICON_SIZE * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);

  const color = STATUS_COLORS[status] ?? STATUS_COLORS.available;
  const pad = 3;
  const w = ICON_SIZE - pad * 2;
  const h = ICON_SIZE - pad * 2;

  roundedRectPath(ctx, pad, pad, w, h, 3);
  ctx.fillStyle = rgba(color, 0.18);
  ctx.fill();

  ctx.lineWidth = 1.8;
  ctx.strokeStyle = color;
  if (status === 'disabled') ctx.setLineDash([3, 2.2]);
  roundedRectPath(ctx, pad, pad, w, h, 3);
  ctx.stroke();
  ctx.setLineDash([]);

  return { imageData: canvasToImageData(canvas), ratio };
}

function drawSelectionRing() {
  const ratio = devicePixelRatioCapped();
  const size = ICON_SIZE + 12;
  const canvas = document.createElement('canvas');
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);

  const pad = 2.5;
  roundedRectPath(ctx, pad, pad, size - pad * 2, size - pad * 2, 5);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = rgba(SELECTION_RING_COLOR, 0.9);
  ctx.shadowColor = rgba(SELECTION_RING_COLOR, 0.5);
  ctx.shadowBlur = 4;
  ctx.stroke();

  return { imageData: canvasToImageData(canvas), ratio };
}

export const POSITION_ICON_KEYS = {
  planned: 'elevant-position-planned',
  unverified: 'elevant-position-unverified',
  available: 'elevant-position-available',
  occupied: 'elevant-position-occupied',
  disabled: 'elevant-position-disabled',
  releasing: 'elevant-position-releasing',
};

export const SELECTION_RING_ICON_KEY = 'elevant-position-selection-ring';

// Idempotente: cada style.load (montaje inicial o cambio de tema vía setStyle) empieza con un
// estilo sin imágenes propias, así que siempre es seguro volver a registrarlas.
export function registerPositionIcons(map) {
  Object.entries(POSITION_ICON_KEYS).forEach(([status, key]) => {
    if (map.hasImage(key)) return;
    const { imageData, ratio } = drawStandIcon(status);
    map.addImage(key, imageData, { pixelRatio: ratio });
  });

  if (!map.hasImage(SELECTION_RING_ICON_KEY)) {
    const { imageData, ratio } = drawSelectionRing();
    map.addImage(SELECTION_RING_ICON_KEY, imageData, { pixelRatio: ratio });
  }
}
