import { useTranslation } from '../../../i18n/LanguageScope';
import { OCC_SHORTCUTS } from '../../occ-ui/occShortcuts';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';

// The 2D/3D control of an OccMap (PR M7, contracts 2.2 and 2.3), beside the view selector in the map's dock: two
// buttons, «2D» and «3D», the pressed one framed in cyan as the views are, with the D key of the key table. The map
// keeps the choice (in the browser, or in the page that sets the mode); a map whose page sets the mode without letting
// it change, or that cannot draw, shows no control.

const SHORTCUT = OCC_SHORTCUTS.find(row => row.action === 'toggle3d');
const MODES = Object.freeze([['2d', '2D', 'to2d'], ['3d', '3D', 'to3d']]);

export default function Map3dToggle({ className = '' }) {
  const { view3d } = useOccMap();
  const { t } = useTranslation(mapMessages);
  if (!view3d?.available) return null;
  const key = SHORTCUT.key.toUpperCase();
  const current = view3d.on ? '3d' : '2d';

  return (
    <div
      role="group"
      aria-label={t('view3d.group')}
      data-testid="map-3d-toggle"
      className={`flex shrink-0 gap-0.5 rounded border border-occ-line bg-occ-panel p-0.5 ${className}`.trim()}
    >
      {MODES.map(([mode, label, title]) => {
        const pressed = current === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={pressed}
            aria-keyshortcuts={key}
            title={t(`view3d.${title}`)}
            onClick={() => {
              if (!pressed) view3d.toggle();
            }}
            className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm border px-3 text-sm font-semibold ${pressed
              ? 'border-occ-accent bg-occ-accent-soft text-occ-text'
              : 'border-transparent text-occ-muted hover:bg-occ-panel-raised hover:text-occ-text'}`}
          >
            {mode === '3d' && <span aria-hidden="true" className="font-mono text-xs text-occ-faint">{key}</span>}
            {label}
          </button>
        );
      })}
    </div>
  );
}
