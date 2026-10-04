import { useEffect, useRef } from 'react';
import { Map as MaplibreMap, Marker, NavigationControl, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../flightMonitoringMappers';
import { createAircraftMarkerElement, updateAircraftMarkerElement } from './AircraftMarker';
import { createAirportMarkerElement } from './AirportMarker';
import { CrosshairIcon, RotateCcwIcon } from './icons';

const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const STYLE_URLS = {
  light: process.env.NEXT_PUBLIC_FLIGHT_MAP_STYLE_LIGHT || DEMO_STYLE_URL,
  dark: process.env.NEXT_PUBLIC_FLIGHT_MAP_STYLE_DARK || DEMO_STYLE_URL,
};
const INITIAL_ZOOM = 6;
const CENTER_ZOOM = 9;

export default function FlightMap({ flights, selectedFlightId, onSelectFlight, theme, onPopoverPosition }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const onSelectFlightRef = useRef(onSelectFlight);
  onSelectFlightRef.current = onSelectFlight;
  const isInitialThemeRef = useRef(true);

  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  const selectedFlightIdRef = useRef(selectedFlightId);
  selectedFlightIdRef.current = selectedFlightId;
  const onPopoverPositionRef = useRef(onPopoverPosition);
  onPopoverPositionRef.current = onPopoverPosition;
  const recomputePopoverPositionRef = useRef(() => {});

  useEffect(() => {
    const map = new MaplibreMap({
      container: containerRef.current,
      style: STYLE_URLS[theme] ?? STYLE_URLS.light,
      center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
      zoom: INITIAL_ZOOM,
    });
    map.addControl(new NavigationControl(), 'top-right');

    const airportMarker = new Marker({ element: createAirportMarkerElement() })
      .setLngLat([PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude])
      .addTo(map);

    // Re-projects the selected flight's lngLat to screen coordinates so FlightDetailPopover
    // (a plain React overlay, not MapLibre's own limited-styling popup) can stay pinned to its
    // aircraft through pans and zooms — reads current flights/selection via refs so this
    // listener never needs to be torn down and re-registered as those props change.
    function recomputePopoverPosition() {
      const selectedFlight = flightsRef.current.find(flight => flight.id === selectedFlightIdRef.current);
      if (!selectedFlight) {
        onPopoverPositionRef.current?.(null);
        return;
      }
      const point = map.project([selectedFlight.longitude, selectedFlight.latitude]);
      onPopoverPositionRef.current?.({ left: point.x, top: point.y });
    }
    map.on('move', recomputePopoverPosition);
    map.on('zoom', recomputePopoverPosition);

    mapRef.current = map;
    recomputePopoverPositionRef.current = recomputePopoverPosition;

    return () => {
      map.off('move', recomputePopoverPosition);
      map.off('zoom', recomputePopoverPosition);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      airportMarker.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount once; theme changes are handled by the effect below.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Skip the run that fires right after mount (same commit as the effect above) — the
    // constructor already applied this exact style; only react to genuine theme *changes*.
    if (isInitialThemeRef.current) {
      isInitialThemeRef.current = false;
      return;
    }
    map.setStyle(STYLE_URLS[theme] ?? STYLE_URLS.light);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seenIds = new Set();

    flights.forEach(flight => {
      seenIds.add(flight.id);
      const selected = flight.id === selectedFlightId;
      const existing = markers.get(flight.id);

      if (existing) {
        updateAircraftMarkerElement(existing.element, flight, { selected });
        existing.marker.setLngLat([flight.longitude, flight.latitude]);
      } else {
        const element = createAircraftMarkerElement(flight, { selected });
        element.addEventListener('click', () => onSelectFlightRef.current(flight.id));
        const marker = new Marker({ element }).setLngLat([flight.longitude, flight.latitude]).addTo(map);
        markers.set(flight.id, { marker, element });
      }
    });

    Array.from(markers.keys()).forEach(id => {
      if (!seenIds.has(id)) {
        markers.get(id).marker.remove();
        markers.delete(id);
      }
    });
  }, [flights, selectedFlightId]);

  useEffect(() => {
    const map = mapRef.current;
    const selectedFlight = flightsRef.current.find(flight => flight.id === selectedFlightId);
    if (!map || !selectedFlight) return;
    map.flyTo({ center: [selectedFlight.longitude, selectedFlight.latitude] });
  }, [selectedFlightId]);

  useEffect(() => {
    if (!mapRef.current) return;
    recomputePopoverPositionRef.current();
  }, [flights, selectedFlightId]);

  function handleResetView() {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new LngLatBounds();
    bounds.extend([PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude]);
    flights.forEach(flight => bounds.extend([flight.longitude, flight.latitude]));
    map.fitBounds(bounds, { padding: 60 });
  }

  function handleCenterPuj() {
    mapRef.current?.flyTo({ center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude], zoom: CENTER_ZOOM });
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="flight-map-container" className="h-full w-full" />
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleResetView}
          title="Restablecer vista"
          aria-label="Restablecer vista"
          className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <RotateCcwIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
        <button
          type="button"
          onClick={handleCenterPuj}
          title="Centrar PUJ"
          aria-label="Centrar PUJ"
          className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <CrosshairIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
      </div>
    </div>
  );
}
