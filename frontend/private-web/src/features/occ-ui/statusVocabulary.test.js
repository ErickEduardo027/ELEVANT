import { describe, expect, it } from 'vitest';
import { OCC_PALETTE } from './occPalette';
import { SIGNALS, STAND_STATES, STAND_STATE_KEYS, TAGS, isInOperation } from './statusVocabulary';

const stateTokens = state => [state.fill.token, state.outline.token].filter(token => token !== null);

// A palette value as [red, green, blue, alpha]: `#rrggbb` is opaque, `rgb(r g b / a)` carries its alpha.
function rgba(value) {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(value);
  if (hex) return [...hex.slice(1).map(pair => Number.parseInt(pair, 16)), 1];
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (rgb) return rgb.slice(1).map(Number);
  throw new Error(`Not a palette colour: ${value}`);
}

describe('stand states', () => {
  it('lists the seven stand states of the contracts page with their Spanish and English labels', () => {
    expect(STAND_STATE_KEYS).toEqual([
      'available', 'planned', 'arriving', 'occupied', 'releasing', 'disabled', 'unverified',
    ]);
    expect(Object.keys(STAND_STATES)).toEqual(STAND_STATE_KEYS);

    const labels = Object.fromEntries(STAND_STATE_KEYS.map(key => [key, [STAND_STATES[key].es, STAND_STATES[key].en]]));
    expect(labels).toEqual({
      available: ['Libre', 'Free'],
      planned: ['Planificada', 'Planned'],
      arriving: ['Llegando', 'Arriving'],
      occupied: ['Ocupada', 'Occupied'],
      releasing: ['Por liberar', 'Releasing'],
      disabled: ['Inhabilitada', 'Disabled'],
      unverified: ['Sin verificar', 'Unverified'],
    });
  });

  it('draws each stand state as the contracts page says', () => {
    const drawing = Object.fromEntries(STAND_STATE_KEYS.map(key => {
      const { fill, outline, dash, extra } = STAND_STATES[key];
      return [key, [fill.kind, fill.token, fill.opacity, outline.width, outline.token, dash, extra]];
    }));
    expect(drawing).toEqual({
      available: ['none', null, 0, 1, '--occ-line-strong', null, 'code'],
      planned: ['none', null, 0, 1.5, '--occ-muted', [4, 3], 'flight-time'],
      arriving: ['tint', '--occ-arriving-fill', 1, 2.5, '--occ-text', null, 'lead-in'],
      occupied: ['solid', '--occ-panel-raised', 1, 2, '--occ-text', null, 'footprint-progress'],
      releasing: ['solid', '--occ-panel-raised', 1, 2, '--occ-text', null, 'clock'],
      disabled: ['hatch', '--occ-line-strong', 1, 1.5, '--occ-line-strong', [2, 2], 'combined-link'],
      unverified: ['none', null, 0, 1, '--occ-faint', [1, 3], 'muted-code'],
    });

    // «Llegando» is the raised slab at 40 %, in a token of its own: a legend drawn in HTML paints it as it is,
    // since Tailwind has no opacity modifier for an occ colour.
    const [red, green, blue, alpha] = rgba(OCC_PALETTE['--occ-arriving-fill']);
    expect([red, green, blue]).toEqual(rgba(OCC_PALETTE['--occ-panel-raised']).slice(0, 3));
    expect(alpha).toBe(0.4);
  });

  it('every fill paints its token as it is, and only a see-through fill has an alpha', () => {
    for (const key of STAND_STATE_KEYS) {
      const { kind, token, opacity } = STAND_STATES[key].fill;
      // No consumer dims a fill on its own, so a map, a canvas and a legend in HTML paint the same colour.
      expect(opacity, key).toBe(kind === 'none' ? 0 : 1);
      if (kind !== 'none') expect(rgba(OCC_PALETTE[token])[3] < 1, `${key}: ${token}`).toBe(kind === 'tint');
    }
  });

  it('every pair of stand states differs in a channel other than colour', () => {
    const shape = state => JSON.stringify([state.fill.kind, state.outline.width, state.dash]);
    const signature = state => JSON.stringify([state.fill.kind, state.outline.width, state.dash, state.extra]);
    const pairs = STAND_STATE_KEYS.flatMap((left, index) =>
      STAND_STATE_KEYS.slice(index + 1).map(right => [left, right]));
    expect(pairs).toHaveLength(21);

    for (const [left, right] of pairs) {
      expect(signature(STAND_STATES[left]), `${left} and ${right}`).not.toBe(signature(STAND_STATES[right]));
    }

    // Fill, outline width and dash alone tell every pair apart but one: «Ocupada» and «Por liberar» are drawn
    // alike on purpose, and the clock glyph is what separates them.
    const sameShape = pairs.filter(([left, right]) => shape(STAND_STATES[left]) === shape(STAND_STATES[right]));
    expect(sameShape).toEqual([['occupied', 'releasing']]);
  });

  it('stand states only reference tokens that the palette defines', () => {
    for (const key of STAND_STATE_KEYS) {
      const state = STAND_STATES[key];
      for (const token of stateTokens(state)) expect(OCC_PALETTE, `${key}: ${token}`).toHaveProperty([token]);
      // A fill has a colour exactly when there is something to paint.
      expect(state.fill.token === null, key).toBe(state.fill.kind === 'none');
    }
  });

  it('normal stand states carry no signal hue', () => {
    const signalHues = new Set(Object.entries(OCC_PALETTE)
      .filter(([name]) => /^--occ-(nav-)?(accent|warn|danger)/.test(name))
      .map(([, value]) => value));
    expect(signalHues.size).toBeGreaterThan(0);

    for (const key of STAND_STATE_KEYS) {
      for (const token of stateTokens(STAND_STATES[key])) {
        expect(signalHues.has(OCC_PALETTE[token]), `${key}: ${token}`).toBe(false);
      }
    }
  });

  it('cannot be changed by a consumer', () => {
    expect(Object.isFrozen(STAND_STATES.planned.dash)).toBe(true);
    expect(() => { STAND_STATES.occupied.fill.kind = 'none'; }).toThrow(TypeError);
    expect(() => { TAGS.demo.es = 'Simulado'; }).toThrow(TypeError);
    expect(() => { SIGNALS.urgent.shape = 'triangle'; }).toThrow(TypeError);
  });
});

