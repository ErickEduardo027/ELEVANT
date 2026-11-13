import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { TERMINALS, VIEW_NAMES } from './cameraPresets';

// The one selection of the OCC screens, kept in the URL (contracts 2.1): the map, the lists, the boards and the
// drawers read it from here. Pure: useMapSelection.js writes it through useAppSearchParams with `replace`.
//
// | Key        | Value                                                                                          |
// | `flightId` | a flightKey, a visitKey, a leg id or a turnaround id (today's links with a leg id keep working) |
// | `stand`    | the normalized stand code                                                                       |
// | `hex`      | the ADS-B hex of an aircraft that is not an ELEVANT flight                                      |
// | `view`     | region · approach · airfield · ramp (a terminal preset is `ramp` plus `terminal=A|B|FBO`)       |
// | `follow`   | 1                                                                                               |
// | `focus`    | map (the maximised map)                                                                         |

export const SELECTION_KEYS = Object.freeze(['flightId', 'stand', 'hex', 'view', 'terminal', 'follow', 'focus']);

/** The kinds of selection and their URL key. One selection at a time. */
export const SELECTION_KIND_KEYS = Object.freeze({ flight: 'flightId', stand: 'stand', aircraft: 'hex' });

const KIND_ORDER = ['flight', 'stand', 'aircraft'];

// Stand codes go through the positions normalizer (A01 is A1); PR A1 turns mapStandCode into an alias of the shared
// normalizeStandCode rule, which this module then follows unchanged.
function normalizeId(kind, id) {
  const text = String(id ?? '').trim();
  if (text === '') return null;
  if (kind === 'stand') return mapStandCode(text) || null;
  if (kind === 'aircraft') return text.toLowerCase();
  return text;
}

const validView = view => (VIEW_NAMES.includes(view) ? view : null);

function validTerminal(terminal) {
  const code = String(terminal ?? '').trim().toUpperCase();
  return TERMINALS.includes(code) ? code : null;
}

const toParams = params => new URLSearchParams(params instanceof URLSearchParams ? params : params?.toString?.() ?? '');

/**
 * What the URL selects: `{ selection: { kind: 'flight'|'stand'|'aircraft', id } | null, view, terminal, follow,
 * focus }`. A hand-written URL with several selection keys reads as the first of flight, stand and aircraft; an
 * unknown view, a terminal without the ramp view or any other value outside the contract reads as nothing.
 */
export function readSelection(params) {
  const query = toParams(params);
  let selection = null;
  for (const kind of KIND_ORDER) {
    const id = normalizeId(kind, query.get(SELECTION_KIND_KEYS[kind]));
    if (id !== null) {
      selection = { kind, id };
      break;
    }
  }
  const view = validView(query.get('view'));
  return {
    selection,
    view,
    terminal: view === 'ramp' ? validTerminal(query.get('terminal')) : null,
    follow: query.get('follow') === '1',
    focus: query.get('focus') === 'map' ? 'map' : null,
  };
}

/**
 * New URLSearchParams with `patch` applied, starting from `params` and touching only the selection keys: every
 * other key (stationId, operationId, …) is kept as it is. `patch` may hold:
 * - `selection`: `{ kind, id }` sets that one key and deletes the other two; `null` deletes all three;
 * - `view` and `terminal`: an invalid value is dropped (its key deleted), and the terminal only stays with `ramp`;
 * - `follow`: true writes `1`, anything else deletes it; `focus`: `'map'` writes it, anything else deletes it.
 */
export function writeSelection(params, patch = {}) {
  const next = toParams(params);

  if (Object.hasOwn(patch, 'selection')) {
    for (const key of Object.values(SELECTION_KIND_KEYS)) next.delete(key);
    const { kind, id } = patch.selection ?? {};
    const value = Object.hasOwn(SELECTION_KIND_KEYS, kind ?? '') ? normalizeId(kind, id) : null;
    if (value !== null) next.set(SELECTION_KIND_KEYS[kind], value);
  }

  if (Object.hasOwn(patch, 'view')) {
    const view = validView(patch.view);
    if (view === null) next.delete('view');
    else next.set('view', view);
  }
  if (Object.hasOwn(patch, 'terminal')) {
    const terminal = validTerminal(patch.terminal);
    if (terminal === null) next.delete('terminal');
    else next.set('terminal', terminal);
  }
  if (Object.hasOwn(patch, 'view') || Object.hasOwn(patch, 'terminal')) {
    if (next.get('view') !== 'ramp' || validTerminal(next.get('terminal')) === null) next.delete('terminal');
  }

  if (Object.hasOwn(patch, 'follow')) {
    if (patch.follow === true) next.set('follow', '1');
    else next.delete('follow');
  }
  if (Object.hasOwn(patch, 'focus')) {
    if (patch.focus === 'map') next.set('focus', 'map');
    else next.delete('focus');
  }
  return next;
}

