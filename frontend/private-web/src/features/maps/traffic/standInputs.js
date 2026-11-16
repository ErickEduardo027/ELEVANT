// What the stands of a screen read from the map situation (PR M6, design D1): the inputs of the stand model
// (stands/standModel.js: deriveDisplayStatus, through stands/useStandDisplay.js) from the situation of
// traffic/situationModel.js (buildSituation), so a stand says «Llegando» until its aircraft is on it, draws that
// aircraft to scale, counts its milestones and asks to record an arrival nobody recorded. It is read at the pace of the
// situation (each read and each `changesAt`), never per frame: the map draws the motion in between.
//
// The same content gives the same object (a small memo by content), so a re-read that changed nothing leaves the stands
// as they are and the map writes nothing. Pure apart from that memo. It imports nothing of the map's drawing, so a screen
// that reads it before its map loads (Planificación) carries none of it.

/** How many inputs the memo keeps: the screens of one tab read one situation, a test a few. */
export const STAND_INPUTS_MEMO_SIZE = 8;

const EMPTY_INPUTS = Object.freeze({ flightsByTurnaround: new Map(), aircraftByTurnaround: new Map() });
// Where an aircraft is, to the decimetre: the stand model reads only whether it is inside a stand box.
const round = (value, digits) => (typeof value === 'number' && Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const turnaroundOf = value => (typeof value === 'string' && value.trim() !== '' ? value : null);
const finite = value => typeof value === 'number' && Number.isFinite(value);
// An aircraft the map draws (traffic/trafficFeatures.js: isDrawn): a position, and no stand of an ELEVANT visit hiding it.
const isDrawn = item => item != null && item.hiddenInStand !== true && finite(item.lon) && finite(item.lat);
// A position from a fix before one estimated from the schedule, when a visit has both.
const RANK = Object.freeze({ live: 0, stale: 1, estimated: 2 });
const rankOf = quality => RANK[quality] ?? 1;

const memo = new Map();

function remember(key, inputs) {
  memo.delete(key);
  memo.set(key, inputs);
  while (memo.size > STAND_INPUTS_MEMO_SIZE) memo.delete(memo.keys().next().value);
  return inputs;
}

/**
 * The inputs of the stand model from a map `situation` (buildSituation's `{ flights, aircraft }`):
 * - `flightsByTurnaround`: each turnaround id of the map flights with its legs (rows of contracts 1.3, in their order);
 *   a proposal nobody imported has no turnaround and is left out;
 * - `aircraftByTurnaround`: each turnaround id whose ELEVANT aircraft the map draws (isDrawn), live or estimated, with
 *   `{ position: [lng, lat], onGround, gsMs, quality }`; a position from a fix wins over one estimated for the same
 *   visit.
 * Without a situation, two empty Maps (always the same object): a screen outside the OCC frame reads as before.
 */
export function standInputsOf(situation) {
  const rows = Array.isArray(situation?.flights) ? situation.flights : [];
  const aircraft = Array.isArray(situation?.aircraft) ? situation.aircraft : [];
  if (rows.length === 0 && aircraft.length === 0) return EMPTY_INPUTS;

  const legs = new Map();
  for (const row of rows) {
    const turnaroundId = turnaroundOf(row?.turnaroundId);
    if (turnaroundId === null) continue;
    if (!legs.has(turnaroundId)) legs.set(turnaroundId, []);
    legs.get(turnaroundId).push(row);
  }
  const places = new Map();
  for (const item of aircraft) {
    const turnaroundId = turnaroundOf(item?.turnaroundId);
    if (item?.kind !== 'aviam' || turnaroundId === null || !isDrawn(item)) continue;
    const held = places.get(turnaroundId);
    if (held && rankOf(held.quality) <= rankOf(item.quality)) continue;
    places.set(turnaroundId, {
      position: [round(item.lon, 6), round(item.lat, 6)],
      onGround: item.onGround === true,
      gsMs: round(item.gsMs, 1),
      quality: typeof item.quality === 'string' ? item.quality : null,
    });
  }

  const key = JSON.stringify([[...legs.entries()], [...places.entries()]]);
  const known = memo.get(key);
  if (known) return remember(key, known);
  return remember(key, Object.freeze({
    flightsByTurnaround: new Map([...legs.entries()].map(([id, list]) => [id, Object.freeze(list)])),
    aircraftByTurnaround: new Map([...places.entries()].map(([id, place]) => [id, Object.freeze({
      ...place, position: Object.freeze(place.position),
    })])),
  }));
}
