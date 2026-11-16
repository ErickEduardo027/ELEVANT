// Who reads an OCC map (contracts 1.3, OccMapAccess; ADR-0042): any of these permissions, for a station in scope. The
// air picture, the map flights and the aerodrome weather share the rule. The list lives on its own so that a reader
// outside the map, such as the weather of features/weather/useMdpcWeather.js, gates on it without loading the map's
// modules (useMapSituation pulls the airport layout); useMapSituation exports it as well.

/** Any of them lets an OCC account read the map (contracts 1.3, OccMapAccess). */
export const MAP_PERMISSIONS = Object.freeze(['operations.dashboard.read', 'operations.flight_monitoring.read',
  'operations.positions_map.read', 'operations.planning.read']);