// The fields a flight id is resolved against, in order: its own key first, then the legacy ids that older links
// carry, then the proposal key a visit had before OCC linked it to a planned flight (contracts 1.3, rule 3-N07).
const FLIGHT_ID_FIELDS = [
  flight => flight.flightKey,
  flight => flight.id,
  flight => flight.legId,
  flight => (flight.proposalId ? `p:${flight.proposalId}` : null),
  flight => flight.visitKey,
  flight => flight.turnaroundId,
];

/**
 * The flight a `flightId` names: a flightKey, a visitKey, a leg id, a turnaround id or the legacy `id`, so today's
 * links keep working. The two legs of a visit share its visitKey and turnaround: those resolve to the arrival.
 */
export function matchFlight(flights, id) {
  const wanted = String(id ?? '').trim();
  if (wanted === '' || !Array.isArray(flights)) return null;
  for (const field of FLIGHT_ID_FIELDS) {
    const matches = flights.filter(flight => flight != null && field(flight) != null && String(field(flight)) === wanted);
    if (matches.length > 0) return matches.find(flight => flight.direction === 'Arrival') ?? matches[0];
  }
  return null;
}

const standCodeOfFlight = flight => {
  const code = flight?.stand?.code ?? flight?.suggestedStandCode ?? null;
  return code == null || String(code).trim() === '' ? null : mapStandCode(String(code).trim());
};

const flightTime = flight => Date.parse(flight.actualAt ?? flight.estimatedAt ?? flight.scheduledAt ?? '') || Infinity;

// A visit is judged whole (its legs share one visitKey): an arrival keeps `arrived` or `landed` after its aircraft has
// gone, and the stand assignment stays open after the PUSHBACK (contracts 1.2), so a single leg cannot tell. A visit
// stops counting on its stand (contracts 2.4) once its PUSHBACK is recorded, once a leg has departed or diverted, when
// its arrival is cancelled (the aircraft is not coming), and, for a demo flight, once the server's timeline has taken
// the aircraft off the stand (contracts 1.1: TaxiOut, Departed and Gone, the phase of a cancelled demo as well). A
// cancelled departure alone leaves the aircraft where it is: that visit still counts, through its arrival.
const LEFT_PHASES = new Set(['departed', 'diverted']);
const DEMO_OFF_STAND_PHASES = new Set(['TaxiOut', 'Departed', 'Gone']);

const visitOf = flight => flight.visitKey ?? flight;
const pushedBack = flight => Array.isArray(flight.milestones)
  && flight.milestones.some(milestone => milestone?.code === 'PUSHBACK' && milestone.actualAt != null);

function endsItsVisit(flight) {
  return LEFT_PHASES.has(flight.phase)
    || (flight.phase === 'cancelled' && flight.direction !== 'Departure')
    || pushedBack(flight)
    || DEMO_OFF_STAND_PHASES.has(flight.demo?.phase);
}

/**
 * What a selection marks as related (contracts 2.1), kept minimal in M2: the second argument is `{ flights, stands }`
 * and only the map flights are read until the stands carry their visits (PR M4). A flight relates its stand (the
 * assigned one, or the suggestion of a demo flight not yet imported); a stand relates its current or next flight:
 * the earliest leg on it of a visit that still counts there (never a cancelled leg). `{ standCode, flightKey }`, each
 * `null` when there is none.
 */
export function relatedEntities(selection, { flights = [] } = {}) {
  if (selection?.kind === 'flight') {
    const flight = matchFlight(flights, selection.id);
    return { standCode: standCodeOfFlight(flight), flightKey: flight?.flightKey ?? null };
  }
  if (selection?.kind === 'stand') {
    const code = normalizeId('stand', selection.id);
    if (code === null) return { standCode: null, flightKey: null };
    const legs = (Array.isArray(flights) ? flights : []).filter(flight => flight != null);
    const ended = new Set(legs.filter(endsItsVisit).map(visitOf));
    const next = legs
      .filter(flight => standCodeOfFlight(flight) === code && flight.phase !== 'cancelled' && !ended.has(visitOf(flight)))
      .sort((first, second) => flightTime(first) - flightTime(second))[0];
    return { standCode: code, flightKey: next?.flightKey ?? null };
  }
  return { standCode: null, flightKey: null };
}
