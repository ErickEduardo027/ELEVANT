import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useOptionalOccShellChannel } from '../../admin-occ/shell/occShellContext';
import { useOccStation } from '../../admin-occ/useOccStation';
import { PUJ_ARP, defaultFlightView, lngLatOf } from '../../maps/core/cameraPresets';
import { matchFlight } from '../../maps/core/mapSelection';
import OccMap from '../../maps/core/OccMap';
import { useOccMap } from '../../maps/core/OccMapContext';
import { useMapSelection } from '../../maps/core/useMapSelection';
import { mapMessages } from '../../maps/mapMessages';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import { isDrawn } from '../../maps/traffic/trafficFeatures';
import FlightDataBlock from '../../maps/ui/FlightDataBlock';
import MapDock from '../../maps/ui/MapDock';
import MapLayersMenu from '../../maps/ui/MapLayersMenu';
import MapLegend from '../../maps/ui/MapLegend';
import MapPresetSwitcher from '../../maps/ui/MapPresetSwitcher';
import MapSourceStatus from '../../maps/ui/MapSourceStatus';
import { useMapSituation } from '../../maps/useMapSituation';
import { flightMonitoringMessages } from '../flightMonitoringMessages';
import { CrosshairIcon, RotateCcwIcon } from './icons';

const EMPTY = Object.freeze([]);
// Room left around the flights and PUJ when «Restablecer vista» frames them.
const RESET_PADDING_PX = 60;
// The data block is docked at the top left of the map, so it never follows the aircraft on screen.
const DOCKED_BLOCK_STYLE = Object.freeze({ top: 12, left: 12 });

const findFlight = (flights, id) => (id == null ? null : flights.find(flight => String(flight.id) === String(id)) ?? null);

const toolClass = 'flex min-h-11 min-w-11 items-center justify-center rounded border border-occ-line bg-occ-panel '
  + 'text-occ-text hover:bg-occ-panel-raised';

// The map of Monitoreo de vuelos on the one map engine: a thin adapter over OccMap over the NOC style. It opens on the
// region, or on the approach when the linked flight is within 40 NM (contracts 2.3), draws the flights that carry a
// position as symbols, which its legend explains while one is on screen, and keeps «Restablecer vista» and «Centrar
// PUJ». Inside the OCC shell it also draws the live traffic, the data block of the chosen aircraft and the layers menu
// (LiveFlightMap). `detail` is the page's own card of its selected flight: the plain map shows it, the live map only
// for a flight it does not know. `theme` is accepted and ignored: the OCC maps are dark only.
function FlightMapView({
  flights = EMPTY, selectedFlightId = null, onSelectFlight, traffic, drawnFlights, selection: chosen, onSelect,
  framePoints = EMPTY, children,
}) {
  const { t } = useTranslation(flightMonitoringMessages);
  const { t: tMap } = useTranslation(mapMessages);
  const mapRef = useRef(null);
  const [defaultView] = useState(() => defaultFlightView(findFlight(flights, selectedFlightId)));
  // The flight the map last flew to; the one it opens with is framed by its view.
  const flownRef = useRef(selectedFlightId);

  const flightSelection = useMemo(() => (selectedFlightId == null ? null : { kind: 'flight', id: String(selectedFlightId) }),
    [selectedFlightId]);
  const selection = chosen === undefined ? flightSelection : chosen;
  const fallbackItems = useMemo(() => flights.map(flight => ({
    id: String(flight.id), label: flight.flightNumber ?? String(flight.id), kind: 'flight',
  })), [flights]);
  // The page keeps its own flight ids (numbers in the planning feed); the map speaks of them as text.
  const selectFlight = id => onSelectFlight?.(findFlight(flights, id)?.id ?? id);
  const handleSelect = next => {
    if (next === null) onSelectFlight?.(null);
    else if (next.kind === 'flight') selectFlight(next.id);
  };

  // A newly selected flight is brought to the centre once it has a position: its own, or its aircraft's.
  const trafficAircraft = traffic?.aircraft;
  useEffect(() => {
    if (selectedFlightId == null || flownRef.current === selectedFlightId) {
      flownRef.current = selectedFlightId;
      return;
    }
    if (mapRef.current?.flyToFlight(String(selectedFlightId))) flownRef.current = selectedFlightId;
  }, [selectedFlightId, flights, trafficAircraft]);

  function resetView() {
    const points = [...flights.map(lngLatOf).filter(Boolean), ...framePoints];
    if (points.length === 0) mapRef.current?.flyToPreset('region');
    else mapRef.current?.flyToBounds([PUJ_ARP, ...points], { padding: RESET_PADDING_PX });
  }

  return (
    <OccMap
      ref={mapRef}
      testId="flight-map-container"
      className="rounded-md"
      defaultView={defaultView}
      presetStands={STAND_REFERENCE}
      flights={drawnFlights ?? flights}
      traffic={traffic}
      selection={selection}
      onSelect={onSelect ?? handleSelect}
      labels={{
        unavailableTitle: t('map.unavailableTitle'),
        unavailableDescription: t('map.unavailableDescription'),
        unavailableList: tMap('unavailable.flights'),
      }}
      fallbackItems={fallbackItems}
      onFallbackSelect={selectFlight}
    >
      {children}
      <MapDock>
        <MapLayersMenu />
        <MapPresetSwitcher />
        <button type="button" onClick={resetView} title={t('map.resetView')} aria-label={t('map.resetView')} className={toolClass}>
          <RotateCcwIcon className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => mapRef.current?.flyToPreset('approach')} title={t('map.centerPuj')}
          aria-label={t('map.centerPuj')} className={toolClass}>
          <CrosshairIcon className="h-4 w-4" />
        </button>
        <MapLegend />
      </MapDock>
    </OccMap>
  );
}

