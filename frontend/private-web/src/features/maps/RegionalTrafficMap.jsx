import { useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MaplibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { basemapStyleUrl, OSM_ATTRIBUTION, resolveOpenFreeMapSpriteGaps } from './basemapStyles';
import { PUJ_COORDINATES } from '../flight-monitoring/flightMonitoringMappers';
import { collapseCompactAttribution } from './collapseCompactAttribution';

// The compact 303px map must still include PUJ at the island's eastern edge.
const REGION_CENTER = [-69.9, 18.8];
const REGION_ZOOM = 5.5;
const motionDuration = milliseconds => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : milliseconds;

export default function RegionalTrafficMap({ theme, initialCamera, onCameraChange, labels,
  aircraft = [], selectedIcao24 = null, onSelectAircraft }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const callbackRef = useRef(onCameraChange);
  const selectRef = useRef(onSelectAircraft);
  const aircraftMarkersRef = useRef(new Map());
  const initialCameraRef = useRef(initialCamera);
  const initialThemeRef = useRef(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => { callbackRef.current = onCameraChange; }, [onCameraChange]);
  useEffect(() => { selectRef.current = onSelectAircraft; }, [onSelectAircraft]);

  useEffect(() => {
    let map;
    let ready = false;
    let disposed = false;
    try {
      setWorkerUrl('/assets/maplibre/maplibre-gl-worker.mjs');
      map = new MaplibreMap({
        container: containerRef.current,
        style: basemapStyleUrl(theme),
        center: initialCameraRef.current?.center ?? REGION_CENTER,
        zoom: initialCameraRef.current?.zoom ?? REGION_ZOOM,
        attributionControl: false,
      });
    } catch {
      queueMicrotask(() => setUnavailable(true));
      return undefined;
    }
    resolveOpenFreeMapSpriteGaps(map);
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: true, customAttribution: OSM_ATTRIBUTION }), 'bottom-right');
    collapseCompactAttribution(map);
    const airport = document.createElement('div');
    airport.className = 'rounded-md border border-white/80 bg-ink-900 px-2 py-1 text-[11px] font-bold tracking-wide text-white shadow-md';
    airport.textContent = 'PUJ';
    const marker = new Marker({ element: airport, anchor: 'bottom' })
      .setLngLat([PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude]).addTo(map);
    const timeout = window.setTimeout(() => { if (!ready && !disposed) setUnavailable(true); }, 12_000);
    const onIdle = () => { ready = true; window.clearTimeout(timeout); if (!disposed) setUnavailable(false); };
    const onError = () => { if (!ready && !disposed) setUnavailable(true); };
    const onMoveEnd = () => {
      const center = map.getCenter();
      callbackRef.current?.({ center: [center.lng, center.lat], zoom: map.getZoom() });
    };
    map.on('idle', onIdle);
    map.on('error', onError);
    map.on('moveend', onMoveEnd);
    mapRef.current = map;
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      marker.remove();
      aircraftMarkersRef.current.forEach(item => item.marker.remove());
      aircraftMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // Map lifetime is independent of theme; the effect below swaps its style.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (initialThemeRef.current) { initialThemeRef.current = false; return; }
    map.setStyle(basemapStyleUrl(theme));
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = aircraftMarkersRef.current;
    const active = new Set();
    for (const item of aircraft) {
      if (!Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) continue;
      active.add(item.icao24);
      let entry = markers.get(item.icao24);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'flex items-center gap-1 rounded-full border border-sky-300/80 bg-slate-950/90 px-1.5 py-1 text-[10px] font-semibold text-white shadow-lg backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('width', '19');
        icon.setAttribute('height', '19');
        icon.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', 'M12 2 14 9 21 13 21 15 14 13 14 20 12 22 10 20 10 13 3 15 3 13 10 9Z');
        shape.setAttribute('fill', 'currentColor');
        icon.append(shape);
        const label = document.createElement('span');
        label.className = 'max-w-20 truncate';
        button.append(icon, label);
        button.addEventListener('click', () => selectRef.current?.(item.icao24));
        entry = { button, icon, label, marker: new Marker({ element: button, anchor: 'center' }).addTo(map) };
        markers.set(item.icao24, entry);
      }
      entry.marker.setLngLat([item.longitude, item.latitude]);
      entry.button.setAttribute('aria-label', `${labels.aircraft} ${item.callsign || item.icao24}`);
      entry.button.setAttribute('aria-pressed', String(selectedIcao24 === item.icao24));
      entry.button.style.borderColor = selectedIcao24 === item.icao24 ? '#f2661e' : '';
      entry.icon.style.transform = Number.isFinite(item.trueTrackDegrees) ? `rotate(${item.trueTrackDegrees}deg)` : '';
      entry.label.textContent = item.callsign || item.icao24;
    }
    for (const [icao24, entry] of markers) {
      if (!active.has(icao24)) { entry.marker.remove(); markers.delete(icao24); }
    }
  }, [aircraft, labels.aircraft, selectedIcao24]);

  return <div className="absolute inset-0 overflow-hidden">
    <div ref={containerRef} data-testid="regional-map-container" className="h-full w-full" />
    <div className="absolute left-3 top-3 z-10 flex gap-1.5">
      <button type="button" onClick={() => mapRef.current?.flyTo({ center: REGION_CENTER, zoom: REGION_ZOOM, duration: motionDuration(500) })}
        className="rounded-md border border-occ-line bg-occ-panel px-2 py-1 text-[11px] font-semibold text-occ-text shadow-sm">
        {labels.resetRegion}
      </button>
      <button type="button" onClick={() => mapRef.current?.flyTo({
        center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude], zoom: 9, duration: motionDuration(500),
      })} className="rounded-md border border-occ-line bg-occ-panel px-2 py-1 text-[11px] font-semibold text-occ-text shadow-sm">
        {labels.centerPuj}
      </button>
    </div>
    {unavailable && <p role="alert" className="absolute inset-0 z-20 flex items-center justify-center bg-occ-panel p-4 text-sm text-occ-text">
      {labels.unavailable}
    </p>}
  </div>;
}
