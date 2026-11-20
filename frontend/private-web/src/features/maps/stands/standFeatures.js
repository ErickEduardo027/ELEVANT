import { createTranslator, localeFor } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { aircraftFootprint } from '../aircraft/footprint';
import { haversineM, pointInPolygon, toLocal } from '../airport/geo';
import { STAND_BOX, standBox } from '../airport/standGeometry';
import { TERMINALS, isRetired, standCodeOf, standTerminalOf } from '../core/cameraPresets';
import { mapMessages } from '../mapMessages';
import { standPaint } from './standLayers';
import {
  STILL_BELOW_MS, coverageInitials, displayFromStatus, floorToMinute, minutesUntil, standCoverageNames, standStateOf,
} from './standModel';

// The stands of a screen as the GeoJSON of the stand layers (stands/standLayers.js): the polygons with their state,
// their lines (lead-ins, combined links, narrow-body boxes, progress bars), a label point per stand, a chip per
// terminal and the aircraft drawn at true size on them (PR M6). diffStandFeatures gives the part of them a refresh
// changes, so the map sends updateData only for the stands that changed. A stand reads as the screen derived it
// (useStandDisplay: `displayStatus`, `signals` and `display`); without that, as its board status says (standModel.js:
// standStateOf). Pure.

/**
 * The property that keys the features of each collection of buildStandFeatures: the `promoteId` of its source. It
 * always equals the feature's own `id`, which diffStandFeatures uses.
 */
export const STAND_FEATURE_KEYS = Object.freeze({
  polygons: 'code', aux: 'id', labels: 'code', groups: 'terminal', footprints: 'id',
});
export const STAND_FEATURE_COLLECTIONS = Object.freeze(Object.keys(STAND_FEATURE_KEYS));
/** The label modes, as stands/standLayers.js names them: `dashboard` is the console's apron map. */
export const STAND_FEATURE_LABEL_MODES = Object.freeze(['default', 'dashboard']);
export const DEFAULT_TIME_ZONE = 'America/Santo_Domingo';

// Which labels win a place first (MapLibre places the lower symbol-sort-key first): disabled and arriving, then the
// stands with an aircraft on them, then planned, then free. The console's apron puts its planned stands first, as its
// codes did before.
const SORT_KEYS = Object.freeze({
  default: Object.freeze({ disabled: 1, arriving: 1, occupied: 2, releasing: 2, planned: 3, available: 4, unverified: 5 }),
  dashboard: Object.freeze({ planned: 0, disabled: 1, arriving: 1, occupied: 2, releasing: 2, available: 4, unverified: 5 }),
});
// A stand with a signal places its label before every other (MapLibre places the lower key first): urgent, then
// attention, then a plain notice, then the order of its state.
const SIGNAL_SORT = Object.freeze({ urgent: -20, attention: -10, notice: -5 });
// The signals the map draws on a stand, the strongest first: it draws one.
const SIGNAL_ORDER = Object.freeze(['urgent', 'attention', 'notice']);
const SEPARATOR = ' · ';
// The code-C box of a stand limited to narrow-body aircraft sits inside the stand, at least a metre from each side.
const NARROW_MARGIN_M = 2;
// The aircraft a stand draws to scale: on the stand, or still to come (standModel.js: deriveDisplayStatus).
const FOOTPRINT_KINDS = new Set(['solid', 'planned']);

/**
 * Where the progress bar of a turnaround sits in a stand's box (design D3): this many metres inside its rear edge, the
 * tail's side, and this share of the box's width off each side, so it reads apart from the stand's outline.
 */
export const PROGRESS_INSET = Object.freeze({ rearM: 4, sideShare: 0.1 });

const clockFormatters = new Map();

// «14:20»: hours and minutes on 24 hours in the station's zone.
function clockOf(language, timeZone) {
  const key = `${language}|${timeZone}`;
  if (!clockFormatters.has(key)) {
    clockFormatters.set(key, new Intl.DateTimeFormat(localeFor(language), {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
    }));
  }
  const formatter = clockFormatters.get(key);
  return ms => formatter.format(ms);
}

// The signals a stand of a screen carries: those the screen derived (useStandDisplay), else those of its display.
function signalsOf(position) {
  if (Array.isArray(position?.signals)) return position.signals;
  return Array.isArray(position?.display?.signals) ? position.display.signals : [];
}

