import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Map as MaplibreMap, NavigationControl, AttributionControl, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../positionsMapMappers';
import { attachPositionsLayers, updatePositionsData, setSelectedPositionFilter } from './positionMapLayers';

// OpenStreetMap (vía OpenMapTiles/OpenFreeMap) — nunca Google Maps ni Mapbox. Configurable por
// entorno, con el mismo mecanismo NEXT_PUBLIC_*_STYLE_* que ya usa FlightMap. El estilo "liberty" incluye
// una capa building-3d con datos reales de altura (render_height) para el modo 3D; el estilo
// "dark" de OpenFreeMap no define esa capa — limitación real de la fuente, no simulada.
const DEFAULT_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const STYLE_URLS = {
  light: process.env.NEXT_PUBLIC_POSITIONS_MAP_STYLE_LIGHT || DEFAULT_STYLE_LIGHT,
  dark: process.env.NEXT_PUBLIC_POSITIONS_MAP_STYLE_DARK || DEFAULT_STYLE_DARK,
};
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors · © OpenFreeMap · © OpenMapTiles';

const DEFAULT_ZOOM = 15;
const FOCUS_ZOOM = 17;
const PITCH_3D = 55;
const BEARING_3D = -17;

function boundsFromPositions(positions) {
  if (positions.length === 0) return null;
  const bounds = new LngLatBounds();
  positions.forEach(position => bounds.extend([position.longitude, position.latitude]));
  return bounds;
}

const PositionMap = forwardRef(function PositionMap({ positions, selectedPositionId, onSelectPosition, theme, viewMode }, ref) {
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

  useEffect(() => {
    let map;
    let ready = false;
    let disposed = false;
    try {
      setWorkerUrl('/assets/maplibre/maplibre-gl-worker.mjs');
      map = new MaplibreMap({
      container: containerRef.current,
      style: STYLE_URLS[theme] ?? STYLE_URLS.light,
      center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
      zoom: DEFAULT_ZOOM,
      pitch: viewModeRef.current === '3d' ? PITCH_3D : 0,
      bearing: viewModeRef.current === '3d' ? BEARING_3D : 0,
      attributionControl: false,
      });
    } catch {
      setMapUnavailable(true);
      return undefined;
    }
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

    function setupLayers() {
      detachLayersRef.current();
      detachLayersRef.current = attachPositionsLayers(map, {
        positions: positionsRef.current,
        selectedPositionId: selectedPositionIdRef.current,
        onSelectPosition: id => onSelectPositionRef.current(id),
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
    map.setStyle(STYLE_URLS[theme] ?? STYLE_URLS.light);
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
    map.easeTo({
      pitch: viewMode === '3d' ? PITCH_3D : 0,
      bearing: viewMode === '3d' ? BEARING_3D : 0,
      duration: 600,
    });
  }, [viewMode]);

  useImperativeHandle(ref, () => ({
    flyToPosition(id) {
      const map = mapRef.current;
      const position = positionsRef.current.find(item => item.id === id);
      if (!map || !position) return;
      const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
      map.flyTo({ center: [position.longitude, position.latitude], zoom, duration: 700 });
    },
    flyToBounds(coords) {
      const map = mapRef.current;
      if (!map || coords.length === 0) return;
      const bounds = new LngLatBounds();
      coords.forEach(([lng, lat]) => bounds.extend([lng, lat]));
      map.fitBounds(bounds, { padding: 70, duration: 700 });
    },
    flyToAll() {
      const map = mapRef.current;
      const bounds = boundsFromPositions(positionsRef.current);
      if (!map || !bounds) return;
      map.fitBounds(bounds, { padding: 70, duration: 700 });
    },
    flyToPuj() {
      mapRef.current?.flyTo({ center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude], zoom: DEFAULT_ZOOM, duration: 700 });
    },
    resetNorth() {
      mapRef.current?.resetNorth({ duration: 400 });
    },
  }));

  return (
    <div className="absolute inset-0 overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="position-map-container" className="h-full w-full" />
      {mapUnavailable && <div role="alert" className="absolute inset-0 z-20 overflow-y-auto bg-white/95 p-5 text-ink-900 dark:bg-surface-dark-card/95 dark:text-text-primary-dark">
        <h3 className="text-base font-semibold">La cartografía no está disponible</h3>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Puedes consultar y seleccionar las posiciones desde esta lista mientras se restablece el mapa base.</p>
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
