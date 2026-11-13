import { createTranslator, localeFor } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { standBox } from '../airport/standGeometry';
import { TERMINALS, isRetired, lngLatOf, standCodeOf, standTerminalOf } from '../core/cameraPresets';
import { mapMessages } from '../mapMessages';
import { coverageInitials, deriveDisplayStatus, standDrawState } from './standModel';

// The stands of a screen as GeoJSON. Until the stand layers move to polygons (PR M4, step b) the stands source draws
// points (toStandFeatures); buildStandFeatures gives the four collections of the polygon layers, and
// diffStandFeatures the part of them a board refresh changes, so the map sends updateData only for the stands that
// changed. Pure.

export { standDrawState };

/**
 * `positions` are the stands of a positions screen (`{ id | code, terminal | terminalCode, latitude, longitude,
 * status, locationSource }`). Each one with finite coordinates becomes a point keyed by its normalized code
 * (mapStandCode: `A01` is `A1`), with `code`, `terminal`, `status` and `unofficial` (true unless OCC placed the stand:
 * it then sits at an internal reference location). Stands without coordinates and retired stands are left out, and a
 * code seen twice keeps its first stand, so every feature id is unique.
 */
export function toStandFeatures(positions = []) {
  const features = [];
  const codes = new Set();
  for (const position of positions ?? []) {
    if (position == null || isRetired(position)) continue;
    const point = lngLatOf(position);
    const code = mapStandCode(standCodeOf(position));
    if (point === null || code === '' || codes.has(code)) continue;
    codes.add(code);
    features.push({
      type: 'Feature',
      properties: {
        code,
        terminal: standTerminalOf(position),
        status: standDrawState(position.status),
        unofficial: position.locationSource !== 'occ',
      },
      geometry: { type: 'Point', coordinates: point },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The property that keys the features of each collection of buildStandFeatures: the `promoteId` of its source. It
 * always equals the feature's own `id`, which diffStandFeatures uses.
 */
export const STAND_FEATURE_KEYS = Object.freeze({ polygons: 'code', aux: 'id', labels: 'code', groups: 'terminal' });
export const STAND_FEATURE_COLLECTIONS = Object.freeze(Object.keys(STAND_FEATURE_KEYS));
/** The label modes, as stands/standLayers.js names them: `dashboard` is the console's apron map. */
export const STAND_FEATURE_LABEL_MODES = Object.freeze(['default', 'dashboard']);
export const DEFAULT_TIME_ZONE = 'America/Santo_Domingo';

// Which labels win a place first (MapLibre places the lower symbol-sort-key first). The console's apron puts its
// planned stands first, as its codes did before (standLayers.js, `dashboard`).
const SORT_KEYS = Object.freeze({
  default: Object.freeze({ disabled: 1, arriving: 1, occupied: 2, releasing: 2, planned: 3, available: 4, unverified: 5 }),
  dashboard: Object.freeze({ planned: 0, disabled: 1, arriving: 1, occupied: 2, releasing: 2, available: 4, unverified: 5 }),
});
// The states with an aircraft on the stand: they show its glyph (until the footprint to scale of PR M5), count in the
// terminal chip and give the departure time; the others give the arrival time of the flight to come.
const ON_STAND_STATES = new Set(['occupied', 'releasing']);
const SEPARATOR = ' · ';

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

function strongestSignal(signals) {
  if (signals.some(signal => signal.kind === 'urgent')) return 'urgent';
  return signals.some(signal => signal.kind === 'attention') ? 'attention' : null;
}

const feature = (id, properties, geometry) => ({ type: 'Feature', id, properties, geometry });
const collection = features => ({ type: 'FeatureCollection', features });

// «Llega 14:20 · en 12 min», «Llega 14:20», «Sale 15:05 · en 8 min» or «Sale 15:05», and the covering agents'
// initials: the departure of an aircraft on the stand, the arrival of one to come. Only for a visit of the board.
function timeLine(display, t, clock, initials) {
  if (display.visit === null) return null;
  const onStand = ON_STAND_STATES.has(display.state);
  const at = onStand ? display.departureAt : display.arrivalAt;
  const minutes = onStand ? display.minutesToDeparture : display.minutesToArrival;
  const verb = onStand ? 'departs' : 'arrives';
  let time = null;
  if (at !== null) time = minutes > 0 ? t(`stand.${verb}In`, { time: clock(at), minutes }) : t(`stand.${verb}`, { time: clock(at) });
  const line = [time, initials].filter(Boolean).join(SEPARATOR);
  return line === '' ? null : line;
}

// The three label variants of a stand: the code; the code and the flight (or «Anulada por …»); and up to the full
// label: code; flight, type and «Demo»; times and initials; then «Anulada por …», the reason of the strongest signal
// and «Solo fuselaje estrecho» where they apply. Lines are separated by «\n».
function labelTexts(code, position, display, { t, clock, language }) {
  const demo = display.isDemo ? TAGS.demo[language] ?? TAGS.demo.es : null;
  const flight = display.flightNumber;
  const cancelled = display.state === 'disabled' && display.cancelledBy !== null
    ? t('stand.cancelledBy', { code: display.cancelledBy }) : null;
  const flightShort = flight ? [flight, demo].filter(Boolean).join(SEPARATOR) : null;
  const flightLong = flight ? [flight, display.aircraftType, demo].filter(Boolean).join(SEPARATOR) : null;
  const second = cancelled ?? flightShort;
  const reason = display.signals.length > 0 ? t(`stand.${display.signals[0].reason}`) : null;
  const narrow = position.narrowbodyOnly === true ? t('stand.narrowbodyOnly') : null;
  return {
    label1: code,
    label2: second === null ? code : `${code}\n${second}`,
    label3: [code, flightLong, timeLine(display, t, clock, coverageInitials(position.coveredBy)), cancelled, reason, narrow]
      .filter(Boolean).join('\n'),
  };
}

const lineOf = points => points.map(point => [point[0], point[1]]);
const terminalOrder = terminal => {
  const at = TERMINALS.indexOf(terminal);
  return at === -1 ? TERMINALS.length : at;
};

/**
 * The four collections the stand layers draw, from the stands of a screen with their geometry
 * (stand model: attachStandGeometry); a stand without one, a retired stand or a code seen twice is left out:
 * - `polygons`: each stand's box, id the normalized code (`code` is the promoteId), with `code`, `terminal`, `state`
 *   (deriveDisplayStatus at `nowMs`), `unofficial` (not placed by OCC), `signal` (`urgent`, `attention` or `null`),
 *   `glyph` (`aircraft` where an aircraft is on the stand, until the footprints to scale of PR M5) and `clock`
 *   (`releasing`);
 * - `aux`: lines by `kind`: `leadIn` (with the stand's `state`), `combinedLink` (from the centre of a cancelled stand
 *   to the centre of the stand that cancels it, when both are drawn) and `narrowInner` (the code-C box inside a
 *   larger stand limited to narrow-body aircraft);
 * - `labels`: a point at each centre with the label variants `label1` (code), `label2` (code and flight) and `label3`
 *   (the full label), its `state`, `signal` and `sortKey` (`labels: 'dashboard'` puts planned stands first);
 * - `groups`: one point per terminal at the centre of its boxes, `text` «A · 3/16» (aircraft on the stands over the
 *   stands drawn) and `arriving` (a flight is arriving at one of them).
 * The countdowns change only on the minute: `nowMs` (the current time when it is not given) is rounded down to it.
 * Texts follow `language` (es, en) and the clock times `timeZone`. `flightsByTurnaround` and `aircraftByTurnaround`
 * go to deriveDisplayStatus.
 */
export function buildStandFeatures(stands = [], {
  nowMs, language = 'es', timeZone = DEFAULT_TIME_ZONE, labels = 'default', flightsByTurnaround, aircraftByTurnaround,
} = {}) {
  if (!STAND_FEATURE_LABEL_MODES.includes(labels)) throw new RangeError(`Unknown stand label mode: ${String(labels)}`);
  const t = createTranslator(mapMessages, language);
  const clock = clockOf(language, timeZone);
  // One instant for the whole build, so no two stands are read on either side of a minute.
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const drawn = [];
  const codes = new Set();
  for (const position of stands ?? []) {
    if (position === null || typeof position !== 'object' || isRetired(position) || !position.geometry) continue;
    const code = mapStandCode(standCodeOf(position));
    if (code === '' || codes.has(code)) continue;
    codes.add(code);
    drawn.push({
      code,
      position,
      geometry: position.geometry,
      terminal: standTerminalOf(position),
      display: deriveDisplayStatus(position, { nowMs: now, flightsByTurnaround, aircraftByTurnaround }),
    });
  }

  const polygons = [];
  const aux = [];
  const labelPoints = [];
  const centres = new Map(drawn.map(stand => [stand.code, stand.geometry.center]));
  for (const { code, position, geometry, terminal, display } of drawn) {
    const { state } = display;
    const signal = strongestSignal(display.signals);
    polygons.push(feature(code, {
      code,
      terminal,
      state,
      unofficial: geometry.locationSource !== 'occ',
      signal,
      glyph: ON_STAND_STATES.has(state) ? 'aircraft' : null,
      clock: state === 'releasing',
    }, { type: 'Polygon', coordinates: [lineOf(geometry.polygon)] }));

    if (Array.isArray(geometry.leadIn) && geometry.leadIn.length >= 2) {
      const id = `leadIn:${code}`;
      aux.push(feature(id, { id, kind: 'leadIn', code, state }, { type: 'LineString', coordinates: lineOf(geometry.leadIn) }));
    }
    const canceller = display.cancelledBy;
    if (canceller !== null && canceller !== code && centres.has(canceller)) {
      const id = `combinedLink:${code}`;
      aux.push(feature(id, { id, kind: 'combinedLink', code, target: canceller }, {
        type: 'LineString', coordinates: lineOf([geometry.center, centres.get(canceller)]),
      }));
    }
    if (position.narrowbodyOnly === true && geometry.sizeLetter !== 'C') {
      const id = `narrowInner:${code}`;
      aux.push(feature(id, { id, kind: 'narrowInner', code }, {
        type: 'LineString', coordinates: lineOf(standBox(geometry.center, geometry.headingTrue, 'C')),
      }));
    }

    labelPoints.push(feature(code, {
      code,
      state,
      signal,
      sortKey: SORT_KEYS[labels][state],
      ...labelTexts(code, position, display, { t, clock, language }),
    }, { type: 'Point', coordinates: lineOf([geometry.center])[0] }));
  }

  return {
    polygons: collection(polygons),
    aux: collection(aux),
    labels: collection(labelPoints),
    groups: collection(terminalGroups(drawn)),
  };
}

// One chip per terminal at the centre of the box around its stands, in the order of TERMINALS.
function terminalGroups(drawn) {
  const byTerminal = new Map();
  for (const stand of drawn) {
    if (stand.terminal === null || stand.terminal === undefined || stand.terminal === '') continue;
    const group = byTerminal.get(stand.terminal) ?? { total: 0, busy: 0, arriving: false, points: [] };
    group.total += 1;
    if (ON_STAND_STATES.has(stand.display.state)) group.busy += 1;
    if (stand.display.state === 'arriving') group.arriving = true;
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

function sameProperties(first = {}, second = {}) {
  const keys = Object.keys(first ?? {});
  if (keys.length !== Object.keys(second ?? {}).length) return false;
  return keys.every(key => Object.hasOwn(second, key) && Object.is(first[key], second[key]));
}

const sameGeometry = (first, second) => first?.type === second?.type
  && JSON.stringify(first?.coordinates) === JSON.stringify(second?.coordinates);

/**
 * What changed between two FeatureCollections whose features carry unique ids, as a MapLibre GeoJSONSourceDiff:
 * `{ add, remove, update: [{ id, newGeometry?, removeAllProperties?, addOrUpdateProperties? }] }`, where an update
 * carries the new geometry only when it moved and the whole new properties only when one of them changed; `null` when
 * nothing changed.
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
    const changed = !sameProperties(old.properties, item.properties);
    if (!moved && !changed) continue;
    const entry = { id };
    if (moved) entry.newGeometry = item.geometry;
    if (changed) {
      entry.removeAllProperties = true;
      entry.addOrUpdateProperties = Object.entries(item.properties ?? {}).map(([key, value]) => ({ key, value }));
    }
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