/**
 * The one signal the map draws on a stand of a screen, its label point's `signal`: `urgent` when one of the signals the
 * stand carries (those the screen derived, else those of its display) is urgent, else `attention` when one is, else
 * `notice` for a plain notice (PR M6: «Registra la llegada»), else `null`. A stand with several shows only the strongest,
 * so the legend explains that one alone (ui/legendEntries.js).
 */
export function standSignalOf(position) {
  const signals = signalsOf(position);
  return SIGNAL_ORDER.find(kind => signals.some(signal => signal?.kind === kind)) ?? null;
}

const feature = (id, properties, geometry) => ({ type: 'Feature', id, properties, geometry });
const collection = features => ({ type: 'FeatureCollection', features });
const hasAircraft = state => standPaint(state).glyph === 'aircraft';

// «Llega 14:20 · en 12 min», «Llega 14:20», «Sale 15:05 · en 8 min» or «Sale 15:05» (the departure of an aircraft on
// the stand, the arrival of one to come, counted down at `now`; only for a visit of the board), then the initials of the
// agents who cover it now (N26: standCoverageNames), which a stand without a visit shows alone: who covers a stand is a
// fact of the stand, and the tooltip and the drawer say it in full («Cubre M. Castillo»).
function timeLine(stand, { t, clock, now }) {
  let time = null;
  if (stand.display.visit != null) {
    const onStand = hasAircraft(stand.state);
    const at = onStand ? stand.display.departureAt : stand.display.arrivalAt;
    const minutes = minutesUntil(at, now);
    const verb = onStand ? 'departs' : 'arrives';
    if (Number.isFinite(at)) time = minutes > 0 ? t(`stand.${verb}In`, { time: clock(at), minutes }) : t(`stand.${verb}`, { time: clock(at) });
  }
  const line = [time, coverageInitials(standCoverageNames(stand.position))].filter(Boolean).join(SEPARATOR);
  return line === '' ? null : line;
}

// The three label variants of a stand: the code; the code and the flight (or «Anulada por …»); and up to the full
// label: code; flight, type and «Demo»; times and initials; then «Anulada por …», the reason of the strongest signal,
// the plain notice (PR M6: «El avión ya está en la posición. Registra la llegada.») and «Solo fuselaje estrecho» where
// they apply. Lines are separated by «\n».
function labelTexts(stand, context) {
  const { code, display, state, signals, position } = stand;
  const { t, language } = context;
  const demo = display.isDemo ? TAGS.demo[language] ?? TAGS.demo.es : null;
  const flight = display.flightNumber;
  const cancelled = state === 'disabled' && display.cancelledBy != null ? t('stand.cancelledBy', { code: display.cancelledBy }) : null;
  const flightShort = flight ? [flight, demo].filter(Boolean).join(SEPARATOR) : null;
  const flightLong = flight ? [flight, display.aircraftType, demo].filter(Boolean).join(SEPARATOR) : null;
  const second = cancelled ?? flightShort;
  const strongest = signals.find(signal => (signal?.kind === 'urgent' || signal?.kind === 'attention') && signal.reason);
  const reason = strongest ? t(`stand.${strongest.reason}`) : null;
  const notice = signals.find(signal => signal?.kind === 'notice' && signal.reason);
  const narrow = position.narrowbodyOnly === true ? t('stand.narrowbodyOnly') : null;
  return {
    label1: code,
    label2: second === null ? code : `${code}\n${second}`,
    label3: [code, flightLong, timeLine(stand, context), cancelled, reason, notice ? t(`stand.${notice.reason}`) : null, narrow]
      .filter(Boolean).join('\n'),
  };
}

const lineOf = points => points.map(point => [point[0], point[1]]);
// The width of a stand's box: its nose side, the first two corners of the ring as standBox and the layout write it.
const boxWidthM = polygon => (Array.isArray(polygon) && polygon.length >= 2 ? haversineM(polygon[0], polygon[1]) : 0);
// A narrow-body box fits inside a stand only when the stand is wider than code C.
const takesNarrowBox = (position, geometry) => position.narrowbodyOnly === true && geometry.sizeLetter !== 'C'
  && boxWidthM(geometry.polygon) >= STAND_BOX.C.widthM + NARROW_MARGIN_M;
const terminalOrder = terminal => {
  const at = TERMINALS.indexOf(terminal);
  return at === -1 ? TERMINALS.length : at;
};

