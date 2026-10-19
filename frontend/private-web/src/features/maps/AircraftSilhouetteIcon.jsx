import { AIRCRAFT_SILHOUETTE_PATH, AIRCRAFT_SILHOUETTE_VIEWBOX } from './aircraftSilhouette';

// Versión React de la silueta de ELEVANT para leyendas y listas.
export default function AircraftSilhouetteIcon({ className = '', fill = 'currentColor', rotationDeg = 0 }) {
  return (
    <svg viewBox={`0 0 ${AIRCRAFT_SILHOUETTE_VIEWBOX} ${AIRCRAFT_SILHOUETTE_VIEWBOX}`} aria-hidden="true" className={className}
      style={rotationDeg ? { transform: `rotate(${rotationDeg}deg)` } : undefined}>
      <path d={AIRCRAFT_SILHOUETTE_PATH} fill={fill} />
    </svg>
  );
}
