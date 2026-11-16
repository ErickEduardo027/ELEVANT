import { useOccMap } from '../core/OccMapContext';

/**
 * The group of map controls at the bottom centre of an OccMap's visible area (occ-map.css places it inside the
 * insets): the view selector, the legend and a screen's own map tools. A map that cannot draw shows its fallback list
 * instead, so the dock is not rendered then.
 */
export default function MapDock({ children }) {
  const { engineStatus } = useOccMap();
  if (engineStatus === 'unavailable') return null;
  return <div className="occ-map-dock">{children}</div>;
}
