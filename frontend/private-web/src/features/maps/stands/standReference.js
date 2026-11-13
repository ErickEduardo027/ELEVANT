import { DASHBOARD_POSITIONS } from '../../dashboard/dashboardPositions';

// The short stand list of Punta Cana: code, terminal and centre of the 41 stands of the internal reference catalogue
// (dashboard/dashboardPositions.js, B33 retired). The maps find a stand by its code in it, to centre or mark it, and
// frame the views with it only when they have no airport layout: with the MDPC layout (PR M3) the layout's box and
// stand polygons frame them. It is a planning reference, not a survey. Its centres are the stand centres of the MDPC
// layout, since both come from positionsData.js (airportLayout.test.js checks the layout's); PR M4 decides whether
// this list moves to the reviewed layout. Services and screens import only this list, never a full layout.
export const STAND_REFERENCE = Object.freeze(DASHBOARD_POSITIONS.map(position => Object.freeze({
  code: position.id,
  terminal: position.terminal,
  longitude: position.lon,
  latitude: position.lat,
})));