describe('tags and signals', () => {
  it('tags keep the fixed words Demo, est., No oficial and Sin actualizar desde las {time}', () => {
    expect(Object.keys(TAGS)).toEqual(['demo', 'estimated', 'unofficial', 'stale']);

    const words = Object.fromEntries(Object.entries(TAGS).map(([key, tag]) => [key, [tag.es, tag.en, tag.texture]]));
    expect(words).toEqual({
      demo: ['Demo', 'Demo', 'stripes-45'],
      estimated: ['est.', 'est.', 'dashed'],
      unofficial: ['No oficial', 'Unofficial', 'outline'],
      stale: ['Sin actualizar desde las {time}', 'Not updated since {time}', 'dimmed'],
    });
    expect(TAGS.estimated.description).toEqual({
      es: 'Posición estimada: calculada con el horario, no con señal del avión.',
      en: "Estimated position: calculated from the schedule, not from the aircraft's signal.",
    });
    // Provenance is told by texture: no two tags share one.
    expect(new Set(Object.values(TAGS).map(tag => tag.texture)).size).toBe(4);
  });

  it('signals pair one hue with one shape and the plain notice has no colour', () => {
    expect(SIGNALS).toEqual({
      attention: { colorToken: '--occ-warn', shape: 'triangle', es: 'Atención', en: 'Attention' },
      urgent: { colorToken: '--occ-danger', shape: 'octagon', es: 'Urgente', en: 'Urgent' },
      notice: { colorToken: null, shape: 'diamond', es: 'Aviso', en: 'Notice' },
    });
    expect(new Set(Object.values(SIGNALS).map(signal => signal.shape)).size).toBe(3);

    const hues = Object.values(SIGNALS)
      .filter(signal => signal.colorToken !== null)
      .map(signal => OCC_PALETTE[signal.colorToken]);
    expect(hues).toHaveLength(2);
    expect(new Set(hues).size).toBe(2);
    // Cyan means «selected or actionable», so no signal may borrow it.
    expect(hues).not.toContain(OCC_PALETTE['--occ-accent']);
  });
});

describe('isInOperation', () => {
  // The two shapes a visit comes in: a turnaround as planning and the boards hold it, and a map flight, which
  // nests its turnaround (`null` until the flight is imported).
  const turnaround = (status, operationStatus) => ({ id: 'turnaround-1', status, operationStatus });
  const mapFlight = (status, operationStatus) => ({ flightKey: 'p:1', turnaround: turnaround(status, operationStatus) });

  it('isInOperation is true for a turnaround in progress or an operation in progress or returned, in both visit shapes', () => {
    for (const visit of [turnaround, mapFlight]) {
      expect(isInOperation(visit('InProgress', null))).toBe(true);
      expect(isInOperation(visit('InProgress', 'Assigned'))).toBe(true);
      expect(isInOperation(visit('Confirmed', 'InProgress'))).toBe(true);
      expect(isInOperation(visit('Confirmed', 'Returned'))).toBe(true);
      expect(isInOperation(visit('Completed', 'Returned'))).toBe(true);
      // The state names are compared without regard to case.
      expect(isInOperation(visit('inprogress', null))).toBe(true);
      expect(isInOperation(visit('CONFIRMED', 'RETURNED'))).toBe(true);
    }
  });

  it('isInOperation also reads the operation of a planning turnaround', () => {
    expect(isInOperation({ status: 'Confirmed', operation: { status: 'InProgress' } })).toBe(true);
    expect(isInOperation({ status: 'Confirmed', operation: { status: 'Returned' } })).toBe(true);
    expect(isInOperation({ status: 'Confirmed', operation: { status: 'Assigned' } })).toBe(false);
    expect(isInOperation({ status: 'Confirmed', operation: null })).toBe(false);
  });

  it('isInOperation is false for planned, completed, missing or null visits', () => {
    for (const visit of [turnaround, mapFlight]) {
      expect(isInOperation(visit('Scheduled', 'Planned'))).toBe(false);
      expect(isInOperation(visit('Confirmed', 'Assigned'))).toBe(false);
      expect(isInOperation(visit('Confirmed', null))).toBe(false);
      expect(isInOperation(visit('Completed', 'PendingReview'))).toBe(false);
      expect(isInOperation(visit('Completed', 'Approved'))).toBe(false);
      expect(isInOperation(visit('Cancelled', 'Cancelled'))).toBe(false);
      expect(isInOperation(visit(null, null))).toBe(false);
      expect(isInOperation(visit(undefined, undefined))).toBe(false);
    }
    // A flight of the feed that nobody imported has no turnaround.
    expect(isInOperation({ flightKey: 'p:3', turnaround: null })).toBe(false);
    expect(isInOperation({})).toBe(false);
    expect(isInOperation(null)).toBe(false);
    expect(isInOperation(undefined)).toBe(false);
    expect(isInOperation('InProgress')).toBe(false);
  });
});
