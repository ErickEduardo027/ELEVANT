import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Map as MaplibreMap, NavigationControl, AttributionControl, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../positionsMapMappers';
import { attachPositionsLayers, updatePositionsData, setSelectedPositionFilter } from './positionMapLayers';
import { OSM_ATTRIBUTION, basemapStyleUrl, resolveOpenFreeMapSpriteGaps } from '../../maps/basemapStyles';
import { attachAerowayLayers } from '../../maps/aerowayLayers';
import { collapseCompactAttribution } from '../../maps/collapseCompactAttribution';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

// OpenStreetMap (vía OpenMapTiles/OpenFreeMap) — nunca Google Maps ni Mapbox; estilos en
// maps/basemapStyles. El estilo "liberty" incluye una capa building-3d con datos reales de altura
// (render_height) para el modo 3D; el estilo "dark" de OpenFreeMap no define esa capa —
// limitación real de la fuente, no simulada. Las pistas se resaltan con la geometría OSM.
const DEFAULT_ZOOM = 15;
const FOCUS_ZOOM = 17;
const PITCH_3D = 55;
const BEARING_3D = -17;
const DASHBOARD_BUILDINGS_LAYER = 'elevant-dashboard-tile-buildings';
const motionDuration = milliseconds => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : milliseconds;

function attachDashboardBuildings(map, theme, viewMode) {
  // Only extrude features with a published tile height. No guessed building
  // height or runway lighting is introduced for the night presentation.
  if (theme !== 'dark' || !map.getSource('openmaptiles')) return;
  if (!map.getLayer(DASHBOARD_BUILDINGS_LAYER)) {
    map.addLayer({
      id: DASHBOARD_BUILDINGS_LAYER,
      source: 'openmaptiles',
      'source-layer': 'building',
      type: 'fill-extrusion',
      filter: ['has', 'render_height'],
      layout: { visibility: viewMode === '3d' ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': '#213b56',
        'fill-extrusion-height': ['to-number', ['get', 'render_height']],
        'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'render_min_height']], 0],
        'fill-extrusion-opacity': 0.72,
      },
    });
  }
}

function boundsFromPositions(positions) {
  if (positions.length === 0) return null;
  const bounds = new LngLatBounds();
  positions.forEach(position => bounds.extend([position.longitude, position.latitude]));
  return bounds;
}

