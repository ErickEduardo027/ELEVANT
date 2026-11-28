import { useOccMap } from '../core/OccMapContext';

/**
 * The control rail of an OccMap (CN-32): one column at the true right edge of the map, under MapLibre's zoom group and
 * as wide as it (occ-map.css places it there, M1: it never moves with the insets, and the panels that float at the
 * right of the map sit left of it, --occ-map-rail-reserve). A screen puts its controls in it in this order,
 * each group one slab: the view selector with 3D (ui/MapPresetSwitcher.jsx), «Seguir» (ui/MapFollowButton.jsx), the
 * screen's own tools, the pause (ui/MapMotionControl.jsx), «Capas» (ui/MapLayersMenu.jsx) and «Leyenda»
 * (ui/MapLegend.jsx), whose menus fly out to the left of the column. A map that cannot draw shows its fallback list
 * instead, so the rail is not rendered then.
 */
export default function MapDock({ children }) {
  const { engineStatus } = useOccMap();
  if (engineStatus === 'unavailable') return null;
  return <div className="occ-map-dock">{children}</div>;
}
