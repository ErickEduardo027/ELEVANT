import { localeFor } from '../../../i18n/languageStore';
import { normalizeStandCode } from '../../../services/standCodes';
import { STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { isRetired, standCodeOf } from '../core/cameraPresets';
import { boxOfPoints, boxesMeet } from './standFeatures';
import { displayFromStatus, sameAgentCodes, standCoverageNames, standStateOf } from './standModel';

// What a person's pointer and selection do to the stands of an OCC map (PR M4, design D5): the words of the tooltip of
// a stand, the feature-state a hover or a selection writes (only what changes), and whether a selected stand lies
// outside the area of the map in sight, so the camera eases to it only then. Pure: core/OccMap.jsx applies them.

/** The flags of the stand polygons a hover or a selection writes as feature-state (stands/standLayers.js reads them). */
export const STAND_FLAG_KEYS = Object.freeze(['hover', 'selected', 'related']);
/**
 * The share of the area in sight, on each side, that does not count as safe: a stand there is half out of the view.
 * It stays under the room the ramp view leaves around the stand polygons (120 m of about 2.4 km, contracts 2.3), so in
 * the ramp view every stand is in sight and selecting one never moves the camera.
 */
export const SAFE_AREA_MARGIN = 0.03;

const SEPARATOR = ' · ';
const NO_CODES = Object.freeze([]);
// The signals a stand says the reason of, the strongest first: the order deriveDisplayStatus gives them.
const SIGNAL_KINDS = new Set(['urgent', 'attention', 'notice']);
const listFormatters = new Map();

// «Marta Castillo y Luis Peña»: the names of the agents in the language's list form.
function joinNames(names, language) {
  const locale = localeFor(language);
  if (!listFormatters.has(locale)) listFormatters.set(locale, new Intl.ListFormat(locale, { type: 'conjunction' }));
  return listFormatters.get(locale).format(names);
}

const codeOf = stand => normalizeStandCode(standCodeOf(stand));

/** The stand of `stands` (not retired) whose normalized code is `code`'s, or `null`. */
export function findStandByCode(stands, code) {
  const wanted = normalizeStandCode(code);
  if (wanted === '') return null;
  return (stands ?? []).find(stand => stand !== null && typeof stand === 'object' && !isRetired(stand)
    && codeOf(stand) === wanted) ?? null;
}

/**
 * The tooltip of stand `code` among the stands a map draws (with how the screen reads them: `displayStatus`, `signals`
 * and `display`, else their board status), with the words of `t` (the map messages) in `language`:
 * `{ kind: 'stand', id, code, title, detail, reasons }`:
 * - `title`: the code and the state in the words of the vocabulary, «A5 · Ocupada»;
 * - `detail`: the flight (with «Demo» for a demo flight) and who covers the stand (now, with the board's coverage
 *   windows of today, N26: standModel.js, standCoverageNames), «DM161 · Cubre M. Castillo», or `null` when there is
 *   neither;
 * - `reasons`: `[{ signal, text }]`, the reasons of its signals first (`signal` is `urgent`, `attention` or, PR M6, the
 *   plain `notice` «El avión ya está en la posición. Registra la llegada.», drawn with their shape), then «Anulada
 *   por …» and «Solo fuselaje estrecho» (`signal` `null`).
 * The label of the stand and its drawer carry the same facts, so nothing lives only in the tooltip. `null` for a code
 * the map does not draw.
 */
export function standTooltip(code, stands, t, language = 'es') {
  const stand = findStandByCode(stands, code);
  if (stand === null) return null;
  const id = codeOf(stand);
  const state = standStateOf(stand);
  const vocabulary = STAND_STATES[state];
  const display = stand.display ?? displayFromStatus(stand);
  const demo = display.isDemo ? TAGS.demo[language] ?? TAGS.demo.es : null;
  const flight = display.flightNumber ? [display.flightNumber, demo].filter(Boolean).join(SEPARATOR) : null;
  const names = standCoverageNames(stand);
  const coverage = names.length > 0 ? t('stand.coveredBy', { names: joinNames(names, language) }) : null;
  const signals = Array.isArray(stand.signals) ? stand.signals : display.signals ?? [];
  const reasons = signals
    .filter(signal => signal?.reason && SIGNAL_KINDS.has(signal.kind))
    .map(signal => ({ signal: signal.kind, text: t(`stand.${signal.reason}`) }));
  if (state === 'disabled' && display.cancelledBy) reasons.push({ signal: null, text: t('stand.cancelledBy', { code: display.cancelledBy }) });
  if (stand.narrowbodyOnly === true) reasons.push({ signal: null, text: t('stand.narrowbodyOnly') });
  const detail = [flight, coverage].filter(Boolean).join(SEPARATOR);
  return {
    kind: 'stand',
    id,
    code: id,
    title: `${id}${SEPARATOR}${vocabulary[language] ?? vocabulary.es}`,
    detail: detail === '' ? null : detail,
    reasons,
  };
}

/** The normalized codes of a set, a list or nothing, sorted, so a plan is written in a fixed order. */
function codesOf(value) {
  if (value == null) return NO_CODES;
  const list = value instanceof Set || Array.isArray(value) ? [...value] : [];
  return [...new Set(list.map(code => normalizeStandCode(code)).filter(code => code !== ''))].sort();
}

const flagOf = value => {
  const code = normalizeStandCode(value);
  return code === '' ? null : code;
};

/**
 * The flags of the stand polygons for a pointer over `hover` and a selection of `selected` (stand codes or `null`) and
 * `related` (the stand of a selected flight): `{ hover, selected, related, sameAgent }`, where `sameAgent` holds the
 * other stands covered by an agent who covers the hovered stand, else the selected one (standModel.js:
 * sameAgentCodes over `stands`, the stands of the screen with their `coveredBy`). Leaving a stand gives the marks back
 * to the selection; without a selection they go. sameAgentMark says whose agent they follow.
 */
export function standFlags({ hover = null, selected = null, related = null, stands = [] } = {}) {
  const pointed = flagOf(hover);
  const chosen = flagOf(selected);
  const source = pointed ?? chosen;
  return {
    hover: pointed,
    selected: chosen,
    related: flagOf(related),
    sameAgent: source === null ? new Set() : sameAgentCodes(stands, source),
  };
}

/**
 * The legend's name for the ring the `flags` of standFlags draw around the stands covered by the same agent:
 * `sameAgentHover` while it follows the agent of the stand under the pointer, `sameAgent` while it follows the selected
 * stand's (also with the pointer over the selected stand), and `null` when it rings no stand: the stand it follows has
 * no agent with other stands, or there is no stand to follow. The legend explains only the ring the map draws
 * (contracts 2.4), so a stand under the pointer without an agent leaves nothing to explain, not even the selection's.
 */
export function sameAgentMark(flags) {
  if (codesOf(flags?.sameAgent).length === 0) return null;
  const pointed = flagOf(flags.hover);
  return pointed !== null && pointed !== flagOf(flags.selected) ? 'sameAgentHover' : 'sameAgent';
}

/**
 * What the feature-state of the stand polygons must change to go from `previous` to `next`, each
 * `{ hover, selected, related, sameAgent }`: the stand under the pointer, the selected stand, the stand of the selected
 * flight (codes or `null`) and the stands covered by the same agent as the hovered or selected one (a Set or a list of
 * codes). Only what changed is written: `[{ op: 'remove', id, key } | { op: 'set', id, state: { [key]: true } }]`, every
 * removal before any write, each group in a fixed order (hover, selected, related, sameAgent, codes sorted).
 */
export function featureStatePlan(previous = {}, next = {}) {
  const removals = [];
  const writes = [];
  for (const key of STAND_FLAG_KEYS) {
    const before = flagOf(previous?.[key]);
    const after = flagOf(next?.[key]);
    if (before === after) continue;
    if (before !== null) removals.push({ op: 'remove', id: before, key });
    if (after !== null) writes.push({ op: 'set', id: after, state: { [key]: true } });
  }
  const before = codesOf(previous?.sameAgent);
  const after = codesOf(next?.sameAgent);
  for (const id of before) if (!after.includes(id)) removals.push({ op: 'remove', id, key: 'sameAgent' });
  for (const id of after) if (!before.includes(id)) writes.push({ op: 'set', id, state: { sameAgent: true } });
  return [...removals, ...writes];
}

/**
 * Whether a stand whose box is `standBounds` lies outside the safe part of `visibleBounds` (the area of the map the
 * panels leave in sight, both `[[west, south], [east, north]]`): the area less `margin` of its width and height on
 * each side. A stand that only reaches into that band, or lies beyond it, is outside. Without either box (a map with
 * no size, a stand the map does not draw) the camera has nothing to do: `false`.
 */
export function isOutsideSafeArea(standBounds, visibleBounds, { margin = SAFE_AREA_MARGIN } = {}) {
  if (!boxOfPoints(standBounds ?? []) || !boxOfPoints(visibleBounds ?? [])) return false;
  const [[west, south], [east, north]] = visibleBounds;
  const insetX = (east - west) * margin;
  const insetY = (north - south) * margin;
  const safe = [[west + insetX, south + insetY], [east - insetX, north - insetY]];
  if (!boxesMeet(standBounds, safe)) return true;
  return standBounds[0][0] < safe[0][0] || standBounds[1][0] > safe[1][0]
    || standBounds[0][1] < safe[0][1] || standBounds[1][1] > safe[1][1];
}
