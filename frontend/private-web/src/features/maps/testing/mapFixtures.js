import { DASHBOARD_POSITIONS } from '../../dashboard/dashboardPositions';

// Synthetic data for the map tests, over the internal reference catalogue of Punta Cana (41 stand points, B33 out).
// The states are invented: three stands of terminal A were placed by OCC, every other stand sits at its reference
// location (so the legend shows the «No oficial» tag for them).
const STAND_STATES = Object.freeze({
  A1: ['occupied', 'occ'],
  A2: ['available', 'occ'],
  A3: ['planned', 'occ'],
  B21: ['disabled', 'reference'],
  BN6: ['unverified', 'reference'],
});

/** The stands of a positions screen: `{ id, terminal, latitude, longitude, status, locationSource }`. */
export function createMapStands(overrides = {}) {
  return DASHBOARD_POSITIONS.map(position => {
    const [status, locationSource] = STAND_STATES[position.id] ?? ['available', 'reference'];
    return {
      id: position.id,
      terminal: position.terminal,
      latitude: position.lat,
      longitude: position.lon,
      status,
      locationSource,
      ...overrides[position.id],
    };
  });
}

/** The reference point of a stand as `[lng, lat]`. */
export function standPoint(code) {
  const position = DASHBOARD_POSITIONS.find(item => item.id === code);
  if (!position) throw new RangeError(`No reference point for stand ${code}`);
  return [position.lon, position.lat];
}
