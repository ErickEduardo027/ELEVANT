import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PUJ_COORDINATES } from '../positionsMapMappers';
import { loadGoogleMap } from '../../maps/googleMapsLoader';

const INITIAL_ZOOM = 15;
const FOCUS_ZOOM = 17;
const LABEL_ZOOM = 17;
const STATUS_COLORS = {
  available: '#13996f',
  occupied: '#2465c5',
  disabled: '#c54444',
  releasing: '#e7972f',
  planned: '#65748b',
  unverified: '#65748b',
};

const GooglePositionMap = forwardRef(function GooglePositionMap(
  { positions, selectedPositionId, onSelectPosition, theme, viewMode }, ref,
) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const markersRef = useRef([]);
  const positionsRef = useRef(positions);
  const selectionRef = useRef(onSelectPosition);
  const [error, setError] = useState(false);
  const [labelsVisible, setLabelsVisible] = useState(false);
  const [readyVersion, setReadyVersion] = useState(0);
  positionsRef.current = positions;
  selectionRef.current = onSelectPosition;

  useEffect(() => {
    let disposed = false;
    let map = null;
    let readyListener = null;
    let zoomListener = null;
    const timeout = window.setTimeout(() => { if (!disposed) setError(true); }, 12000);
    setError(false);
    setLabelsVisible(false);

    loadGoogleMap(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).then(maps => {
      if (disposed) return;
      mapsRef.current = maps;
      map = new maps.Map(containerRef.current, {
        center: { lat: PUJ_COORDINATES.latitude, lng: PUJ_COORDINATES.longitude },
        zoom: INITIAL_ZOOM,
        colorScheme: theme === 'dark' ? 'DARK' : 'LIGHT',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        tilt: viewMode === '3d' ? 45 : 0,
      });
      mapRef.current = map;
      zoomListener = maps.event.addListener(map, 'zoom_changed', () => {
        if (!disposed) setLabelsVisible((map.getZoom() ?? INITIAL_ZOOM) >= LABEL_ZOOM);
      });
      setReadyVersion(version => version + 1);
      readyListener = maps.event.addListenerOnce(map, 'idle', () => {
        window.clearTimeout(timeout);
        if (!disposed) setError(false);
      });
    }).catch(() => {
      window.clearTimeout(timeout);
      if (!disposed) setError(true);
    });

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      readyListener?.remove();
      zoomListener?.remove();
      markersRef.current.forEach(marker => marker.setMap(null));
      markersRef.current = [];
      if (map && mapsRef.current) mapsRef.current.event.clearInstanceListeners(map);
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = positions.map(position => {
      const selected = position.id === selectedPositionId;
      const marker = new maps.Marker({
        map,
        position: { lat: position.latitude, lng: position.longitude },
        title: `Posición ${position.id}`,
        label: selected || labelsVisible
          ? { text: position.id, color: '#ffffff', fontWeight: '700', fontSize: '10px' }
          : undefined,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          fillColor: STATUS_COLORS[position.status] ?? STATUS_COLORS.unverified,
          fillOpacity: 1,
          strokeColor: selected ? '#ff6a1f' : '#ffffff',
          strokeWeight: selected ? 4 : 2,
          scale: selected ? 18 : labelsVisible ? 15 : 7,
        },
      });
      marker.addListener('click', () => selectionRef.current(position.id));
      return marker;
    });
  }, [positions, selectedPositionId, labelsVisible, readyVersion]);

  useEffect(() => {
    mapRef.current?.setTilt(viewMode === '3d' ? 45 : 0);
  }, [viewMode, theme]);

  useImperativeHandle(ref, () => ({
    flyToPosition(id) {
      const position = positionsRef.current.find(item => item.id === id);
      if (!position || !mapRef.current) return;
      mapRef.current.panTo({ lat: position.latitude, lng: position.longitude });
      mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? INITIAL_ZOOM, FOCUS_ZOOM));
    },
    flyToBounds(coords) {
      const map = mapRef.current;
      const maps = mapsRef.current;
      if (!map || !maps || coords.length === 0) return;
      const bounds = new maps.LatLngBounds();
      coords.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
      map.fitBounds(bounds, 70);
    },
    flyToAll() {
      const map = mapRef.current;
      const maps = mapsRef.current;
      if (!map || !maps || positionsRef.current.length === 0) return;
      const bounds = new maps.LatLngBounds();
      positionsRef.current.forEach(position => bounds.extend({ lat: position.latitude, lng: position.longitude }));
      map.fitBounds(bounds, 70);
    },
    flyToPuj() {
      mapRef.current?.panTo({ lat: PUJ_COORDINATES.latitude, lng: PUJ_COORDINATES.longitude });
      mapRef.current?.setZoom(INITIAL_ZOOM);
    },
    resetNorth() {
      mapRef.current?.setHeading(0);
    },
  }));

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={containerRef} data-testid="google-position-map-container" className="h-full w-full" />
      {error && <div role="alert" className="absolute inset-0 z-20 overflow-y-auto bg-white/95 p-5 text-ink-900 dark:bg-surface-dark-card/95 dark:text-text-primary-dark">
        <h3 className="text-base font-semibold">Google Maps no está disponible</h3>
        <p className="mt-1 text-sm">Consulta y selecciona las posiciones desde la lista mientras se restablece el mapa.</p>
        <div className="mt-4 flex flex-wrap gap-2">{positions.map(position =>
          <button key={position.id} type="button" onClick={() => onSelectPosition(position.id)}
            className="min-h-11 rounded-lg border border-accent-600/30 px-3 text-sm font-semibold">
            {position.id}
          </button>)}</div>
      </div>}
    </div>
  );
});

export default GooglePositionMap;
