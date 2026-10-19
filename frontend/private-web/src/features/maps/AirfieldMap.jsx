import { useEffect, useRef, useState } from 'react';
import { Map as MaplibreMap, NavigationControl, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../flight-monitoring/flightMonitoringMappers';
import { OSM_ATTRIBUTION, basemapStyleUrl, resolveOpenFreeMapSpriteGaps } from './basemapStyles';
import { RUNWAY_LAYER, attachAerowayLayers, setSelectedRunway } from './aerowayLayers';

const AIRFIELD_ZOOM = 13.4;
const LOAD_TIMEOUT_MS = 12_000;

// Vista general del aeródromo de PUJ: mapa base OSM con pistas, rodajes y plataformas
// resaltados. Seleccionar una pista entrega solo lo que la cartografía publica (su `ref`).
// `geometry` informa si las teselas incluyen pistas en la vista actual.
export default function AirfieldMap({
  theme = 'light', selectedRunway = null, onSelectRunway, initialCamera, onCameraChange,
  onStatusChange, labels,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  const themeRef = useRef(theme);
  const selectedRef = useRef(selectedRunway);
  const callbacks = useRef({ onSelectRunway, onCameraChange, onStatusChange });
  const initialCameraRef = useRef(initialCamera);
  const isInitialThemeRef = useRef(true);

  // Los manejadores de MapLibre se registran una vez; leen siempre las props vigentes.
  useEffect(() => {
    themeRef.current = theme;
    selectedRef.current = selectedRunway;
    callbacks.current = { onSelectRunway, onCameraChange, onStatusChange };
  });

  useEffect(() => {
    let map;
    let ready = false;
    let disposed = false;
    try {
      setWorkerUrl('/assets/maplibre/maplibre-gl-worker.mjs');
      map = new MaplibreMap({
        container: containerRef.current,
        style: basemapStyleUrl(themeRef.current),
        center: initialCameraRef.current?.center ?? [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
        zoom: initialCameraRef.current?.zoom ?? AIRFIELD_ZOOM,
        bearing: initialCameraRef.current?.bearing ?? 0,
        attributionControl: false,
      });
    } catch {
      queueMicrotask(() => {
        setUnavailable(true);
        callbacks.current.onStatusChange?.('unavailable');
      });
      return undefined;
    }
    resolveOpenFreeMapSpriteGaps(map);
    const timeout = setTimeout(() => {
      if (!ready && !disposed) setUnavailable(true);
    }, LOAD_TIMEOUT_MS);
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: true, customAttribution: OSM_ATTRIBUTION }), 'bottom-right');

    const setup = () => {
      attachAerowayLayers(map, { theme: themeRef.current, selectedRef: selectedRef.current });
    };
    const handleIdle = () => {
      ready = true;
      clearTimeout(timeout);
      if (disposed) return;
      setUnavailable(false);
      const runways = map.getLayer(RUNWAY_LAYER) ? map.queryRenderedFeatures({ layers: [RUNWAY_LAYER] }) : [];
      callbacks.current.onStatusChange?.(runways.length > 0 ? 'geometry' : 'no-geometry');
    };
    const handleError = () => {
      if (!ready && !disposed) setUnavailable(true);
    };
    const handleClick = event => {
      const feature = map.getLayer(RUNWAY_LAYER)
        ? map.queryRenderedFeatures(event.point, { layers: [RUNWAY_LAYER] })[0] : null;
      // Pista sin `ref` publicado → cadena vacía; clic fuera de una pista → null.
      callbacks.current.onSelectRunway?.(feature ? (feature.properties?.ref ?? '') : null);
    };
    const handleMoveEnd = () => {
      const center = map.getCenter();
      callbacks.current.onCameraChange?.({ center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing() });
    };
    const setCursor = cursor => () => { map.getCanvas().style.cursor = cursor; };
    const pointer = setCursor('pointer');
    const reset = setCursor('');
    map.on('style.load', setup);
    map.on('idle', handleIdle);
    map.on('error', handleError);
    map.on('click', handleClick);
    map.on('moveend', handleMoveEnd);
    map.on('mouseenter', RUNWAY_LAYER, pointer);
    map.on('mouseleave', RUNWAY_LAYER, reset);
    mapRef.current = map;
    return () => {
      disposed = true;
      clearTimeout(timeout);
      map.remove();
      mapRef.current = null;
    };
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
    if (mapRef.current) setSelectedRunway(mapRef.current, selectedRunway);
  }, [selectedRunway]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} data-testid="airfield-map-container" className="h-full w-full" />
      {unavailable && (
        <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-occ-panel p-4 text-center">
          <p className="text-sm font-semibold text-occ-text">{labels.unavailableTitle}</p>
          <p className="max-w-xs text-xs text-occ-muted">{labels.unavailableBody}</p>
        </div>
      )}
    </div>
  );
}