// The stands a screen gives that the map draws: with a geometry, not retired, each code once, as they will be drawn.
function drawnStands(stands) {
  const drawn = [];
  const codes = new Set();
  for (const position of stands ?? []) {
    if (position === null || typeof position !== 'object' || isRetired(position) || !position.geometry) continue;
    const code = mapStandCode(standCodeOf(position));
    if (code === '' || codes.has(code)) continue;
    codes.add(code);
    const display = position.display ?? displayFromStatus(position);
    drawn.push({
      code,
      position,
      geometry: position.geometry,
      terminal: standTerminalOf(position),
      state: standStateOf(position),
      signals: signalsOf(position),
      display,
    });
  }
  return drawn;
}

/**
 * The five collections the stand layers draw, from the stands of a screen with their geometry (stand model:
 * attachStandGeometry) and, when the screen derived it, their display (withStandDisplay); a stand without a geometry, a
 * retired stand or a code seen twice is left out:
 * - `polygons`: each stand's box, id the normalized code (`code` is the promoteId), with `code`, `terminal`, `state`
 *   (standStateOf) and `unofficial` (not placed by OCC);
 * - `aux`: lines by `kind`: `leadIn` (with the stand's `state`), `combinedLink` (from the centre of a cancelled stand
 *   to the centre of the stand that cancels it, when both are drawn), `narrowInner` (the code-C box inside a stand
 *   wider than code C limited to narrow-body aircraft; a narrower stand is already that box), and on a stand with an
 *   aircraft on it whose milestones are known (PR M6) `progressTrack`, the whole bar along its rear edge, and
 *   `progressDone`, the share recorded (progressSegment), both with `done` and `total`;
 * - `labels`: a point at each centre with the label variants `label1` (code), `label2` (code and flight, or «Anulada
 *   por …») and `label3` (the full label), its `state`, `signal` (standSignalOf: `urgent`, `attention`, `notice` or
 *   `null`), `glyph` (`aircraft` while an aircraft is on the stand), `footprint` (the kind of aircraft to scale drawn on
 *   it, `solid` or `planned`, or `null`), `clock` (Por liberar), `heading` (the stand's, for the aircraft) and
 *   `sortKey` (`labels: 'dashboard'` puts planned stands first);
 * - `groups`: one point per terminal at the centre of its boxes, `text` «A · 3/16» (aircraft on the stands over the
 *   stands drawn) and `arriving` (a stand of the terminal reads «Llegando»);
 * - `footprints` (PR M6): the aircraft of a stand at true size (aircraft/footprint.js: aircraftFootprint, from the
 *   type of its display), id `footprint:<code>`, with `code`, `kind` (`solid` while it is on the stand, `planned`,
 *   dashed, while it is still to come) and the stand's `state`.
 * The countdowns are counted at `nowMs` rounded down to the minute (the current time when it is not given), so they
 * change only on the minute. Texts follow `language` (es, en) and the clock times `timeZone`.
 */
export function buildStandFeatures(stands = [], {
  nowMs, language = 'es', timeZone = DEFAULT_TIME_ZONE, labels = 'default',
} = {}) {
  if (!STAND_FEATURE_LABEL_MODES.includes(labels)) throw new RangeError(`Unknown stand label mode: ${String(labels)}`);
  // One instant for the whole build, so no two stands are read on either side of a minute.
  const now = floorToMinute(Number.isFinite(nowMs) ? nowMs : Date.now());
  const context = { t: createTranslator(mapMessages, language), clock: clockOf(language, timeZone), now, language };
  const drawn = drawnStands(stands);

  const polygons = [];
  const aux = [];
  const labelPoints = [];
  const footprints = [];
  const centres = new Map(drawn.map(stand => [stand.code, stand.geometry.center]));
  for (const stand of drawn) {
    const { code, position, geometry, terminal, state, display } = stand;
    const paint = standPaint(state);
    polygons.push(feature(code, {
      code,
      terminal,
      state,
      unofficial: geometry.locationSource !== 'occ',
    }, { type: 'Polygon', coordinates: [lineOf(geometry.polygon)] }));

    // The aircraft of the stand at true size, nose along the stand's heading (PR M6).
    const footprint = footprintOf(display, geometry);
    if (footprint !== null) {
      const id = `footprint:${code}`;
      footprints.push(feature(id, { id, code, kind: display.footprint, state }, { type: 'Polygon', coordinates: [footprint] }));
    }
    if (Array.isArray(geometry.leadIn) && geometry.leadIn.length >= 2) {
      const id = `leadIn:${code}`;
      aux.push(feature(id, { id, kind: 'leadIn', code, state }, { type: 'LineString', coordinates: lineOf(geometry.leadIn) }));
    }
    const canceller = display.cancelledBy;
    if (canceller != null && canceller !== code && centres.has(canceller)) {
      const id = `combinedLink:${code}`;
      aux.push(feature(id, { id, kind: 'combinedLink', code, target: canceller }, {
        type: 'LineString', coordinates: lineOf([geometry.center, centres.get(canceller)]),
      }));
    }
    if (takesNarrowBox(position, geometry)) {
      const id = `narrowInner:${code}`;
      aux.push(feature(id, { id, kind: 'narrowInner', code }, {
        type: 'LineString', coordinates: lineOf(standBox(geometry.center, geometry.headingTrue, 'C')),
      }));
    }
    // How far its turnaround has gone, while its aircraft is on it and its milestones are known (PR M6).
    aux.push(...progressFeatures(code, state, display, geometry));

    const signal = standSignalOf(position);
    labelPoints.push(feature(code, {
      code,
      state,
      signal,
      glyph: paint.glyph,
      footprint: footprint === null ? null : display.footprint,
      clock: paint.clock,
      heading: Number.isFinite(geometry.headingTrue) ? geometry.headingTrue : 0,
      sortKey: (SIGNAL_SORT[signal] ?? 0) + SORT_KEYS[labels][state],
      ...labelTexts(stand, context),
    }, { type: 'Point', coordinates: lineOf([geometry.center])[0] }));
  }

  return {
    polygons: collection(polygons),
    aux: collection(aux),
    labels: collection(labelPoints),
    groups: collection(terminalGroups(drawn)),
    footprints: collection(footprints),
  };
}