/**
 * Monitoreo inside the OCC shell: the same map with the live traffic of the station (useMapSituation over the air
 * picture and the map flights, at the cadences of contracts 2.7). The page's flights (ids are leg ids) are joined to
 * the map flights with matchFlight: a flight whose aircraft the traffic draws is drawn once, as traffic, and a click on
 * it selects the page's flight; one with no page row is selected by its key. A click on other traffic writes `hex=`.
 * The state of the traffic and the credit of its source sit over the map (MapSourceStatus). The chosen flight or
 * aircraft has its data block docked at the top left (FlightDataBlock) and its route on the map; a flight of the page
 * the map does not know (outside its window, or while the map cannot read its flights) keeps the page's own card, as
 * does every flight of the page while the map cannot draw.
 */
function LiveFlightMap({ flights = EMPTY, selectedFlightId = null, onSelectFlight, detail = null }) {
  const { stationId } = useOccStation();
  const { selection: urlSelection, selectAircraft, clear } = useMapSelection();
  const selectedHex = urlSelection?.kind === 'aircraft' ? urlSelection.id : null;
  // One selection at a time: the page's flight, else the aircraft of the URL.
  const selection = useMemo(() => {
    if (selectedFlightId != null) return { kind: 'flight', id: String(selectedFlightId) };
    return selectedHex === null ? null : { kind: 'aircraft', id: selectedHex };
  }, [selectedFlightId, selectedHex]);
  // Every trail is read: the layers menu shows the other traffic's only while «Estelas de todo el tráfico» is on.
  const live = useMapSituation({ stationId, selectedHex, selection, allTrails: true });
  const { situation, trails, target, route } = live;
  const mapFlights = situation.flights;

  const traffic = useMemo(() => ({ aircraft: situation.aircraft, trails, route, source: situation.source }),
    [route, situation, trails]);
  // The ELEVANT flights the traffic draws, by key: the page does not draw them a second time.
  const drawnKeys = useMemo(() => new Set(situation.aircraft
    .filter(item => item.kind === 'aviam' && isDrawn(item)).map(item => item.flightKey)), [situation]);
  const drawnFlights = useMemo(() => flights.filter(flight => !drawnKeys.has(matchFlight(mapFlights, flight.id)?.flightKey)),
    [drawnKeys, flights, mapFlights]);
  const framePoints = useMemo(() => situation.aircraft.filter(item => item.kind === 'aviam' && isDrawn(item))
    .map(item => [item.lon, item.lat]), [situation]);

  useEffect(() => {
    if (selectedFlightId != null && selectedHex !== null) clear();
  }, [clear, selectedFlightId, selectedHex]);

  const handleSelect = next => {
    if (next?.kind === 'aircraft') {
      onSelectFlight?.(null);
      selectAircraft(next.id);
      return;
    }
    if (selectedHex !== null) clear();
    if (next === null) {
      onSelectFlight?.(null);
      return;
    }
    if (next.kind !== 'flight') return;
    // A flight key from the traffic names the page's flight through its leg; without a page row it keeps its key.
    const page = findFlight(flights, next.id) ?? findFlight(flights, matchFlight(mapFlights, next.id)?.legId);
    onSelectFlight?.(page?.id ?? next.id);
  };

  const nowMs = Math.max(live.picture?.serverTime ?? 0, live.flights?.serverTime ?? 0) || null;
  // The page's card only once the map has answered: for a page flight it does not know, or while it cannot draw.
  const pageDetail = selectedFlightId != null && live.status !== 'loading' ? detail : null;
  return (
    <FlightMapView flights={flights} selectedFlightId={selectedFlightId} onSelectFlight={onSelectFlight} traffic={traffic}
      drawnFlights={drawnFlights} selection={selection} onSelect={handleSelect} framePoints={framePoints}>
      <MapSourceStatus status={live.status} picture={live.picture} sourceState={live.sourceState}
        refreshFailed={live.refreshFailed} nowMs={nowMs} onRetry={live.retry} />
      <SelectionCard target={target} detail={pageDetail} telemetry={live.telemetry}
        station={live.flights?.stationAirport ?? null} stationId={stationId} onClose={() => handleSelect(null)} />
    </FlightMapView>
  );
}

/**
 * The card of the live map's selection, inside the map: the data block of what the map knows, docked at the top left;
 * the page's own card (`detail`) for a page flight the map does not know, and while the map cannot draw (its fallback
 * list covers the map, and the data block is one of the map's overlays).
 */
function SelectionCard({ target, detail, ...block }) {
  const { engineStatus } = useOccMap();
  if (target === null || engineStatus === 'unavailable') return detail;
  return <FlightDataBlock target={target} style={DOCKED_BLOCK_STYLE} {...block} />;
}

/**
 * The map of Monitoreo de vuelos. Inside the OCC shell (its channel present) it draws the live traffic of the station
 * (LiveFlightMap); elsewhere (isolated screens and the tests) the same map without live traffic, with the page's card
 * of its selected flight (`detail`).
 */
export default function FlightMap({ detail = null, ...props }) {
  const channel = useOptionalOccShellChannel();
  return channel ? <LiveFlightMap {...props} detail={detail} /> : <FlightMapView {...props}>{detail}</FlightMapView>;
}