// `initialCamera` y `onCameraChange` permiten que una vista ampliada abra donde el usuario
// dejó el mapa compacto (y viceversa) sin reiniciar la selección.
const PositionMap = forwardRef(function PositionMap({
  positions, selectedPositionId, onSelectPosition, theme, viewMode, initialCamera, onCameraChange,
  allowBuildingExtrusion = false, dashboardLabels = false,
}, ref) {
  const { t } = useTranslation(positionsMapMessages);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const detachLayersRef = useRef(() => {});
  const hasFitRef = useRef(false);
  const isInitialThemeRef = useRef(true);

  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const selectedPositionIdRef = useRef(selectedPositionId);
  selectedPositionIdRef.current = selectedPositionId;
  const onSelectPositionRef = useRef(onSelectPosition);
  onSelectPositionRef.current = onSelectPosition;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const initialCameraRef = useRef(initialCamera);

  useEffect(() => {
    let map;
    let ready = false;
    let disposed = false;
    try {
      setWorkerUrl('/assets/maplibre/maplibre-gl-worker.mjs');
      map = new MaplibreMap({
      container: containerRef.current,
      style: basemapStyleUrl(theme),
      center: initialCameraRef.current?.center ?? [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
      zoom: initialCameraRef.current?.zoom ?? DEFAULT_ZOOM,
      pitch: initialCameraRef.current?.pitch ?? (viewModeRef.current === '3d' ? PITCH_3D : 0),
      bearing: initialCameraRef.current?.bearing ?? (viewModeRef.current === '3d' ? BEARING_3D : 0),
      attributionControl: false,
      });
    } catch {
      setMapUnavailable(true);
      return undefined;
    }
    resolveOpenFreeMapSpriteGaps(map);
    const timeout = setTimeout(() => {
      if (!ready && !disposed) setMapUnavailable(true);
    }, 8000);
    const handleIdle = () => {
      ready = true;
      clearTimeout(timeout);
      if (!disposed) setMapUnavailable(false);
    };
    const handleError = () => {
      if (!ready && !disposed) setMapUnavailable(true);
    };
    map.on('idle', handleIdle);
    map.on('error', handleError);
    map.addControl(new NavigationControl(), 'top-right');
    map.addControl(new AttributionControl({ compact: true, customAttribution: OSM_ATTRIBUTION }), 'bottom-right');
    if (allowBuildingExtrusion) collapseCompactAttribution(map);

    if (initialCameraRef.current) hasFitRef.current = true;
    const handleMoveEnd = () => {
      const center = map.getCenter();
      onCameraChangeRef.current?.({ center: [center.lng, center.lat], zoom: map.getZoom(),
        bearing: map.getBearing(), pitch: map.getPitch() });
    };
    map.on('moveend', handleMoveEnd);

    function setupLayers() {
      attachAerowayLayers(map, { theme: themeRef.current });
      if (allowBuildingExtrusion) attachDashboardBuildings(map, themeRef.current, viewModeRef.current);
      detachLayersRef.current();
      detachLayersRef.current = attachPositionsLayers(map, {
        positions: positionsRef.current,
        selectedPositionId: selectedPositionIdRef.current,
        onSelectPosition: id => onSelectPositionRef.current(id),
        theme: themeRef.current, dashboardLabels,
      });

      if (!hasFitRef.current) {
        hasFitRef.current = true;
        const bounds = boundsFromPositions(positionsRef.current);
        if (bounds) map.fitBounds(bounds, { padding: 70, duration: 0 });
      }
    }

    map.on('style.load', setupLayers);

    mapRef.current = map;

    return () => {
      disposed = true;
      clearTimeout(timeout);
      map.off('idle', handleIdle);
      map.off('error', handleError);
      map.off('style.load', setupLayers);
      map.off('moveend', handleMoveEnd);
      detachLayersRef.current();
      map.remove();
      mapRef.current = null;
      hasFitRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount once; theme/viewMode changes handled by the effects below.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isInitialThemeRef.current) {
      isInitialThemeRef.current = false;
      return;
    }
    map.setStyle(basemapStyleUrl(theme));
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updatePositionsData(map, positions);
  }, [positions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setSelectedPositionFilter(map, selectedPositionId);
  }, [selectedPositionId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (allowBuildingExtrusion && map.getLayer(DASHBOARD_BUILDINGS_LAYER)) {
      map.setLayoutProperty(DASHBOARD_BUILDINGS_LAYER, 'visibility', viewMode === '3d' ? 'visible' : 'none');
    }
    map.easeTo({
      pitch: viewMode === '3d' ? PITCH_3D : 0,
      bearing: viewMode === '3d' ? BEARING_3D : 0,
      duration: motionDuration(600),
    });
  }, [viewMode, allowBuildingExtrusion]);

  useImperativeHandle(ref, () => ({
    flyToPosition(id) {
      const map = mapRef.current;
      const position = positionsRef.current.find(item => item.id === id);
      if (!map || !position) return;
      const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
      map.flyTo({ center: [position.longitude, position.latitude], zoom, duration: motionDuration(700) });
    },
    flyToBounds(coords) {
      const map = mapRef.current;
      if (!map || coords.length === 0) return;
      const bounds = new LngLatBounds();
      coords.forEach(([lng, lat]) => bounds.extend([lng, lat]));
      map.fitBounds(bounds, { padding: 70, duration: motionDuration(700) });
    },
    flyToAll() {
      const map = mapRef.current;
      const bounds = boundsFromPositions(positionsRef.current);
      if (!map || !bounds) return;
      map.fitBounds(bounds, { padding: 70, duration: motionDuration(700) });
    },
    flyToPuj() {
      mapRef.current?.flyTo({ center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude], zoom: DEFAULT_ZOOM, duration: motionDuration(700) });
    },
    resetNorth() {
      mapRef.current?.resetNorth({ duration: motionDuration(400) });
    },
  }));

  return (
    <div className="absolute inset-0 overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="position-map-container" className="h-full w-full" />
      {mapUnavailable && <div role="alert" className="absolute inset-0 z-20 overflow-y-auto bg-white/95 p-5 text-ink-900 dark:bg-surface-dark-card/95 dark:text-text-primary-dark">
        <h3 className="text-base font-semibold">{t('map.unavailableTitle')}</h3>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{t('map.unavailableDescription')}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">{positions.map(position =>
          <button key={position.id} type="button" onClick={() => onSelectPosition(position.id)}
            aria-pressed={position.id === selectedPositionId}
            className="min-h-11 rounded-lg border border-accent-600/30 px-2 py-2 text-sm font-semibold hover:bg-accent-600/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600">
            {position.id}
          </button>)}</div>
      </div>}
    </div>
  );
});

export default PositionMap;
