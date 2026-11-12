// The one vocabulary of OCC states: the seven stand states, the provenance tags and the three signals. Maps, lists,
// boards and legends read these keys, so a state has the same word and the same drawing everywhere.
// Pure data: every entry carries its Spanish and English label, and colours are token names of occPalette.js.
//
// «Cabina oscura»: a normal state carries no hue. Stand states differ by fill, outline, dash and an extra mark;
// cyan, amber and red are kept for the selection and for the signals below.

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const STAND_STATE_KEYS = Object.freeze([
  'available', 'planned', 'arriving', 'occupied', 'releasing', 'disabled', 'unverified',
]);

const NO_FILL = { kind: 'none', token: null, opacity: 0 };
const SLAB_FILL = { kind: 'solid', token: '--occ-panel-raised', opacity: 1 };

/**
 * How each stand state reads and is drawn.
 * - `fill.kind`: `none`, `tint` (the token at `opacity`), `solid`, or `hatch` (diagonal lines in the token colour).
 * - `outline.width` is in pixels; `dash` is `[dash, gap]`, also in pixels, or `null` for a solid line. A MapLibre
 *   `line-dasharray` counts in line widths, so a map divides both numbers by the width.
 * - `extra` names the mark that goes with the state: `code` (the stand code), `flight-time` (flight, time and a
 *   dashed footprint), `lead-in` (the lead-in line emphasised, «en N min»), `footprint-progress` (footprint and
 *   progress bar), `clock` (clock glyph, «sale en N min»), `combined-link` («Anulada por 9A» and the link line) and
 *   `muted-code` (the stand code, muted).
 */
export const STAND_STATES = deepFreeze({
  available: {
    es: 'Libre', en: 'Free',
    fill: NO_FILL, outline: { token: '--occ-line-strong', width: 1 }, dash: null, extra: 'code',
  },
  planned: {
    es: 'Planificada', en: 'Planned',
    fill: NO_FILL, outline: { token: '--occ-muted', width: 1.5 }, dash: [4, 3], extra: 'flight-time',
  },
  arriving: {
    es: 'Llegando', en: 'Arriving',
    fill: { kind: 'tint', token: '--occ-panel-raised', opacity: 0.4 },
    outline: { token: '--occ-text', width: 2.5 }, dash: null, extra: 'lead-in',
  },
  occupied: {
    es: 'Ocupada', en: 'Occupied',
    fill: SLAB_FILL, outline: { token: '--occ-text', width: 2 }, dash: null, extra: 'footprint-progress',
  },
  releasing: {
    es: 'Por liberar', en: 'Releasing',
    fill: SLAB_FILL, outline: { token: '--occ-text', width: 2 }, dash: null, extra: 'clock',
  },
  disabled: {
    es: 'Inhabilitada', en: 'Disabled',
    fill: { kind: 'hatch', token: '--occ-line-strong', opacity: 1 },
    outline: { token: '--occ-line-strong', width: 1.5 }, dash: [2, 2], extra: 'combined-link',
  },
  unverified: {
    es: 'Sin verificar', en: 'Unverified',
    fill: NO_FILL, outline: { token: '--occ-faint', width: 1 }, dash: [1, 3], extra: 'muted-code',
  },
});

/**
 * Provenance tags: the same words on every screen, told apart by texture and never by hue.
 * `stale` is a template: replace `{time}` with the local time of the last update («14:02»).
 */
export const TAGS = deepFreeze({
  demo: { es: 'Demo', en: 'Demo', texture: 'stripes-45' },
  estimated: {
    es: 'est.', en: 'est.', texture: 'dashed',
    description: {
      es: 'Posición estimada: calculada con el horario, no con señal del avión.',
      en: "Estimated position: calculated from the schedule, not from the aircraft's signal.",
    },
  },
  unofficial: { es: 'No oficial', en: 'Unofficial', texture: 'outline' },
  stale: { es: 'Sin actualizar desde las {time}', en: 'Not updated since {time}', texture: 'dimmed' },
});

/** The three signals: one hue and one shape each, always next to their word. A plain notice has no colour. */
export const SIGNALS = deepFreeze({
  attention: { colorToken: '--occ-warn', shape: 'triangle', es: 'Atención', en: 'Attention' },
  urgent: { colorToken: '--occ-danger', shape: 'octagon', es: 'Urgente', en: 'Urgent' },
  notice: { colorToken: null, shape: 'diamond', es: 'Aviso', en: 'Notice' },
});

const normalizeStatus = status => String(status ?? '').replace(/[\s_-]+/g, '').toLowerCase();
const ACTIVE_OPERATION_STATES = new Set(['inprogress', 'returned']);

/**
 * Whether a visit counts as «En operación»: its turnaround is InProgress, or its operation is InProgress or
 * Returned. Accepts a map flight (`{ turnaround: { status, operationStatus } }`), a turnaround with `status` and
 * `operationStatus`, and a planning turnaround, whose operation state is `operation.status`.
 */
export function isInOperation(visit) {
  const turnaround = visit?.turnaround ?? visit;
  if (turnaround === null || typeof turnaround !== 'object') return false;
  return normalizeStatus(turnaround.status) === 'inprogress' ||
    ACTIVE_OPERATION_STATES.has(normalizeStatus(turnaround.operationStatus ?? turnaround.operation?.status));
}