// The ring of the aircraft a stand draws to scale (aircraft/footprint.js), or `null`: its display names a kind and a
// type, and its geometry a centre and a heading.
function footprintOf(display, geometry) {
  if (!FOOTPRINT_KINDS.has(display?.footprint) || !display.typeSpec) return null;
  if (!Array.isArray(geometry?.center) || !isFiniteNumber(geometry.headingTrue)) return null;
  return aircraftFootprint(display.typeSpec, geometry.center, geometry.headingTrue);
}

// The bar of a stand's progress and the part done: on a stand with an aircraft on it whose milestones are known.
function progressFeatures(code, state, display, geometry) {
  if (standPaint(state).glyph !== 'aircraft' || !Number.isInteger(display?.milestonesDone) || !(display.milestonesTotal > 0)) {
    return [];
  }
  const total = display.milestonesTotal;
  const done = Math.max(0, Math.min(display.milestonesDone, total));
  const track = progressSegment(geometry.polygon, geometry.headingTrue, 1);
  if (track === null) return [];
  const line = (kind, coordinates) => {
    const id = `${kind}:${code}`;
    return feature(id, { id, kind, code, done, total }, { type: 'LineString', coordinates });
  };
  const features = [line('progressTrack', track)];
  if (done > 0) features.push(line('progressDone', progressSegment(geometry.polygon, geometry.headingTrue, done / total)));
  return features;
}

const roundCoordinate = value => Math.round(value * 1e7) / 1e7;

/**
 * The line of a stand's progress bar (design D3): along the rear edge of its box (`polygon`, a closed ring, the nose
 * along `headingTrue`), PROGRESS_INSET inside it, from one end to `fraction` (0 to 1) of its length, as
 * `[[lng, lat], [lng, lat]]`. It reads from left to right on a north-up map (west to east; south to north when the
 * edge runs that way). `null` without a box or a heading.
 */
export function progressSegment(polygon, headingTrue, fraction) {
  const ring = Array.isArray(polygon) ? polygon.filter(point => Array.isArray(point)) : [];
  const corners = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  if (corners.length < 3 || !isFiniteNumber(headingTrue) || !isFiniteNumber(fraction)) return null;
  const origin = [
    corners.reduce((sum, point) => sum + point[0], 0) / corners.length,
    corners.reduce((sum, point) => sum + point[1], 0) / corners.length,
  ];
  const plane = toLocal(origin);
  const radians = (headingTrue * Math.PI) / 180;
  const nose = [Math.sin(radians), Math.cos(radians)];
  const right = [Math.cos(radians), -Math.sin(radians)];
  const local = corners.map(point => plane.forward(point));
  const along = local.map(([x, y]) => x * nose[0] + y * nose[1]);
  const across = local.map(([x, y]) => x * right[0] + y * right[1]);
  const rear = Math.min(...along) + PROGRESS_INSET.rearM;
  const left = Math.min(...across);
  const width = Math.max(...across) - left;
  const at = acrossM => [nose[0] * rear + right[0] * acrossM, nose[1] * rear + right[1] * acrossM];
  let start = at(left + width * PROGRESS_INSET.sideShare);
  let end = at(left + width * (1 - PROGRESS_INSET.sideShare));
  const [dx, dy] = [end[0] - start[0], end[1] - start[1]];
  if (Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0) [start, end] = [end, start];
  const share = Math.min(1, Math.max(0, fraction));
  const stop = [start[0] + (end[0] - start[0]) * share, start[1] + (end[1] - start[1]) * share];
  return [start, stop].map(xy => plane.inverse(xy).map(roundCoordinate));
}

