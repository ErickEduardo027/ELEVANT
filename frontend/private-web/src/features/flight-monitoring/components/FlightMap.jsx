import { useEffect, useRef, useState } from 'react';
import { Map as MaplibreMap, Marker, NavigationControl, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PUJ_COORDINATES } from '../flightMonitoringMappers';
import { createAircraftMarkerElement, updateAircraftMarkerElement } from './AircraftMarker';
import { createAirportMarkerElement } from './AirportMarker';
import { CrosshairIcon, RotateCcwIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const STYLE_URLS = {
  light: process.env.NEXT_PUBLIC_FLIGHT_MAP_STYLE_LIGHT || DEMO_STYLE_URL,
  dark: process.env.NEXT_PUBLIC_FLIGHT_MAP_STYLE_DARK || DEMO_STYLE_URL,
};
const INITIAL_ZOOM = 6;
const CENTER_ZOOM = 9;

export default function FlightMap({ flights, selectedFlightId, onSelectFlight, theme, onPopoverPosition }) {
  const { t } = useTranslation(flightMonitoringMessages);
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
  const [mapUnavailable, setMapUnavailable] = useState(false);

  useEffect(() => {
    let map;
    try {
      setWorkerUrl('/assets/maplibre/maplibre-gl-worker.mjs');
      map = new MaplibreMap({
        container: containerRef.current,
        style: STYLE_URLS[theme] ?? STYLE_URLS.light,
        center: [PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude],
        zoom: INITIAL_ZOOM,
      });
    } catch {
      // Since MapLibre 6.7 the constructor throws when the browser has no WebGL2: keep the page and say so.
      setMapUnavailable(true);
      return undefined;
    }
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
    <div className="absolute inset-0 overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="flight-map-container" className="h-full w-full" />
      {mapUnavailable && (
        <div role="alert" className="absolute inset-0 z-20 overflow-y-auto bg-white/95 p-5 text-ink-900 dark:bg-surface-dark-card/95 dark:text-text-primary-dark">
          <h3 className="text-base font-semibold">{t('map.unavailableTitle')}</h3>
          <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{t('map.unavailableDescription')}</p>
        </div>
      )}
      {!mapUnavailable && (
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleResetView}
          title={t('map.resetView')}
          aria-label={t('map.resetView')}
          className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <RotateCcwIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
        <button
          type="button"
          onClick={handleCenterPuj}
          title={t('map.centerPuj')}
          aria-label={t('map.centerPuj')}
          className="rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <CrosshairIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
      </div>
      )}
    </div>
  );
}
