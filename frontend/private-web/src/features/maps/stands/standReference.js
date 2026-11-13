import { DASHBOARD_POSITIONS } from '../../dashboard/dashboardPositions';

// The short stand list of Punta Cana that frames the map views: code, terminal and centre of the 41 stands of the
// internal reference catalogue (dashboard/dashboardPositions.js, B33 retired). It is a planning reference, not a
// survey: PR M3 replaces it with the reviewed layout of the airport. Services and screens import only this list,
// never a full layout.
export const STAND_REFERENCE = Object.freeze(DASHBOARD_POSITIONS.map(position => Object.freeze({
  code: position.id,
  terminal: position.terminal,
  longitude: position.lon,
  latitude: position.lat,
})));