// The box of each stand that draws the aircraft on it (Ocupada or Por liberar: its footprint, or its glyph), by the
// turnaround of the visit it shows; built once per list.
const PARKED_BOXES = new WeakMap();
function parkedBoxes(stands) {
  if (!Array.isArray(stands)) return new Map();
  let boxes = PARKED_BOXES.get(stands);
  if (boxes === undefined) {
    boxes = new Map();
    for (const stand of stands) {
      if (stand === null || typeof stand !== 'object' || isRetired(stand) || !Array.isArray(stand.geometry?.polygon)) continue;
      const turnaroundId = stand.display?.visit?.turnaroundId;
      if (hasAircraft(standStateOf(stand)) && turnaroundId != null && !boxes.has(turnaroundId)) {
        boxes.set(turnaroundId, stand.geometry.polygon);
      }
    }
    PARKED_BOXES.set(stands, boxes);
  }
  return boxes;
}

/**
 * The ELEVANT aircraft the stands draw instead of the traffic (design F4: one owner per aircraft, nothing drawn twice):
 * those of `aircraft` (the traffic as a frame draws it, traffic/situationModel.js) standing still on the ground (under
 * 2 kt) inside the box of the stand of their visit while that stand reads an aircraft on it (Ocupada or Por liberar),
 * which it draws: to scale from the codes threshold on (its footprint; the glyph when its type is unknown), as its glyph
 * below. A Set of their ids; from the polygons threshold on, where the stands are drawn, the map hides their symbol
 * (traffic/trafficFeatures.js: `parkedOnStand`). A moving aircraft is always the traffic's.
 */
export function parkedAircraftIds(aircraft = [], stands = []) {
  const parked = new Set();
  const boxes = parkedBoxes(stands);
  if (boxes.size === 0) return parked;
  for (const item of Array.isArray(aircraft) ? aircraft : []) {
    if (item?.kind !== 'aviam' || item.onGround !== true || !isFiniteNumber(item.lon) || !isFiniteNumber(item.lat)) continue;
    if (isFiniteNumber(item.gsMs) && item.gsMs >= STILL_BELOW_MS) continue;
    const box = boxes.get(item.turnaroundId);
    if (box && pointInPolygon([item.lon, item.lat], box)) parked.add(item.id);
  }
  return parked;
}

// One chip per terminal at the centre of the box around its stands, in the order of TERMINALS.
function terminalGroups(drawn) {
  const byTerminal = new Map();
  for (const stand of drawn) {
    if (stand.terminal === null || stand.terminal === undefined || stand.terminal === '') continue;
    const group = byTerminal.get(stand.terminal) ?? { total: 0, busy: 0, arriving: false, points: [] };
    group.total += 1;
    if (hasAircraft(stand.state)) group.busy += 1;
    if (stand.state === 'arriving') group.arriving = true;
    group.points.push(...stand.geometry.polygon);
    byTerminal.set(stand.terminal, group);
  }
  return [...byTerminal.entries()]
    .sort(([first], [second]) => terminalOrder(first) - terminalOrder(second) || String(first).localeCompare(String(second)))
    .map(([terminal, group]) => {
      const lngs = group.points.map(point => point[0]);
      const lats = group.points.map(point => point[1]);
      const centre = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
      return feature(terminal, {
        terminal,
        text: `${terminal}${SEPARATOR}${group.busy}/${group.total}`,
        busy: group.busy,
        total: group.total,
        arriving: group.arriving,
      }, { type: 'Point', coordinates: centre });
    });
}

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

/** The box `[[west, south], [east, north]]` around `[lng, lat]` points, or `null` without a finite one. */
export function boxOfPoints(points) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of points ?? []) {
    if (!Array.isArray(point) || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) continue;
    west = Math.min(west, point[0]);
    south = Math.min(south, point[1]);
    east = Math.max(east, point[0]);
    north = Math.max(north, point[1]);
  }
  return west === Infinity ? null : [[west, south], [east, north]];
}

