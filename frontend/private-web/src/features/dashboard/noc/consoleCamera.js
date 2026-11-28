import { normalizeStandCode } from '../../../services/standCodes';
import { MDPC_LAYOUT } from '../../maps/airport/airportLayout';
import { readSelection, writeSelection } from '../../maps/core/mapSelection';
import { attachStandGeometry } from '../../maps/stands/standModel';
import { isDrawn } from '../../maps/traffic/trafficFeatures';

// What the console does with the camera around its panels (contratos 2.5). Pure: ConsolePage.jsx measures and moves.
//
// The panels take room from the map (maps/ui/stageInsets.js), and when that room changes the map's padding changes with
// it, which MapLibre applies as a jump that also stops a camera move under way: what sat near the edge of a panel can
// end up under it. So the console makes its own moves for a selection only once the URL has that selection and the
// panels are measured for it (an aim: `aimKeyOf`, `aimVerdict`), and when the room changes with something chosen it
// brings what is chosen back into the area the panels leave in sight (`freeAreaOf`, `inFreeArea`, `revealOf`).

/**
 * How far inside the area in sight what is chosen has to be, in pixels: the selection ring of an aircraft (18 px and
 * its 2 px stroke) clear of the panels, and a stand's outline with the same room.
 */
export const REVEAL_MARGIN_PX = 20;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isLngLat = point => Array.isArray(point) && point.length >= 2 && finite(point[0]) && finite(point[1]);

/** The key of a selection (`{ kind, id }`) that an aim compares, or '' for none. */
export function selectionKeyOf(selection) {
  if (!selection || typeof selection.kind !== 'string' || selection.id == null) return '';
  const id = String(selection.id).trim();
  return id === '' ? '' : `${selection.kind}:${id}`;
}

/**
 * The key the URL selection will have once the selection `{ kind, id }` is written (maps/core/mapSelection.js): a stand
 * code normalized (A01 is A1), a hex in lower case, a flight id trimmed. '' for what the URL does not select.
 */
export function aimKeyOf(kind, id) {
  return selectionKeyOf(readSelection(writeSelection('', { selection: { kind, id } })).selection);
}

/**
 * What to do with an aim (`{ key, from }`: the selection it waits for and the one the URL had when it was made) now
 * that the URL selects `selection`: `go` once it selects what the aim names; `wait` while it still selects what it did
 * (the URL has not caught up); `drop` once it moved on to anything else; `none` without an aim.
 */
export function aimVerdict(aim, selection) {
  if (!aim) return 'none';
  const key = selectionKeyOf(selection);
  if (key !== '' && key === aim.key) return 'go';
  return key === aim.from ? 'wait' : 'drop';
}

/**
 * The area of the map that the insets leave in sight, `{ left, top, right, bottom }` in pixels from the map's top-left
 * corner (as the map's `project` answers them), for a map of `size` (`{ width, height }`); null when the map has no
 * size or the insets leave nothing of it.
 */
export function freeAreaOf(size, insets) {
  const width = size?.width;
  const height = size?.height;
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return null;
  const inset = side => (finite(insets?.[side]) && insets[side] > 0 ? insets[side] : 0);
  const area = {
    left: inset('left'), top: inset('top'), right: width - inset('right'), bottom: height - inset('bottom'),
  };
  return area.right > area.left && area.bottom > area.top ? Object.freeze(area) : null;
}

/**
 * Whether every pixel of `points` (`{ x, y }`) lies in `area` at least `margin` pixels from its edges. An area
 * narrower than twice its margin keeps only its middle line. False without an area, without points, or with a point
 * the map could not place.
 */
export function inFreeArea(points, area, margin = REVEAL_MARGIN_PX) {
  if (!area || !Array.isArray(points) || points.length === 0) return false;
  const room = finite(margin) && margin > 0 ? margin : 0;
  const padX = Math.min(room, (area.right - area.left) / 2);
  const padY = Math.min(room, (area.bottom - area.top) / 2);
  return points.every(point => finite(point?.x) && finite(point?.y)
    && point.x >= area.left + padX && point.x <= area.right - padX
    && point.y >= area.top + padY && point.y <= area.bottom - padY);
}

/**
 * Where the map draws the stand `code` among `stands` (the stands of the console as useStandDisplay gives them):
 * `{ center, polygon }` from the airport layout or from the location OCC saved, as the map attaches it
 * (stands/standModel.js: attachStandGeometry, with the layout OccMap draws by default), or null.
 */
export function standGeometryOf(stands, code, layout = MDPC_LAYOUT) {
  const wanted = normalizeStandCode(code);
  if (wanted === '') return null;
  const stand = (Array.isArray(stands) ? stands : [])
    .find(item => item != null && typeof item === 'object' && normalizeStandCode(item.id ?? item.code) === wanted);
  return stand ? attachStandGeometry([stand], layout)[0]?.geometry ?? null : null;
}

// What of a stand is checked: its outline, else its centre.
function outlineOf(geometry) {
  const polygon = Array.isArray(geometry?.polygon) ? geometry.polygon.filter(isLngLat) : [];
  if (polygon.length >= 3) return polygon;
  return isLngLat(geometry?.center) ? [geometry.center] : null;
}

/**
 * What the console keeps in sight for the selection, or null when the map draws nothing of it:
 * `{ points: [[lng, lat], …], move }`, the points that have to be in sight and how to bring them back at the same zoom:
 * `{ kind: 'stand', code }` (the map's flyToStand), `{ kind: 'flight', id }` (flyToFlight) or
 * `{ kind: 'point', center }` (an aircraft of other traffic, which flyToFlight cannot name: the map's jumpTo).
 * - `selection`: the URL selection (`{ kind, id }`); `aircraft`: the aircraft the map draws for it (useMapSituation's
 *   `target.aircraft`), with `flightKey` the ELEVANT flight it flies; `standCode`: the stand of a selected flight (the
 *   one the map marks as related); `standGeometry(code)`: where the map draws a stand (standGeometryOf).
 * - A stand: its outline. A flight: its aircraft, else its stand. An aircraft: its position.
 */
export function revealOf({ selection, aircraft = null, flightKey = null, standCode = null, standGeometry = () => null }
  = {}) {
  const kind = selection?.kind;
  if (selection?.id == null) return null;
  if (kind === 'stand') {
    const points = outlineOf(standGeometry(selection.id));
    return points ? { points, move: { kind: 'stand', code: String(selection.id) } } : null;
  }
  const position = isDrawn(aircraft) ? [aircraft.lon, aircraft.lat] : null;
  if (kind === 'flight') {
    if (position) return { points: [position], move: { kind: 'flight', id: String(selection.id) } };
    const points = standCode ? outlineOf(standGeometry(standCode)) : null;
    return points ? { points, move: { kind: 'stand', code: String(standCode) } } : null;
  }
  if (kind === 'aircraft' && position) {
    const move = flightKey ? { kind: 'flight', id: String(flightKey) } : { kind: 'point', center: position };
    return { points: [position], move };
  }
  return null;
}
