import { useEffect, useRef, useState } from 'react';
import { PUJ_COORDINATES } from '../flightMonitoringMappers';
import { loadGoogleMap } from '../../maps/googleMapsLoader';
import { CrosshairIcon, RotateCcwIcon } from './icons';

export default function GoogleFlightMap({ flights, selectedFlightId, onSelectFlight, theme, onPopoverPosition }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const markersRef = useRef([]);
  const overlayRef = useRef(null);
  const selectionRef = useRef(onSelectFlight);
  const popoverRef = useRef(onPopoverPosition);
  const flightsRef = useRef(flights);
  const selectedRef = useRef(selectedFlightId);
  const [readyVersion, setReadyVersion] = useState(0);
  const [error, setError] = useState(false);
  selectionRef.current = onSelectFlight;
  popoverRef.current = onPopoverPosition;
  flightsRef.current = flights;
  selectedRef.current = selectedFlightId;

  function recomputePopover() {
    const selected = flightsRef.current.find(flight => flight.id === selectedRef.current);
    const projection = overlayRef.current?.getProjection();
    if (!selected || !projection || !mapsRef.current) {
      popoverRef.current?.(null);
      return;
    }
    const point = projection.fromLatLngToContainerPixel(
      new mapsRef.current.LatLng(selected.latitude, selected.longitude));
    popoverRef.current?.(point ? { left: point.x, top: point.y } : null);
  }

  useEffect(() => {
    let disposed = false;
    let map = null;
    let overlay = null;
    const timeout = window.setTimeout(() => { if (!disposed) setError(true); }, 12000);
    setError(false);
    loadGoogleMap(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).then(maps => {
      if (disposed) return;
      mapsRef.current = maps;
      map = new maps.Map(containerRef.current, {
        center: { lat: PUJ_COORDINATES.latitude, lng: PUJ_COORDINATES.longitude },
        zoom: 6,
        colorScheme: theme === 'dark' ? 'DARK' : 'LIGHT',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;
      overlay = new maps.OverlayView();
      overlay.onAdd = () => {};
      overlay.draw = recomputePopover;
      overlay.onRemove = () => {};
      overlay.setMap(map);
      overlayRef.current = overlay;
      maps.event.addListenerOnce(map, 'idle', () => {
        window.clearTimeout(timeout);
        if (!disposed) setError(false);
      });
      setReadyVersion(version => version + 1);
    }).catch(() => {
      window.clearTimeout(timeout);
      if (!disposed) setError(true);
    });

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      markersRef.current.forEach(marker => marker.setMap(null));
      markersRef.current = [];
      overlay?.setMap(null);
      if (map && mapsRef.current) mapsRef.current.event.clearInstanceListeners(map);
      overlayRef.current = null;
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = flights.map(flight => {
      const marker = new maps.Marker({
        map,
        position: { lat: flight.latitude, lng: flight.longitude },
        title: `Vuelo ${flight.flightNumber ?? flight.id}`,
        icon: {
          path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor: flight.id === selectedFlightId ? '#ff6a1f' : '#2465c5',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          scale: flight.id === selectedFlightId ? 7 : 6,
          rotation: Number(flight.heading) || 0,
        },
      });
      marker.addListener('click', () => selectionRef.current(flight.id));
      return marker;
    });
    recomputePopover();
  }, [flights, selectedFlightId, readyVersion]);

  useEffect(() => {
    const selected = flights.find(flight => flight.id === selectedFlightId);
    if (selected) mapRef.current?.panTo({ lat: selected.latitude, lng: selected.longitude });
    recomputePopover();
  }, [selectedFlightId, readyVersion]);

  function resetView() {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;
    const bounds = new maps.LatLngBounds();
    bounds.extend({ lat: PUJ_COORDINATES.latitude, lng: PUJ_COORDINATES.longitude });
    flights.forEach(flight => bounds.extend({ lat: flight.latitude, lng: flight.longitude }));
    map.fitBounds(bounds, 60);
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="google-flight-map-container" className="h-full w-full" />
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button type="button" aria-label="Restablecer vista" onClick={resetView}
          className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md dark:bg-surface-dark-card">
          <RotateCcwIcon className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Centrar PUJ" onClick={() => {
          mapRef.current?.panTo({ lat: PUJ_COORDINATES.latitude, lng: PUJ_COORDINATES.longitude });
          mapRef.current?.setZoom(9);
        }} className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md dark:bg-surface-dark-card">
          <CrosshairIcon className="h-4 w-4" />
        </button>
      </div>
      {error && <div role="alert" className="absolute inset-0 z-20 flex items-center justify-center bg-white/95 p-6 text-center text-sm dark:bg-surface-dark-card/95">
        Google Maps no está disponible. Consulta la lista de vuelos mientras se restablece el mapa.
      </div>}
    </div>
  );
}
