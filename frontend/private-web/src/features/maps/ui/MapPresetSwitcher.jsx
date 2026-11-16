import { useTranslation } from '../../../i18n/LanguageScope';
import { OCC_SHORTCUTS } from '../../occ-ui/occShortcuts';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import Map3dToggle from './Map3dToggle';

// The four views of the key table (1 Región · 2 Aproximación · 3 Aeródromo · 4 Rampa), with their own words.
const VIEW_BUTTONS = Object.freeze(OCC_SHORTCUTS
  .filter(({ action }) => action.startsWith('view.'))
  .map(({ key, action, es, en }) => Object.freeze({ view: action.slice('view.'.length), key, label: { es, en } })));

// The words a narrow map shows (occ-map.css, the dock's compact steps); the full word stays the button's name.
const SHORT_LABELS = Object.freeze({
  approach: Object.freeze({ es: 'Aprox.', en: 'Appr.' }),
  airfield: Object.freeze({ es: 'Aeród.', en: 'Airf.' }),
});

/**
 * The view selector of an OccMap (it goes with the legend in the group at the bottom centre). The pressed button is
 * the view the camera really shows, so it stays truthful after a free zoom; a click flies to the view and writes
 * `view=` in the URL. The pressed view is told by its cyan frame as well as by its tint, never by colour alone. The
 * 2D/3D control (PR M7, ui/Map3dToggle.jsx) comes right after it, so every dock with the views offers it.
 */
export default function MapPresetSwitcher({ className = '' }) {
  const { activeView, requestView, engineStatus } = useOccMap();
  const { t, language } = useTranslation(mapMessages);

  return (
    <>
      <div
        role="group"
        aria-label={t('view.group')}
        data-testid="map-preset-switcher"
        className={`flex gap-0.5 rounded border border-occ-line bg-occ-panel p-0.5 ${className}`.trim()}
      >
        {VIEW_BUTTONS.map(({ view, key, label }) => {
          const pressed = activeView === view;
          return (
            <button
              key={view}
              type="button"
              aria-pressed={pressed}
              aria-keyshortcuts={key}
              disabled={engineStatus === 'unavailable'}
              onClick={() => requestView(view)}
              className={`flex min-h-11 min-w-11 items-center gap-2 rounded-sm border px-3 text-sm font-semibold disabled:cursor-not-allowed ${pressed
                ? 'border-occ-accent bg-occ-accent-soft text-occ-text'
                : 'border-transparent text-occ-muted hover:bg-occ-panel-raised hover:text-occ-text'}`}
            >
              <span aria-hidden="true" className="occ-map-key font-mono text-xs text-occ-faint">{key}</span>
              {/* A narrow map (occ-map.css) shows the short word and keeps the full one for assistive technology. */}
              <span className="occ-map-label-full">{label[language] ?? label.es}</span>
              {SHORT_LABELS[view] ? (
                <span aria-hidden="true" className="occ-map-label-short">
                  {SHORT_LABELS[view][language] ?? SHORT_LABELS[view].es}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <Map3dToggle />
    </>
  );
}