/** Whether two boxes `[[west, south], [east, north]]` share a point (edges included). */
export function boxesMeet(first, second) {
  if (!first || !second) return false;
  return first[0][0] <= second[1][0] && second[0][0] <= first[1][0] && first[0][1] <= second[1][1] && second[0][1] <= first[1][1];
}

/**
 * The stands of a screen the map draws whose box meets `bounds` (`[[west, south], [east, north]]`, the area the
 * panels leave in sight): with a geometry and not retired; without bounds, every drawn stand. A polygon that only
 * reaches into the view counts, as the map shows that part of it.
 */
export function standsDrawnIn(stands = [], bounds = null) {
  return (stands ?? []).filter(stand => stand != null && !isRetired(stand) && Array.isArray(stand.geometry?.polygon)
    && (bounds === null || boxesMeet(boxOfPoints(stand.geometry.polygon), bounds)));
}

/**
 * The features of a collection of buildStandFeatures that meet `bounds`: points inside it, lines and polygons whose box
 * meets it. `kind` keeps those of one kind (an `aux` line's `kind`).
 */
export function featuresIn(featureCollection, bounds, { kind } = {}) {
  return (featureCollection?.features ?? []).filter(item => {
    if (kind !== undefined && item.properties?.kind !== kind) return false;
    const { type, coordinates } = item.geometry ?? {};
    const points = type === 'Point' ? [coordinates] : type === 'Polygon' ? coordinates?.[0] : coordinates;
    return bounds === null || boxesMeet(boxOfPoints(points), bounds);
  });
}

// The properties that differ between two features: the keys that went (`removeProperties`) and the keys that came or
// changed (`addOrUpdateProperties`).
function propertyChanges(first, second) {
  const before = first ?? {};
  const after = second ?? {};
  return {
    removeProperties: Object.keys(before).filter(key => !Object.hasOwn(after, key)),
    addOrUpdateProperties: Object.entries(after)
      .filter(([key, value]) => !Object.hasOwn(before, key) || !Object.is(before[key], value))
      .map(([key, value]) => ({ key, value })),
  };
}

const sameGeometry = (first, second) => first?.type === second?.type
  && JSON.stringify(first?.coordinates) === JSON.stringify(second?.coordinates);

/**
 * What changed between two FeatureCollections whose features carry unique ids, as a MapLibre GeoJSONSourceDiff:
 * `{ add, remove, update: [{ id, newGeometry?, removeProperties?, addOrUpdateProperties? }] }`, where an update
 * carries the new geometry only when it moved, and only the properties that went or changed; `null` when nothing
 * changed. Never `removeAllProperties`: MapLibre 6.16 drops the `addOrUpdateProperties` that come with it, and the
 * feature would lose every property it is drawn by.
 */
export function diffFeatureCollections(previous, next) {
  const before = new Map((previous?.features ?? []).map(item => [item.id, item]));
  const after = new Map((next?.features ?? []).map(item => [item.id, item]));
  const remove = [...before.keys()].filter(id => !after.has(id));
  const add = [];
  const update = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (old === undefined) {
      add.push(item);
      continue;
    }
    const moved = !sameGeometry(old.geometry, item.geometry);
    const { removeProperties, addOrUpdateProperties } = propertyChanges(old.properties, item.properties);
    if (!moved && removeProperties.length === 0 && addOrUpdateProperties.length === 0) continue;
    const entry = { id };
    if (moved) entry.newGeometry = item.geometry;
    if (removeProperties.length > 0) entry.removeProperties = removeProperties;
    if (addOrUpdateProperties.length > 0) entry.addOrUpdateProperties = addOrUpdateProperties;
    update.push(entry);
  }
  return add.length === 0 && remove.length === 0 && update.length === 0 ? null : { add, remove, update };
}

/**
 * What a refresh changes in the collections of buildStandFeatures: `{ polygons, aux, labels, groups }`, each a
 * GeoJSONSourceDiff or `null` when that collection did not change, or `null` when nothing changed at all. Without a
 * previous build every feature is added.
 */
export function diffStandFeatures(previous, next) {
  let changed = false;
  const diff = {};
  for (const name of STAND_FEATURE_COLLECTIONS) {
    diff[name] = diffFeatureCollections(previous?.[name], next?.[name]);
    if (diff[name] !== null) changed = true;
  }
  return changed ? diff : null;
}
