import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import OccMap from '../../maps/core/OccMap';
import { mapMessages } from '../../maps/mapMessages';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import MapDock from '../../maps/ui/MapDock';
import MapLegend from '../../maps/ui/MapLegend';
import MapPresetSwitcher from '../../maps/ui/MapPresetSwitcher';
import { mapStandCode } from '../positionsMapMappers';
import { positionsMapMessages } from '../positionsMapMessages';

const EMPTY = Object.freeze([]);

// The stands map of Mapa de posiciones, Planificación and the console's apron, on the one map engine: a thin adapter
// over OccMap that keeps the props, the imperative handle, the test id and the fallback strings of the map it
// replaces, so its pages need no change. The stands are points with today's meaning, drawn and clustered through the
// stands slot; the map opens on the ramp of the reference catalogue (contracts 2.3), with the view selector and the
// legend at the bottom. `theme` is accepted and ignored: the OCC maps have one dark style and never swap it.
const PositionMap = forwardRef(function PositionMap({
  positions = EMPTY, selectedPositionId = null, onSelectPosition, viewMode = '2d', initialCamera, onCameraChange,
  allowBuildingExtrusion = false, dashboardLabels = false, onMapClick, placing = false,
}, ref) {
  const { t } = useTranslation(positionsMapMessages);
  const { t: tMap } = useTranslation(mapMessages);
  const mapRef = useRef(null);

  // The map speaks of normalized stand codes; the pages keep their own position ids.
  const positionIdOf = code => positions.find(position => mapStandCode(position.id) === mapStandCode(code))?.id ?? code;
  const selectStand = next => {
    if (next === null) onSelectPosition?.(null);
    else if (next.kind === 'stand') onSelectPosition?.(positionIdOf(next.id));
  };
  const selection = useMemo(() => (selectedPositionId == null ? null : { kind: 'stand', id: String(selectedPositionId) }),
    [selectedPositionId]);
  const fallbackItems = useMemo(() => positions.map(position => ({
    id: String(position.id), label: String(position.id), kind: 'stand',
  })), [positions]);
  const threeD = viewMode === '3d';

  useImperativeHandle(ref, () => ({
    // A stand comes at least a step past the ramp fit (OccMap derives it from the screen).
    flyToPosition: id => mapRef.current?.flyToStand(id),
    flyToBounds: coords => mapRef.current?.flyToBounds(coords),
    // Frames the positions the page shows, as it always did.
    flyToAll: () => mapRef.current?.flyToBounds(positions.map(position => [position.longitude, position.latitude])),
    flyToPuj: () => mapRef.current?.flyToPuj(),
    resetNorth: () => mapRef.current?.resetNorth(),
  }), [positions]);

  return (
    <OccMap
      ref={mapRef}
      testId="position-map-container"
      className="rounded-md"
      defaultView="ramp"
      presetStands={STAND_REFERENCE}
      stands={positions}
      standLabels={dashboardLabels ? 'dashboard' : 'default'}
      selection={selection}
      onSelect={selectStand}
      onMapClick={onMapClick}
      placing={placing}
      initialCamera={initialCamera}
      onCameraChange={onCameraChange}
      pitchMode={threeD ? '3d' : '2d'}
      groups={{ 'buildings-3d': allowBuildingExtrusion && threeD }}
      labels={{
        unavailableTitle: t('map.unavailableTitle'),
        unavailableDescription: t('map.unavailableDescription'),
        unavailableList: tMap('unavailable.stands'),
      }}
      fallbackItems={fallbackItems}
      onFallbackSelect={id => onSelectPosition?.(positionIdOf(id))}
    >
      <MapDock>
        <MapPresetSwitcher />
        <MapLegend defaultOpen={!dashboardLabels} />
      </MapDock>
    </OccMap>
  );
});

export default PositionMap;
