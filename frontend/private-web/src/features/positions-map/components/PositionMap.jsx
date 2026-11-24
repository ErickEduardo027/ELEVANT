import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import OccMap from '../../maps/core/OccMap';
import { mapMessages } from '../../maps/mapMessages';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import MapDock from '../../maps/ui/MapDock';
import MapFollowButton from '../../maps/ui/MapFollowButton';
import MapLegend from '../../maps/ui/MapLegend';
import MapMotionControl from '../../maps/ui/MapMotionControl';
import MapPresetSwitcher from '../../maps/ui/MapPresetSwitcher';
import { mapStandCode } from '../positionsMapMappers';
import { positionsMapMessages } from '../positionsMapMessages';

const EMPTY = Object.freeze([]);

// The stands map of Mapa de posiciones, Planificación and the console's apron, on the one map engine: a thin adapter
// over OccMap that keeps the props, the imperative handle, the test id and the fallback strings of the map it
// replaces, so its pages need no change. The stands are polygons with their state (PR M4), with a tooltip, the marks of
// the agent who covers them and the camera brought to a selected stand out of sight; the map opens on the ramp of the
// reference catalogue (contracts 2.3), with the view selector and the legend at the bottom. `theme` is accepted and
// ignored: OccMap follows the shell theme on its own. Placing a stand (ADR-0027, Decision D-2): `placing` with
// `onMapClick` gives the clicked point; `placingCode` also draws that stand's box at the pointer and a click gives the
// point it snapped to (`{ latitude, longitude, snapped }`), `pendingLocation` draws the location waiting for «Guardar
// ubicación» and `onCancelPlacing` is what Esc on the map does first. `weather` (PR M8, what useMdpcWeather answers)
// gives the map its wind at the airfield; without it the map draws no weather, as on the console's apron.
// The live traffic (PR M6) is optional and given whole by the screen, inside the OCC frame (maps/MapSituationGate.jsx):
// `traffic` (useMapSituation's, read once when the map starts: the aircraft, their motion and the chosen flight's
// route), `trafficSelection` (the chosen flight or aircraft, `{ kind: 'flight' | 'aircraft', id }`, which takes the
// place of a selected stand: one selection at a time) and `onSelectTraffic(next)` for a click on an aircraft. `children`
// are the screen's overlays on the map (the data block, the traffic's state). The dock adds «Seguir» and «Pausar
// movimiento», which show only on a map that moves its traffic. Without them it is the map it always was.
// `focusSelectedOnStart` (U5): a stand the page opens with (a `stand=` link) is brought to the centre once the map is
// ready, as a row of the list does; it starts with the legend folded. `legendFoldKey` folds the legend when it changes.
// `railTools` (CN-32) are the screen's own map tools, such as Mapa de posiciones' 2D/3D, «Centrar PUJ» and full screen:
// they go in the map's control rail, after «Seguir» and before the pause.
const PositionMap = forwardRef(function PositionMap({
  positions = EMPTY, selectedPositionId = null, onSelectPosition, viewMode = '2d', initialCamera, onCameraChange,
  allowBuildingExtrusion = false, dashboardLabels = false, onMapClick, placing = false, placingCode = null,
  pendingLocation = null, onCancelPlacing, weather, traffic, trafficSelection = null, onSelectTraffic,
  focusSelectedOnStart = false, legendFoldKey = null, railTools = null, children,
}, ref) {
  const { t } = useTranslation(positionsMapMessages);
  const { t: tMap } = useTranslation(mapMessages);
  const mapRef = useRef(null);

  // The map speaks of normalized stand codes; the pages keep their own position ids.
  const positionIdOf = code => positions.find(position => mapStandCode(position.id) === mapStandCode(code))?.id ?? code;
  const selectStand = next => {
    if (next === null) onSelectPosition?.(null);
    else if (next.kind === 'stand') onSelectPosition?.(positionIdOf(next.id));
    else if (next.kind === 'flight' || next.kind === 'aircraft') onSelectTraffic?.(next);
  };
  const trafficKind = trafficSelection?.kind === 'flight' || trafficSelection?.kind === 'aircraft' ? trafficSelection.kind : null;
  const trafficId = trafficKind === null ? null : String(trafficSelection.id);
  const selection = useMemo(() => {
    if (trafficKind !== null) return { kind: trafficKind, id: trafficId };
    return selectedPositionId == null ? null : { kind: 'stand', id: String(selectedPositionId) };
  }, [selectedPositionId, trafficKind, trafficId]);
  const fallbackItems = useMemo(() => positions.map(position => ({
    id: String(position.id), label: String(position.id), kind: 'stand',
  })), [positions]);
  // The stand being placed, with the largest aircraft it takes: a stand the layout does not know gets a box that size.
  const placingStand = useMemo(() => {
    const code = placingCode == null ? '' : mapStandCode(placingCode);
    if (code === '') return null;
    const position = positions.find(item => mapStandCode(item.id) === code);
    return { code, sizeHint: position?.maxAircraftSize ?? null };
  }, [placingCode, positions]);
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
      traffic={traffic}
      standLabels={dashboardLabels ? 'dashboard' : 'default'}
      selection={selection}
      onSelect={selectStand}
      onMapClick={onMapClick}
      placing={placing}
      placingStand={placingStand}
      pendingLocation={pendingLocation}
      onCancelPlacing={onCancelPlacing}
      initialCamera={initialCamera}
      onCameraChange={onCameraChange}
      pitchMode={threeD ? '3d' : '2d'}
      weather={weather}
      groups={{ 'buildings-3d': allowBuildingExtrusion && threeD }}
      labels={{
        unavailableTitle: t('map.unavailableTitle'),
        unavailableDescription: t('map.unavailableDescription'),
        unavailableList: tMap('unavailable.stands'),
      }}
      focusStandOnStart={focusSelectedOnStart}
      fallbackItems={fallbackItems}
      onFallbackSelect={id => onSelectPosition?.(positionIdOf(id))}
    >
      {children}
      <MapDock>
        <MapPresetSwitcher />
        <MapFollowButton />
        {railTools}
        <MapMotionControl />
        {/* A stand a link opens with is brought to the centre: the legend starts folded so it does not cover it. */}
        <MapLegend defaultOpen={!dashboardLabels && !(focusSelectedOnStart && selectedPositionId != null)}
          foldKey={legendFoldKey} />
      </MapDock>
    </OccMap>
  );
});

export default PositionMap;
