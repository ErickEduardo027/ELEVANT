'use client';

import { useState } from 'react';
import { pointInPolygon } from '../../maps/airport/geo';
import { locationPoint } from '../../maps/airport/standGeometry';
import { STILL_BELOW_MS } from '../../maps/stands/standModel';

// The aircraft positions the console's stands read (maps/traffic/standInputs.js: `aircraftByTurnaround`) move with
// every air-picture read, every 10 s, although a stand reads of its aircraft only whether it is inside the stand's box,
// on the ground and still (maps/stands/standModel.js: describeVisit). Handing the stands a new Map each time rebuilt every
// stand and the map's stand layer for nothing. This keeps the Map the stands were given until what they read of it
// changes: the positions are reduced to that reading.

const NO_STANDS = Object.freeze([]);
const isMovingFast = speed => typeof speed === 'number' && Number.isFinite(speed) && speed >= STILL_BELOW_MS;

function entriesOf(aircraftByTurnaround) {
  if (aircraftByTurnaround instanceof Map) return [...aircraftByTurnaround];
  return aircraftByTurnaround && typeof aircraftByTurnaround === 'object' ? Object.entries(aircraftByTurnaround) : [];
}

// The outline of each stand that lists a turnaround (its `geometry.polygon`, as the stand model reads it; null without).
function outlinesByTurnaround(stands) {
  const outlines = new Map();
  for (const stand of Array.isArray(stands) ? stands : NO_STANDS) {
    if (!stand || typeof stand !== 'object' || !Array.isArray(stand.turnarounds)) continue;
    const polygon = Array.isArray(stand.geometry?.polygon) ? stand.geometry.polygon : null;
    for (const turnaround of stand.turnarounds) {
      const id = turnaround?.turnaroundId;
      if (id == null) continue;
      if (!outlines.has(id)) outlines.set(id, []);
      outlines.get(id).push(polygon);
    }
  }
  return outlines;
}

/**
 * What the stands read of `aircraftByTurnaround` (`{ position: [lng, lat], onGround, gsMs }` per turnaround id), as a
 * string: for each turnaround a stand lists, whether its aircraft is inside each such stand's box (`i`/`o`), has no
 * position (`n`) or the stand has no outline (`x`), and whether it moves. Two positions with the same reading draw the
 * same stands.
 */
export function standAircraftReading(aircraftByTurnaround, stands) {
  const outlines = outlinesByTurnaround(stands);
  const parts = [];
  for (const [id, place] of entriesOf(aircraftByTurnaround)) {
    const polygons = outlines.get(id);
    if (!polygons) continue;
    const point = locationPoint(place?.position ?? place);
    const grounded = place?.onGround !== false;
    const boxes = polygons.map(polygon => {
      if (polygon === null) return 'x';
      if (point === null) return 'n';
      return grounded && pointInPolygon(point, polygon) ? 'i' : 'o';
    }).join('');
    parts.push(`${id}:${boxes}:${isMovingFast(place?.gsMs) ? 'm' : 's'}`);
  }
  return parts.sort().join('|');
}

/**
 * `aircraftByTurnaround` with the identity of the last one whose reading (standAircraftReading) was the same, so the
 * stand display (maps/stands/useStandDisplay.js) and the map keep their stands while the aircraft only move between
 * two reads of the same occupancy.
 */
export function useStandAircraft(aircraftByTurnaround, stands) {
  const reading = standAircraftReading(aircraftByTurnaround, stands);
  const [held, setHeld] = useState(() => ({ reading, value: aircraftByTurnaround }));
  if (held.reading !== reading) {
    setHeld({ reading, value: aircraftByTurnaround });
    return aircraftByTurnaround;
  }
  return held.value;
}
