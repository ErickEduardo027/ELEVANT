import { useEffect, useRef, useState } from 'react';
import { Map as MaplibreMap, NavigationControl, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../flight-monitoring/flightMonitoringMappers';
import { OSM_ATTRIBUTION, basemapStyleUrl, resolveOpenFreeMapSpriteGaps } from './basemapStyles';
import { SATELLITE_LAYERS, SATELLITE_OPACITY, satelliteTileAt } from '../../services/satelliteService';
import { collapseCompactAttribution } from './collapseCompactAttribution';

// Mapa regional con imagen infrarroja GOES-East de NASA GIBS. La consola la
// muestra por defecto cuando existe una imagen; no es observación del aeródromo.
const SOURCE_ID = 'elevant-satellite-imagery';
const GIBS_ATTRIBUTION = 'Imagery: NASA GIBS / NOAA GOES-East / GPM IMERG';

export default function GoesCloudMap({ theme = 'light', imagery = 'none', imageryTime = null, labels }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  const imageryRef = useRef(imagery);
  const imageryTimeRef = useRef(imageryTime);
  const isInitialThemeRef = useRef(true);

  useEffect(() => {
    let map;
    try {
      setWorkerUrl('/assets/maplibre/maplibre-gl-worker.mjs');
      map = new MaplibreMap({
        container: containerRef.current,
        style: basemapStyleUrl(theme),
        center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
        zoom: 5.2,
        maxZoom: 9,
        attributionControl: false,
      });
    } catch {
      queueMicrotask(() => setUnavailable(true));
      return undefined;
    }
    resolveOpenFreeMapSpriteGaps(map);
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: true, customAttribution: `${OSM_ATTRIBUTION} · ${GIBS_ATTRIBUTION}` }), 'bottom-right');
    collapseCompactAttribution(map);
    const setup = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'raster', tiles: [satelliteTileAt(imageryRef.current, imageryTimeRef.current) ?? SATELLITE_LAYERS.goes], tileSize: 256, maxzoom: 6 });
      }
      if (!map.getLayer(SOURCE_ID)) {
        map.addLayer({ id: SOURCE_ID, type: 'raster', source: SOURCE_ID,
          layout: { visibility: imageryRef.current === 'none' ? 'none' : 'visible' },
          paint: { 'raster-opacity': SATELLITE_OPACITY[imageryRef.current] ?? SATELLITE_OPACITY.goes } });
      }
    };
    map.on('style.load', setup);
    map.on('error', event => {
      if (event?.sourceId !== SOURCE_ID) return;
      setUnavailable(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; theme and layer toggles handled below.
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
    imageryRef.current = imagery;
    imageryTimeRef.current = imageryTime;
    const map = mapRef.current;
    if (map?.getSource(SOURCE_ID) && imagery !== 'none') {
      const pinned = satelliteTileAt(imagery, imageryTime);
      if (pinned) map.getSource(SOURCE_ID).setTiles([pinned]);
    }
    if (map?.getLayer(SOURCE_ID)) {
      map.setLayoutProperty(SOURCE_ID, 'visibility', imagery === 'none' ? 'none' : 'visible');
      map.setPaintProperty(SOURCE_ID, 'raster-opacity', SATELLITE_OPACITY[imagery] ?? SATELLITE_OPACITY.goes);
    }
    setUnavailable(false);
  }, [imagery, imageryTime]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
      {unavailable && imagery !== 'none' && (
        <p role="status" className="absolute bottom-3 left-3 z-10 rounded-md border border-occ-line bg-occ-panel px-3 py-2 text-xs text-occ-text shadow">
          {labels.cloudsUnavailable}
        </p>
      )}
    </div>
  );
}
