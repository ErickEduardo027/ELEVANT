'use client';

import { Suspense, lazy, useMemo } from 'react';
import { useOptionalOccShellChannel } from '../admin-occ/shell/occShellContext';
import { useOccStation } from '../admin-occ/useOccStation';
import { useOccMap } from './core/OccMapContext';
import FlightDataBlock from './ui/FlightDataBlock';
import MapSourceStatus from './ui/MapSourceStatus';

// What a screen with an OCC map reads of the sky and of the ELEVANT flights (PR M6): the map situation of the station of
// the session (useMapSituation: the air picture, the map flights and the chosen aircraft's track, at the cadences of
// contracts 2.7), only inside the OCC frame, whose shell drives the reads. Outside it (an isolated screen, the page
// tests) the screen gets nothing and nothing is read, so it works as it did before the live traffic. Mapa de posiciones
// and Planificación take their stands' inputs and their traffic from it; Monitoreo has its own (FlightMap.jsx).
//
// The reads, the motion and the airport layout they plan with come in a chunk of their own (React.lazy): a screen that
// opens without its map, as Planificación on its timeline does, loads none of it until its map shows. While that chunk
// loads, the screen shows `fallback` instead (its own loading state): the map must start with its traffic, because
// OccMap reads at start whether it draws any.

/** The kinds of the URL selection the live situation reads (contracts 2.1): a flight, or an aircraft by its address. */
export function trafficSelectionOf(selection) {
  return selection?.kind === 'flight' || selection?.kind === 'aircraft' ? selection : null;
}

const LiveSituation = lazy(() => Promise.all([import('./useMapSituation'), import('./airport/airportLayout')])
  .then(([{ useMapSituation }, { MDPC_LAYOUT }]) => ({
    default: function LiveSituation({ selection, allTrails, service, children }) {
      const { stationId } = useOccStation();
      const live = useMapSituation({
        stationId, selection, selectedHex: selection?.kind === 'aircraft' ? selection.id : null, allTrails, service,
      });
      // The station and the airport layout the map draws, next to the situation: the screen places its stands with
      // the same layout (stands/standModel.js: attachStandGeometry), so their states read the aircraft in their boxes.
      const value = useMemo(() => ({ ...live, stationId, layout: MDPC_LAYOUT }), [live, stationId]);
      return children(value);
    },
  })));

/**
 * Gives `children` (a function) the live situation of the station's map: useMapSituation's answer plus `stationId` and
 * `layout` (the MDPC airport layout), or `null` outside the OCC frame, where nothing is read.
 * - `selection`: the URL selection (useMapSelection); only a flight or an aircraft goes to the reads (its route, its
 *   track, the data block's target).
 * - `allTrails`: also the trails of the other traffic (only a screen with the layers menu shows them).
 * - `service`: the map reads (src/services/occMapService.js by default; the simulated adapter in tests).
 * - `fallback`: what the screen shows inside the frame while the live chunk loads.
 */
export default function MapSituationGate({ selection = null, allTrails = false, service, fallback = null, children }) {
  const channel = useOptionalOccShellChannel();
  const traffic = trafficSelectionOf(selection);
  if (!channel) return children(null);
  return (
    <Suspense fallback={fallback}>
      <LiveSituation selection={traffic} allTrails={allTrails} service={service}>{children}</LiveSituation>
    </Suspense>
  );
}

// The data block is docked at the top left of the map unless a screen keeps that corner for its own tools.
const DOCKED_BLOCK_STYLE = Object.freeze({ top: 12, left: 12 });

/**
 * The overlays of the live map, inside the screen's OccMap: the state and the credit of the air traffic
 * (ui/MapSourceStatus.jsx) and the data block of the chosen flight or aircraft (ui/FlightDataBlock.jsx), docked at
 * `blockStyle`, with «Seguir» when the map can follow. Nothing without `live` (outside the OCC frame); no data block while
 * nothing is chosen or while the map cannot draw (its fallback list stands in for it). `onClose` is the block's
 * «Cerrar».
 */
export function MapSituationOverlays({ live, onClose, blockStyle = DOCKED_BLOCK_STYLE }) {
  const { engineStatus, follow } = useOccMap();
  if (!live) return null;
  return (
    <>
      <MapSourceStatus status={live.status} picture={live.picture} sourceState={live.sourceState} clock={live.clock}
        onRetry={live.retry} />
      {live.target && engineStatus !== 'unavailable' && (
        <FlightDataBlock target={live.target} telemetry={live.telemetry} station={live.flights?.stationAirport ?? null}
          stationId={live.stationId ?? null} onClose={onClose} onFollow={follow.available ? follow.toggle : null}
          following={follow.following} style={blockStyle} />
      )}
    </>
  );
}
