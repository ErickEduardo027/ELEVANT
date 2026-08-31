import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Map as MaplibreMap, NavigationControl, AttributionControl, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../positionsMapMappers';
import { attachPositionsLayers, updatePositionsData, setSelectedPositionFilter } from './positionMapLayers';

// OpenStreetMap (vía OpenMapTiles/OpenFreeMap) — nunca Google Maps ni Mapbox. Configurable por
// entorno, con el mismo mecanismo VITE_*_STYLE_* que ya usa FlightMap. El estilo "liberty" incluye
// una capa building-3d con datos reales de altura (render_height) para el modo 3D; el estilo
// "dark" de OpenFreeMap no define esa capa — limitación real de la fuente, no simulada.
const DEFAULT_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const STYLE_URLS = {
  light: import.meta.env.VITE_POSITIONS_MAP_STYLE_LIGHT || DEFAULT_STYLE_LIGHT,
  dark: import.meta.env.VITE_POSITIONS_MAP_STYLE_DARK || DEFAULT_STYLE_DARK,
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
    const map = new MaplibreMap({
      container: containerRef.current,
      style: STYLE_URLS[theme] ?? STYLE_URLS.light,
      center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
      zoom: DEFAULT_ZOOM,
      pitch: viewModeRef.current === '3d' ? PITCH_3D : 0,
      bearing: viewModeRef.current === '3d' ? BEARING_3D : 0,
      attributionControl: false,
    });
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
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="position-map-container" className="h-full w-full" />
    </div>
  );
});

export default PositionMap;
