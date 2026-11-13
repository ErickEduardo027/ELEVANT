import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { PUJ_ARP, defaultFlightView, lngLatOf } from '../../maps/core/cameraPresets';
import OccMap from '../../maps/core/OccMap';
import { mapMessages } from '../../maps/mapMessages';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import MapDock from '../../maps/ui/MapDock';
import MapLegend from '../../maps/ui/MapLegend';
import MapPresetSwitcher from '../../maps/ui/MapPresetSwitcher';
import { flightMonitoringMessages } from '../flightMonitoringMessages';
import { CrosshairIcon, RotateCcwIcon } from './icons';

const EMPTY = Object.freeze([]);
// Room left around the flights and PUJ when «Restablecer vista» frames them.
const RESET_PADDING_PX = 60;

const findFlight = (flights, id) => (id == null ? null : flights.find(flight => String(flight.id) === String(id)) ?? null);

const toolClass = 'flex min-h-11 min-w-11 items-center justify-center rounded border border-occ-line bg-occ-panel '
  + 'text-occ-text hover:bg-occ-panel-raised';

// The map of Monitoreo de vuelos on the one map engine: a thin adapter over OccMap over the NOC style. It opens on the
// region, or on the approach when the linked flight is within 40 NM (contracts 2.3), draws the flights that carry a
// position as symbols, and keeps «Restablecer vista» and «Centrar PUJ». The detail card is docked by the page, so
// nothing follows the aircraft on screen. `theme` is accepted and ignored: the OCC maps are dark only.
export default function FlightMap({ flights = EMPTY, selectedFlightId = null, onSelectFlight }) {
  const { t } = useTranslation(flightMonitoringMessages);
  const { t: tMap } = useTranslation(mapMessages);
  const mapRef = useRef(null);
  const [defaultView] = useState(() => defaultFlightView(findFlight(flights, selectedFlightId)));
  // The flight the map last flew to; the one it opens with is framed by its view.
  const flownRef = useRef(selectedFlightId);

  const selection = useMemo(() => (selectedFlightId == null ? null : { kind: 'flight', id: String(selectedFlightId) }),
    [selectedFlightId]);
  const fallbackItems = useMemo(() => flights.map(flight => ({
    id: String(flight.id), label: flight.flightNumber ?? String(flight.id), kind: 'flight',
  })), [flights]);
  // The page keeps its own flight ids (numbers in the planning feed); the map speaks of them as text.
  const selectFlight = id => onSelectFlight?.(findFlight(flights, id)?.id ?? id);
  const handleSelect = next => {
    if (next === null) onSelectFlight?.(null);
    else if (next.kind === 'flight') selectFlight(next.id);
  };

  // A newly selected flight is brought to the centre once it has a position.
  useEffect(() => {
    if (selectedFlightId == null || flownRef.current === selectedFlightId) {
      flownRef.current = selectedFlightId;
      return;
    }
    if (mapRef.current?.flyToFlight(String(selectedFlightId))) flownRef.current = selectedFlightId;
  }, [selectedFlightId, flights]);

  function resetView() {
    const points = flights.map(lngLatOf).filter(Boolean);
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
      flights={flights}
      selection={selection}
      onSelect={handleSelect}
      labels={{
        unavailableTitle: t('map.unavailableTitle'),
        unavailableDescription: t('map.unavailableDescription'),
        unavailableList: tMap('unavailable.flights'),
      }}
      fallbackItems={fallbackItems}
      onFallbackSelect={selectFlight}
    >
      <MapDock>
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
