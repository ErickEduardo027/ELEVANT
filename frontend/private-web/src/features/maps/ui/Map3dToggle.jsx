import { useTranslation } from '../../../i18n/LanguageScope';
import { OCC_SHORTCUTS } from '../../occ-ui/occShortcuts';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { RAIL_KEY, railToolClass } from './railClasses';

// The 2D/3D control of an OccMap (PR M7, contracts 2.2 and 2.3), right under the view selector in the map's control rail
// (CN-32): one toggle button «3D», pressed (framed in cyan, as the views are) while the map is in 3D, with the D key of
// the key table. The map keeps the choice (in the browser, or in the page that sets the mode); a map whose page sets the
// mode without letting it change, or that cannot draw, shows no control.

const SHORTCUT = OCC_SHORTCUTS.find(row => row.action === 'toggle3d');

export default function Map3dToggle({ className = '' }) {
  const { view3d } = useOccMap();
  const { t } = useTranslation(mapMessages);
  if (!view3d?.available) return null;
  const key = SHORTCUT.key.toUpperCase();
  const pressed = view3d.on;

  return (
    <button
      type="button"
      data-testid="map-3d-toggle"
      aria-pressed={pressed}
      aria-keyshortcuts={key}
      title={t(pressed ? 'view3d.to2d' : 'view3d.to3d')}
      onClick={() => view3d.toggle()}
      className={railToolClass(pressed, className)}
    >
      <span aria-hidden="true" className={RAIL_KEY}>{key}</span>
      3D
    </button>
  );
}
